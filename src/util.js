import JSZip from 'jszip';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 ** 2) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 ** 3) return (b / 1024 ** 2).toFixed(2) + ' MB';
  return (b / 1024 ** 3).toFixed(2) + ' GB';
}

export const baseName = (n) => n.replace(/\.[^.]+$/, '');
export const ext = (n) => (n.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();

/** Wire a drop zone + hidden input to a mutable file list. */
export function fileBox({ inputId, listEl, onChange, sortable = false }) {
  const input = document.getElementById(inputId);
  const drop = input.closest('.drop');
  let files = [];

  const render = () => {
    listEl.innerHTML = '';
    files.forEach((f, i) => {
      const row = document.createElement('div');
      row.className = 'file';
      row.draggable = sortable;
      row.dataset.i = i;
      row.innerHTML = `${sortable ? '<span aria-hidden="true">⋮⋮</span>' : ''}<span class="name"></span><span class="size">${fmtSize(f.size)}</span>
        ${sortable ? '<button title="Move up" data-a="up">↑</button><button title="Move down" data-a="down">↓</button>' : ''}
        <button title="Remove" data-a="rm">✕</button>`;
      row.querySelector('.name').textContent = f.name;
      listEl.appendChild(row);
    });
    onChange(files);
  };

  listEl.addEventListener('click', (e) => {
    const a = e.target.dataset?.a; if (!a) return;
    const i = +e.target.closest('.file').dataset.i;
    if (a === 'rm') files.splice(i, 1);
    if (a === 'up' && i > 0) [files[i - 1], files[i]] = [files[i], files[i - 1]];
    if (a === 'down' && i < files.length - 1) [files[i + 1], files[i]] = [files[i], files[i + 1]];
    render();
  });

  if (sortable) {
    let from = null;
    listEl.addEventListener('dragstart', (e) => { from = +e.target.dataset.i; e.target.classList.add('dragging'); });
    listEl.addEventListener('dragend', (e) => e.target.classList.remove('dragging'));
    listEl.addEventListener('dragover', (e) => e.preventDefault());
    listEl.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      const to = e.target.closest('.file'); if (from == null || !to) return;
      const [m] = files.splice(from, 1); files.splice(+to.dataset.i, 0, m); from = null; render();
    });
  }

  const add = (list) => { files.push(...list); render(); };
  input.addEventListener('change', () => { add([...input.files]); input.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); add([...e.dataTransfer.files]); });

  return { get files() { return files; }, clear() { files = []; render(); }, input };
}

const urls = [];
export function resetResults(el) { urls.splice(0).forEach(URL.revokeObjectURL); el.innerHTML = ''; }

export function addResult(el, { blob, name, origSize, thumb = false }) {
  const url = URL.createObjectURL(blob); urls.push(url);
  const row = document.createElement('div');
  row.className = 'result';
  let delta = fmtSize(blob.size);
  if (origSize) {
    const pct = Math.round((1 - blob.size / origSize) * 100);
    delta = `${fmtSize(origSize)} → <b>${fmtSize(blob.size)}</b> ` +
      (pct >= 0 ? `<span class="down">−${pct}%</span>` : `<span class="up">+${-pct}%</span>`);
  }
  row.innerHTML = `${thumb ? `<img class="thumb" src="${url}" alt="">` : ''}
    <div class="info"><div class="n"></div><div class="delta">${delta}</div></div>
    <a class="dl" href="${url}">Download</a>`;
  row.querySelector('.n').textContent = name;
  row.querySelector('.dl').download = name;
  el.appendChild(row);
}

export async function addZip(el, items, zipName) {
  if (items.length < 2) return;
  const zip = new JSZip();
  const seen = new Set();
  for (const { blob, name } of items) {
    let n = name, k = 1;
    while (seen.has(n)) n = `${baseName(name)} (${k++}).${ext(name)}`;
    seen.add(n); zip.file(n, blob);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob); urls.push(url);
  const a = document.createElement('a');
  a.className = 'dl all'; a.href = url; a.download = zipName;
  a.textContent = `⬇ Download all as ZIP (${items.length} files, ${fmtSize(blob.size)})`;
  el.prepend(a);
}

export function addError(el, msg) {
  const d = document.createElement('div'); d.className = 'err'; d.textContent = '⚠ ' + msg; el.appendChild(d);
}

/** Parse "ranges" like "1-3, 5, 8-" (1-based) into 0-based indexes. */
export function parseRanges(str, total) {
  const out = [];
  for (const part of str.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    if (m) {
      const a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : total;
      for (let i = a; i <= b; i++) if (i >= 1 && i <= total) out.push(i - 1);
    } else if (/^\d+$/.test(part)) {
      const i = +part; if (i >= 1 && i <= total) out.push(i - 1);
    } else throw new Error(`Bad page range: "${part}"`);
  }
  return out;
}

export function parseTime(s) {
  s = (s || '').trim(); if (!s) return null;
  const parts = s.split(':').map(Number);
  if (parts.some(isNaN)) throw new Error(`Bad time: "${s}"`);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}
