import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
// Apply the production security headers to `vite preview` too, so tests run under the real CSP.
const vercel = JSON.parse(readFileSync('./vercel.json', 'utf8'));
const headers = Object.fromEntries(vercel.headers.find((h) => h.source === '/(.*)').headers.map((h) => [h.key, h.value]));

export default defineConfig({
  define: { __FFMPEG_CORE__: JSON.stringify(pkg.dependencies['@ffmpeg/core']) },
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  worker: { format: 'es' },
  preview: { headers },
});
