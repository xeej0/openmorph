import { PDFDocument, degrees } from 'pdf-lib';
import { $, $$, fileBox, Results, baseName, parseRanges, setBusy, plural, isImage, isPdf } from './util.js';
import { loadImage } from './image.js';

let pdfjs;
async function getPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  }
  return pdfjs;
}

const pdfBlob = (bytes) => new Blob([bytes], { type: 'application/pdf' });
const canvasBlob = (c, type, q) => new Promise((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('page too large to render'))), type, q));
const RANGES = (ph = 'all pages') => `<label>Pages <span class="hint">e.g. 1-3, 5, 8-</span><input id="p-ranges" type="text" placeholder="${ph}"></label>`;

const MODES = {
  img2pdf: {
    title: 'Drop images or click to browse', hint: 'Each image becomes a page. Drag to reorder.', accept: isImage, acceptAttr: 'image/*,.heic,.heif', min: 1, sortable: true,
    btn: (n) => `Create PDF from ${plural(n, 'image')}`,
    opts: `<label>Page size<select id="p-size"><option value="fit">Same as image</option><option value="a4">A4</option><option value="letter">US Letter</option></select></label>
           <label>Margin<select id="p-margin"><option value="0">None</option><option value="18">Small</option><option value="36">Normal</option><option value="72">Large</option></select></label>
           <label>Image quality<select id="p-iq"><option value="0.92">High</option><option value="0.75" selected>Medium (smaller file)</option><option value="0.55">Low (smallest)</option></select></label>`,
  },
  merge: { title: 'Drop PDFs or click to browse', hint: 'Add 2 or more. Drag to set the order.', accept: isPdf, acceptAttr: '.pdf,application/pdf', min: 2, sortable: true,
    btn: (n) => (n < 2 ? 'Add at least 2 PDFs' : `Merge ${plural(n, 'PDF')}`), opts: '' },
  split: {
    title: 'Drop a PDF or click to browse', hint: 'Pull out specific pages, or split every page into its own file.', accept: isPdf, acceptAttr: '.pdf,application/pdf', min: 1,
    btn: () => 'Split PDF',
    opts: `<label>Output<select id="p-split"><option value="extract">Selected pages as one PDF</option><option value="each">Each page as its own PDF</option></select></label>${RANGES()}`,
  },
  pdf2img: {
    title: 'Drop a PDF or click to browse', hint: 'Every page becomes an image.', accept: isPdf, acceptAttr: '.pdf,application/pdf', min: 1,
    btn: (n) => `Convert ${plural(n, 'PDF')} to images`,
    opts: `<label>Format<select id="p-fmt"><option value="image/png">PNG (sharp)</option><option value="image/jpeg" selected>JPG (smaller)</option><option value="image/webp">WebP</option></select></label>
           <label>Resolution<select id="p-dpi"><option value="72">Low · 72 DPI</option><option value="150" selected>Medium · 150 DPI</option><option value="300">High · 300 DPI (print)</option></select></label>${RANGES()}`,
  },
  compress: {
    title: 'Drop PDFs or click to browse', hint: 'Great for scans and photo-heavy PDFs.', accept: isPdf, acceptAttr: '.pdf,application/pdf', min: 1,
    btn: (n) => `Compress ${plural(n, 'PDF')}`,
    opts: `<label>Strength<select id="p-level"><option value="light">Light · keeps text selectable</option><option value="medium" selected>Strong · 150 DPI</option><option value="high">Extreme · 96 DPI</option></select></label>
           <label class="jq">Image quality<select id="p-jq"><option value="0.8">High</option><option value="0.65" selected>Medium</option><option value="0.45">Low</option></select></label>
           <p class="note lvl-note" style="grid-column:1/-1;margin:0">Strong and Extreme turn each page into an image, so text can no longer be selected or searched.</p>`,
  },
  rotate: {
    title: 'Drop PDFs or click to browse', hint: 'Turn all pages or just some of them.', accept: isPdf, acceptAttr: '.pdf,application/pdf', min: 1,
    btn: (n) => `Rotate ${plural(n, 'PDF')}`,
    opts: `<label>Direction<select id="p-rot"><option value="90">↻ 90° right</option><option value="270">↺ 90° left</option><option value="180">180° (upside down)</option></select></label>${RANGES()}`,
  },
};

async function imagesToPdf(files, onStep) {
  const doc = await PDFDocument.create();
  const size = $('#p-size').value, margin = +$('#p-margin').value || 0, iq = +$('#p-iq').value;
  for (const [i, f] of files.entries()) {
    onStep(`Adding image ${i + 1} of ${files.length}…`);
    const img = await loadImage(f);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || 1000; c.height = img.naturalHeight || 1000;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const keepPng = f.type === 'image/png' && iq >= 0.9;
    const bytes = new Uint8Array(await (await canvasBlob(c, keepPng ? 'image/png' : 'image/jpeg', iq)).arrayBuffer());
    const emb = keepPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    // 1 image pixel = 0.75pt (96 DPI) for "same as image"
    const iw = emb.width * 0.75, ih = emb.height * 0.75;
    let pw, ph;
    if (size === 'fit') { pw = iw + margin * 2; ph = ih + margin * 2; }
    else {
      [pw, ph] = size === 'a4' ? [595.28, 841.89] : [612, 792];
      if (iw > ih) [pw, ph] = [ph, pw];
    }
    const page = doc.addPage([pw, ph]);
    const s = Math.min((pw - margin * 2) / iw, (ph - margin * 2) / ih);
    const w = iw * s, h = ih * s;
    page.drawImage(emb, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  return doc.save();
}

async function loadPdf(file) {
  let doc;
  try { doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true }); }
  catch { throw new Error(`"${file.name}" isn't a readable PDF`); }
  if (doc.isEncrypted) throw new Error(`"${file.name}" is password-protected. Unlock it first.`);
  return doc;
}

async function openPdfjs(file) {
  const lib = await getPdfjs();
  try { return await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise; }
  catch (e) { throw new Error(e?.name === 'PasswordException' ? `"${file.name}" is password-protected` : `"${file.name}" isn't a readable PDF`); }
}

async function renderPage(page, scale, type, q) {
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const blob = await canvasBlob(c, type, q);
  c.width = c.height = 0; // free memory early
  page.cleanup();
  return blob;
}

export function initPdf() {
  const go = $('#pdf-go'), results = new Results($('#pdf-results'));
  const step = $('#tab-pdf .step');
  let mode = 'img2pdf';
  const label = () => {
    const n = box.files.length, m = MODES[mode];
    go.disabled = n < m.min;
    go.textContent = n ? m.btn(n) : 'Add files to start';
  };
  const box = fileBox({
    inputId: 'pdf-files', listEl: $('#pdf-list'), sortable: true,
    accept: (f) => MODES[mode].accept(f),
    onChange: (f) => { step.hidden = !f.length || !MODES[mode].opts; label(); results.reset(); },
  });

  const setMode = (m) => {
    if (!MODES[m]) return;
    const prev = MODES[mode];
    mode = m;
    const M = MODES[m];
    $$('#pdf-modes button').forEach((b) => { const on = b.dataset.mode === m; b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; });
    $('#pdf-drop-title').textContent = M.title;
    $('#pdf-drop-hint').textContent = M.hint;
    $('#pdf-opts').innerHTML = M.opts;
    box.input.accept = M.acceptAttr;
    // keep files that still fit the new tool
    if (prev.accept !== M.accept) box.clear(); else { label(); step.hidden = !box.files.length || !M.opts; results.reset(); }
    const lvl = $('#p-level');
    if (lvl) {
      const sync = () => { const light = lvl.value === 'light'; $('.jq').hidden = light; $('.lvl-note').hidden = light; };
      lvl.addEventListener('change', sync); sync();
    }
  };
  $('#pdf-modes').addEventListener('click', (e) => { const b = e.target.closest('button[data-mode]'); if (b) setMode(b.dataset.mode); });
  $('#pdf-modes').addEventListener('keydown', (e) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!keys[e.key]) return;
    e.preventDefault();
    const btns = $$('#pdf-modes button'), i = btns.findIndex((b) => b.dataset.mode === mode);
    const n = btns[(i + keys[e.key] + btns.length) % btns.length]; setMode(n.dataset.mode); n.focus();
  });
  setMode('img2pdf');

  const api = { setMode, box, get mode() { return mode; } };

  go.addEventListener('click', async () => {
    results.reset();
    const files = [...box.files];
    const status = (t) => setBusy(go, t);
    status('Working…');
    const ranges = () => $('#p-ranges')?.value.trim() || '';
    try {
      if (mode === 'img2pdf') {
        const total = files.reduce((a, f) => a + f.size, 0);
        const bytes = await imagesToPdf(files, status);
        results.add({ blob: pdfBlob(bytes), name: `${baseName(files[0].name)}.pdf`, origSize: total, meta: plural(files.length, 'page') });
      }

      if (mode === 'merge') {
        const out = await PDFDocument.create();
        let pages = 0;
        for (const [i, f] of files.entries()) {
          status(`Merging ${i + 1} of ${files.length}…`);
          const src = await loadPdf(f);
          (await out.copyPages(src, src.getPageIndices())).forEach((p) => { out.addPage(p); pages++; });
        }
        results.add({ blob: pdfBlob(await out.save()), name: 'merged.pdf', meta: plural(pages, 'page') });
      }

      if (mode === 'split') {
        for (const f of files) {
          const src = await loadPdf(f);
          const idx = ranges() ? parseRanges(ranges(), src.getPageCount()) : src.getPageIndices();
          if ($('#p-split').value === 'extract') {
            const out = await PDFDocument.create();
            (await out.copyPages(src, idx)).forEach((p) => out.addPage(p));
            results.add({ blob: pdfBlob(await out.save()), name: `${baseName(f.name)}-pages.pdf`, meta: plural(idx.length, 'page') });
          } else {
            for (const i of idx) {
              status(`Splitting page ${i + 1} of ${src.getPageCount()}…`);
              const out = await PDFDocument.create();
              out.addPage((await out.copyPages(src, [i]))[0]);
              results.add({ blob: pdfBlob(await out.save()), name: `${baseName(f.name)}-page-${i + 1}.pdf` });
            }
          }
        }
      }

      if (mode === 'pdf2img') {
        const type = $('#p-fmt').value, scale = +$('#p-dpi').value / 72;
        const extn = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[type];
        for (const f of files) {
          const pdf = await openPdfjs(f);
          const idx = ranges() ? parseRanges(ranges(), pdf.numPages) : [...Array(pdf.numPages).keys()];
          for (const i of idx) {
            status(`Rendering page ${i + 1} of ${pdf.numPages}…`);
            const blob = await renderPage(await pdf.getPage(i + 1), scale, type, 0.9);
            results.add({ blob, name: `${baseName(f.name)}-page-${i + 1}.${extn}`, thumb: true });
          }
          pdf.destroy();
        }
      }

      if (mode === 'compress') {
        const level = $('#p-level').value, jq = +$('#p-jq').value;
        for (const f of files) {
          let bytes;
          if (level === 'light') {
            status(`Optimizing ${f.name}…`);
            const src = await loadPdf(f);
            bytes = await src.save({ useObjectStreams: true });
          } else {
            const scale = (level === 'high' ? 96 : 150) / 72;
            const pdf = await openPdfjs(f);
            const out = await PDFDocument.create();
            for (let i = 1; i <= pdf.numPages; i++) {
              status(`Compressing page ${i} of ${pdf.numPages}…`);
              const page = await pdf.getPage(i);
              const base = page.getViewport({ scale: 1 });
              const jpg = await out.embedJpg(new Uint8Array(await (await renderPage(page, scale, 'image/jpeg', jq)).arrayBuffer()));
              out.addPage([base.width, base.height]).drawImage(jpg, { x: 0, y: 0, width: base.width, height: base.height });
            }
            pdf.destroy();
            bytes = await out.save({ useObjectStreams: true });
          }
          const smaller = bytes.length < f.size;
          results.add({ blob: smaller ? pdfBlob(bytes) : f, name: `${baseName(f.name)}-compressed.pdf`, origSize: f.size,
            meta: smaller ? '' : 'already optimized, kept original' });
          if (!smaller) results.warn(`${f.name} couldn't be made smaller at this level. Try a stronger setting.`);
        }
      }

      if (mode === 'rotate') {
        const deg = +$('#p-rot').value;
        for (const f of files) {
          const src = await loadPdf(f);
          const idx = ranges() ? parseRanges(ranges(), src.getPageCount()) : src.getPageIndices();
          idx.forEach((i) => { const p = src.getPage(i); p.setRotation(degrees((p.getRotation().angle + deg) % 360)); });
          results.add({ blob: pdfBlob(await src.save()), name: `${baseName(f.name)}-rotated.pdf`, meta: `${plural(idx.length, 'page')} rotated` });
        }
      }
    } catch (e) {
      results.error(e.message || String(e));
    }
    await results.finish({ split: 'split-pages.zip', pdf2img: 'pdf-pages.zip', compress: 'compressed-pdfs.zip', rotate: 'rotated-pdfs.zip' }[mode] || 'openmorph.zip');
    setBusy(go); label();
  });

  return api;
}
