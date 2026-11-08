// Конвертація старих і «небраузерних» форматів (AVI, WMV, FLV, MPG, 3GP, MTS, а також MOV з H.265/ProRes…) у MP4 (або WebM,
// якщо браузер не вміє H.264) — прямо в браузері.
// ffmpeg.wasm (≈31 МБ) вантажиться лише під час першої конвертації, далі береться з кешу браузера.
// Якщо всередині вже H.264 — лише перепаковуємо (секунди), інакше перекодовуємо у швидкому режимі.
import { $, toast, openModal, closeModal } from './ui.js';

// Спершу шукаємо конвертер поруч із редактором (vendor/ffmpeg-core/ — див. README там), інакше беремо з CDN.
// Так у школі без інтернету все працює, якщо файли покласти в папку один раз.
const LOCAL_CORE = new URL('../vendor/ffmpeg-core/', import.meta.url).href;
const CDN_CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/';
async function coreBase() {
  try { const r = await fetch(LOCAL_CORE + 'ffmpeg-core.wasm', { method: 'HEAD' }); if (r.ok && !/html/.test(r.headers.get('content-type') || '')) return LOCAL_CORE; } catch (e) { /* немає локальної копії */ }
  return CDN_CORE;
}
export const CONVERT_EXT = ['avi', 'wmv', 'asf', 'flv', 'f4v', 'mpg', 'mpeg', 'mpe', 'm2v', 'vob', '3gp', '3g2', 'mts', 'm2ts', 'divx', 'xvid', 'ogv', 'dv', 'rm', 'rmvb', 'mxf', 'm1v'];
export const CONVERT_ACCEPT = CONVERT_EXT.map(e => '.' + e).join(',');
const ext = name => (String(name).split('.').pop() || '').toLowerCase();
export const needsConvert = file => CONVERT_EXT.includes(ext(file.name));

let ff = null, loading = null;
async function getFF(onStage) {
  if (ff) return ff;
  if (loading) return loading;
  loading = (async () => {
    const { FFmpeg } = await import('../vendor/ffmpeg/index.js');
    const inst = new FFmpeg();
    onStage('Завантажуємо конвертер (≈ 31 МБ, лише перший раз)…');
    const base = await coreBase();
    await inst.load({ coreURL: base + 'ffmpeg-core.js', wasmURL: base + 'ffmpeg-core.wasm' });
    ff = inst;
    return inst;
  })().finally(() => { loading = null; });
  return loading;
}

// що всередині файлу: тривалість, кодеки
function parseProbe(log) {
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log);
  const v = /Stream #\d+:\d+[^:]*: Video: ([a-z0-9_]+)/i.exec(log);
  const a = /Stream #\d+:\d+[^:]*: Audio: ([a-z0-9_]+)/i.exec(log);
  return { duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0, video: v ? v[1].toLowerCase() : null, audio: a ? a[1].toLowerCase() : null };
}
const timeOf = line => { const m = /time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null; };

let current = null; // { cancel }

// чи вміє браузер H.264 (у деяких збірках Chromium і Firefox його немає) — інакше робимо WebM
let h264 = null;
async function canH264() {
  if (h264 != null) return h264;
  const v = document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
  let dec = true;
  if (window.VideoDecoder) { try { dec = (await VideoDecoder.isConfigSupported({ codec: 'avc1.42E01E', codedWidth: 640, codedHeight: 360 })).supported; } catch { dec = false; } }
  return (h264 = !!v && dec);
}

// Повертає File у форматі MP4 або кидає помилку. onProgress(частка 0…1, текст)
export async function convertToMp4(file, onProgress = () => {}) {
  const run = { cancelled: false };
  current = run;
  const stage = t => onProgress(null, t);
  const f = await getFF(stage);
  if (run.cancelled) throw cancelErr();
  const dir = '/in' + Date.now();
  let log = '';
  const onLog = ({ message }) => { log += message + '\n'; };
  f.on('log', onLog);
  try {
    // файл монтуємо без копіювання в пам’ять — працює й для великих відео
    await f.createDir(dir);
    await f.mount('WORKERFS', { files: [file] }, dir);
    const src = `${dir}/${file.name}`;
    stage('Аналізуємо файл…');
    log = '';
    await f.exec(['-hide_banner', '-i', src]);
    const info = parseProbe(log);
    if (!info.video && !info.audio) throw new Error('У файлі не знайдено ні відео, ні звуку');
    const total = info.duration || 0;
    const progress = (base, span, label) => ({ message }) => {
      const t = timeOf(message);
      if (t != null && total) onProgress(Math.min(1, base + span * t / total), label);
    };

    const mp4 = await canH264();
    const audioArgs = info.audio ? ['-map', '0:a:0?', ...(info.audio === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '160k'])] : [];
    const out = mp4 ? 'out.mp4' : 'out.webm';
    let ok = false;
    // ① H.264 — лише перепаковуємо (майже миттєво)
    if (mp4 && info.video === 'h264') {
      stage('Перепаковуємо в MP4…');
      const h = progress(0, 1, 'Перепаковуємо в MP4…'); f.on('log', h);
      const ret = await f.exec(['-hide_banner', '-fflags', '+genpts', '-i', src, '-map', '0:v:0', '-c:v', 'copy', ...audioArgs, '-movflags', '+faststart', '-y', out]);
      f.off('log', h);
      ok = ret === 0;
    }
    if (run.cancelled) throw cancelErr();
    // ② інакше — перекодовуємо в H.264 (швидкий режим, добра якість)
    if (!ok) {
      const label = info.video ? 'Перекодовуємо відео…' : 'Перекодовуємо звук…';
      stage(label);
      const h = progress(0, 1, label); f.on('log', h);
      // парні розміри; 4K і більше — до 1080p, щоб перетворення не тривало вічність (для уроку цього досить)
      const even = ['-vf', "scale='min(iw,1920)':'min(ih,1920)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1", '-pix_fmt', 'yuv420p'];
      const v = !info.video ? [] : mp4 ? ['-map', '0:v:0', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22', ...even]
        : ['-map', '0:v:0', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '0', '-crf', '10', '-qmin', '4', '-qmax', '42', ...even];
      const a = !info.audio ? [] : ['-map', '0:a:0?', ...(mp4 ? ['-c:a', 'aac', '-b:a', '160k'] : ['-c:a', 'libopus', '-b:a', '128k'])];
      const ret = await f.exec(['-hide_banner', '-i', src, ...v, ...a, ...(mp4 ? ['-movflags', '+faststart'] : []), '-y', out]);
      f.off('log', h);
      if (run.cancelled) throw cancelErr();
      if (ret !== 0) throw new Error('Не вдалося перетворити файл. Можливо, він пошкоджений.');
    }
    const data = await f.readFile(out);
    await f.deleteFile(out).catch(() => {});
    onProgress(1, 'Готово');
    const name = file.name.replace(/\.[^.]+$/, '') + (mp4 ? '.mp4' : '.webm');
    return new File([data], name, { type: (info.video ? 'video/' : 'audio/') + (mp4 ? 'mp4' : 'webm') });
  } catch (e) {
    if (run.cancelled) throw cancelErr();
    throw e;
  } finally {
    f.off('log', onLog);
    try { await f.unmount(dir); await f.deleteDir(dir); } catch { /* вже прибрано */ }
    if (current === run) current = null;
  }
}
const cancelErr = () => Object.assign(new Error('Конвертацію скасовано'), { name: 'AbortError' });
export const converting = () => !!current;
export function cancelConvert() {
  if (!current) return;
  current.cancelled = true;
  if (ff) { ff.terminate(); ff = null; } // зупиняє роботу миттєво; наступного разу конвертер перезапуститься (з кешу)
}

// Вікно з прогресом. Повертає File (MP4) або null, якщо скасовано.
export async function convertWithDialog(file) {
  $('cvName').textContent = file.name;
  $('cvBar').style.width = '0%'; $('cvPct').textContent = '0%'; $('cvStage').textContent = 'Готуємо…';
  openModal('cvModal');
  const t0 = performance.now();
  try {
    const out = await convertToMp4(file, (p, text) => {
      if (p != null) {
        $('cvBar').style.width = (p * 100).toFixed(1) + '%';
        const el = (performance.now() - t0) / 1000;
        const left = p > 0.03 ? Math.max(0, el / p - el) : null;
        $('cvPct').textContent = Math.floor(p * 100) + '%';
        if (text) $('cvStage').textContent = text + (left != null && left > 3 ? ` Лишилось ≈ ${left < 60 ? Math.round(left) + ' с' : Math.round(left / 60) + ' хв'}` : '');
      } else if (text) $('cvStage').textContent = text;
    });
    closeModal('cvModal');
    return out;
  } catch (e) {
    closeModal('cvModal');
    if (e.name === 'AbortError') { toast('Конвертацію скасовано'); return null; }
    console.error(e);
    const net = /fetch|network|import|Failed to load|NetworkError/i.test(e.message || '');
    toast(net ? 'Не вдалося завантажити конвертер. Перевірте інтернет і спробуйте ще раз.' : (e.message || 'Не вдалося перетворити файл'), 'err', 7000);
    return null;
  }
}
export function initConvert() {
  $('cvCancel').addEventListener('click', () => { cancelConvert(); });
}
