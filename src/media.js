import { $, $$, fileBox, Results, baseName, ext, parseTime, setBusy, plural, isMedia, fmtSize, errText } from './util.js';

// ffmpeg.wasm runs in 32-bit WebAssembly: input + output must fit in ~2 GB of memory.
const MAX_BYTES = 1.5 * 1024 ** 3;
const acceptMedia = (f) => isMedia(f) || /\.gif$/i.test(f.name) || f.type === 'image/gif';

const AUDIO = ['mp3', 'm4a', 'wav', 'ogg', 'opus', 'flac'];
const MIME = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', gif: 'image/gif',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac' };

/** Errors about the file or settings (shown as-is, never retried). */
class UserError extends Error {}

/** Turn whatever an engine or browser API rejected with into a readable sentence. */
function friendly(e) {
  const t = errText(e);
  if (/out of memory|OOM|Cannot enlarge memory|Array buffer allocation failed|RangeError/i.test(t)) return 'your browser ran out of memory for this file. Close other tabs, try a shorter trim, or use a desktop browser.';
  if (/failed to import|Failed to fetch|dynamically imported|Importing a module|NetworkError/i.test(t)) return 'the video engine could not be downloaded. Check your connection and reload the page.';
  if (/WebAssembly/i.test(t)) return 'your browser blocked WebAssembly, which the video engine needs. Turn off strict/enhanced security mode for this site or try another browser.';
  if (/terminate/i.test(t)) return 'the video engine was stopped.';
  return t;
}

let ffmpeg = null;
let loading = null;
let pending = null; // instance being loaded, so Cancel can stop the download too
let logLines = [];
let logSeq = 0; // total lines ever logged; logLines only keeps the last 500
const logSince = (seq) => logLines.slice(Math.max(0, logLines.length - (logSeq - seq)));
const log = (m) => {
  logSeq++;
  logLines.push(m);
  if (logLines.length > 500) logLines.shift();
  const pre = $('#media-log'); pre.textContent = logLines.join('\n'); pre.scrollTop = pre.scrollHeight;
};

function getFFmpeg() {
  if (ffmpeg) return Promise.resolve(ffmpeg);
  // share one in-flight load between the warm-up and the Convert click
  loading ??= loadFFmpeg().finally(() => (loading = null));
  return loading;
}

async function loadFFmpeg() {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ff = new FFmpeg();
  pending = ff;
  ff.on('log', ({ message }) => log(message));
  const base = new URL(`/ffmpeg/${__FFMPEG_CORE__}/`, location.href).href;
  await ff.load({ coreURL: base + 'ffmpeg-core.js', wasmURL: base + 'ffmpeg-core.wasm' });
  if (pending !== ff) throw new Error('cancelled');
  pending = null;
  ffmpeg = ff;
  return ff;
}

function killEngine() {
  for (const ff of [ffmpeg, pending]) if (ff) { try { ff.terminate(); } catch {} }
  ffmpeg = pending = null;
}

/** Duration in seconds: ask the browser first, fall back to ffmpeg's own probe. */
async function probeDuration(file, ff, input) {
  const viaBrowser = await new Promise((res) => {
    const el = document.createElement(file.type.startsWith('audio') ? 'audio' : 'video');
    const url = URL.createObjectURL(file);
    const done = (v) => { URL.revokeObjectURL(url); res(v); };
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    el.onerror = () => done(null);
    setTimeout(() => done(null), 4000);
    el.src = url;
  });
  if (viaBrowser) return viaBrowser;
  const start = logSeq;
  await ff.exec(['-hide_banner', '-i', input]);
  const m = logSince(start).join('\n').match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
}

function buildArgs(input, output, o) {
  const a = ['-hide_banner'];
  if (o.start) a.push('-ss', String(o.start));
  a.push('-i', input);
  if (o.end) a.push('-t', String(o.end - (o.start || 0)));
  const fmt = o.format;
  // yuv420p needs even width/height, so always round down to even numbers
  const scale = o.height ? `scale=-2:trunc(min(${o.height}\\,ih)/2)*2` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  // first video + first audio stream only; skip subtitles/data that can't be re-encoded
  const maps = ['-map', '0:v:0?', '-map', '0:a:0?', '-sn', '-dn'];

  if (AUDIO.includes(fmt)) {
    a.push('-vn', '-sn', '-dn', '-map_metadata', '-1');
    const [codec, lossy] = { mp3: ['libmp3lame', 1], m4a: ['aac', 1], ogg: ['libvorbis', 1], opus: ['libopus', 1], wav: ['pcm_s16le', 0], flac: ['flac', 0] }[fmt];
    a.push('-c:a', codec);
    if (lossy) a.push('-b:a', o.abr);
  } else if (fmt === 'gif') {
    const sz = o.height ? `scale=-2:min(${o.height}\\,ih):flags=lanczos` : 'scale=min(480\\,iw):-2:flags=lanczos';
    a.push('-filter_complex', `fps=${o.fps},${sz},split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4`, '-loop', '0');
  } else {
    a.push(...maps, '-vf', scale);
    const audioK = o.audioK ?? (o.vbitrate && o.vbitrate < 600 ? 64 : 128);
    if (fmt === 'webm') {
      a.push('-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8');
      if (o.vbitrate) a.push('-b:v', `${o.vbitrate}k`, '-maxrate', `${Math.round(o.vbitrate * 1.2)}k`, '-bufsize', `${o.vbitrate * 2}k`);
      else a.push('-crf', String(Math.min(63, o.crf + 6)), '-b:v', '4M');
      a.push(...(o.mute ? ['-an'] : ['-c:a', 'libvorbis', '-b:a', `${audioK}k`]));
    } else {
      a.push('-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p');
      if (o.vbitrate) a.push('-b:v', `${o.vbitrate}k`, '-maxrate', `${Math.round(o.vbitrate * 1.3)}k`, '-bufsize', `${o.vbitrate * 2}k`);
      else a.push('-crf', String(o.crf));
      a.push(...(o.mute ? ['-an'] : ['-c:a', 'aac', '-b:a', `${audioK}k`]));
      if (fmt === 'mp4' || fmt === 'mov') a.push('-movflags', '+faststart');
    }
  }
  a.push('-y', output);
  return a;
}

export function initMedia() {
  const go = $('#media-go'), cancel = $('#media-cancel'), results = new Results($('#media-results'));
  const prog = $('#media-progress'), barWrap = prog.querySelector('.bar'), bar = barWrap.querySelector('span'), ptext = prog.querySelector('.ptext');
  const step = $('#tab-media .step');
  const fmtSel = $('#media-format'), sizeMode = $('#media-sizemode');
  let running = false, cancelled = false;
  let formatTouched = false; // once the user picks an output, never change it for them
  const isAudioFile = (f) => /^audio\//.test(f.type) || /\.(mp3|wav|m4a|aac|flac|oga|opus|wma|aiff?)$/i.test(f.name);
  const VIDEO_PRESETS = ['shrink', 'discord', '25mb', 'mp4', 'gif'];

  const label = () => {
    const n = box.files.length;
    go.disabled = !n || running;
    const f = fmtSel.value;
    go.textContent = n ? `Convert ${plural(n, 'file')} to ${f.toUpperCase()}` : 'Add files to start';
  };
  step.hidden = true;
  const box = fileBox({ inputId: 'media-files', listEl: $('#media-list'), accept: (f) => {
      if (!acceptMedia(f)) return false;
      if (f.size > MAX_BYTES) return `${f.name} is ${fmtSize(f.size)}. In-browser video is limited to about 1.5 GB per file.`;
      return true;
    },
    onChange: (f) => {
      // start downloading the engine in the background as soon as there is work for it
      if (f.length && !ffmpeg) getFFmpeg().catch(() => {});
      // audio-only input: offer audio outputs instead of "convert to MP4"
      const allAudio = f.length > 0 && f.every(isAudioFile);
      if (!formatTouched && f.length) fmtSel.value = allAudio ? 'mp3' : 'mp4';
      $$('#media-presets button').forEach((b) => { if (VIDEO_PRESETS.includes(b.dataset.p)) b.hidden = allAudio; });
      $('#media-presets [data-p=mp3]').textContent = allAudio ? 'To MP3' : 'Extract MP3';
      step.hidden = !f.length; syncOpts(); } });

  const syncOpts = () => {
    const f = fmtSel.value, audio = AUDIO.includes(f), gif = f === 'gif', target = sizeMode.value === 'target';
    $$('#tab-media .v-only').forEach((el) => (el.hidden = audio || gif));
    $$('#tab-media .g-show').forEach((el) => (el.hidden = audio));
    $$('#tab-media .a-only').forEach((el) => (el.hidden = !audio || f === 'wav' || f === 'flac'));
    $$('#tab-media .gif-only').forEach((el) => (el.hidden = !gif));
    if (!audio && !gif) {
      $$('#tab-media .q-only').forEach((el) => (el.hidden = target));
      $$('#tab-media .t-only').forEach((el) => (el.hidden = !target));
    }
    label();
  };
  fmtSel.addEventListener('change', () => { formatTouched = true; syncOpts(); });
  sizeMode.addEventListener('change', syncOpts);
  syncOpts();

  const presets = {
    shrink: { format: 'mp4', size: 'quality', crf: '28', height: '720' },
    discord: { format: 'mp4', size: 'target', target: 9.5, height: '' },
    '25mb': { format: 'mp4', size: 'target', target: 24, height: '' },
    mp4: { format: 'mp4', size: 'quality', crf: '23', height: '' },
    gif: { format: 'gif', fps: 12, height: '' },
    mp3: { format: 'mp3', abr: '192k' },
  };
  $('#media-presets').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-p]'); if (!b) return;
    const p = presets[b.dataset.p];
    formatTouched = true;
    fmtSel.value = p.format;
    if (p.size) sizeMode.value = p.size;
    if (p.crf) $('#media-crf').value = p.crf;
    if (p.target) $('#media-target').value = p.target;
    if (p.height !== undefined) $('#media-height').value = p.height;
    if (p.fps) $('#media-fps').value = p.fps;
    if (p.abr) $('#media-abr').value = p.abr;
    $$('#media-presets button').forEach((x) => x.classList.toggle('on', x === b));
    syncOpts();
  });
  $('#tab-media .opts').addEventListener('input', () => $$('#media-presets button').forEach((x) => x.classList.remove('on')));

  const status = (t, p) => {
    prog.hidden = false; ptext.textContent = t;
    barWrap.classList.toggle('indet', p == null);
    if (p != null) { bar.style.width = Math.round(p * 100) + '%'; barWrap.setAttribute('aria-valuenow', Math.round(p * 100)); } else barWrap.removeAttribute('aria-valuenow');
  };

  cancel.addEventListener('click', () => {
    if (!running) return;
    cancelled = true;
    killEngine(); // stops a conversion or the engine download; a fresh engine loads next time
  });

  go.addEventListener('click', async () => {
    results.reset();
    logLines = []; $('#media-log').textContent = '';
    let o;
    try {
      o = {
        format: fmtSel.value, crf: +$('#media-crf').value, height: +$('#media-height').value || 0,
        fps: Math.min(30, Math.max(1, +$('#media-fps').value || 12)), abr: $('#media-abr').value,
        start: parseTime($('#media-start').value), end: parseTime($('#media-end').value), mute: $('#media-mute').checked,
        targetMB: sizeMode.value === 'target' && !AUDIO.includes(fmtSel.value) && fmtSel.value !== 'gif' ? +$('#media-target').value : 0,
      };
      if (o.end != null && o.end <= (o.start || 0)) throw new Error('Trim end must be after trim start');
      const wantsTarget = sizeMode.value === 'target' && !AUDIO.includes(o.format) && o.format !== 'gif';
      if (wantsTarget && !(o.targetMB > 0)) throw new Error('Enter a max size in MB (for example 10)');
    } catch (e) { results.error(errText(e)); return; }

    running = true; cancelled = false;
    setBusy(go, 'Working…'); cancel.hidden = false;
    let ff; // replaced if the engine has to be restarted
    try {
      status('Loading the video engine (first time only, ~30 MB)…', null);
      ff = await getFFmpeg();
    } catch (e) {
      if (cancelled) results.warn('Cancelled.');
      else results.error('Could not start the video engine: ' + friendly(e));
      running = false; setBusy(go); cancel.hidden = true; prog.hidden = true; label(); return;
    }
    if (cancelled) { results.warn('Cancelled.'); running = false; setBusy(go); cancel.hidden = true; prog.hidden = true; label(); return; }

    const { fetchFile } = await import('@ffmpeg/util');
    const files = [...box.files];
    for (const [i, file] of files.entries()) {
      if (cancelled) break;
      const tag = files.length > 1 ? ` (${i + 1} of ${files.length})` : '';
      const input = `in_${i}.${ext(file.name) || 'bin'}`;
      const output = `out_${i}.${o.format}`;

      const convertOne = async () => {
        let onProg;
        try {
          status(`Reading ${file.name}${tag}…`, null);
          await ff.writeFile(input, await fetchFile(file));
          const opts = { ...o };
          let attempt = 0, blob, meta = '';
          while (true) {
            if (opts.targetMB) {
              const full = await probeDuration(file, ff, input);
              if (!full) throw new UserError("couldn't read the video length, so a target size isn't possible. Use quality mode instead.");
              const dur = Math.max(0.5, (o.end ?? full) - (o.start || 0));
              const totalK = (opts.targetMB * 8 * 1024 * (attempt ? 0.85 : 0.93)) / dur;
              const audioK = o.mute ? 0 : totalK - 128 < 600 ? 64 : 128;
              opts.audioK = audioK || 64;
              opts.vbitrate = Math.max(40, Math.floor(totalK - audioK));
              // pick a sensible resolution for the bitrate unless the user chose one
              if (!o.height) opts.height = opts.vbitrate < 350 ? 360 : opts.vbitrate < 800 ? 480 : opts.vbitrate < 1800 ? 720 : opts.vbitrate < 4000 ? 1080 : 0;
              meta = `${opts.vbitrate} kbps video${opts.height ? `, ≤${opts.height}p` : ''}`;
            }
            onProg = ({ progress }) => {
              const p = Math.min(1, Math.max(0, progress));
              status(`Converting ${file.name}${tag}… ${Math.round(p * 100)}%${attempt ? ' (second pass to hit size)' : ''}`, p);
            };
            ff.on('progress', onProg);
            status(`Converting ${file.name}${tag}…`, 0);
            const runStart = logSeq;
            const code = await ff.exec(buildArgs(input, output, opts));
            ff.off('progress', onProg); onProg = null;
            if (code !== 0) {
              const runLog = logSince(runStart);
              const tail = runLog.slice(-8).find((l) => /error|invalid|not|unsupported|no such/i.test(l));
              const noStream = /does not contain any stream|matches no streams|Output file #0 does not contain|Cannot find a matching stream|Stream map .* matches no/i.test(runLog.join('\n'));
              throw new UserError(noStream ? (AUDIO.includes(o.format) ? 'this file has no audio track' : 'this file has no video track')
                : /Invalid data found|could not find codec|moov atom not found/i.test(runLog.join('\n')) ? "this file is damaged or isn't a format ffmpeg can read"
                : `conversion failed${tail ? ': ' + tail.trim() : ''}. See "Technical log" below.`);
            }
            const data = await ff.readFile(output);
            blob = new Blob([data], { type: MIME[o.format] });
            if (opts.targetMB && blob.size > opts.targetMB * 1024 * 1024 && attempt === 0) { attempt++; continue; }
            break;
          }
          if (opts.targetMB && blob.size > opts.targetMB * 1024 * 1024) results.warn(`${file.name}: came out at ${fmtSize(blob.size)}, a bit over the target. Try trimming or a lower max height.`);
          if (blob.size > file.size && !AUDIO.includes(o.format) && o.format !== 'gif' && ext(file.name) === o.format)
            results.warn(`${file.name}: the result is bigger than the original, which means the source was already well compressed. Try a lower quality or max height, or keep the original.`);
          results.add({
            blob, name: `${baseName(file.name)}.${o.format}`, origSize: file.size, meta,
            thumb: o.format === 'gif', player: o.format === 'gif' ? null : AUDIO.includes(o.format) ? 'audio' : (o.format === 'mp4' || o.format === 'webm' ? 'video' : null),
          });
        } finally {
          if (onProg) { try { ff.off('progress', onProg); } catch {} }
          if (!cancelled && ff) for (const f of [input, output]) { try { await ff.deleteFile(f); } catch {} }
        }
      };

      // A problem inside the engine itself (crash, out of memory, stale worker) gets one
      // automatic retry on a fresh engine. Problems with the file itself are reported directly.
      for (let tries = 0; ; tries++) {
        try { await convertOne(); break; }
        catch (e) {
          if (cancelled) break;
          if (e instanceof UserError || tries >= 1) { results.error(`${file.name}: ${friendly(e)}`); break; }
          log(`[OpenMorph] engine error: ${errText(e)}. Restarting the engine and retrying…`);
          status('The video engine hit a problem. Restarting it and trying again…', null);
          killEngine();
          try { ff = await getFFmpeg(); }
          catch (e2) { results.error(`${file.name}: ${friendly(e2)}`); break; }
        }
      }
    }
    if (cancelled) { results.warn('Cancelled.'); prog.hidden = true; }
    else status(results.items.length ? 'Done ✓' : 'Finished with errors', 1);
    await results.finish('openmorph-media.zip');
    running = false; setBusy(go); cancel.hidden = true; label();
  });
  return { box };
}
