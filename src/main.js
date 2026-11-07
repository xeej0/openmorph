import { $$ } from './util.js';
import { initImage } from './image.js';
import { initPdf } from './pdf.js';
import { initMedia } from './media.js';

const tabs = $$('.tabs button');
function show(name) {
  tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  $$('.panel').forEach((p) => (p.hidden = p.id !== 'tab-' + name));
  try { localStorage.setItem('om-tab', name); } catch {}
}
tabs.forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
try { const t = localStorage.getItem('om-tab'); if (t && tabs.some((b) => b.dataset.tab === t)) show(t); } catch {}

// keep the browser from opening files dropped outside a drop zone
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => e.preventDefault());

initImage();
initPdf();
initMedia();
