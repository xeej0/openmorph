import { $, $$, fileBox, resetResults, addResult, addZip, addError, baseName, ext, parseTime } from './util.js';

const AUDIO = ['mp3', 'm4a', 'wav', 'ogg', 'opus', 'flac'];
let ffmpeg = null;
let logLines = [];

async function getFFmpeg(onStatus) {
  if (ffmpeg) return ffmpeg;
  onStatus('Loading video engine (~30 MB, first time only)…');
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ff = new FFmpeg();
  ff.on('log', ({ message }) => {
    logLines.push(message);
    if (logLines.length > 400) logLines.shift();
    const pre = $('#media-log'); pre.textContent = logLines.join('\n'); pre.scrollTop = pre.scrollHeight;
  });
  const base = new URL('/ffmpeg/', location.href).href;
  await ff.load({ coreURL: base + 'ffmpeg-core.js', wasmURL: base + 'ffmpeg-core.wasm' });
  ffmpeg = ff;
  return ff;
}

function buildArgs(input, output, o) {
  const a = [];
  if (o.start) a.push('-ss', String(o.start));
  a.push('-i', input);
  if (o.end) a.push('-t', String(o.end - (o.start || 0)));
  const fmt = o.format;
  const scale = o.height ? `scale=-2:min(${o.height}\\,ih)` : null;

  if (AUDIO.includes(fmt)) {
    a.push('-vn');
    const codec = { mp3: ['libmp3lame', 1], m4a: ['aac', 1], ogg: ['libvorbis', 1], opus: ['libopus', 1], wav: ['pcm_s16le', 0], flac: ['flac', 0] }[fmt];
    a.push('-c:a', codec[0]);
    if (codec[1]) a.push('-b:a', o.abr);
  } else if (fmt === 'gif') {
    const sz = o.height ? `scale=-2:min(${o.height}\\,ih):flags=lanczos` : 'scale=min(480\\,iw):-2:flags=lanczos';
    a.push('-filter_complex', `fps=${o.fps},${sz},split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4`, '-loop', '0');
  } else if (fmt === 'webm') {
    if (scale) a.push('-vf', scale);
    a.push('-c:v', 'libvpx', '-crf', String(Math.min(63, o.crf + 6)), '-b:v', '4M', '-deadline', 'realtime', '-cpu-used', '8');
    a.push(...(o.mute ? ['-an'] : ['-c:a', 'libvorbis', '-b:a', '128k']));
  } else {
    if (scale) a.push('-vf', scale);
    a.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(o.crf), '-pix_fmt', 'yuv420p');
    a.push(...(o.mute ? ['-an'] : ['-c:a', 'aac', '-b:a', '128k']));
    if (fmt === 'mp4' || fmt === 'mov') a.push('-movflags', '+faststart');
  }
  a.push('-y', output);
  return a;
}

const MIME = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', gif: 'image/gif',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac' };

export function initMedia() {
  const go = $('#media-go'), results = $('#media-results');
  const prog = $('#media-progress'), bar = prog.querySelector('span'), ptext = prog.querySelector('.ptext');
  const box = fileBox({ inputId: 'media-files', listEl: $('#media-list'), onChange: (f) => (go.disabled = !f.length) });
  const fmtSel = $('#media-format');
  const syncOpts = () => {
    const f = fmtSel.value, audio = AUDIO.includes(f);
    $$('.v-only').forEach((el) => (el.hidden = audio));
    $$('.a-only').forEach((el) => (el.hidden = !audio));
    $$('.gif-only').forEach((el) => (el.hidden = f !== 'gif'));
    if (f === 'gif') $('#media-crf').closest('label').hidden = true, $('#media-mute').closest('label').hidden = true;
  };
  fmtSel.addEventListener('change', syncOpts); syncOpts();

  const status = (t, p) => { prog.hidden = false; ptext.textContent = t; if (p != null) bar.style.width = Math.round(p * 100) + '%'; };

  go.addEventListener('click', async () => {
    resetResults(results);
    go.disabled = true;
    logLines = [];
    const done = [];
    let o;
    try {
      o = {
        format: fmtSel.value, crf: +$('#media-crf').value, height: +$('#media-height').value || 0,
        fps: Math.min(30, Math.max(1, +$('#media-fps').value || 12)), abr: $('#media-abr').value,
        start: parseTime($('#media-start').value), end: parseTime($('#media-end').value), mute: $('#media-mute').checked,
      };
      if (o.end != null && o.end <= (o.start || 0)) throw new Error('Trim end must be after trim start');
    } catch (e) { addError(results, e.message); go.disabled = false; return; }

    let ff;
    try { ff = await getFFmpeg((t) => status(t, 0)); }
    catch (e) { addError(results, 'Could not load the video engine: ' + e.message); go.disabled = false; prog.hidden = true; return; }

    const { fetchFile } = await import('@ffmpeg/util');
    for (const [i, file] of box.files.entries()) {
      const tag = box.files.length > 1 ? ` (${i + 1}/${box.files.length})` : '';
      const input = `in_${i}.${ext(file.name) || 'bin'}`;
      const output = `out_${i}.${o.format}`;
      const onProg = ({ progress }) => status(`Converting ${file.name}${tag}… ${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`, Math.min(1, Math.max(0, progress)));
      try {
        status(`Reading ${file.name}${tag}…`, 0);
        await ff.writeFile(input, await fetchFile(file));
        ff.on('progress', onProg);
        const code = await ff.exec(buildArgs(input, output, o));
        ff.off('progress', onProg);
        if (code !== 0) throw new Error('ffmpeg failed. Open "ffmpeg log" below for details. ' + (logLines.slice(-3).join(' | ')));
        const data = await ff.readFile(output);
        const blob = new Blob([data.buffer], { type: MIME[o.format] });
        const item = { blob, name: `${baseName(file.name)}.${o.format}` };
        done.push(item);
        addResult(results, { ...item, origSize: file.size, thumb: o.format === 'gif' });
      } catch (e) {
        ff.off('progress', onProg);
        addError(results, `${file.name}: ${e.message}`);
      } finally {
        for (const f of [input, output]) { try { await ff.deleteFile(f); } catch {} }
      }
    }
    status(done.length ? 'Done ✓' : 'Finished with errors', 1);
    await addZip(results, done, 'openmorph-media.zip');
    go.disabled = false;
  });
}
