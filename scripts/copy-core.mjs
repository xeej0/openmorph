// Self-host the ffmpeg.wasm core (no third-party CDN). The folder is versioned so it
// can be cached forever and still update cleanly when the package is upgraded.
import { mkdirSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
const { version } = JSON.parse(readFileSync('node_modules/@ffmpeg/core/package.json', 'utf8'));
const src = 'node_modules/@ffmpeg/core/dist/esm';
rmSync('public/ffmpeg', { recursive: true, force: true });
const dst = `public/ffmpeg/${version}`;
mkdirSync(dst, { recursive: true });
for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) copyFileSync(`${src}/${f}`, `${dst}/${f}`);
console.log('ffmpeg core copied to', dst);
