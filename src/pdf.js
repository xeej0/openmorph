import { PDFDocument, degrees } from 'pdf-lib';
import { $, fileBox, resetResults, addResult, addZip, addError, baseName, parseRanges } from './util.js';
import { loadImage } from './image.js';

let pdfjs;
async function getPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('pdfjs-dist');
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = worker;
  }
  return pdfjs;
}

const pdfBlob = (bytes) => new Blob([bytes], { type: 'application/pdf' });
const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const canvasBlob = (c, type, q) => new Promise((r) => c.toBlob(r, type, q));

const MODES = {
  img2pdf: {
    title: 'Drop images here', hint: 'JPG, PNG, WebP, GIF… Drag rows to reorder pages.', accept: 'image/*', sortable: true, min: 1,
    opts: `<label>Page size<select id="p-size"><option value="fit">Fit to image</option><option value="a4">A4</option><option value="letter">US Letter</option></select></label>
           <label>Margin (pt)<input id="p-margin" type="number" min="0" value="0"></label>
           <label>Image quality<select id="p-iq"><option value="0.92">High</option><option value="0.75">Medium (smaller)</option><option value="0.55">Low (smallest)</option></select></label>`,
  },
  merge: { title: 'Drop PDFs here', hint: 'Drag rows to set the order.', accept: '.pdf,application/pdf', sortable: true, min: 2, opts: '' },
  split: {
    title: 'Drop a PDF here', hint: 'Pick pages to extract, or split every page into its own file.', accept: '.pdf,application/pdf', min: 1,
    opts: `<label>Mode<select id="p-split"><option value="extract">Extract pages into one PDF</option><option value="each">Every page as a separate PDF</option></select></label>
           <label>Pages (e.g. 1-3, 5, 8-)<input id="p-ranges" type="text" placeholder="all"></label>`,
  },
  pdf2img: {
    title: 'Drop a PDF here', hint: 'Every page becomes an image.', accept: '.pdf,application/pdf', min: 1,
    opts: `<label>Format<select id="p-fmt"><option value="image/png">PNG</option><option value="image/jpeg">JPG</option><option value="image/webp">WebP</option></select></label>
           <label>Resolution<select id="p-dpi"><option value="72">72 DPI (screen)</option><option value="150" selected>150 DPI</option><option value="300">300 DPI (print)</option></select></label>
           <label>Pages (e.g. 1-3, 5)<input id="p-ranges" type="text" placeholder="all"></label>`,
  },
  compress: {
    title: 'Drop PDFs here', hint: 'Strong mode turns pages into images (text is no longer selectable) but shrinks scans massively.', accept: '.pdf,application/pdf', min: 1,
    opts: `<label>Level<select id="p-level"><option value="light">Light (keeps text, small savings)</option><option value="medium" selected>Strong · 150 DPI</option><option value="high">Extreme · 96 DPI</option></select></label>
           <label>JPEG quality<select id="p-jq"><option value="0.8">High</option><option value="0.65" selected>Medium</option><option value="0.45">Low</option></select></label>`,
  },
  rotate: {
    title: 'Drop PDFs here', hint: 'Rotate all or some pages.', accept: '.pdf,application/pdf', min: 1,
    opts: `<label>Rotate<select id="p-rot"><option value="90">90° clockwise</option><option value="180">180°</option><option value="270">90° counter-clockwise</option></select></label>
           <label>Pages (e.g. 1-3, 5)<input id="p-ranges" type="text" placeholder="all"></label>`,
  },
};

async function imagesToPdf(files) {
  const doc = await PDFDocument.create();
  const size = $('#p-size').value, margin = +$('#p-margin').value || 0, iq = +$('#p-iq').value;
  for (const f of files) {
    const img = await loadImage(f);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    const png = f.type === 'image/png' || f.type === 'image/gif';
    if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.drawImage(img, 0, 0);
    const bytes = new Uint8Array(await (await canvasBlob(c, png ? 'image/png' : 'image/jpeg', iq)).arrayBuffer());
    const emb = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    let pw, ph;
    if (size === 'fit') { pw = emb.width + margin * 2; ph = emb.height + margin * 2; }
    else {
      [pw, ph] = size === 'a4' ? [595.28, 841.89] : [612, 792];
      if (emb.width > emb.height) [pw, ph] = [ph, pw];
    }
    const page = doc.addPage([pw, ph]);
    const s = Math.min((pw - margin * 2) / emb.width, (ph - margin * 2) / emb.height);
    const w = emb.width * s, h = emb.height * s;
    page.drawImage(emb, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  return doc.save();
}

async function loadPdf(file) {
  try { return await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true }); }
  catch { throw new Error(`Couldn't read "${file.name}" (is it a valid, unlocked PDF?)`); }
}

export function initPdf() {
  const go = $('#pdf-go'), results = $('#pdf-results'), modeSel = $('#pdf-mode');
  const input = $('#pdf-files');
  let mode = modeSel.value;
  const box = fileBox({
    inputId: 'pdf-files', listEl: $('#pdf-list'), sortable: true,
    onChange: (f) => (go.disabled = f.length < MODES[mode].min),
  });
  const setMode = () => {
    mode = modeSel.value;
    const m = MODES[mode];
    $('#pdf-drop-title').textContent = m.title;
    $('#pdf-drop-hint').textContent = m.hint;
    $('#pdf-opts').innerHTML = m.opts;
    input.accept = m.accept;
    box.clear(); resetResults(results);
  };
  modeSel.addEventListener('change', setMode);
  setMode();

  go.addEventListener('click', async () => {
    resetResults(results);
    const label = go.textContent;
    go.disabled = true; go.textContent = 'Working…';
    const files = box.files;
    const totalIn = files.reduce((a, f) => a + f.size, 0);
    try {
      if (mode !== 'img2pdf') {
        const bad = files.find((f) => !isPdf(f));
        if (bad) throw new Error(`"${bad.name}" is not a PDF`);
      }
      if (mode === 'img2pdf') {
        addResult(results, { blob: pdfBlob(await imagesToPdf(files)), name: `${baseName(files[0].name)}.pdf`, origSize: totalIn });
      }

      if (mode === 'merge') {
        const out = await PDFDocument.create();
        for (const f of files) {
          const src = await loadPdf(f);
          (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
        }
        addResult(results, { blob: pdfBlob(await out.save()), name: 'merged.pdf', origSize: totalIn });
      }

      if (mode === 'split') {
        const done = [];
        for (const f of files) {
          const src = await loadPdf(f);
          const r = $('#p-ranges').value.trim();
          const idx = r ? parseRanges(r, src.getPageCount()) : src.getPageIndices();
          if (!idx.length) throw new Error('No valid pages selected');
          if ($('#p-split').value === 'extract') {
            const out = await PDFDocument.create();
            (await out.copyPages(src, idx)).forEach((p) => out.addPage(p));
            const item = { blob: pdfBlob(await out.save()), name: `${baseName(f.name)}-pages.pdf` };
            done.push(item); addResult(results, item);
          } else {
            for (const i of idx) {
              go.textContent = `Splitting page ${i + 1}…`;
              const out = await PDFDocument.create();
              out.addPage((await out.copyPages(src, [i]))[0]);
              const item = { blob: pdfBlob(await out.save()), name: `${baseName(f.name)}-page-${i + 1}.pdf` };
              done.push(item); addResult(results, item);
            }
          }
        }
        await addZip(results, done, 'split-pages.zip');
      }

      if (mode === 'pdf2img') {
        const lib = await getPdfjs();
        const type = $('#p-fmt').value, scale = +$('#p-dpi').value / 72;
        const extn = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[type];
        const done = [];
        for (const f of files) {
          const pdf = await lib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
          const r = $('#p-ranges').value.trim();
          const idx = r ? parseRanges(r, pdf.numPages) : [...Array(pdf.numPages).keys()];
          for (const i of idx) {
            go.textContent = `Rendering page ${i + 1} / ${pdf.numPages}…`;
            const page = await pdf.getPage(i + 1);
            const vp = page.getViewport({ scale });
            const c = document.createElement('canvas');
            c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
            await page.render({ canvasContext: ctx, viewport: vp }).promise;
            const item = { blob: await canvasBlob(c, type, 0.9), name: `${baseName(f.name)}-page-${i + 1}.${extn}` };
            done.push(item); addResult(results, { ...item, thumb: true });
          }
        }
        await addZip(results, done, 'pdf-images.zip');
      }

      if (mode === 'compress') {
        const level = $('#p-level').value, jq = +$('#p-jq').value;
        const done = [];
        for (const f of files) {
          let bytes;
          if (level === 'light') {
            const src = await loadPdf(f);
            src.setProducer('OpenMorph'); src.setCreator('OpenMorph');
            bytes = await src.save({ useObjectStreams: true });
          } else {
            const lib = await getPdfjs();
            const scale = (level === 'high' ? 96 : 150) / 72;
            const pdf = await lib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
            const out = await PDFDocument.create();
            for (let i = 1; i <= pdf.numPages; i++) {
              go.textContent = `Compressing page ${i} / ${pdf.numPages}…`;
              const page = await pdf.getPage(i);
              const base = page.getViewport({ scale: 1 });
              const vp = page.getViewport({ scale });
              const c = document.createElement('canvas');
              c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
              const ctx = c.getContext('2d');
              ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
              await page.render({ canvasContext: ctx, viewport: vp }).promise;
              const jpg = await out.embedJpg(new Uint8Array(await (await canvasBlob(c, 'image/jpeg', jq)).arrayBuffer()));
              const p = out.addPage([base.width, base.height]);
              p.drawImage(jpg, { x: 0, y: 0, width: base.width, height: base.height });
            }
            bytes = await out.save({ useObjectStreams: true });
          }
          const blob = bytes.length < f.size ? pdfBlob(bytes) : f; // never return a bigger file
          const item = { blob, name: `${baseName(f.name)}-compressed.pdf` };
          done.push(item); addResult(results, { ...item, origSize: f.size });
          if (blob === f) addError(results, `${f.name}: already well optimized, kept the original. Try a stronger level.`);
        }
        await addZip(results, done, 'compressed-pdfs.zip');
      }

      if (mode === 'rotate') {
        const done = [];
        const deg = +$('#p-rot').value;
        for (const f of files) {
          const src = await loadPdf(f);
          const r = $('#p-ranges').value.trim();
          const idx = r ? parseRanges(r, src.getPageCount()) : src.getPageIndices();
          idx.forEach((i) => { const p = src.getPage(i); p.setRotation(degrees((p.getRotation().angle + deg) % 360)); });
          const item = { blob: pdfBlob(await src.save()), name: `${baseName(f.name)}-rotated.pdf` };
          done.push(item); addResult(results, item);
        }
        await addZip(results, done, 'rotated-pdfs.zip');
      }
    } catch (e) {
      console.error(e);
      addError(results, e.message || String(e));
    }
    go.textContent = label;
    go.disabled = box.files.length < MODES[mode].min;
  });
}
