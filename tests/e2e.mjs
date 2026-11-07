// End-to-end test: builds must exist (npm run build). Serves dist/ with the production
// security headers, then drives every tool in a real Chromium.
// Run: npm test
import { preview } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const FX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fx = (...n) => n.map((x) => FX + x);

// BASE_URL=https://openmorph.xeej.app/ npm test  runs against a deployed site instead
const server = process.env.BASE_URL ? null : await preview({ preview: { port: 4317, strictPort: true }, logLevel: 'silent' });
const BASE = process.env.BASE_URL || 'http://localhost:4317/';
const browser = await chromium.launch();
const page = await browser.newPage();

const problems = [];
const foreign = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) problems.push('console: ' + m.text()); });
page.on('request', (r) => { const u = r.url(); if (!u.startsWith(BASE) && !/^(blob|data):/.test(u)) foreign.push(u); });

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message.split('\n')[0]); }
}
const settle = (tab) => page.waitForFunction((t) => {
  const g = document.querySelector(`#${t}-go`);
  return !g.classList.contains('busy') && document.querySelector(`#${t}-results`).children.length > 0;
}, tab, { timeout: 180_000 });
const run = async (tab) => {
  await page.click(`#${tab}-go`); await settle(tab);
  return page.$$eval(`#${tab}-results > *`, (els) => els.map((e) => ({ cls: e.className, text: e.innerText.replace(/\s+/g, ' ') })));
};
const ok = (rows, n) => {
  const errs = rows.filter((r) => r.cls === 'err');
  assert.equal(errs.length, 0, errs.map((e) => e.text).join('; '));
  assert.equal(rows.filter((r) => r.cls === 'result').length, n, 'result count');
};
const err = (rows, re) => assert.ok(rows.some((r) => r.cls === 'err' && re.test(r.text)), 'expected error ' + re + ', got ' + JSON.stringify(rows));

await page.goto(BASE);
console.log('Images');
await page.setInputFiles('#img-files', fx('photo.jpg', 'a.png', 'phone.heic', 'anim.gif'));
await test('compress keeps formats and never grows', async () => {
  await page.click('#img-presets [data-p=compress]');
  const rows = await run('img'); ok(rows, 4);
  const grew = rows.filter((r) => /\+\d+%/.test(r.text) && !/^phone\.jpg/.test(r.text)); // HEIC→JPG may grow, by design
  assert.deepEqual(grew, [], 'a file got bigger');
});
await test('convert all to WebP', async () => { await page.click('#img-presets [data-p=webp]'); const r = await run('img'); ok(r, 4); assert.ok(r.filter((x) => /\.webp/.test(x.text)).length === 4); });
await test('resize to max 100px', async () => {
  await page.selectOption('#img-resize', 'dims'); await page.fill('#img-w', '100'); await page.fill('#img-h', '100');
  const r = await run('img'); ok(r, 4); assert.ok(r.filter((x) => x.cls === 'result').every((x) => /\b(100×\d+|\d+×100)\b/.test(x.text)), JSON.stringify(r));
  await page.selectOption('#img-resize', 'none');
});
await test('JPG under 20 KB', async () => {
  await page.click('#img-presets [data-p=jpg]'); await page.fill('#img-target', '20');
  const r = await run('img'); ok(r, 4);
  for (const x of r.filter((x) => x.cls === 'result')) { const m = x.text.match(/→ ([\d.]+) (KB|B)/); assert.ok(m && (m[2] === 'B' || +m[1] <= 20), x.text); }
  await page.fill('#img-target', '');
});

console.log('PDF');
await page.click('#t-pdf');
await test('images to PDF', async () => { await page.setInputFiles('#pdf-files', fx('photo.jpg', 'a.png', 'phone.heic')); const r = await run('pdf'); ok(r, 1); assert.match(r[1].text, /3 pages/); });
await page.click('[data-mode=merge]');
await test('merge needs 2 files', async () => { await page.setInputFiles('#pdf-files', fx('doc.pdf')); assert.ok(await page.isDisabled('#pdf-go')); });
await test('merge', async () => { await page.setInputFiles('#pdf-files', fx('doc.pdf')); const r = await run('pdf'); ok(r, 1); assert.match(r[1].text, /4 pages/); });
await page.click('#pdf-list [data-a=clear]'); await page.setInputFiles('#pdf-files', fx('doc.pdf'));
await page.click('[data-mode=split]');
await test('split each page', async () => { await page.selectOption('#p-split', 'each'); ok(await run('pdf'), 2); });
await test('split rejects missing pages', async () => { await page.fill('#p-ranges', '7'); err(await run('pdf'), /this PDF has 2 pages/); await page.fill('#p-ranges', ''); });
await page.click('[data-mode=pdf2img]');
await test('PDF to images', async () => ok(await run('pdf'), 2));
await page.click('[data-mode=compress]');
await test('compress (strong)', async () => ok(await run('pdf'), 1));
await page.click('[data-mode=rotate]');
await test('rotate', async () => ok(await run('pdf'), 1));
await test('text PDF with a non-embedded font renders to an image', async () => {
  await page.click('#pdf-list [data-a=clear]'); await page.setInputFiles('#pdf-files', fx('text.pdf'));
  await page.click('[data-mode=pdf2img]'); ok(await run('pdf'), 1);
});
await test('invalid PDF gives a clear error', async () => {
  await page.click('#pdf-list [data-a=clear]'); await page.setInputFiles('#pdf-files', fx('fake.pdf'));
  err(await run('pdf'), /isn't a readable PDF/);
});

console.log('Video & audio');
await page.click('#t-media');
await page.setInputFiles('#media-files', fx('clip.mp4'));
for (const [fmt, n] of [['mp4', 1], ['webm', 1], ['gif', 1], ['mp3', 1], ['m4a', 1], ['wav', 1], ['flac', 1], ['opus', 1], ['ogg', 1]]) {
  await test(`clip.mp4 → ${fmt}`, async () => { await page.selectOption('#media-format', fmt); ok(await run('media'), n); });
}
await test('trim', async () => {
  await page.selectOption('#media-format', 'mp3'); await page.fill('#media-start', '0:00.5'); await page.fill('#media-end', '1.5');
  ok(await run('media'), 1); await page.fill('#media-start', ''); await page.fill('#media-end', '');
});
await test('fit under size', async () => {
  await page.selectOption('#media-format', 'mp4'); await page.selectOption('#media-sizemode', 'target'); await page.fill('#media-target', '0.5');
  const r = await run('media'); ok(r, 1); assert.match(r.find((x) => x.cls === 'result').text, /kbps video/);
  await page.selectOption('#media-sizemode', 'quality');
});
await test('animated GIF → MP4', async () => {
  await page.click('#media-list [data-a=clear]'); await page.setInputFiles('#media-files', fx('anim.gif'));
  await page.selectOption('#media-format', 'mp4'); ok(await run('media'), 1);
});
await test('audio file → GIF explains the problem', async () => {
  await page.click('#media-list [data-a=clear]'); await page.setInputFiles('#media-files', fx('tone.mp3'));
  await page.selectOption('#media-format', 'gif'); err(await run('media'), /no video track/);
});
await test('bad trim is rejected', async () => {
  await page.selectOption('#media-format', 'wav'); await page.fill('#media-start', '5'); await page.fill('#media-end', '1');
  err(await run('media'), /Trim end must be after/); await page.fill('#media-start', ''); await page.fill('#media-end', '');
});

await test('odd-sized video (321×241 AVI) → MP4', async () => {
  await page.click('#media-list [data-a=clear]'); await page.setInputFiles('#media-files', fx('odd.avi'));
  await page.selectOption('#media-format', 'mp4'); ok(await run('media'), 1);
});
await test('empty max size is rejected', async () => {
  await page.selectOption('#media-sizemode', 'target'); await page.fill('#media-target', '');
  err(await run('media'), /Enter a max size/); await page.selectOption('#media-sizemode', 'quality');
});

console.log('Robustness');
await test('cancel while the video engine is still loading', async () => {
  const p2 = await browser.newPage();
  p2.on('pageerror', (e) => problems.push('pageerror(p2): ' + e.message));
  await p2.goto(BASE + '#media');
  await p2.setInputFiles('#media-files', fx('clip.mp4'));
  await p2.click('#media-go'); await p2.click('#media-cancel');
  await p2.waitForFunction(() => !document.querySelector('#media-go').classList.contains('busy'), null, { timeout: 60_000 });
  assert.match(await p2.textContent('#media-results'), /Cancelled/);
  await p2.click('#media-go'); // and it still works afterwards
  await p2.waitForSelector('#media-results .result', { timeout: 120_000 });
  await p2.close();
});
await test('PDF tool cannot be switched mid-run', async () => {
  await page.click('#t-pdf'); await page.click('[data-mode=img2pdf]');
  await page.setInputFiles('#pdf-files', fx('photo.jpg', 'a.png', 'photo.jpg', 'a.png', 'photo.jpg'));
  await page.click('#pdf-go'); await page.click('[data-mode=merge]', { force: true });
  await settle('pdf');
  assert.equal(await page.getAttribute('[data-mode=img2pdf]', 'aria-checked'), 'true');
  const r = await page.$$eval('#pdf-results > *', (els) => els.map((e) => ({ cls: e.className, text: e.innerText })));
  ok(r, 1);
});

await test('engine download failure shows a real message, then recovers', async () => {
  const p3 = await browser.newPage();
  let block = true;
  await p3.route('**/ffmpeg-core.wasm', (r) => (block ? r.abort('failed') : r.continue()));
  await p3.goto(BASE + '#media');
  await p3.setInputFiles('#media-files', fx('tone.mp3'));
  await p3.selectOption('#media-format', 'wav');
  await p3.click('#media-go');
  await p3.waitForFunction(() => !document.querySelector('#media-go').classList.contains('busy') && document.querySelector('#media-results').children.length, null, { timeout: 60_000 });
  const msg = await p3.textContent('#media-results');
  assert.ok(!/undefined/.test(msg), 'error says "undefined": ' + msg);
  assert.match(msg, /video engine/i);
  block = false;
  await p3.click('#media-go');
  await p3.waitForSelector('#media-results .result', { timeout: 120_000 });
  await p3.close();
});
await test('m4a with spaces in the name → mp3', async () => {
  const p4 = await browser.newPage();
  await p4.goto(BASE + '#media');
  await p4.setInputFiles('#media-files', { name: 'drop 4.m4a', mimeType: 'audio/x-m4a', buffer: (await import('node:fs')).readFileSync(FX + 'tone.m4a') });
  await p4.click('#media-presets [data-p=mp3]'); await p4.click('#media-go');
  await p4.waitForSelector('#media-results .result', { timeout: 120_000 });
  await p4.close();
});

console.log('Privacy & security');
await test('no requests to any other origin', async () => assert.deepEqual(foreign, []));
await test('no page errors or CSP violations', async () => {
  // expected, user-facing errors are rendered in the page, never thrown
  assert.deepEqual(problems, []);
});
await test('legacy engine path rewrite matches the installed ffmpeg core', async () => {
  const fs = await import('node:fs');
  const v = JSON.parse(fs.readFileSync('node_modules/@ffmpeg/core/package.json', 'utf8')).version;
  const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  assert.ok(vercel.rewrites.some((r) => r.destination === `/ffmpeg/${v}/:file`), 'update the rewrite in vercel.json to ' + v);
});
await test('security headers are served', async () => {
  const res = await page.request.get(BASE);
  const h = res.headers();
  assert.match(h['content-security-policy'] || '', /connect-src 'self'/);
  assert.equal(h['x-content-type-options'], 'nosniff');
});

await browser.close();
server?.httpServer.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
