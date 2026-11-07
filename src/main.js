import { $, $$, toast, hideGlobalDrop, isImage, isPdf, isMedia, plural } from './util.js';
import { initImage } from './image.js';
import { initPdf } from './pdf.js';
import { initMedia } from './media.js';

/* ---------- theme ---------- */
const root = document.documentElement;
try { const t = localStorage.getItem('om-theme'); if (t) root.dataset.theme = t; } catch {}
$('#theme').addEventListener('click', () => {
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('om-theme', root.dataset.theme); } catch {}
});

/* ---------- tabs ---------- */
const tabs = $$('.tabs button');
let current = 'image';
function show(name, focus = false) {
  current = name;
  tabs.forEach((b) => {
    const on = b.dataset.tab === name;
    b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
  $$('.panel').forEach((p) => (p.hidden = p.id !== 'tab-' + name));
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
}
tabs.forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
$('.tabs').addEventListener('keydown', (e) => {
  const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (!d) return;
  const i = tabs.findIndex((b) => b.dataset.tab === current);
  show(tabs[(i + d + tabs.length) % tabs.length].dataset.tab, true);
});
const fromHash = location.hash.slice(1);
if (tabs.some((b) => b.dataset.tab === fromHash)) show(fromHash);

/* ---------- tools ---------- */
const image = initImage();
const pdf = initPdf();
const media = initMedia();

/** Send files to the right tool, wherever they were dropped or pasted. */
function route(files) {
  files = [...files];
  if (!files.length) return;
  const isGif = (f) => f.type === 'image/gif' || /\.gif$/i.test(f.name);
  // on the Video tab a GIF is something to convert (GIF → MP4), so keep it there
  const gifToMedia = (f) => current === 'media' && isGif(f);
  const pdfs = files.filter(isPdf);
  const imgs = files.filter((f) => isImage(f) && !isPdf(f) && !gifToMedia(f));
  const avs = files.filter((f) => (isMedia(f) && !isImage(f)) || gifToMedia(f));
  // images go to Images, unless the PDF tool is open on "Images → PDF"
  if (imgs.length) {
    if (current === 'pdf' && pdf.mode === 'img2pdf') pdf.box.add(imgs);
    else { image.box.add(imgs); if (!pdfs.length && !avs.length) show('image'); }
  }
  if (pdfs.length) {
    // keep the PDF tool the user picked; only "Images → PDF" can't take PDFs, so pick a sensible one then
    if (pdf.mode === 'img2pdf') pdf.setMode(pdfs.length > 1 ? 'merge' : 'compress');
    pdf.box.add(pdfs); if (!avs.length) show('pdf');
  }
  if (avs.length) { media.box.add(avs); show('media'); }
  const skipped = files.length - pdfs.length - imgs.length - avs.length;
  if (skipped) toast(`Skipped ${plural(skipped, 'file')} OpenMorph can't open`);
  return files.length - skipped;
}

/* drag anywhere on the page */
const overlay = $('#global-drop');
let depth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; depth++; overlay.hidden = false; });
addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--depth <= 0) { depth = 0; overlay.hidden = true; } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', () => { depth = 0; overlay.hidden = true; }, true); // also when a drop zone handles it
addEventListener('drop', (e) => {
  e.preventDefault(); depth = 0; hideGlobalDrop();
  if (e.dataTransfer?.files?.length) route(e.dataTransfer.files);
});

/* paste (Ctrl/Cmd+V) */
addEventListener('paste', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  const files = [...(e.clipboardData?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  // clipboard images are usually named "image.png": give them a unique name
  const added = route(files.map((f, i) => (/^image\.\w+$/.test(f.name) ? new File([f], `pasted-${Date.now()}-${i}.${f.type.split('/')[1] || 'png'}`, { type: f.type }) : f)));
  if (added) toast(`Added ${plural(added, 'pasted file')}`);
});
