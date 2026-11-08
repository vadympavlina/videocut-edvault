// Вікно експорту: вибір формату й якості, запуск, прогрес, скасування.
import { S, media, on, emit, duration } from './state.js';
import { pause } from './player.js';
import { exportVideo, exportAudio, exportSize, detectCodecs, canExport } from './export.js';
import { $, fmt, toast, openModal, confirmDialog, downloadBlob, safeName, fmtBytes } from './ui.js';

// ══════════ Експорт ══════════
let exporting = null, lastExport = null;
export const isExporting = () => !!exporting;
const exOpt = { format: 'mp4', short: 1080, quality: 'high', range: 'all' };
function segPick(id, key, conv = v => v) {
  $(id).addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b || b.disabled) return;
    $(id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    exOpt[key] = conv(b.dataset.v);
    updateExportInfo();
  });
}
segPick('exFormat', 'format');
segPick('exRes', 'short', Number);
segPick('exQuality', 'quality');
segPick('exRange', 'range');
$('btnExport').addEventListener('click', openExport);
on('open-export', openExport);

export function openExport() {
  if (!duration()) { toast('Спочатку додайте відео на таймлайн'); return; }
  if (!canExport()) { toast('Експорт потребує сучасного браузера: Chrome, Edge, Safari 17+ або Firefox 130+', 'err', 6000); return; }
  pause();
  $('exSetup').hidden = false; $('exRun').hidden = true; $('exDone').hidden = true;
  $('exName').value = S.project.name && S.project.name !== 'Новий проєкт' ? S.project.name : defaultName();
  const hasMarks = S.markIn != null && S.markOut != null && S.markOut - S.markIn > 0.1;
  $('exRangeWrap').hidden = !hasMarks;
  if (!hasMarks) exOpt.range = 'all';
  updateExportInfo();
  openModal('exportModal');
}
function defaultName() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `відео-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const exRange = () => (exOpt.range === 'marks' && S.markIn != null && S.markOut != null ? [S.markIn, S.markOut] : [0, duration()]);

// приблизний розмір файлу, байт
function estimateSize(len, W, H, audioOnly = false) {
  const vbr = ({ low: 1, medium: 2.5, high: 5, max: 9 }[exOpt.quality] || 5) * (W * H) / (1920 * 1080) + 0.16;
  return (audioOnly ? 0.16 : vbr) * 1e6 / 8 * len;
}
let infoSeq = 0;
async function updateExportInfo() {
  const audioOnly = exOpt.format === 'audio';
  $('exResWrap').hidden = audioOnly;
  $('exExt').textContent = audioOnly ? '.m4a' : '.' + exOpt.format;
  const [a, b] = exRange();
  const len = b - a;
  const { W, H } = exportSize(exOpt.short);
  const seq = ++infoSeq;
  $('exInfo').innerHTML = 'Перевіряємо можливості браузера…';
  const fmtKey = audioOnly ? 'mp4' : exOpt.format;
  const codecs = await detectCodecs(fmtKey, W, H).catch(() => ({}));
  if (seq !== infoSeq) return;
  const names = { avc: 'H.264', hevc: 'H.265', vp9: 'VP9', vp8: 'VP8', av1: 'AV1', aac: 'AAC', opus: 'Opus', vorbis: 'Vorbis' };
  const size = estimateSize(len, W, H, audioOnly);
  let html;
  if (audioOnly) html = codecs.a ? `Звук: <b>${names[codecs.a] || codecs.a}</b> · тривалість <b>${fmt(len)}</b> · приблизно <b>${fmtBytes(size)}</b>` : '<span class="warn">Браузер не вміє кодувати звук.</span>';
  else if (!codecs.v) html = `<span class="warn">Браузер не вміє кодувати відео у ${exOpt.format.toUpperCase()} такого розміру. Спробуйте інший формат або меншу якість.</span>`;
  else html = `<b>${W}×${H}</b>, ${S.project.fps} к/с · відео <b>${names[codecs.v] || codecs.v}</b>${codecs.a ? `, звук <b>${names[codecs.a] || codecs.a}</b>` : ''}<br>Тривалість <b>${fmt(len)}</b> · файл приблизно <b>${fmtBytes(size)}</b>` +
    (exOpt.format === 'mp4' && codecs.v !== 'avc' ? '<br><span class="warn">Цей браузер не має кодека H.264 — MP4 може не відкритися на старих пристроях.</span>' : '');
  if ([...media.values()].some(m => m.proxyUrl)) html += '<br>Перегляд використовує легку копію великого відео, а експорт бере оригінал у повній якості.';
  $('exInfo').innerHTML = html;
  $('exStart').disabled = audioOnly ? !codecs.a : !codecs.v;
}

$('exStart').addEventListener('click', startExport);
$('exCancel').addEventListener('click', () => { if (exporting) exporting.abort(); });
$('exAgain').addEventListener('click', () => { if (lastExport) downloadBlob(lastExport.blob, lastExport.name); });

async function startExport() {
  const audioOnly = exOpt.format === 'audio';
  const ext = audioOnly ? 'm4a' : exOpt.format;
  const name = safeName($('exName').value || defaultName()) + '.' + ext;
  const range = exRange();
  let writable = null;
  // довгі відео пишемо одразу у файл (без утримання всього в пам'яті), якщо браузер це дозволяє
  const { W: ew, H: eh } = exportSize(exOpt.short);
  const estBytes = estimateSize(range[1] - range[0], ew, eh, audioOnly);
  // без запису прямо у файл (Safari, Firefox) усе відео збирається в пам'яті — для великих файлів це ризик
  if (!audioOnly && !window.showSaveFilePicker && estBytes > 800e6) {
    const ok = await confirmDialog('Великий файл', `Готове відео займе близько ${fmtBytes(estBytes)}, а цей браузер збирає його в пам’яті — вкладка може завершитися помилкою. Надійніше експортувати в Chrome чи Edge, або вибрати меншу роздільність чи якість. Продовжити тут?`, 'Продовжити', false);
    if (!ok) return;
  }
  if (!audioOnly && window.showSaveFilePicker && (range[1] - range[0] > 600 || estBytes > 250e6)) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Відео', accept: { [exOpt.format === 'mp4' ? 'video/mp4' : 'video/webm']: ['.' + ext] } }] });
      writable = await h.createWritable();
    } catch (e) { if (e.name === 'AbortError') return; writable = null; }
  }
  $('exSetup').hidden = true; $('exRun').hidden = false;
  $('exBar').style.width = '0%'; $('exPct').textContent = '0%'; $('exEta').textContent = 'Готуємо…';
  const ctrl = new AbortController();
  exporting = ctrl;
  const t0 = performance.now();
  const onProgress = (p, info) => {
    $('exBar').style.width = (p * 100).toFixed(1) + '%';
    $('exPct').textContent = Math.floor(p * 100) + '%';
    if (info && info.eta != null) $('exEta').textContent = `Залишилось ≈ ${fmt(info.eta)}${info.speed ? ` · швидкість ${info.speed.toFixed(1).replace('.', ',')}×` : ''}`;
  };
  try {
    const opts = { format: audioOnly ? 'mp4' : exOpt.format, short: exOpt.short, quality: exOpt.quality, fps: S.project.fps, range, onProgress, signal: ctrl.signal, writable, onWarn: m => toast(m, '', 7000) };
    const blob = audioOnly ? await exportAudio(opts) : await exportVideo(opts);
    const secs = (performance.now() - t0) / 1000;
    if (blob) { lastExport = { blob, name }; downloadBlob(blob, name); }
    $('exRun').hidden = true; $('exDone').hidden = false;
    $('exAgain').hidden = !blob;
    $('exDoneInfo').textContent = `${name}${blob ? ' · ' + fmtBytes(blob.size) : ''} · за ${fmt(secs)}`;
    toast('Експорт завершено', 'ok');
    emit('exported');
  } catch (e) {
    console.error(e);
    if (writable) try { await writable.abort(); } catch (er) { /* ignore */ }
    $('exRun').hidden = true; $('exSetup').hidden = false;
    if (e.name === 'AbortError') toast('Експорт скасовано');
    else toast('Помилка експорту: ' + (e.message || e), 'err', 7000);
  } finally { exporting = null; }
}
window.addEventListener('beforeunload', e => { if (exporting) { e.preventDefault(); e.returnValue = ''; } });
