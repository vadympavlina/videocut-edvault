// Імпорт медіафайлів: метадані, елементи для перегляду, мініатюри й хвилі звуку.
import { Input, ALL_FORMATS, BlobSource, CanvasSink, AudioBufferSink } from '../vendor/mediabunny.min.mjs';
import { S, media, emit, on, uid } from './state.js';
import { needsProxy, makeProxy } from './proxy.js';
import { DB } from './db.js';

export const PEAKS_RATE = 50; // стовпчиків хвилі на секунду

const pool = () => document.getElementById('mediaPool');

function kindOf(blob, name) {
  const t = (blob.type || '').toLowerCase();
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (t.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)) return 'image';
  if (t.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) return 'audio';
  if (t.startsWith('video/') || ['mp4', 'webm', 'mov', 'qt', 'mkv', 'm4v', 'avi', 'ts', 'wmv', 'flv', 'mpg', 'mpeg', '3gp', 'mts', 'm2ts', 'ogv'].includes(ext)) return 'video';
  return null;
}

// чи браузер справді показує кадри (а не лише звук) — для кодеків, яких не вміє WebCodecs
function framesVisible(el, ms = 6000) {
  return new Promise(res => {
    let done = false;
    const fin = v => { if (done) return; done = true; clearTimeout(tm); el.removeEventListener('loadeddata', chk); el.removeEventListener('error', bad); res(v); };
    const chk = () => { if (el.readyState >= 2) fin(el.videoWidth > 0); };
    const bad = () => fin(false);
    const tm = setTimeout(() => fin(el.readyState >= 2 && el.videoWidth > 0), ms);
    if (el.error) return fin(false);
    chk();
    el.addEventListener('loadeddata', chk);
    el.addEventListener('error', bad);
  });
}

function mediaElementMeta(el) {
  return new Promise((res, rej) => {
    const done = () => {
      if (el.duration === Infinity) { // WebM з MediaRecorder без тривалості
        el.currentTime = 1e9;
        el.addEventListener('timeupdate', function h() { el.removeEventListener('timeupdate', h); const d = el.duration; el.currentTime = 0; res(d); }, { once: true });
      } else res(el.duration);
    };
    if (el.readyState >= 1) done();
    else { el.addEventListener('loadedmetadata', done, { once: true }); el.addEventListener('error', () => rej(new Error('Браузер не може відкрити цей файл')), { once: true }); }
  });
}

// Додає файл у проєкт. Повертає запис медіа.
export async function addMedia(blob, name, opts = {}) {
  name = name || blob.name || 'файл';
  const kind = kindOf(blob, name);
  if (!kind) throw new Error('Непідтримуваний тип файлу: ' + name);
  const id = opts.id || uid('m');
  const m = { id, kind, name, size: blob.size, blob, url: URL.createObjectURL(blob), duration: 0, width: 0, height: 0, hasAudio: false, hasVideo: false, thumbs: [], peaks: null, input: null, vt: null, at: null, canDecodeV: false, canDecodeA: false, el: null, analyzing: true };

  if (kind === 'image') {
    const img = new Image();
    img.src = m.url;
    await img.decode().catch(() => { throw new Error('Не вдалося відкрити зображення ' + name); });
    m.el = img; m.width = img.naturalWidth || 1280; m.height = img.naturalHeight || 720; m.duration = 5; m.hasVideo = true;
    const c = document.createElement('canvas'); const th = 72; c.height = th; c.width = Math.max(1, Math.round(th * m.width / m.height));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    m.thumbs = [{ t: 0, c }];
    m.analyzing = false;
  } else {
    try {
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
      m.input = input;
      m.vt = kind === 'audio' ? null : await input.getPrimaryVideoTrack();
      m.at = await input.getPrimaryAudioTrack();
      m.duration = await input.computeDuration();
      if (m.vt) { m.width = await m.vt.getDisplayWidth(); m.height = await m.vt.getDisplayHeight(); m.canDecodeV = await m.vt.canDecode(); }
      if (m.at) m.canDecodeA = await m.at.canDecode();
    } catch (e) {
      console.warn('mediabunny не прочитав файл, використовуємо браузерний плеєр', e);
      m.input = null; m.vt = null; m.at = null;
    }
    m.kind = m.vt || (!m.at && kind === 'video') ? 'video' : 'audio';
    const el = document.createElement(m.kind === 'video' ? 'video' : 'audio');
    el.preload = 'auto'; el.playsInline = true; el.src = m.url;
    pool().appendChild(el);
    m.el = el;
    if (!m.duration || !isFinite(m.duration)) m.duration = await mediaElementMeta(el);
    if (m.kind === 'video' && (!m.width || !m.height)) {
      await new Promise(r => (el.readyState >= 1 ? r() : el.addEventListener('loadedmetadata', r, { once: true })));
      m.width = el.videoWidth || 1280; m.height = el.videoHeight || 720;
    }
    m.hasVideo = m.kind === 'video';
    m.hasAudio = !!m.at || m.kind === 'audio';
    // кодек, якого браузер не показує (H.265 з iPhone, ProRes, MJPEG…) — краще одразу перетворити
    if (opts.check && m.kind === 'video' && !(m.vt && m.canDecodeV) && !(await framesVisible(el))) {
      el.removeAttribute('src'); el.remove(); URL.revokeObjectURL(m.url);
      try { m.input?.dispose?.(); } catch (e) { /* ignore */ }
      throw Object.assign(new Error('Браузер не показує відео з цього файлу'), { needsConvert: true });
    }
    if (!isFinite(m.duration) || m.duration <= 0) throw Object.assign(new Error('Не вдалося визначити тривалість файлу ' + name), { needsConvert: m.kind === 'video' });
  }

  media.set(id, m);
  if (opts.persist !== false) {
    // просимо браузер не видаляти збережені файли при нестачі місця
    if (navigator.storage && navigator.storage.persist && !addMedia.asked) { addMedia.asked = true; navigator.storage.persist().catch(() => {}); }
    DB.putBlob(id, blob).catch(e => { console.warn('Не вдалося зберегти файл у браузері', e); emit('storage-error', { name, e }); });
  }
  emit('media');
  if (m.kind !== 'image') queue(() => analyze(m));
  if (needsProxy(m) && opts.proxy !== false) queue(() => buildProxy(m));
  return m;
}

// ── легка копія для перегляду (великі відео) ──
// Перегляд грає копію, експорт — оригінал. Готова копія зберігається в IndexedDB під ключем 'p_<id>'.
async function buildProxy(m) {
  if (!media.has(m.id)) return;
  try {
    let blob = await DB.getBlob('p_' + m.id).catch(() => null);
    if (!blob) {
      m.proxy = { state: 'working', p: 0 };
      emit('proxy', m.id);
      emit('proxy-start', m);
      m.proxyHandle = {};
      let last = 0;
      blob = await makeProxy(m.blob, { width: m.width, height: m.height }, p => {
        m.proxy.p = p;
        if (p - last >= 0.02) { last = p; emit('proxy', m.id); }
      }, m.proxyHandle);
      if (blob && media.has(m.id)) DB.putBlob('p_' + m.id, blob).catch(() => {});
    }
    if (!blob || !media.has(m.id)) { m.proxy = null; emit('proxy', m.id); return; }
    m.proxyBlob = blob;
    m.proxy = { state: 'ready', p: 1 };
    swapToProxy(m);
  } catch (e) {
    console.warn('Не вдалося зробити копію для перегляду — працюємо з оригіналом', e);
    m.proxy = null;
    emit('proxy', m.id);
  }
}
// підміна джерела відеоелемента без втрати позиції; під час відтворення чекаємо паузи
function swapToProxy(m) {
  if (!media.has(m.id) || !m.proxyBlob || m.proxyUrl) return;
  if (S.playing) { const off = on('play', () => { if (!S.playing) { swapToProxy(m); } }); return off; }
  const el = m.el;
  m.proxyUrl = URL.createObjectURL(m.proxyBlob);
  const t = el.currentTime;
  el.addEventListener('loadedmetadata', () => { try { el.currentTime = t; } catch (e) { /* ignore */ } emit('proxy', m.id); emit('media'); }, { once: true });
  el.src = m.proxyUrl;
  el.load();
}
export const previewUrl = m => m.proxyUrl || m.url;
export function cancelProxy(m) { if (m.proxyHandle) { m.proxyHandle.cancelled = true; m.proxyHandle.cancel?.(); } }

// Видалені з проєкту файли лишаються в IndexedDB до кінця сесії, щоб «Скасувати» могло їх повернути
const removed = new Map(); // id → назва
export function removedMedia(id) { return removed.get(id) || null; }
export async function reviveMedia(id) {
  const name = removed.get(id);
  if (!name || media.has(id)) return media.get(id) || null;
  const blob = await DB.getBlob(id);
  if (!blob) { removed.delete(id); return null; }
  removed.delete(id);
  return addMedia(blob, name, { id, persist: false });
}
export function purgeRemoved() { removed.forEach((_, id) => { DB.delBlob(id).catch(() => {}); DB.delBlob('p_' + id).catch(() => {}); }); removed.clear(); }

export function removeMedia(id, { forever = false } = {}) {
  const m = media.get(id);
  if (!m) return;
  cancelProxy(m);
  if (m.proxyUrl) URL.revokeObjectURL(m.proxyUrl);
  if (forever) { DB.delBlob(id).catch(() => {}); DB.delBlob('p_' + id).catch(() => {}); } else removed.set(id, m.name);
  if (m.el && m.el.parentNode) { m.el.pause?.(); m.el.removeAttribute('src'); m.el.load?.(); m.el.remove(); }
  URL.revokeObjectURL(m.url);
  if (m.input) try { m.input.dispose?.(); } catch (e) { /* ignore */ }
  media.delete(id);
  emit('media');
}

// ── фонова обробка: по одному файлу за раз ──
let chain = Promise.resolve();
function queue(job) { chain = chain.then(job).catch(e => console.warn(e)); return chain; }

async function analyze(m) {
  try {
    if (m.kind === 'video') await makeThumbs(m);
    if (!media.has(m.id)) return;
    await makePeaks(m);
  } finally { m.analyzing = false; emit('media'); }
}

async function makeThumbs(m) {
  const th = 72, tw = Math.max(16, Math.round(th * m.width / m.height));
  const n = Math.min(400, Math.max(6, Math.ceil(m.duration / 1.5)));
  const step = m.duration / n;
  const times = Array.from({ length: n }, (_, i) => Math.min(m.duration - 0.05, i * step + step / 2));
  if (m.vt && m.canDecodeV) {
    try {
      const sink = new CanvasSink(m.vt, { width: tw, height: th, fit: 'fill', poolSize: 0 });
      let i = 0;
      for await (const w of sink.canvasesAtTimestamps(times)) {
        if (!media.has(m.id)) return;
        if (w) m.thumbs.push({ t: times[i], c: w.canvas });
        if (++i % 12 === 0) emit('thumbs', m.id);
      }
      emit('thumbs', m.id);
      return;
    } catch (e) { console.warn('Мініатюри через WebCodecs не вийшли', e); m.thumbs = []; }
  }
  // запасний шлях — перемотування відеоелемента (повільніше, тож менше кадрів)
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.src = m.url;
  await new Promise(r => (v.readyState >= 1 ? r() : v.addEventListener('loadedmetadata', r, { once: true })));
  const few = times.filter((_, i) => i % Math.ceil(n / 24) === 0);
  for (const t of few) {
    if (!media.has(m.id)) break;
    await new Promise(r => { v.addEventListener('seeked', r, { once: true }); v.currentTime = t; setTimeout(r, 1500); });
    const c = document.createElement('canvas'); c.width = tw; c.height = th;
    try { c.getContext('2d').drawImage(v, 0, 0, tw, th); m.thumbs.push({ t, c }); } catch (e) { break; }
    emit('thumbs', m.id);
  }
  v.removeAttribute('src'); v.load();
}

async function makePeaks(m) {
  if (!m.at || !m.canDecodeA) return;
  const n = Math.ceil(m.duration * PEAKS_RATE) + 1;
  const peaks = new Float32Array(n);
  m.peaks = peaks;
  const sink = new AudioBufferSink(m.at);
  let k = 0;
  for await (const w of sink.buffers()) {
    if (!media.has(m.id)) return;
    const b = w.buffer, sr = b.sampleRate;
    const chs = Math.min(2, b.numberOfChannels);
    for (let ch = 0; ch < chs; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < d.length; i += 4) {
        const idx = Math.floor((w.timestamp + i / sr) * PEAKS_RATE);
        const v = Math.abs(d[i]);
        if (idx >= 0 && idx < n && v > peaks[idx]) peaks[idx] = v;
      }
    }
    if (++k % 60 === 0) emit('peaks', m.id);
  }
  emit('peaks', m.id);
}

// найближча мініатюра для часу у файлі
export function thumbAt(m, t) {
  const a = m.thumbs;
  if (!a.length) return null;
  let best = a[0], bd = Infinity;
  for (const th of a) { const d = Math.abs(th.t - t); if (d < bd) { bd = d; best = th; } }
  return best.c;
}

// ── останній кадр кліпу (для переходу до наступного) ──
// Кешується за файлом і точкою виходу; рахується у фоні й повідомляє подією 'tails'.
const tails = new Map(); // key → HTMLCanvasElement | null | 'pending'
const tailKey = c => c.mediaId + '@' + (+c.out).toFixed(3);

export async function grabFrame(m, t, maxW = 1280) {
  const w = Math.min(maxW, m.width || maxW), h = Math.max(2, Math.round(w * (m.height || 720) / (m.width || 1280)));
  if (m.vt && m.canDecodeV) {
    try {
      const sink = new CanvasSink(m.vt, { width: w, height: h, fit: 'fill', poolSize: 0 });
      const r = await sink.getCanvas(Math.max(0, t));
      if (r) return r.canvas;
    } catch (e) { console.warn('Кадр через WebCodecs не вийшов', e); }
  }
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.src = m.url;
  try {
    await new Promise((res, rej) => { if (v.readyState >= 1) res(); else { v.addEventListener('loadedmetadata', res, { once: true }); v.addEventListener('error', rej, { once: true }); } });
    await new Promise(r => { v.addEventListener('seeked', r, { once: true }); v.currentTime = Math.max(0, t); setTimeout(r, 3000); });
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(v, 0, 0, w, h);
    return c;
  } catch (e) { return null; } finally { v.removeAttribute('src'); v.load(); }
}

// миттєво: кадр або null (тоді запускає обчислення у фоні)
export function tailFrame(c) {
  const m = media.get(c.mediaId);
  if (!m) return null;
  if (m.kind === 'image') return m.el;
  const k = tailKey(c), v = tails.get(k);
  if (v !== undefined) return v === 'pending' ? null : v;
  tails.set(k, 'pending');
  grabFrame(m, c.out - 0.04).then(cv => { tails.set(k, cv || null); emit('tails'); }).catch(() => tails.set(k, null));
  return null;
}
// дочекатися кадру (для експорту)
export async function ensureTail(c) {
  const m = media.get(c.mediaId);
  if (!m) return null;
  if (m.kind === 'image') return m.el;
  const k = tailKey(c);
  const v = tails.get(k);
  if (v && v !== 'pending') return v;
  const cv = await grabFrame(m, c.out - 0.04);
  tails.set(k, cv || null);
  return cv;
}

// найгучніший момент у фрагменті файлу (за хвилею) — для вирівнювання гучності
export function peakIn(m, from, to) {
  if (!m || !m.peaks) return null;
  let p = 0;
  for (let i = Math.max(0, Math.floor(from * PEAKS_RATE)), e = Math.min(m.peaks.length, Math.ceil(to * PEAKS_RATE)); i < e; i++) if (m.peaks[i] > p) p = m.peaks[i];
  return p;
}
