import { $, $$, fileBox, Results, baseName, setBusy, plural, isImage } from './util.js';

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };
const isHeic = (f) => /image\/hei[cf]/.test(f.type) || /\.hei[cf]$/i.test(f.name);

async function decodeHeic(file) {
  const { default: heic2any } = await import('heic2any');
  const out = await heic2any({ blob: file, toType: 'image/png' });
  return Array.isArray(out) ? out[0] : out;
}

/** Decode any browser-supported image (plus HEIC via WASM) into an <img>. */
export async function loadImage(file) {
  let src = file;
  const tryDecode = async (blob) => {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
  };
  try { return await tryDecode(src); }
  catch {
    if (isHeic(file)) {
      try { return await tryDecode(await decodeHeic(file)); }
      catch { throw new Error("couldn't read this HEIC photo"); }
    }
    throw new Error("your browser can't open this image type");
  }
}

const toBlob = (canvas, type, q) =>
  new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encoding failed (image may be too large)'))), type, q));

async function encode(canvas, type, quality, targetBytes) {
  const lossy = type !== 'image/png';
  let blob = await toBlob(canvas, type, lossy ? quality : undefined);
  if (blob.type !== type) throw new Error(`your browser can't save ${EXT[type].toUpperCase()} (try WebP or JPG)`);
  if (!targetBytes || blob.size <= targetBytes) return blob;
  if (lossy) {
    let lo = 0.05, hi = quality, best = null;
    for (let i = 0; i < 7; i++) {
      const mid = (lo + hi) / 2;
      const b = await toBlob(canvas, type, mid);
      if (b.size <= targetBytes) { best = b; lo = mid; } else hi = mid;
    }
    if (best && best.size > targetBytes * 0.5) return best;
    if (best) blob = best;
  }
  // still too big: shrink dimensions until it fits
  let c = canvas;
  for (let i = 0; i < 15 && blob.size > targetBytes; i++) {
    const n = document.createElement('canvas');
    n.width = Math.max(1, Math.round(c.width * 0.85));
    n.height = Math.max(1, Math.round(c.height * 0.85));
    const ctx = n.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, n.width, n.height);
    c = n;
    blob = await toBlob(c, type, lossy ? Math.min(quality, 0.7) : undefined);
  }
  return blob;
}

/** Read a few bytes to guess whether an image might have transparency worth keeping. */
const mayHaveAlpha = (f) => /png|gif|webp|avif|svg|heic|heif/i.test(f.type || f.name);

export function initImage() {
  const go = $('#img-go'), results = new Results($('#img-results'));
  const fmt = $('#img-format'), q = $('#img-quality'), resize = $('#img-resize');
  const label = () => {
    const n = box.files.length;
    go.textContent = n ? `Process ${plural(n, 'image')}` : 'Add images to start';
    go.disabled = !n;
  };
  const step = $('#tab-image .step');
  step.hidden = true;
  const box = fileBox({ inputId: 'img-files', listEl: $('#img-list'), accept: isImage, onChange: (f) => { step.hidden = !f.length; label(); results.reset(); } });

  const syncQ = () => {
    $('#img-q-val').textContent = q.value + '%';
    const png = fmt.value === 'image/png';
    q.disabled = png;
    $('#img-q-wrap').title = png ? 'PNG is lossless, quality does not apply' : '';
    $('#img-q-wrap').style.opacity = png ? .5 : 1;
  };
  q.addEventListener('input', syncQ);
  fmt.addEventListener('change', syncQ);
  const syncResize = () => {
    $$('.rz').forEach((el) => (el.hidden = true));
    $$('.rz-' + resize.value).forEach((el) => (el.hidden = false));
  };
  resize.addEventListener('change', syncResize);

  // presets
  const presets = {
    compress: { fmt: 'same', q: 70, resize: 'none', target: '' },
    jpg: { fmt: 'image/jpeg', q: 85, resize: 'none', target: '' },
    png: { fmt: 'image/png', q: 80, resize: 'none', target: '' },
    webp: { fmt: 'image/webp', q: 80, resize: 'none', target: '' },
    web: { fmt: 'image/webp', q: 80, resize: 'dims', w: 1920, h: 1920, target: '' },
    '1mb': { fmt: 'image/jpeg', q: 85, resize: 'none', target: 1000 },
  };
  $('#img-presets').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-p]'); if (!b) return;
    const p = presets[b.dataset.p];
    fmt.value = p.fmt; q.value = p.q; resize.value = p.resize;
    $('#img-target').value = p.target;
    if (p.w) { $('#img-w').value = p.w; $('#img-h').value = p.h; }
    $$('#img-presets button').forEach((x) => x.classList.toggle('on', x === b));
    syncQ(); syncResize();
  });
  $('#tab-image .opts').addEventListener('input', () => $$('#img-presets button').forEach((x) => x.classList.remove('on')));
  syncQ();

  go.addEventListener('click', async () => {
    results.reset();
    const quality = +q.value / 100;
    const mode = resize.value, pct = +$('#img-percent').value || 100;
    const mw = +$('#img-w').value || Infinity, mh = +$('#img-h').value || Infinity;
    const target = +$('#img-target').value ? +$('#img-target').value * 1024 : 0;
    const files = [...box.files];
    for (const [i, file] of files.entries()) {
      setBusy(go, `Processing ${i + 1} of ${files.length}…`);
      await new Promise(requestAnimationFrame); // let the UI paint between files
      try {
        let type = fmt.value === 'same' ? file.type : fmt.value;
        if (!EXT[type]) type = mayHaveAlpha(file) ? 'image/png' : 'image/jpeg'; // GIF/BMP/SVG/HEIC with "keep"
        if (isHeic(file) && fmt.value === 'same') type = 'image/jpeg';

        const img = await loadImage(file);
        const ow = img.naturalWidth || img.width || 1024, oh = img.naturalHeight || img.height || 1024;
        let w = ow, h = oh;
        if (mode === 'percent') { w = Math.round(w * pct / 100); h = Math.round(h * pct / 100); }
        if (mode === 'dims') { const s = Math.min(1, mw / w, mh / h); w = Math.round(w * s); h = Math.round(h * s); }
        const c = document.createElement('canvas');
        c.width = Math.max(1, w); c.height = Math.max(1, h);
        const ctx = c.getContext('2d');
        if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        let blob = await encode(c, type, quality, target);
        let note = '';
        // never hand back a bigger file in the same format when nothing else was asked for
        const sameFmt = type === file.type, noResize = mode === 'none' || (w === ow && h === oh);
        if (sameFmt && noResize && blob.size >= file.size) { blob = file; note = 'already optimal, kept original'; }
        const name = `${baseName(file.name)}.${EXT[type]}`;
        const dims = blob === file ? `${ow}×${oh}` : await dimsOf(blob, c);
        results.add({ blob, name, origSize: file.size, thumb: true, meta: [dims, note].filter(Boolean).join(' · ') });
      } catch (e) {
        results.error(`${file.name}: ${e.message}`);
      }
    }
    await results.finish('openmorph-images.zip');
    setBusy(go); label();
  });
  return { box };
}

async function dimsOf(blob, canvas) {
  // after target-size shrinking the encoded size may differ from the canvas, so read it back
  try { const b = await createImageBitmap(blob); const s = `${b.width}×${b.height}`; b.close(); return s; }
  catch { return `${canvas.width}×${canvas.height}`; }
}
