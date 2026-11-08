// Експорт відео через WebCodecs (mediabunny): кадри рендеряться на полотні, звук мікшується блоками.
import {
  Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, StreamTarget, CanvasSource, AudioBufferSource,
  VideoSampleSink, getFirstEncodableVideoCodec, getFirstEncodableAudioCodec,
  QUALITY_LOW, QUALITY_MEDIUM, QUALITY_HIGH, QUALITY_VERY_HIGH,
} from '../vendor/mediabunny.min.mjs';
import { S, media, layout, clipAt, srcTime, duration, outputSize } from './state.js';
import { renderScene, staticKey } from './render.js';
import { capStyle, loadCcFont } from './cc.js';
import { renderBlock, hasAnyAudio, resetAudioSinks } from './audio.js';
import { ensureTail } from './media.js';

const QUALITY = { low: QUALITY_LOW, medium: QUALITY_MEDIUM, high: QUALITY_HIGH, max: QUALITY_VERY_HIGH };

export function exportSize(shortSide) {
  const { W, H } = outputSize();
  const k = shortSide / Math.min(W, H);
  const even = v => Math.max(2, Math.round(v / 2) * 2);
  return { W: even(W * k), H: even(H * k) };
}

export const canExport = () => typeof window.VideoEncoder === 'function';

export async function detectCodecs(format, W, H) {
  const v = await getFirstEncodableVideoCodec(format === 'mp4' ? ['avc', 'hevc', 'vp9', 'av1'] : ['vp9', 'vp8', 'av1'], { width: W, height: H });
  const a = await getFirstEncodableAudioCodec(format === 'mp4' ? ['aac', 'opus'] : ['opus', 'vorbis'], { numberOfChannels: 2, sampleRate: 48000 });
  return { v, a };
}

// Послідовне читання кадрів одного кліпу через декодер WebCodecs
class ClipFrames {
  constructor(m, from, to) {
    this.m = m;
    this.it = new VideoSampleSink(m.vt).samples(Math.max(0, from), to + 0.5);
    this.cur = null; this.nxt = null; this.done = false;
  }
  async pull() { const r = await this.it.next(); if (r.done) { this.done = true; return null; } return r.value; }
  async at(t) {
    if (!this.cur) { this.cur = await this.pull(); this.nxt = this.cur ? await this.pull() : null; }
    while (this.nxt && this.nxt.timestamp <= t + 1e-4) { this.cur.close(); this.cur = this.nxt; this.nxt = await this.pull(); }
    if (!this.cur) return null;
    return { src: this.cur, w: this.cur.displayWidth, h: this.cur.displayHeight };
  }
  async close() { try { this.cur?.close(); this.nxt?.close(); await this.it.return?.(); } catch (e) { /* ignore */ } }
}

// Запасний шлях — перемотування <video> кадр за кадром (якщо WebCodecs не декодує джерело)
class ElementFrames {
  constructor(m) {
    this.m = m;
    this.v = document.createElement('video');
    this.v.muted = true; this.v.preload = 'auto'; this.v.src = m.url;
  }
  async at(t) {
    const v = this.v;
    if (v.readyState < 1) await new Promise(r => v.addEventListener('loadedmetadata', r, { once: true }));
    if (Math.abs(v.currentTime - t) > 0.001) await new Promise(r => { v.addEventListener('seeked', r, { once: true }); v.currentTime = t; setTimeout(r, 1500); });
    return { src: v, w: v.videoWidth, h: v.videoHeight };
  }
  async close() { this.v.removeAttribute('src'); this.v.load(); }
}

/**
 * opts: {format:'mp4'|'webm', short: 1080, fps, quality, range:[a,b]|null, writable?: WritableStream, onProgress(p, info), signal}
 * Повертає Blob (або null, якщо писали прямо у файл).
 */
export async function exportVideo(opts) {
  const { W, H } = exportSize(opts.short);
  const fps = opts.fps || S.project.fps || 30;
  const [a, b] = opts.range || [0, duration()];
  const total = Math.max(0, b - a);
  if (!(total > 0)) throw new Error('Немає що експортувати — таймлайн порожній.');
  const { v: vcodec, a: acodec } = await detectCodecs(opts.format, W, H);
  if (!vcodec) throw new Error('Браузер не вміє кодувати відео у формат ' + opts.format.toUpperCase() + '. Спробуйте інший формат або Chrome/Edge.');

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });

  const target = opts.writable ? new StreamTarget(opts.writable, { chunked: true }) : new BufferTarget();
  const format = opts.format === 'mp4' ? new Mp4OutputFormat({ fastStart: opts.writable ? false : 'in-memory' }) : new WebMOutputFormat();
  const output = new Output({ format, target });
  const vsrc = new CanvasSource(canvas, { codec: vcodec, bitrate: QUALITY[opts.quality] || QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(vsrc, { frameRate: fps });
  const withAudio = !!acodec && hasAnyAudio();
  let asrc = null;
  if (withAudio) { asrc = new AudioBufferSource({ codec: acodec, bitrate: opts.quality === 'low' ? 96e3 : 160e3 }); output.addAudioTrack(asrc); }
  await output.start();

  if (S.project.captions.length) await loadCcFont(capStyle(S.project));
  // шрифт тексту на відео має бути готовий до першого кадру, інакше початок відео вийде іншим шрифтом
  if (S.project.overlays.some(o => o.type === 'text') && document.fonts && document.fonts.load) {
    await Promise.race([Promise.all([600, 700, 800].map(w => document.fonts.load(`${w} 48px Inter`, 'АаБбЯя Aa').catch(() => {}))), new Promise(r => setTimeout(r, 3000))]);
  }
  const L = layout();
  // останні кадри кліпів, після яких іде перехід
  const tails = new Map();
  for (let i = 1; i < L.length; i++) {
    if (!L[i].clip.tr || L[i].end <= a || L[i].start >= b) continue;
    tails.set(L[i - 1].clip.id, await ensureTail(L[i - 1].clip));
  }
  const tailOf = c => tails.get(c.id) || null;
  // відео поверх відео — окремий декодер для кожної накладки
  const ovReaders = new Map();
  const ovFrames = new Map(); // кадри накладок для поточного кадру (рахуються заздалегідь, бо renderScene синхронний)
  async function prepareOv(t) {
    ovFrames.clear();
    for (const o of S.project.overlays) {
      if (o.type !== 'video') continue;
      const live = t >= o.start && t < o.start + o.dur;
      if (!live) { const r = ovReaders.get(o.id); if (r && t >= o.start + o.dur) { await r.close(); ovReaders.delete(o.id); } continue; }
      const m = media.get(o.mediaId); if (!m) continue;
      let r = ovReaders.get(o.id);
      const st = (o.in || 0) + (t - o.start);
      if (!r) { r = m.vt && m.canDecodeV ? new ClipFrames(m, st - 0.05, (o.in || 0) + o.dur) : new ElementFrames(m); ovReaders.set(o.id, r); }
      if (st <= m.duration) ovFrames.set(o.id, await r.at(st));
    }
  }
  const ovFrame = o => ovFrames.get(o.id) || null;
  const hasOv = S.project.overlays.some(o => o.type === 'video');
  const readers = new Map(); // clip.id → ClipFrames|ElementFrames
  const readerFor = l => {
    let r = readers.get(l.clip.id);
    if (!r) {
      const m = media.get(l.clip.mediaId);
      if (!m) return null;
      if (m.kind === 'image') r = { at: async () => ({ src: m.el, w: m.width, h: m.height }), close: async () => {} };
      else if (m.vt && m.canDecodeV) r = new ClipFrames(m, Math.max(l.clip.in, srcTime(l, Math.max(a, l.start))) - 0.05, l.clip.out);
      else { r = new ElementFrames(m); warnSlow(); }
      readers.set(l.clip.id, r);
    }
    return r;
  };

  let warned = false;
  const warnSlow = () => { if (!warned) { warned = true; opts.onWarn?.('Цей файл браузер не вміє швидко декодувати — експорт буде повільнішим. Для швидкості перетворіть його на MP4 (H.264) і додайте знову.'); } };
  resetAudioSinks();
  const frames = Math.max(1, Math.round(total * fps));
  let audioDone = a;
  const BLOCK = 1;
  const t0 = performance.now();
  let lastClipId = null;
  // однакові кадри поспіль (фото, заставка, стоп-кадр) кодуємо один раз з довшою тривалістю
  let pend = null;
  const flush = async () => { if (pend) { const p = pend; pend = null; await vsrc.add(p.ts, p.dur); } };
  const report = i => {
    if (i % 5 === 0 || i === frames - 1) {
      const p = (i + 1) / frames;
      const el = (performance.now() - t0) / 1000;
      opts.onProgress?.(p, { eta: p > 0.02 ? el / p - el : null, speed: (i + 1) / fps / el });
    }
  };
  try {
    for (let i = 0; i < frames; i++) {
      if (opts.signal?.aborted) throw new DOMException('Експорт скасовано', 'AbortError');
      const t = a + i / fps;
      const key = staticKey(t, L);
      if (pend && key && key === pend.key && pend.dur < 2 - 1e-6) { pend.dur += 1 / fps; report(i); continue; }
      await flush();
      // звук випереджає відео на блок — так мультиплексор не накопичує дані
      while (withAudio && audioDone < Math.min(b, t + BLOCK)) {
        const e = Math.min(b, audioDone + BLOCK);
        await asrc.add(await renderBlock(audioDone, e));
        audioDone = e;
      }
      const l = clipAt(t, L);
      if (lastClipId && (!l || l.clip.id !== lastClipId)) { // попередній кліп закінчився — звільняємо декодер
        const r = readers.get(lastClipId); if (r) { await r.close(); readers.delete(lastClipId); }
      }
      lastClipId = l ? l.clip.id : null;
      let frame = null;
      if (l) { const r = readerFor(l); frame = r ? await r.at(srcTime(l, t)) : null; }
      if (hasOv) await prepareOv(t);
      renderScene(ctx, W, H, t, () => frame, L, { tailOf, ovFrame, export: true });
      if (key) pend = { ts: i / fps, dur: 1 / fps, key };
      else await vsrc.add(i / fps, 1 / fps);
      report(i);
    }
    // WebM не зберігає тривалість останнього кадру — закриваємо довгий кадр ще одним у самому кінці
    if (pend && pend.dur > 1.5 / fps) { const p = pend; pend = null; await vsrc.add(p.ts, p.dur - 1 / fps); await vsrc.add(p.ts + p.dur - 1 / fps, 1 / fps); }
    await flush();
    while (withAudio && audioDone < b - 1e-6) { const e = Math.min(b, audioDone + BLOCK); await asrc.add(await renderBlock(audioDone, e)); audioDone = e; }
    vsrc.close(); asrc?.close();
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    for (const r of readers.values()) await r.close();
    for (const r of ovReaders.values()) await r.close();
  }
  if (opts.writable) return null;
  return new Blob([target.buffer], { type: opts.format === 'mp4' ? 'video/mp4' : 'video/webm' });
}

// Лише звук (M4A/Opus у WebM) — наприклад, для подкасту
export async function exportAudio(opts) {
  const [a, b] = opts.range || [0, duration()];
  const { a: acodec } = await detectCodecs(opts.format, 640, 360);
  if (!acodec) throw new Error('Браузер не вміє кодувати звук.');
  const target = new BufferTarget();
  const output = new Output({ format: opts.format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target });
  const asrc = new AudioBufferSource({ codec: acodec, bitrate: 160e3 });
  output.addAudioTrack(asrc);
  await output.start();
  resetAudioSinks();
  for (let t = a; t < b - 1e-6; t += 2) {
    if (opts.signal?.aborted) { await output.cancel(); throw new DOMException('Експорт скасовано', 'AbortError'); }
    await asrc.add(await renderBlock(t, Math.min(b, t + 2)));
    opts.onProgress?.(Math.min(1, (t + 2 - a) / (b - a)), {});
  }
  asrc.close();
  await output.finalize();
  return new Blob([target.buffer], { type: opts.format === 'mp4' ? 'audio/mp4' : 'audio/webm' });
}
