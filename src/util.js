export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 ** 2) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 ** 3) return (b / 1024 ** 2).toFixed(2) + ' MB';
  return (b / 1024 ** 3).toFixed(2) + ' GB';
}
export const baseName = (n) => n.replace(/\.[^.]+$/, '') || 'file';
export const ext = (n) => (n.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

let toastTimer;
export function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
}

export function setBusy(btn, text) {
  if (text) { btn.classList.add('busy'); btn.disabled = true; btn.textContent = text; }
  else btn.classList.remove('busy');
}

/**
 * A drop zone + file list. Shows thumbnails, count/total, clear all, reorder.
 * accept(file) filters what is added; rejected files raise a toast.
 */
export function fileBox({ inputId, listEl, onChange, sortable = false, accept = () => true, single = false }) {
  const input = document.getElementById(inputId);
  const drop = input.closest('.drop');
  const panel = input.closest('.panel');
  let files = [];
  let thumbs = new Map();

  const thumbFor = (f) => {
    if (!thumbs.has(f) && f.type.startsWith('image/') && !/hei[cf]/.test(f.type)) thumbs.set(f, URL.createObjectURL(f));
    return thumbs.get(f);
  };

  const render = () => {
    for (const [f, u] of thumbs) if (!files.includes(f)) { URL.revokeObjectURL(u); thumbs.delete(f); }
    panel.classList.toggle('has-files', files.length > 0);
    listEl.innerHTML = '';
    if (files.length) {
      const total = files.reduce((a, f) => a + f.size, 0);
      const head = document.createElement('div');
      head.className = 'files-head';
      head.innerHTML = `<span>${plural(files.length, 'file')} · ${fmtSize(total)}${sortable && files.length > 1 ? ' · drag to reorder' : ''}</span><button type="button" class="link-btn" data-a="clear">Clear all</button>`;
      listEl.appendChild(head);
      const rows = document.createElement('div');
      rows.className = 'file-rows' + (sortable ? ' sortable' : '');
      files.forEach((f, i) => {
        const row = document.createElement('div');
        row.className = 'file';
        row.draggable = sortable && files.length > 1;
        row.dataset.i = i;
        const t = thumbFor(f);
        row.innerHTML = `${row.draggable ? '<span class="grip" aria-hidden="true">⋮⋮</span>' : ''}
          ${t ? `<img class="th" src="${t}" alt="">` : `<span class="th">${esc(ext(f.name).slice(0, 4) || '?')}</span>`}
          <span class="name" title="${esc(f.name)}">${esc(f.name)}</span><span class="size">${fmtSize(f.size)}</span>
          ${sortable && files.length > 1 ? `<button type="button" title="Move up" aria-label="Move ${esc(f.name)} up" data-a="up" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" title="Move down" aria-label="Move ${esc(f.name)} down" data-a="down" ${i === files.length - 1 ? 'disabled' : ''}>↓</button>` : ''}
          <button type="button" title="Remove" aria-label="Remove ${esc(f.name)}" data-a="rm">✕</button>`;
        rows.appendChild(row);
      });
      listEl.appendChild(rows);
    }
    onChange(files);
  };

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-a]'); if (!btn) return;
    const a = btn.dataset.a;
    if (a === 'clear') { files = []; render(); return drop.focus(); }
    const i = +btn.closest('.file').dataset.i;
    let to = i;
    if (a === 'rm') files.splice(i, 1);
    if (a === 'up' && i > 0) { [files[i - 1], files[i]] = [files[i], files[i - 1]]; to = i - 1; }
    if (a === 'down' && i < files.length - 1) { [files[i + 1], files[i]] = [files[i], files[i + 1]]; to = i + 1; }
    render();
    if (!files.length) return drop.focus();
    const row = $$('.file', listEl)[Math.min(to, files.length - 1)];
    (row?.querySelector(`[data-a="${a}"]:not(:disabled)`) || row?.querySelector('[data-a="rm"]'))?.focus();
  });

  if (sortable) {
    let from = null;
    listEl.addEventListener('dragstart', (e) => { const r = e.target.closest?.('.file'); if (!r) return; from = +r.dataset.i; r.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); });
    listEl.addEventListener('dragend', () => { from = null; $$('.file', listEl).forEach((r) => r.classList.remove('dragging', 'drop-target')); });
    listEl.addEventListener('dragover', (e) => {
      if (from == null) return; e.preventDefault(); e.stopPropagation();
      $$('.file', listEl).forEach((r) => r.classList.toggle('drop-target', r === e.target.closest('.file')));
    });
    listEl.addEventListener('drop', (e) => {
      if (from == null) return;
      e.preventDefault(); e.stopPropagation();
      const to = e.target.closest('.file'); if (!to) return;
      const [m] = files.splice(from, 1); files.splice(+to.dataset.i, 0, m); from = null; render();
    });
  }

  const add = (list) => {
    list = [...list];
    // accept() returns true to keep a file, false to skip it, or a string explaining why it was skipped
    const reasons = [];
    const ok = list.filter((f) => { const r = accept(f); if (typeof r === 'string') reasons.push(r); return r === true; });
    if (reasons.length) toast(reasons[0], 5000);
    else if (ok.length < list.length) toast(`Skipped ${plural(list.length - ok.length, 'file')} this tool can't open`);
    if (!ok.length) return;
    files = single ? [ok[0]] : files.concat(ok);
    render();
  };
  input.addEventListener('change', () => { add(input.files); input.value = ''; });
  drop.addEventListener('click', (e) => { if (e.target !== input) input.click(); });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); hideGlobalDrop(); add(e.dataTransfer.files); });

  return { get files() { return files; }, clear() { files = []; render(); }, add, input };
}

export function hideGlobalDrop() { const g = $('#global-drop'); if (g) g.hidden = true; }

/** Results area: rows + a summary header with "download all". */
export class Results {
  constructor(el) { this.el = el; this.urls = []; this.items = []; this.inTotal = 0; this.outTotal = 0; this.compare = true; }
  reset() { this.urls.splice(0).forEach(URL.revokeObjectURL); this.items = []; this.inTotal = 0; this.outTotal = 0; this.el.innerHTML = ''; }
  url(blob) { const u = URL.createObjectURL(blob); this.urls.push(u); return u; }

  add({ blob, name, origSize, thumb = false, player = null, meta = '' }) {
    const url = this.url(blob);
    this.items.push({ blob, name });
    if (origSize) { this.inTotal += origSize; this.outTotal += blob.size; } else this.compare = false;
    const row = document.createElement('div');
    row.className = 'result';
    let delta = fmtSize(blob.size);
    if (origSize) {
      const pct = Math.round((1 - blob.size / origSize) * 100);
      delta = `${fmtSize(origSize)} → <b>${fmtSize(blob.size)}</b> ` +
        (pct > 0 ? `<span class="down">−${pct}%</span>` : pct < 0 ? `<span class="up">+${-pct}%</span>` : '<span>same size</span>');
    }
    const th = thumb ? `<img class="thumb" src="${url}" alt="" loading="lazy">` : `<span class="thumb">${esc(ext(name))}</span>`;
    row.innerHTML = `${th}<div class="info"><div class="n">${esc(name)}</div><div class="delta">${delta}${meta ? ' · ' + esc(meta) : ''}</div></div>
      <a class="dl" href="${url}" download="${esc(name)}" aria-label="Download ${esc(name)}">⬇ Download</a>
      ${player ? `<div class="player">${player === 'video' ? `<video src="${url}" controls preload="metadata" playsinline></video>` : `<audio src="${url}" controls preload="metadata"></audio>`}</div>` : ''}`;
    this.el.appendChild(row);
  }

  error(msg) {
    const d = document.createElement('div'); d.className = 'err'; d.textContent = '⚠ ' + msg; this.el.appendChild(d);
  }
  warn(msg) {
    const d = document.createElement('div'); d.className = 'warn'; d.textContent = msg; this.el.appendChild(d);
  }

  async finish(zipName) {
    const n = this.items.length;
    if (!n) return;
    const head = document.createElement('div');
    head.className = 'res-head';
    let sub = '';
    if (this.compare && this.inTotal) {
      const saved = this.inTotal - this.outTotal;
      sub = saved > 0 ? `Saved ${fmtSize(saved)} (${Math.round((saved / this.inTotal) * 100)}% smaller)` : `${fmtSize(this.inTotal)} → ${fmtSize(this.outTotal)}`;
    }
    head.innerHTML = `<div class="sum">✓ ${plural(n, 'file')} ready${sub ? `<small>${sub}</small>` : ''}</div>`;
    if (n > 1) {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const seen = new Set();
      for (const { blob, name } of this.items) {
        let nm = name, k = 1;
        while (seen.has(nm)) nm = `${baseName(name)} (${k++}).${ext(name)}`;
        seen.add(nm); zip.file(nm, blob);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      head.insertAdjacentHTML('beforeend', `<a class="dl primary" href="${this.url(blob)}" download="${esc(zipName)}">⬇ Download all (.zip, ${fmtSize(blob.size)})</a>`);
    } else {
      const { blob, name } = this.items[0];
      head.insertAdjacentHTML('beforeend', `<a class="dl primary" href="${this.url(blob)}" download="${esc(name)}">⬇ Download</a>`);
    }
    this.el.prepend(head);
    head.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/** Parse "1-3, 5, 8-" (1-based) into 0-based page indexes. */
export function parseRanges(str, total) {
  const out = [];
  for (const part of str.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    if (m) {
      const a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : total;
      for (let i = a; i <= b; i++) if (i >= 1 && i <= total) out.push(i - 1);
    } else if (/^\d+$/.test(part)) {
      const i = +part; if (i >= 1 && i <= total) out.push(i - 1);
    } else throw new Error(`"${part}" isn't a valid page range. Use something like 1-3, 5`);
  }
  if (!out.length) throw new Error(`None of those pages exist (this PDF has ${total} pages)`);
  return [...new Set(out)];
}

export function parseTime(s) {
  s = (s || '').trim(); if (!s) return null;
  const parts = s.split(':').map(Number);
  if (parts.length > 3 || parts.some((p) => isNaN(p) || p < 0)) throw new Error(`"${s}" isn't a valid time. Use seconds (90) or m:ss (1:30)`);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export const isImage = (f) => f.type.startsWith('image/') || /\.(heic|heif|avif|webp|jpe?g|png|gif|bmp|svg|ico|tiff?)$/i.test(f.name);
export const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
export const isMedia = (f) => /^(video|audio)\//.test(f.type) || /\.(mp4|m4v|mov|mkv|webm|avi|wmv|flv|ts|3gp|mp3|wav|m4a|aac|flac|ogg|oga|opus|wma|aiff?)$/i.test(f.name);
