import { defineConfig } from 'vite';
export default defineConfig({
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  build: { target: 'es2022' },
  worker: { format: 'es' },
});
