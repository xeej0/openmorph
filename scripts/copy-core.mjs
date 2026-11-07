// Copies the ffmpeg.wasm core into public/ so it is self-hosted (no third-party CDN).
import { mkdirSync, copyFileSync } from 'node:fs';
const src = 'node_modules/@ffmpeg/core/dist/esm';
const dst = 'public/ffmpeg';
mkdirSync(dst, { recursive: true });
for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) copyFileSync(`${src}/${f}`, `${dst}/${f}`);
console.log('ffmpeg core copied to', dst);
