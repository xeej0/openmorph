import { $, $$, fileBox, resetResults, addResult, addZip, addError, baseName } from './util.js';

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };

export async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error(`Your browser can't decode "${file.name}"`);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

const toBlob = (canvas, type, q) =>
  new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Encoding failed'))), type, q));

export async function encodeCanvas(canvas, type, quality, targetBytes) {
  const lossy = type !== 'image/png';
  let blob = await toBlob(canvas, type, quality);
  if (blob.type !== type) throw new Error(`Your browser can't encode ${EXT[type]?.toUpperCase() || type}`);
  if (!targetBytes || blob.size <= targetBytes) return blob;
  if (lossy) {
    // binary search quality to hit the target size
    let lo = 0.02, hi = quality, best = null;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      const b = await toBlob(canvas, type, mid);
      if (b.size <= targetBytes) { best = b; lo = mid; } else hi = mid;
    }
    if (best) return best;
  }
  // still too big (or PNG): shrink dimensions step by step
  let c = canvas;
  for (let i = 0; i < 12 && blob.size > targetBytes; i++) {
    const n = document.createElement('canvas');
    n.width = Math.max(1, Math.round(c.width * 0.85));
    n.height = Math.max(1, Math.round(c.height * 0.85));
    n.getContext('2d').drawImage(c, 0, 0, n.width, n.height);
    c = n;
    blob = await toBlob(c, type, lossy ? Math.min(quality, 0.6) : undefined);
  }
  return blob;
}

export function initImage() {
  const go = $('#img-go'), results = $('#img-results');
  const box = fileBox({ inputId: 'img-files', listEl: $('#img-list'), onChange: (f) => (go.disabled = !f.length) });

  const q = $('#img-quality');
  q.addEventListener('input', () => ($('#img-q-val').textContent = q.value));
  $('#img-resize').addEventListener('change', (e) => {
    $$('.rz').forEach((el) => (el.hidden = true));
    $$('.rz-' + e.target.value).forEach((el) => (el.hidden = false));
  });

  go.addEventListener('click', async () => {
    resetResults(results);
    go.disabled = true;
    const fmt = $('#img-format').value, quality = +q.value / 100;
    const mode = $('#img-resize').value, pct = +$('#img-percent').value || 100;
    const mw = +$('#img-w').value || Infinity, mh = +$('#img-h').value || Infinity;
    const target = +$('#img-target').value ? +$('#img-target').value * 1024 : 0;
    const strip = $('#img-strip').checked;
    const done = [];
    for (const [i, file] of box.files.entries()) {
      go.textContent = `Processing ${i + 1} / ${box.files.length}…`;
      try {
        let type = fmt === 'same' ? file.type : fmt;
        if (!EXT[type]) type = 'image/png'; // gif/bmp/svg/etc. become PNG when "keep" is chosen
        const unchanged = fmt === 'same' && mode === 'none' && !target && !strip && EXT[file.type];
        if (unchanged) { addResult(results, { blob: file, name: file.name, origSize: file.size, thumb: true }); continue; }

        const img = await loadImage(file);
        let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (mode === 'percent') { w = Math.round(w * pct / 100); h = Math.round(h * pct / 100); }
        if (mode === 'dims') { const s = Math.min(1, mw / w, mh / h); w = Math.round(w * s); h = Math.round(h * s); }
        const c = document.createElement('canvas');
        c.width = Math.max(1, w); c.height = Math.max(1, h);
        const ctx = c.getContext('2d');
        if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const blob = await encodeCanvas(c, type, quality, target);
        const name = `${baseName(file.name)}.${EXT[type]}`;
        done.push({ blob, name });
        addResult(results, { blob, name, origSize: file.size, thumb: true });
      } catch (e) {
        addError(results, `${file.name}: ${e.message}`);
      }
    }
    await addZip(results, done, 'openmorph-images.zip');
    go.textContent = 'Process images';
    go.disabled = false;
  });
}
