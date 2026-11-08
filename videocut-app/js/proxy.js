// Легка копія великих відео (4K і більше) для плавного перегляду.
// Монтаж і перегляд працюють із копією ≈720p, а експорт завжди бере оригінал — якість готового відео не страждає.
import { Input, Output, Conversion, BlobSource, BufferTarget, ALL_FORMATS, Mp4OutputFormat, WebMOutputFormat, getFirstEncodableVideoCodec } from '../vendor/mediabunny.min.mjs';

const LONG_SIDE = 1280;
export const needsProxy = m => m.kind === 'video' && m.hasVideo && Math.max(m.width || 0, m.height || 0) > 2000;

/**
 * Робить копію файлу меншого розміру. Повертає Blob або null (якщо браузер не вміє кодувати).
 * onProgress(0…1); handle.cancel() зупиняє роботу.
 */
export async function makeProxy(blob, { width, height }, onProgress, handle = {}) {
  const landscape = width >= height;
  const w = landscape ? LONG_SIDE : Math.round(LONG_SIDE * width / height / 2) * 2;
  const h = landscape ? Math.round(LONG_SIDE * height / width / 2) * 2 : LONG_SIDE;
  const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'vp8'], { width: w, height: h });
  if (!codec) return null;
  const mp4 = codec === 'avc';
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  const target = new BufferTarget();
  const output = new Output({ format: mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target });
  const conv = await Conversion.init({
    input, output,
    video: { codec, width: landscape ? w : undefined, height: landscape ? undefined : h, bitrate: 3e6, frameRate: 30, forceTranscode: true },
  });
  if (!conv.isValid) { try { input.dispose?.(); } catch (e) { /* ignore */ } return null; }
  conv.onProgress = p => onProgress?.(p);
  handle.cancel = () => conv.cancel().catch(() => {});
  try { await conv.execute(); }
  catch (e) { if (handle.cancelled) return null; throw e; }
  finally { try { input.dispose?.(); } catch (e) { /* ignore */ } }
  if (handle.cancelled) return null;
  return new Blob([target.buffer], { type: mp4 ? 'video/mp4' : 'video/webm' });
}
