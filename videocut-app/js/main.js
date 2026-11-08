// Точка входу відеоредактора Edvault.
import { S, media, on, emit, commit, undo, redo, canUndo, canRedo, select, duration, layout, newProject, resetHistory, editPoints } from './state.js';
import { addMedia, removeMedia, reviveMedia, removedMedia, purgeRemoved } from './media.js';
import { initPlayer, resizeCanvas, seek, toggle, pause, play, snapshot, requestDraw } from './player.js';
import { initTimeline, render as renderTimeline, zoomBy, zoomFit, setZoom } from './timeline.js';
import { initLibrary, initInspector, importCaptionFile, showTab, showProject } from './panels.js';
import { initPreviewLayer, renderHandles } from './preview.js';
import { addToTimeline, addOverlay, splitAt, deleteSel, duplicateSel, copySel, pasteClip, canPaste, cutRange, addCaption, normalizeSel, transitionsAll, addTitleCard, addLayerAt, TEXT_PRESETS, CARD_STYLES } from './ops.js';
import { initMenu } from './menu.js';
import { initCtx } from './ctxmenu.js';
import { toSrt, toVtt } from './srt.js';
import { exportVideo, exportAudio } from './export.js';
import { openExport, isExporting } from './export-ui.js';
import { openSilences } from './silences.js';
import { openVoice, stopVoice, isRecording } from './voice.js';
import { DB, takeHandoff } from './db.js';
import { packProject, unpackProject, PROJ_EXT } from './projfile.js';
import { initAsr, openAsr, asrBusy } from './asr.js';
import { initConvert, needsConvert, convertWithDialog, converting } from './convert.js';
import { $, icon, hydrateIcons, paintRanges, initTips, initTheme, toast, fmt, openModal, closeModal, anyModalOpen, confirmDialog, downloadBlob, safeName, fmtBytes } from './ui.js';

hydrateIcons();
paintRanges(document);
initTips();
initTheme($('btnTheme'));
initPlayer($('pv'));
initTimeline();
initCtx();
initLibrary();
initInspector();
initPreviewLayer();
initAsr();
initConvert();
on('open-asr', openAsr);
on('proxy-start', m => toast(`«${m.name}» дуже велике (${m.width}×${m.height}). Готуємо легку копію, щоб перегляд не гальмував — експорт піде з оригіналу.`, '', 7000));

// ── розмір перегляду ──
const stage = $('stage');
function fitStage() {
  const r = stage.getBoundingClientRect();
  resizeCanvas(Math.max(40, r.width - 32), Math.max(40, r.height - 32));
  renderHandles();
}
new ResizeObserver(fitStage).observe(stage);
on('aspect', () => { fitStage(); renderTimeline(); });
on('project', d => { if (d && d.committed) fitStage(); });

// ── перемикач таймлайну за висотою ──
(() => {
  const sp = $('splitter');
  let saved = 0;
  try { saved = +localStorage.getItem('ev_vc_tl_h') || 0; } catch (e) { /* ignore */ }
  if (saved) document.documentElement.style.setProperty('--tl-h', saved + 'px');
  sp.addEventListener('pointerdown', e => {
    sp.setPointerCapture(e.pointerId); sp.classList.add('active');
    const startY = e.clientY, startH = $('tl').getBoundingClientRect().height;
    const mv = ev => {
      const h = Math.max(150, Math.min(window.innerHeight - 260, startH - (ev.clientY - startY)));
      document.documentElement.style.setProperty('--tl-h', h + 'px');
    };
    sp.addEventListener('pointermove', mv);
    sp.addEventListener('pointerup', () => {
      sp.removeEventListener('pointermove', mv); sp.classList.remove('active');
      try { localStorage.setItem('ev_vc_tl_h', Math.round($('tl').getBoundingClientRect().height)); } catch (e) { /* ignore */ }
      renderTimeline();
    }, { once: true });
  });
})();

// ── транспорт ──
function syncTransport() {
  $('trTime').textContent = fmt(S.t, true);
  $('trDur').textContent = fmt(duration(), true);
}
on('time', syncTransport);
on('project', syncTransport);
on('play', () => { $('btnPlay').innerHTML = icon(S.playing ? 'pause' : 'play'); });
const frame = () => 1 / (S.project.fps || 30);
$('btnPlay').addEventListener('click', toggle);
$('btnStart').addEventListener('click', () => seek(0));
$('btnEnd').addEventListener('click', () => seek(duration()));
$('btnFrameBack').addEventListener('click', () => { pause(); seek(S.t - frame()); });
$('btnFrameFwd').addEventListener('click', () => { pause(); seek(S.t + frame()); });
$('btnSnap').addEventListener('click', async () => {
  if (!duration()) return;
  const b = await snapshot();
  downloadBlob(b, `${safeName(S.project.name)}-кадр-${fmt(S.t).replace(/:/g, '-')}.png`);
  toast('Кадр збережено', 'ok');
});
$('btnFull').addEventListener('click', toggleFullscreen);
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else stage.requestFullscreen?.().catch(() => {});
}
document.addEventListener('fullscreenchange', () => setTimeout(fitStage, 50));

// ── верхня панель ──
function syncHistory() { $('btnUndo').disabled = !canUndo(); $('btnRedo').disabled = !canRedo(); }
on('history', syncHistory);
$('btnUndo').addEventListener('click', () => undo());
$('btnRedo').addEventListener('click', () => redo());
function syncTitle() {
  $('projName').textContent = S.project.name || 'Без назви';
  document.title = (S.project.name ? S.project.name + ' — ' : '') + 'Відеоредактор Edvault';
}
on('title', syncTitle);
on('project', syncTitle);
$('btnHelp').addEventListener('click', () => openModal('helpModal'));
document.querySelectorAll('.overlay').forEach(o => o.addEventListener('click', e => {
  if (o.id === 'confirmModal') return;
  if (e.target === o || e.target.closest('[data-close]')) { if (o.id === 'exportModal' && isExporting()) return; closeModal(o.id); }
}));

// порожній стан перегляду
function syncEmpty() { $('stageEmpty').hidden = S.project.clips.length > 0 || S.project.overlays.length > 0; }
on('project', syncEmpty);

// ── імпорт файлів ──
const fileInput = $('fileInput');
$('btnImport').addEventListener('click', () => { fileInput.dataset.target = ''; fileInput.click(); });
$('btnImport3').addEventListener('click', () => { fileInput.dataset.target = ''; fileInput.click(); });
fileInput.addEventListener('change', () => {
  const files = [...fileInput.files];
  const target = fileInput.dataset.target;
  fileInput.value = ''; fileInput.dataset.target = '';
  importFiles(files, { logo: target === 'logo', layer: target === 'layer' });
});
$('capInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importCaptionFile(f); });

function pickFiles(target = '') { fileInput.dataset.target = target; fileInput.click(); }
async function importFiles(files, { logo = false, layer = false, toTimeline = true } = {}) {
  let added = 0;
  for (let f of files) {
    if (/\.(srt|vtt)$/i.test(f.name)) { await importCaptionFile(f); continue; }
    if (f.name.toLowerCase().endsWith(PROJ_EXT)) { await openProjectFile(f); continue; }
    // AVI, WMV, MPG та інші формати, яких браузер не відкриває, — спершу перетворюємо на MP4
    if (needsConvert(f)) { const c = await convertWithDialog(f); if (!c) continue; f = c; }
    toast(`Відкриваємо «${f.name}»…`, '', 60000);
    try {
      let m;
      try { m = await addMedia(f, f.name, { check: true }); }
      catch (e) {
        // браузер не відкрив відео або не показує його кадрів (H.265, ProRes, MJPEG у MOV тощо) — перетворюємо
        const vid = e.needsConvert || /^video\//.test(f.type) || /\.(mp4|mov|qt|mkv|webm|m4v|ts)$/i.test(f.name);
        if (!vid) throw e;
        toast(`«${f.name}»: браузер не вміє показати цей кодек — перетворюємо`, '', 4000);
        const c = await convertWithDialog(f); if (!c) continue;
        f = c; m = await addMedia(f, f.name);
      }
      added++;
      if (logo && m.kind === 'image') addOverlay('image', { mediaId: m.id });
      else if (layer && m.kind !== 'audio' && S.project.clips.length) addLayerAt(m, { start: S.t });
      else if (toTimeline && (m.kind !== 'image' || !S.project.clips.length || files.length > 1)) addToTimeline(m, { silent: true });
    } catch (e) {
      console.error(e);
      toast(e.message || 'Не вдалося відкрити файл', 'err', 5000);
    }
  }
  if (added) {
    toast(added === 1 ? 'Файл додано' : `Додано файлів: ${added}`, 'ok');
    if (S.project.clips.length && duration() > 0) zoomFit();
    emit('aspect');
  }
}

// перетягування файлів у вікно
let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('dropHint').classList.add('show'); });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropHint').classList.remove('show'); });
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $('dropHint').classList.remove('show');
  importFiles([...e.dataTransfer.files]);
});

// ── таймлайн: кнопки ──
$('btnSplit').addEventListener('click', () => splitAt());
$('btnDelete').addEventListener('click', () => { if (!deleteSel()) toast('Спочатку виділіть елемент на таймлайні'); });
$('btnMarkIn').addEventListener('click', () => mark('in'));
$('btnMarkOut').addEventListener('click', () => mark('out'));
$('btnCutRange').addEventListener('click', () => cutRange(S.markIn, S.markOut));
$('btnSnapToggle').addEventListener('click', e => { S.snap = !S.snap; e.currentTarget.classList.toggle('on', S.snap); toast(S.snap ? 'Прилипання увімкнено' : 'Прилипання вимкнено'); });
$('btnZoomIn').addEventListener('click', () => zoomBy(1.5));
$('btnZoomOut').addEventListener('click', () => zoomBy(1 / 1.5));
$('btnZoomFit').addEventListener('click', zoomFit);
function mark(which) {
  if (which === 'in') S.markIn = S.t; else S.markOut = S.t;
  if (S.markIn != null && S.markOut != null && S.markOut < S.markIn) [S.markIn, S.markOut] = [S.markOut, S.markIn];
  syncCut();
  emit('marks');
  toast(which === 'in' ? `Початок шматка: ${fmt(S.t, true)}` : `Кінець шматка: ${fmt(S.t, true)}`);
}
function clearMarks() { S.markIn = S.markOut = null; syncCut(); emit('marks'); }
// кнопка «Вирізати шматок» з'являється лише тоді, коли є позначки
function syncCut() {
  const b = $('btnCutRange');
  b.hidden = S.markIn == null && S.markOut == null;
  b.disabled = !(S.markIn != null && S.markOut != null && S.markOut - S.markIn > 0.05);
}
on('project', d => { if (d && d.committed) syncCut(); });

// новий субтитр у позиції курсора, і одразу можна друкувати
function newCaptionHere() {
  showTab('captions');
  const c = addCaption('');
  const ta = document.querySelector(`#libBody textarea[data-cap="${c.id}"]`);
  if (ta) { ta.focus(); ta.select(); }
}

// ── клавіатура (за фізичною клавішею — працює й на українській розкладці) ──
document.addEventListener('keydown', e => {
  if (anyModalOpen()) {
    if (e.key === 'Escape') {
      const o = document.querySelector('.overlay.open');
      if (o.id === 'confirmModal') $('confirmNo').click();
      else if (!(o.id === 'exportModal' && isExporting())) closeModal(o.id);
    }
    return;
  }
  if (isRecording()) { // під час запису голосу — лише зупинка
    if (e.code === 'Space' || e.key === 'Escape') { e.preventDefault(); stopVoice(); }
    return;
  }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.code === 'KeyZ') { if (typing) return; e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && e.code === 'KeyY') { if (typing) return; e.preventDefault(); redo(); return; }
  if (mod && e.code === 'KeyE') { e.preventDefault(); openExport(); return; }
  if (mod && e.code === 'KeyS') { e.preventDefault(); saveNow(); toast('Проєкт збережено в цьому браузері', 'ok'); return; }
  if (typing) { if (e.key === 'Escape') e.target.blur(); return; }
  if (mod && e.code === 'KeyD') { e.preventDefault(); duplicateSel(); return; }
  if (mod && e.code === 'KeyC') { e.preventDefault(); copySel(); return; }
  if (mod && e.code === 'KeyX') { e.preventDefault(); copySel(true); return; }
  if (mod && e.code === 'KeyV') { e.preventDefault(); pasteClip(); return; }
  if (mod && e.code === 'KeyO') { e.preventDefault(); pickFiles(''); return; }
  if (mod || e.altKey) return;
  const f = frame();
  switch (e.code) {
    case 'Space': case 'KeyK': e.preventDefault(); toggle(); break;
    case 'KeyJ': seek(S.t - 5); break;
    case 'KeyL': seek(S.t + 5); break;
    case 'ArrowLeft': e.preventDefault(); pause(); seek(S.t - (e.shiftKey ? 1 : f)); break;
    case 'ArrowRight': e.preventDefault(); pause(); seek(S.t + (e.shiftKey ? 1 : f)); break;
    case 'ArrowUp': case 'ArrowDown': { // до попередньої / наступної точки монтажу (край кліпу, тексту, субтитру…)
      e.preventDefault(); pause();
      const pts = editPoints(), eps = 0.005;
      const target = e.code === 'ArrowDown' ? pts.find(p => p > S.t + eps) : [...pts].reverse().find(p => p < S.t - eps);
      if (target != null) seek(target);
      break;
    }
    case 'Home': e.preventDefault(); seek(0); break;
    case 'End': e.preventDefault(); seek(duration()); break;
    case 'KeyS': e.preventDefault(); splitAt(); break;
    case 'Delete': case 'Backspace': e.preventDefault(); deleteSel(); break;
    case 'KeyI': mark('in'); break;
    case 'KeyO': mark('out'); break;
    case 'KeyX': cutRange(S.markIn, S.markOut); break;
    case 'KeyT': e.preventDefault(); showTab('text'); addOverlay('text', { preset: 'plain' }); emit('focus-inspector'); break;
    case 'KeyC': e.preventDefault(); newCaptionHere(); break;
    case 'KeyF': toggleFullscreen(); break;
    case 'KeyR': openVoice(); break;
    case 'Equal': case 'NumpadAdd': zoomBy(1.5); break;
    case 'Minus': case 'NumpadSubtract': zoomBy(1 / 1.5); break;
    case 'KeyZ': if (e.shiftKey) zoomFit(); break;
    case 'Escape': if (S.sel) select(null); else if (!document.body.classList.contains('insp-off')) showProject(false); else clearMarks(); break;
    case 'Slash': if (e.shiftKey) openModal('helpModal'); break;
    default: return;
  }
});

// ══════════ Автозбереження ══════════
let storageWarned = false;
on('storage-error', ({ name }) => {
  if (storageWarned) return; storageWarned = true;
  toast(`У браузері забракло місця, щоб зберегти «${name}». Монтаж працює, але після перезавантаження сторінки файл треба буде додати знову. Експортуйте відео, коли закінчите.`, 'err', 9000);
});
let saveTimer = 0;
function setSaveState(t) { const el = $('saveState'); el.textContent = t; el.dataset.s = t === 'Збережено' ? 'ok' : t === 'Не збережено' ? 'err' : 'busy'; }
function saveNow() {
  clearTimeout(saveTimer);
  const list = [...media.values()].map(m => ({ id: m.id, name: m.name }));
  return Promise.all([DB.set('project', S.project), DB.set('mediaList', list)])
    .then(() => { savePending = false; setSaveState('Збережено'); })
    .catch(e => { console.warn(e); setSaveState('Не збережено'); });
}
function scheduleSave() { setSaveState('Зберігаємо…'); clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 700); }
// закрили або згорнули вкладку раніше за 0,7 с після правки — зберігаємо одразу, щоб остання зміна не пропала
let savePending = false;
on('project', d => { if (d && d.committed) savePending = true; });
on('media', () => { savePending = true; });
const flushSave = () => { if (savePending) { savePending = false; saveNow(); } };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
window.addEventListener('pagehide', flushSave);
on('project', d => { if (d && d.committed) scheduleSave(); });
on('media', scheduleSave);

async function restore() {
  let p = null, list = [];
  try { p = await DB.get('project'); list = (await DB.get('mediaList')) || []; } catch (e) { console.warn(e); }
  if (!p || !p.clips) return false;
  const missing = [];
  // блоби читаємо з бази паралельно, а відкриваємо по черзі — зберігається порядок файлів у бібліотеці
  const blobs = await Promise.all(list.map(x => DB.getBlob(x.id).catch(() => null)));
  for (let i = 0; i < list.length; i++) {
    const { id, name } = list[i];
    if (!blobs[i]) { missing.push(name); continue; }
    try { await addMedia(blobs[i], name, { id, persist: false }); } catch (e) { missing.push(name); }
  }
  S.project = { ...newProject(), ...p };
  // файли, яких немає у списку проєкту (залишки після збоїв чи видалених), більше не потрібні
  DB.blobKeys().then(keys => keys.filter(k => !list.some(x => x.id === k || 'p_' + x.id === k)).forEach(k => DB.delBlob(k).catch(() => {}))).catch(() => {});
  resetHistory();
  emit('project', { committed: true, restored: true });
  emit('aspect');
  if (S.project.clips.length || S.project.overlays.length) {
    toast(missing.length ? `Проєкт відновлено, але бракує файлів: ${missing.join(', ')}` : 'Проєкт відновлено з минулого разу', missing.length ? 'err' : 'ok', 4500);
    setSaveState('Збережено');
  }
  return true;
}

// «Скасувати» повернуло кліпи, чий файл раніше прибрали з проєкту, — підвантажуємо його назад
async function reviveMissing() {
  const p = S.project;
  const ids = new Set([...p.clips.map(c => c.mediaId), ...p.music.map(m => m.mediaId), ...p.overlays.map(o => o.mediaId)].filter(Boolean));
  let n = 0;
  for (const id of ids) if (!media.has(id) && removedMedia(id)) { try { if (await reviveMedia(id)) n++; } catch (e) { console.warn(e); } }
  if (n) { emit('project', { restored: true }); emit('aspect'); }
}
on('project', d => { if (d && d.restored && d.committed) reviveMissing(); });

// прибирає з редактора поточний проєкт і всі файли
function clearEditor() {
  pause();
  [...media.keys()].forEach(id => removeMedia(id, { forever: true }));
  purgeRemoved();
  S.project = newProject();
  S.sel = null; S.t = 0; clearMarks();
  resetHistory();
}
$('btnNew').addEventListener('click', async () => {
  if ((S.project.clips.length || media.size) && !(await confirmDialog('Почати новий проєкт?', 'Поточний проєкт і всі додані файли буде прибрано з редактора. Уже експортовані відео це не зачепить. Щоб не втратити роботу, спершу збережіть проєкт у файл (меню «Файл»).', 'Новий проєкт'))) return;
  clearEditor();
  emit('project', { committed: true });
  emit('select');
  emit('aspect');
  saveNow();
});

// ── проєкт як файл ──
function saveProjectFile() {
  if (!media.size && !S.project.clips.length) { toast('Проєкт порожній — нічого зберігати'); return; }
  const blob = packProject();
  downloadBlob(blob, safeName(S.project.name) + PROJ_EXT);
  toast(`Проєкт збережено у файл (${fmtBytes(blob.size)}). Він містить усі відео, фото й звуки`, 'ok', 5000);
}
async function openProjectFile(file) {
  let data;
  try { data = await unpackProject(file); } catch (e) { toast(e.message || 'Не вдалося відкрити файл проєкту', 'err', 6000); return; }
  if ((S.project.clips.length || media.size) && !(await confirmDialog('Відкрити проєкт із файлу?', 'Поточний проєкт буде замінено. Збережіть його у файл, якщо він ще потрібен.', 'Відкрити'))) return;
  clearEditor();
  toast('Відкриваємо проєкт…', '', 60000);
  const missing = [];
  for (const it of data.items) {
    try { await addMedia(it.blob, it.name, { id: it.id }); } catch (e) { console.warn(e); missing.push(it.name); }
  }
  S.project = { ...newProject(), ...data.project };
  resetHistory();
  emit('project', { committed: true, restored: true });
  emit('select');
  emit('aspect');
  if (duration() > 0) zoomFit();
  saveNow();
  toast(missing.length ? `Проєкт відкрито, але не вдалося завантажити: ${missing.join(', ')}` : 'Проєкт відкрито', missing.length ? 'err' : 'ok', 5000);
}
$('projInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) openProjectFile(f); });

// файл, переданий з іншого інструмента (наприклад, «Запис екрану»)
async function takeHandoffIfAny() {
  const params = new URLSearchParams(location.search);
  if (!params.has('import')) return;
  history.replaceState(null, '', location.pathname);
  const item = await takeHandoff(params.get('import'));
  if (!item || !item.blob) { toast('Не знайшли переданий файл — додайте його вручну', 'err'); return; }
  try {
    const m = await addMedia(item.blob, item.name || 'запис-екрану.webm');
    addToTimeline(m, { silent: true });
    zoomFit();
    toast('Запис екрану відкрито — можна обрізати й доповнити', 'ok', 4000);
  } catch (e) { toast(e.message, 'err'); }
}

// маленькі екрани: панелі як висувні
$('btnShowLib').addEventListener('click', () => { document.body.classList.toggle('show-lib'); document.body.classList.remove('show-insp'); });
$('btnShowInsp').addEventListener('click', () => { if (!S.sel) showProject(true); document.body.classList.toggle('show-insp'); document.body.classList.remove('show-lib'); });
$('btnProj').addEventListener('click', () => { const off = document.body.classList.contains('insp-off') || !!S.sel; showProject(off); if (off && matchMedia('(max-width:980px)').matches) { document.body.classList.add('show-insp'); document.body.classList.remove('show-lib'); } if (off) setTimeout(() => document.querySelector('#inspector [data-pf="name"]')?.focus(), 0); });
document.addEventListener('pointerdown', e => {
  if (!document.body.matches('.show-lib,.show-insp')) return;
  if (e.target.closest('.lib,.insp,#btnShowLib,#btnShowInsp,.overlay')) return;
  document.body.classList.remove('show-lib', 'show-insp');
});
if (window.matchMedia('(max-width: 980px)').matches) toast('Редактор найзручніший на комп’ютері з великим екраном', '', 4000);

(async () => {
  await restore();
  await takeHandoffIfAny();
  syncTitle(); syncEmpty(); syncTransport(); syncHistory(); fitStage();
  if (duration() > 0) zoomFit(); else setZoom(60, 0);
  requestDraw();
})();

// для автотестів
window.VideoCut = { S, media, seek, commit, exportVideo, exportAudio, duration, layout };

window.addEventListener('beforeunload', e => { if (isRecording() || asrBusy() || converting()) { e.preventDefault(); e.returnValue = ''; } });

// ══════════ Меню (Файл · Редагування · …) ══════════
// Рідше вживані дії живуть тут, щоб не займати місце на екрані.
{
  const has = () => S.project.clips.length > 0;
  const capList = () => S.project.captions.slice().sort((a, b) => a.start - b.start);
  const saveCaps = kind => {
    const caps = capList(), name = safeName(S.project.name);
    const body = kind === 'srt' ? toSrt(caps) : kind === 'vtt' ? toVtt(caps) : caps.map(c => c.text.replace(/\s*\n\s*/g, ' ')).join('\n');
    downloadBlob(new Blob([body], { type: 'text/plain' }), `${name}.${kind}`);
  };
  const panel = (cls, on) => { document.body.classList.toggle(cls, !on); try { localStorage.setItem('vc_' + cls, document.body.classList.contains(cls) ? '1' : ''); } catch { /* немає доступу */ } };
  ['hide-lib'].forEach(c => { try { if (localStorage.getItem('vc_' + c)) document.body.classList.add(c); } catch { /* немає доступу */ } });
  const narrow = () => matchMedia('(max-width:980px)').matches;
  const showLibTab = t => { showTab(t); if (narrow()) document.body.classList.add('show-lib'); else panel('hide-lib', true); };

  const hasSel = () => !!S.sel;
  const audioSel = () => !!S.sel && (S.sel.kind === 'clip' || S.sel.kind === 'music');
  // Меню зібране за змістом: спершу робота з файлами, потім правка, вставка, автоматичні інструменти, вигляд.
  // Дії над кліпом (швидкість, фільтр, перехід, поворот…) живуть у панелі «Властивості» праворуч — тут їх немає.
  initMenu($('menubar'), [
    { label: 'Файл', items: [
      { label: 'Новий проєкт', ic: 'plus', run: () => $('btnNew').click() },
      { label: 'Відкрити проєкт із файлу…', ic: 'upload', run: () => $('projInput').click() },
      { label: 'Зберегти проєкт у файл…', ic: 'download', enabled: () => media.size > 0, run: saveProjectFile },
      { sep: true },
      { label: 'Додати відео, фото, музику…', ic: 'media', key: 'Ctrl+O', run: () => pickFiles('') },
      { label: 'Субтитри', ic: 'cc', sub: [
        { label: 'Імпортувати з файлу (.srt, .vtt)…', run: () => $('capInput').click() },
        { sep: true },
        { label: 'Зберегти як .srt', enabled: () => S.project.captions.length > 0, run: () => saveCaps('srt') },
        { label: 'Зберегти як .vtt', enabled: () => S.project.captions.length > 0, run: () => saveCaps('vtt') },
        { label: 'Зберегти як звичайний текст', enabled: () => S.project.captions.length > 0, run: () => saveCaps('txt') } ] },
      { sep: true },
      { label: 'Експорт відео…', ic: 'download', key: 'Ctrl+E', enabled: has, run: openExport },
      { label: 'Зберегти поточний кадр (PNG)', ic: 'camera', enabled: has, run: () => $('btnSnap').click() },
      { sep: true },
      { label: 'Параметри проєкту…', ic: 'gear', run: () => $('btnProj').click() },
    ] },
    { label: 'Редагування', items: [
      { label: 'Скасувати', ic: 'undo', key: 'Ctrl+Z', enabled: canUndo, run: () => undo() },
      { label: 'Повторити', ic: 'redo', key: 'Ctrl+Shift+Z', enabled: canRedo, run: () => redo() },
      { sep: true },
      { label: 'Вирізати', key: 'Ctrl+X', enabled: hasSel, run: () => copySel(true) },
      { label: 'Копіювати', ic: 'copy', key: 'Ctrl+C', enabled: hasSel, run: () => copySel() },
      { label: 'Вставити в позиції курсора', key: 'Ctrl+V', enabled: canPaste, run: () => pasteClip() },
      { label: 'Дублювати', key: 'Ctrl+D', enabled: hasSel, run: () => duplicateSel() },
      { label: 'Видалити', ic: 'trash', key: 'Delete', enabled: hasSel, run: () => deleteSel() },
      { sep: true },
      { label: 'Розрізати в позиції курсора', ic: 'split', key: 'S', enabled: has, run: () => splitAt() },
      { head: 'Вирізати шматок відео' },
      { label: '1. Позначити початок', key: 'I', enabled: has, run: () => mark('in') },
      { label: '2. Позначити кінець', key: 'O', enabled: has, run: () => mark('out') },
      { label: '3. Вирізати позначене', ic: 'scissors', key: 'X', enabled: () => S.markIn != null && S.markOut != null, run: () => cutRange(S.markIn, S.markOut) },
      { label: 'Зняти позначки', enabled: () => S.markIn != null || S.markOut != null, run: clearMarks },
    ] },
    { label: 'Додати', items: [
      { head: 'Відео, фото, звук' },
      { label: 'Відео чи фото поверх основного…', ic: 'pip', enabled: has, run: () => pickFiles('layer') },
      { label: 'Логотип чи картинка…', ic: 'image', enabled: has, run: () => pickFiles('logo') },
      { label: 'Музика чи звук…', ic: 'music', run: () => pickFiles('') },
      { label: 'Озвучити голосом…', ic: 'mic', key: 'R', enabled: has, run: openVoice },
      { head: 'Текст' },
      { label: 'Текст на відео', ic: 'text', sub: Object.entries(TEXT_PRESETS).map(([k, v]) => ({ label: v.label, run: () => { showLibTab('text'); addOverlay('text', { preset: k }); emit('focus-inspector'); } })) },
      { label: 'Субтитр у позиції курсора', ic: 'cc', key: 'C', run: () => { showLibTab('captions'); newCaptionHere(); } },
      { label: 'Заставка з назвою', ic: 'film', sub: Object.keys(CARD_STYLES).map((k, i) => ({ label: ['Синя', 'Захід сонця', 'Зелена', 'Темна', 'Світла'][i] || k, run: async () => { try { await addTitleCard(k); emit('focus-inspector'); } catch (e) { toast('Не вдалося створити заставку', 'err'); } } })) },
      { head: 'Пояснення на кадрі' },
      { label: 'Стрілка', ic: 'arrow', enabled: has, run: () => addOverlay('arrow') },
      { label: 'Рамка', ic: 'rect', enabled: has, run: () => addOverlay('rect') },
      { label: 'Прожектор (затемнити решту)', ic: 'spot', enabled: has, run: () => addOverlay('spot') },
      { label: 'Розмиття (сховати дані)', ic: 'blur', enabled: has, run: () => addOverlay('blur') },
      { label: 'Прогрес-бар', ic: 'progress', enabled: has, run: () => addOverlay('progress') },
      { label: 'Емодзі-стікер…', ic: 'smile', enabled: has, run: () => showLibTab('elements') },
    ] },
    { label: 'Автоматично', items: [
      { label: 'Субтитри з мовлення…', ic: 'wand', enabled: () => has() || S.project.music.length > 0, run: () => openAsr() },
      { label: 'Прибрати паузи й тишу…', ic: 'scissors', enabled: has, run: openSilences },
      { label: 'Переходи між усіма кліпами', enabled: () => S.project.clips.length > 1, run: () => transitionsAll() },
      { label: 'Вирівняти гучність виділеного', ic: 'volume', enabled: audioSel, run: () => normalizeSel() },
    ] },
    { label: 'Вигляд', items: [
      { label: 'Формат кадру', sub: [['16:9', 'YouTube, урок'], ['9:16', 'Reels, Shorts'], ['1:1', 'Квадрат'], ['4:3', 'Класичний']].map(([v, n]) => ({ label: `${v} — ${n}`, checked: () => S.project.aspect === v, run: () => { S.project.aspect = v; commit(); emit('aspect'); } })) },
      { label: 'Перегляд на весь екран', ic: 'full', key: 'F', enabled: has, run: toggleFullscreen },
      { label: 'Панель медіа й елементів', checked: () => !document.body.classList.contains('hide-lib'), run: () => narrow() ? document.body.classList.toggle('show-lib') : panel('hide-lib', document.body.classList.contains('hide-lib')) },
      { label: 'Темна тема', checked: () => document.documentElement.dataset.theme === 'dark', run: () => $('btnTheme').click() },
      { head: 'Таймлайн' },
      { label: 'Прилипання до країв', checked: () => S.snap, run: () => $('btnSnapToggle').click() },
      { label: 'Повторювати відтворення', checked: () => !!S.loop, run: () => { S.loop = !S.loop; toast(S.loop ? 'Відтворення повторюється' : 'Повтор вимкнено'); } },
      { label: 'Наблизити', ic: 'zoomIn', key: '+', run: () => zoomBy(1.5) },
      { label: 'Віддалити', ic: 'zoomOut', key: '−', run: () => zoomBy(1 / 1.5) },
      { label: 'Показати весь проєкт', ic: 'fit', key: 'Shift+Z', run: zoomFit },
    ] },
    { label: 'Довідка', items: [
      { label: 'Гарячі клавіші', ic: 'help', key: '?', run: () => openModal('helpModal') },
      { label: 'Які формати підтримуються', run: () => toast('Відео: MP4, MOV, WebM, MKV, а також AVI, WMV, MPG, FLV, 3GP, MTS і MOV з iPhone (H.265) чи ProRes — їх редактор перетворює автоматично. Фото: JPG, PNG, WebP, GIF. Звук: MP3, WAV, M4A, OGG.', '', 9000) },
      { label: 'Як користуватися меню з клавіатури', key: 'F10', run: () => toast('F10 відкриває меню, стрілки — пересування, Enter — вибір, Esc — закрити', '', 6000) },
    ] },
  ]);
}
