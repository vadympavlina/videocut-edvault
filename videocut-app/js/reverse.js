// Реверс відрізка відео: кадри й звук перекодовуються у зворотному порядку в новий файл (WebM).
import {
  Output, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource, CanvasSink, AudioBufferSink,
  getFirstEncodableVideoCodec, getFirstEncodableAudioCodec, QUALITY_HIGH,
} from '../vendor/mediabunny.min.mjs';

export const REVERSE_MAX = 30; // секунд
const WIN = 24; // кадрів у вікні декодування: зберігаємо в пам'яті лише одне вікно

export async function reverseRange(m, from, to, { onProgress = () => {}, isAlive = () => true } = {}) {
  if (!m.vt || !m.canDecodeV) throw new Error('Цей файл браузер не вміє швидко декодувати');
  const W = Math.min(1280, m.width) & ~1, H = Math.round(W * m.height / m.width) & ~1;
  const fps = 30, n = Math.max(2, Math.floor((to - from) * fps));
  const vcodec = await getFirstEncodableVideoCodec(['vp9', 'vp8'], { width: W, height: H });
  if (!vcodec) throw new Error('Браузер не вміє кодувати WebM');
  const withAudio = !!(m.at && m.canDecodeA), acodec = withAudio ? await getFirstEncodableAudioCodec(['opus', 'vorbis'], { numberOfChannels: 2, sampleRate: 48000 }) : null;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  const target = new BufferTarget(), output = new Output({ format: new WebMOutputFormat(), target });
  const vsrc = new CanvasSource(canvas, { codec: vcodec, bitrate: QUALITY_HIGH, keyFrameInterval: 1 });
  output.addVideoTrack(vsrc, { frameRate: fps });
  let asrc = null;
  if (acodec) { asrc = new AudioBufferSource({ codec: acodec, bitrate: 128e3 }); output.addAudioTrack(asrc); }
  await output.start();
  try {
    const sink = new CanvasSink(m.vt, { width: W, height: H, fit: 'fill', poolSize: 0 });
    let outI = 0, last = null;
    for (let end = n; end > 0; end -= WIN) {
      if (!isAlive()) throw new Error('Скасовано');
      const start = Math.max(0, end - WIN), times = [];
      for (let i = start; i < end; i++) times.push(Math.min(m.duration - 0.01, from + (i + 0.5) / fps));
      const frames = [];
      for await (const w of sink.canvasesAtTimestamps(times)) frames.push(w ? w.canvas : null);
      for (let k = frames.length - 1; k >= 0; k--) {
        const f = frames[k] || last; if (!f) continue;
        ctx.drawImage(f, 0, 0, W, H); last = f;
        await vsrc.add(outI / fps, 1 / fps); outI++;
      }
      onProgress(Math.min(0.9, (n - start) / n * 0.9));
      await new Promise(r => setTimeout(r));
    }
    if (asrc) {
      const sinkA = new AudioBufferSink(m.at); let sr = 48000, chans = null, total = 0;
      const parts = [];
      for await (const w of sinkA.buffers(from, to)) { parts.push(w); sr = w.buffer.sampleRate; }
      total = Math.round((to - from) * sr); chans = [new Float32Array(total), new Float32Array(total)];
      for (const w of parts) {
        const off = Math.round((w.timestamp - from) * sr), b = w.buffer, L = b.getChannelData(0), R = b.numberOfChannels > 1 ? b.getChannelData(1) : L;
        for (let i = 0; i < L.length; i++) { const j = off + i; if (j >= 0 && j < total) { chans[0][j] = L[i]; chans[1][j] = R[i]; } }
      }
      chans[0].reverse(); chans[1].reverse();
      const buf = new AudioBuffer({ length: total, numberOfChannels: 2, sampleRate: sr });
      buf.copyToChannel(chans[0], 0); buf.copyToChannel(chans[1], 1);
      await asrc.add(buf);
    }
    vsrc.close(); asrc?.close();
    await output.finalize();
  } catch (e) { await output.cancel().catch(() => {}); throw e; }
  onProgress(1);
  return new Blob([target.buffer], { type: 'video/webm' });
}
