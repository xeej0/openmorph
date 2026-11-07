# OpenMorph

Free, open-source alternative to those "convert X to Y" websites. Convert, compress and resize **images, PDFs, video and audio**, entirely in your browser.

- **Private:** files never leave your device. No uploads, no accounts, no tracking.
- **No limits:** no file-count caps, no watermarks, no queues.
- **Static site:** deploys anywhere (Vercel, GitHub Pages, Netlify, your own server).

## Features

| Images | PDF | Video & Audio |
|---|---|---|
| Convert JPG / PNG / WebP / AVIF (reads GIF, BMP, SVG, HEIC on Safari) | Images → PDF | Convert to MP4, WebM, MOV, MKV |
| Compress with a quality slider | Merge PDFs (drag to reorder) | Video → animated GIF |
| Hit a target file size (e.g. "under 200 KB") | Split / extract pages | Extract audio: MP3, M4A, WAV, OGG, Opus, FLAC |
| Resize by % or max width/height | PDF → PNG / JPG / WebP | Compress video (quality + resolution) |
| Strip EXIF / GPS metadata | Compress PDF (light or strong) | Trim start / end, remove audio |
| Batch + download all as ZIP | Rotate pages | Batch + ZIP |

## Run locally

```bash
npm install
npm run dev
```

`npm run build` outputs a static site to `dist/`.

## Deploy

Import the repo in Vercel (framework: Vite) or click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/xeej0/openmorph)

## How it works

- Images: the browser's Canvas API (re-encoding drops metadata).
- PDFs: [pdf-lib](https://pdf-lib.js.org/) for editing, [PDF.js](https://mozilla.github.io/pdf.js/) for rendering.
- Video/audio: [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm), self-hosted from `public/ffmpeg` (copied from `node_modules` at build time).
- ZIP downloads: [JSZip](https://stuk.github.io/jszip/).

Video runs single-threaded in WebAssembly, so big or long files are slower than desktop ffmpeg and are limited by browser memory (~2 GB).

## License

MIT
