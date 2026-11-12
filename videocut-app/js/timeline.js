// Таймлайн: доріжки, перетягування, обрізання, прилипання, зум.
// Мініатюри й хвилі малюються лише для видимої частини — це тримає швидкість навіть на годинних відео.
import { S, media, emit, on, layout, duration, clipDur, musicDur, snap, snapHit, snapOn, commit, rippleShift, select, selectMany, isSel, findSel, laneOf, laneLocked, trackOf, LANES } from './state.js';
import { thumbAt, PEAKS_RATE } from './media.js';
import { isLayer } from './layer.js';
import { addToTimeline, addLayerAt, addMarker, removeMarker, renameMarker } from './ops.js';
import { seek } from './player.js';
import { $, esc, icon, clamp, fmt, setHtml, paintRange } from './ui.js';

const ROW = 26, CC_H = 28, V_H = 58, V2_H = 44, A_H = 40, RULER_H = 22, BAR_H = 44;
const OV_LABEL = { video: 'Відео поверх', text: 'Текст', rect: 'Рамка', arrow: 'Стрілка', blur: 'Розмиття', spot: 'Прожектор', image: 'Зображення', emoji: 'Емодзі', progress: 'Прогрес' };
const OV_ICON = { video: 'pip', text: 'text', rect: 'rect', arrow: 'arrow', blur: 'blur', spot: 'spot', image: 'image', emoji: 'smile', progress: 'progress' };
const TR_NAMES = { fade: 'Розчинення', black: 'Через чорне', slide: 'Зсув', wipe: 'Шторка', zoom: 'Наближення' };

let scroll, inner, lanes, heads, ruler, playheadEl, rangeEl, insertEl, hoverEl, snapEl;
let vCanvas, aCanvas, v2Canvas;
let v2Rows = 1, v2RowOf = new Map();
let ovRows = 1;
let muRows = 1, muRowOf = new Map();
let ovRowOf = new Map(), dragRows = null; // dragRows: доріжка ('v2' | 'ov' | 'a'), елемент якої зараз тягнуть по рядах
// що зараз тягнуть із бібліотеки — тоді тимчасово показуємо доріжки, куди можна кинути
let dragKind = null;

export function initTimeline() {
  scroll = $('tlScroll'); inner = $('tlInner'); lanes = $('tlLanes'); heads = $('tlHeads');
  ruler = $('tlRuler'); playheadEl = $('tlPlayhead'); rangeEl = $('tlRange'); insertEl = $('tlInsert');
  hoverEl = $('tlHover'); snapEl = $('tlSnap');
  // під час перетягування 'project' приходить на кожен рух миші — перемальовуємо не частіше за кадр
  on('project', d => { if (d && d.live) scheduleRender(); else render(); });
  on('select', render);
  on('media', render);
  on('thumbs', drawCanvases);
  on('peaks', drawCanvases);
  on('time', () => { placePlayhead(); if (S.playing) follow(); });
  on('marks', () => { placeRange(); drawRuler(); });
  on('silences', render);
  // прокрутка шле багато подій — мініатюри й лінійку малюємо раз на кадр
  let scrollQueued = 0;
  scroll.addEventListener('scroll', () => {
    heads.scrollTop = scroll.scrollTop;
    if (scrollQueued) return;
    scrollQueued = requestAnimationFrame(() => { scrollQueued = 0; drawCanvases(); drawRuler(); });
  }, { passive: true });
  window.addEventListener('resize', () => { render(); });
  scroll.addEventListener('wheel', onWheel, { passive: false });
  inner.addEventListener('pointerdown', onDown);
  // кнопки в заголовках доріжок: сховати, вимкнути звук, соло, заблокувати
  heads.addEventListener('click', e => {
    const b = e.target.closest('.th-b'); if (!b) return;
    const k = b.dataset.lane, a = b.dataset.act, T = (S.project.tracks = S.project.tracks || {});
    const s = (T[k] = T[k] || {});
    s[a] = !s[a];
    if (a === 'solo' && s.solo) for (const o of ['v', 'v2', 'a']) if (o !== k && T[o]) T[o].solo = false;
    if (a === 'lock' && s.lock) S.multi = S.multi.filter(x => !(x.kind === 'clip' && k === 'v') && !(x.kind === 'music' && k === 'a') && !(x.kind === 'caption' && k === 'cc'));
    commit(); render(); emit('tracks');
  });
  // Esc під час перетягування скасовує його й нічого більше не робить
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && (drag || band)) { e.stopPropagation(); e.preventDefault(); if (band) { band.el?.remove(); band = null; inner.removeEventListener('pointermove', onBandMove); render(); } else cancelDrag(); } }, true);
  // маркер: подвійний клік — перейменувати
  $('tlRulerWrap')?.addEventListener('dblclick', e => { const mk = markerAt(e); if (mk) editMarker(mk, e); });
  // тонка лінія з часом під вказівником — щоб точно потрапити в потрібну мить
  let hoverRaf = 0, hoverX = null;
  inner.addEventListener('pointermove', e => {
    if (drag || e.pointerType === 'touch') return;
    hoverX = e.clientX;
    if (!hoverRaf) hoverRaf = requestAnimationFrame(() => { hoverRaf = 0; showHover(hoverX); });
  });
  inner.addEventListener('pointerleave', () => { hoverX = null; hoverEl.hidden = true; });
  // клавіатура: Tab переходить між елементами таймлайну, фокус виділяє елемент (далі працюють S, Delete, Ctrl+D…)
  inner.addEventListener('focusin', e => {
    const it = e.target.closest?.('.it');
    if (it && !(S.sel && S.sel.kind === it.dataset.kind && S.sel.id === it.dataset.id)) select(it.dataset.kind, it.dataset.id);
  });
  inner.addEventListener('keydown', e => {
    const it = e.target.closest?.('.it');
    if (!it || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter') { e.preventDefault(); emit('focus-inspector'); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.stopPropagation(); // тут стрілки ↑↓ пересувають між елементами, а не по точках монтажу
    // стрілки вгору/вниз пересуваються між елементами в порядку на таймлайні, ліворуч/праворуч лишаються для курсора
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const all = [...inner.querySelectorAll('.it')].sort((a, b) => a.offsetLeft - b.offsetLeft);
      const n = all[all.indexOf(it) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (n) { e.preventDefault(); n.focus(); }
    }
  });
  inner.addEventListener('dblclick', e => {
    const it = e.target.closest('.it');
    if (it) { select(it.dataset.kind, it.dataset.id); emit('focus-inspector'); }
  });
  // файли з бібліотеки: «Відео 1» — вставити кліп, «Звук» — музика, решта — поверх (Відео 2)
  document.addEventListener('dragstart', e => {
    const id = e.target.closest?.('.mcard[data-id]')?.dataset.id;
    const m = id && media.get(id);
    if (m) setTimeout(() => { dragKind = m.kind; render(); });
  });
  document.addEventListener('dragend', () => { if (dragKind) { dragKind = null; render(); } });
  inner.addEventListener('dragover', e => {
    if (![...e.dataTransfer.types].includes('application/x-vc-media')) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    const lane = e.target.closest('.lane');
    lanes.querySelectorAll('.lane.drop-on').forEach(l => { if (l !== lane) l.classList.remove('drop-on'); });
    if (lane) lane.classList.add('drop-on');
  });
  inner.addEventListener('dragleave', e => { if (!inner.contains(e.relatedTarget)) lanes.querySelectorAll('.lane.drop-on').forEach(l => l.classList.remove('drop-on')); });
  inner.addEventListener('drop', e => {
    const id = e.dataTransfer.getData('application/x-vc-media'); if (!id) return;
    e.preventDefault();
    lanes.querySelectorAll('.lane.drop-on').forEach(l => l.classList.remove('drop-on'));
    dragKind = null;
    const m = media.get(id); if (!m) return;
    const t = Math.max(0, snap(timeAt(e), null, 8));
    const lane = e.target.closest('.lane');
    if (m.kind !== 'audio' && (!S.project.clips.length || (lane && lane.classList.contains('lane-v')))) {
      const L = layout();
      let at = L.length;
      for (let i = 0; i < L.length; i++) if (t < (L[i].start + L[i].end) / 2) { at = i; break; }
      addToTimeline(m, { at });
    } else addLayerAt(m, { start: t });
  });
  $('tlZoom').addEventListener('input', e => setZoom(zoomFromSlider(+e.target.value)));
  render();
}

// ── зум ──
const ZMIN = 2, ZMAX = 400;
const sliderFromZoom = z => Math.round(100 * Math.log(z / ZMIN) / Math.log(ZMAX / ZMIN));
const zoomFromSlider = v => ZMIN * Math.pow(ZMAX / ZMIN, v / 100);
export function setZoom(pps, anchorT = S.t) {
  pps = clamp(pps, ZMIN, ZMAX);
  const ax = anchorT * S.pps - scroll.scrollLeft;
  S.pps = pps;
  render();
  scroll.scrollLeft = Math.max(0, anchorT * pps - ax);
  $('tlZoom').value = sliderFromZoom(pps); paintRange($('tlZoom'));
  drawCanvases(); drawRuler();
}
export function zoomBy(f) { setZoom(S.pps * f); }
export function zoomFit() {
  const d = Math.max(1, duration());
  setZoom((scroll.clientWidth - 40) / d, 0);
  scroll.scrollLeft = 0;
}
function onWheel(e) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const rect = scroll.getBoundingClientRect();
    const t = (e.clientX - rect.left + scroll.scrollLeft) / S.pps;
    const pps = clamp(S.pps * Math.pow(1.0015, -e.deltaY), ZMIN, ZMAX);
    const ax = e.clientX - rect.left;
    S.pps = pps; render();
    scroll.scrollLeft = Math.max(0, t * pps - ax);
    $('tlZoom').value = sliderFromZoom(pps); paintRange($('tlZoom'));
    drawCanvases(); drawRuler();
  } else if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    // коліщатко: якщо доріжок більше, ніж вміщується, — прокручуємо їх вертикально,
    // а в кінці (або якщо все вміщується) — рухаємо таймлайн по горизонталі
    const canV = scroll.scrollHeight > scroll.clientHeight + 1;
    const atEdge = e.deltaY > 0 ? scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 1 : scroll.scrollTop <= 0;
    if (canV && !atEdge) return;
    e.preventDefault();
    scroll.scrollLeft += e.deltaY;
  }
}

// ── рендер ──
// Ряди всередині доріжки. Елемент із полем row займає саме цей ряд (або найближчий вільний нижче), решта розкладаються автоматично.
function assignRows(items) {
  const occ = [], rowOf = new Map();
  const free = (r, s, e) => !(occ[r] || []).some(([a, b]) => s < b - 1e-6 && e > a + 1e-6);
  const put = (o, from) => { let r = from; while (!free(r, o.start, o.start + o.dur)) r++; (occ[r] = occ[r] || []).push([o.start, o.start + o.dur]); rowOf.set(o.id, r); };
  const byStart = (a, b) => a.start - b.start;
  items.filter(o => Number.isInteger(o.row) && o.row >= 0).sort(byStart).forEach(o => put(o, o.row));
  items.filter(o => !(Number.isInteger(o.row) && o.row >= 0)).sort(byStart).forEach(o => put(o, 0));
  for (let i = 0; i < occ.length; i++) occ[i] = occ[i] || [];
  return { rowOf, n: Math.max(1, occ.length) };
}

let renderQueued = 0;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = requestAnimationFrame(() => { renderQueued = 0; render(); });
}
export function render() {
  if (!scroll) return;
  if (renderQueued) { cancelAnimationFrame(renderQueued); renderQueued = 0; }
  // перемальовування замінює всі доріжки — запам'ятовуємо прокрутку, щоб таймлайн не «підстрибував»
  const keepL = scroll.scrollLeft, keepT = scroll.scrollTop;
  const fa = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.it') : null;
  const focusKey = fa && inner.contains(fa) ? fa.dataset.kind + ':' + fa.dataset.id : null;
  const p = S.project, pps = S.pps;
  const d = duration();
  const width = Math.max(scroll.clientWidth, (d + 8) * pps);
  inner.style.width = width + 'px';
  const sel = S.sel;
  const selCls = (k, id) => (isSel(k, id) ? (sel && sel.kind === k && sel.id === id ? ' sel main' : ' sel') : '') + (drag && drag.moved && drag.group.some(g => g.kind === k && g.id === id) ? ' drag-src' : '');
  const hnd = '<i class="h h-l"></i><i class="h h-r"></i>';

  const layers = p.overlays.filter(isLayer), graphics = p.overlays.filter(o => !isLayer(o));
  const gr = assignRows(graphics), rowOf = gr.rowOf;
  ovRowOf = rowOf;
  const n = gr.n + (dragRows === 'ov' ? 1 : 0); // під час перетягування вниз додається порожній ряд — нова доріжка
  ovRows = n;
  const ovH = n * ROW + 6;
  const lr = assignRows(layers);
  v2Rows = lr.n + (dragRows === 'v2' ? 1 : 0); v2RowOf = lr.rowOf;
  const v2H = v2Rows * V2_H + 6;
  const lay = layers.map(o => {
    const m = media.get(o.mediaId);
    const badges = [];
    if (o.shape === 'circle') badges.push('коло');
    if ((o.opacity ?? 1) < 0.99) badges.push(Math.round((o.opacity ?? 1) * 100) + '%');
    if (o.type === 'video' && o.muted) badges.push('без звуку');
    return `<div class="it lay${o.type === 'image' ? ' lay-img' : ''}${selCls('overlay', o.id)}${m ? '' : ' missing'}" data-kind="overlay" data-id="${o.id}" style="left:${o.start * pps}px;width:${Math.max(4, o.dur * pps)}px;top:${3 + (v2RowOf.get(o.id) || 0) * V2_H}px;height:${V2_H - 6}px"><span class="lbl">${esc(m ? m.name : 'Файл відсутній')}${badges.length ? ' · ' + badges.join(' · ') : ''}</span>${hnd}</div>`;
  }).join('');

  const ov = graphics.map(o => {
    const label = o.type === 'text' ? (o.text || '').split('\n')[0] : o.type === 'emoji' ? (o.emoji || '') + ' ' + OV_LABEL.emoji : OV_LABEL[o.type];
    return `<div class="it ov ov-${o.type}${selCls('overlay', o.id)}" data-kind="overlay" data-id="${o.id}" style="left:${o.start * pps}px;width:${Math.max(4, o.dur * pps)}px;top:${3 + rowOf.get(o.id) * ROW}px">${icon(OV_ICON[o.type] || 'shapes')}<span>${esc(label)}</span>${hnd}</div>`;
  }).join('');
  const cc = p.captions.map(c => `<div class="it cc${selCls('caption', c.id)}" data-kind="caption" data-id="${c.id}" style="left:${c.start * pps}px;width:${Math.max(4, c.dur * pps)}px"><span>${esc(c.text)}</span>${hnd}</div>`).join('');
  const clips = layout().map((l, idx) => {
    const c = l.clip, m = media.get(c.mediaId);
    const badges = [];
    if (c.look && c.look !== 'none') badges.push('фільтр');
    if ((c.speed || 1) !== 1) badges.push(`${String(c.speed).replace('.', ',')}×`);
    if (c.muted) badges.push('без звуку');
    if ((c.zoom || 1) > 1.001) badges.push('зум');
    const fi = c.fadeIn ? `<b class="fade fi" style="width:${Math.min(c.fadeIn * pps, (l.end - l.start) * pps / 2)}px"></b>` : '';
    const fo = c.fadeOut ? `<b class="fade fo" style="width:${Math.min(c.fadeOut * pps, (l.end - l.start) * pps / 2)}px"></b>` : '';
    const trm = c.tr && idx > 0 ? `<b class="tr-zone" style="width:${Math.min((c.tr.d || 0.6) * pps, (l.end - l.start) * pps)}px" title="Перехід: ${TR_NAMES[c.tr.type] || ''}"></b>` : '';
    return `<div class="it clip${selCls('clip', c.id)}${m ? '' : ' missing'}" data-kind="clip" data-id="${c.id}" style="left:${l.start * pps}px;width:${Math.max(4, (l.end - l.start) * pps)}px">${fi}${fo}${trm}<span class="lbl">${esc(m ? m.name : 'Файл відсутній')}${badges.length ? ' · ' + badges.join(' · ') : ''}</span>${hnd}</div>`;
  }).join('');
  const mr = assignRows(p.music.map(x => ({ id: x.id, start: x.start, dur: musicDur(x), row: x.row })));
  muRows = mr.n + (dragRows === 'a' ? 1 : 0); muRowOf = mr.rowOf;
  const mu = p.music.map(x => {
    const m = media.get(x.mediaId);
    return `<div class="it mu${x.voice ? ' voice' : ''}${selCls('music', x.id)}" data-kind="music" data-id="${x.id}" style="left:${x.start * pps}px;width:${Math.max(4, musicDur(x) * pps)}px;top:${4 + (muRowOf.get(x.id) || 0) * A_H}px"><span class="lbl">${icon(x.voice ? 'mic' : 'music')}${esc(x.voice ? 'Голос' : m ? m.name : 'Файл відсутній')}</span>${hnd}</div>`;
  }).join('');
  const sil = (S.silPreview || []).map(([a, b]) => `<div class="sil" style="left:${a * pps}px;width:${Math.max(2, (b - a) * pps)}px"></div>`).join('');

  const empty = (cond, text) => (cond ? `<div class="lane-empty">${text}</div>` : '');
  // доріжки з'являються лише тоді, коли на них щось є (або коли туди тягнуть файл)
  const dragVis = dragKind && dragKind !== 'audio', dragAud = dragKind === 'audio' || (dragKind === 'video' && p.clips.length);
  const rows = [];
  if (layers.length || (dragVis && p.clips.length)) rows.push([v2H, 'lane-v2', `<canvas class="lane-canvas" id="tlV2Canvas"></canvas>${empty(!layers.length, 'Відпустіть тут — буде поверх основного відео')}${lay}`, 'pip', 'Поверх', 'Відео 2 — поверх основного']);
  rows.push([V_H, 'lane-v', `<canvas class="lane-canvas" id="tlVCanvas"></canvas>${empty(!p.clips.length, 'Перетягніть сюди відео або фото')}${clips}${sil}`, 'video', 'Відео', 'Основне відео']);
  if (p.music.length || dragAud) rows.push([A_H * muRows, 'lane-a', `<canvas class="lane-canvas" id="tlACanvas"></canvas>${empty(!p.music.length, 'Відпустіть тут — музика чи звук')}${mu}`, 'music', 'Звук', 'Музика та озвучення']);
  if (p.captions.length) rows.push([CC_H, 'lane-cc', cc, 'cc', 'Субтитри', 'Субтитри']);
  if (graphics.length) rows.push([ovH, 'lane-ov', ov, 'text', 'Графіка', 'Текст, стрілки, розмиття']);
  const laneKey = cls => cls.slice(5); // lane-v → v
  const stCls = cls => { const s = trackOf(laneKey(cls)); return (s.hide ? ' is-hidden' : '') + (s.lock ? ' is-locked' : '') + (s.mute || s.solo ? ' is-muted' : ''); };
  const mkLines = (p.markers || []).map(m => `<i class="mk-line" style="left:${m.t * pps}px"></i>`).join('');
  setHtml(lanes, rows.map(([h, cls, html]) => `<div class="lane ${cls}${stCls(cls)}" data-lane="${laneKey(cls)}" style="height:${h}px">${html}</div>`).join('') + mkLines);
  const CAN = { v: ['hide', 'mute', 'solo', 'lock'], v2: ['hide', 'mute', 'solo', 'lock'], a: ['mute', 'solo', 'lock'], cc: ['hide', 'lock'], ov: ['hide', 'lock'] };
  const BTN = { hide: ['eye', 'eyeOff', 'Сховати доріжку', 'Показати доріжку'], mute: ['volume', 'volumeOff', 'Вимкнути звук доріжки', 'Увімкнути звук доріжки'], solo: ['solo', 'solo', 'Лише ця доріжка (соло)', 'Прибрати соло'], lock: ['unlock', 'lock', 'Заблокувати доріжку від змін', 'Розблокувати доріжку'] };
  const headBtns = k => `<span class="th-btns">${(CAN[k] || []).map(a => { const on = !!trackOf(k)[a], [i0, i1, t0, t1] = BTN[a]; return `<button type="button" class="th-b th-${a}${on ? ' on' : ''}" data-lane="${k}" data-act="${a}" aria-pressed="${on}" aria-label="${on ? t1 : t0}" data-tip="${on ? t1 : t0}">${a === 'solo' ? '<b>S</b>' : icon(on ? i1 : i0)}</button>`; }).join('')}</span>`;
  setHtml(heads, `<div class="head" style="height:${RULER_H}px"></div>` +
    rows.map(([h, cls, , ic, name, tip]) => `<div class="head head-${laneKey(cls)}${stCls(cls)}" data-lane="${laneKey(cls)}" style="height:${h}px" title="${tip}">${icon(ic)}<span class="th-n">${name}</span>${headBtns(laneKey(cls))}</div>`).join('') + '<div style="height:40px"></div>');
  // таймлайн не вищий, ніж потрібно — решта місця йде переглядові
  const need = BAR_H + RULER_H + rows.reduce((a, r) => a + r[0] + 1, 0) + 14;
  $('tl').style.setProperty('--tl-fit', need + 'px');
  vCanvas = $('tlVCanvas'); aCanvas = $('tlACanvas'); v2Canvas = $('tlV2Canvas');
  // доступність: кожен елемент — кнопка з підписом, яку можна досягти клавішею Tab
  const KIND = { clip: 'Кліп', overlay: 'Накладка', caption: 'Субтитр', music: 'Звук' };
  lanes.querySelectorAll('.it').forEach(it => {
    it.tabIndex = 0;
    it.setAttribute('role', 'button');
    it.setAttribute('aria-label', `${KIND[it.dataset.kind] || ''}: ${it.textContent.trim()}`);
    it.setAttribute('aria-pressed', it.classList.contains('sel') ? 'true' : 'false');
    it.title = it.getAttribute('aria-label') + ' · права кнопка — дії';
    if (focusKey && it.dataset.kind + ':' + it.dataset.id === focusKey) it.focus({ preventScroll: true });
  });
  if (scroll.scrollTop !== keepT) scroll.scrollTop = keepT;
  if (scroll.scrollLeft !== keepL) scroll.scrollLeft = keepL;
  heads.scrollTop = scroll.scrollTop; // назви доріжок завжди навпроти своїх доріжок
  placePlayhead(); placeRange(); drawRuler(); drawCanvases();
}

function showHover(x) {
  if (x == null || drag) { hoverEl.hidden = true; return; }
  const t = Math.max(0, (x - inner.getBoundingClientRect().left) / S.pps);
  hoverEl.hidden = false;
  hoverEl.style.transform = `translateX(${t * S.pps}px)`;
  hoverEl.firstElementChild.textContent = fmt(t, true);
  hoverEl.classList.toggle('flip', t * S.pps - scroll.scrollLeft > scroll.clientWidth - 90);
}
function showSnap(at) {
  if (at == null) { snapEl.hidden = true; return; }
  snapEl.hidden = false;
  snapEl.style.transform = `translateX(${at * S.pps}px)`;
}

function placePlayhead() {
  playheadEl.style.transform = `translateX(${S.t * S.pps}px)`;
}
function placeRange() {
  const a = S.markIn, b = S.markOut;
  if (a == null && b == null) { rangeEl.hidden = true; return; }
  const x0 = (a ?? 0) * S.pps, x1 = (b ?? duration()) * S.pps;
  rangeEl.hidden = false;
  rangeEl.style.left = Math.min(x0, x1) + 'px';
  rangeEl.style.width = Math.max(1, Math.abs(x1 - x0)) + 'px';
}
function follow() {
  const x = S.t * S.pps, w = scroll.clientWidth;
  if (x > scroll.scrollLeft + w - 60) scroll.scrollLeft = x - 80;
  else if (x < scroll.scrollLeft) scroll.scrollLeft = Math.max(0, x - 80);
}

function sizeCanvas(c, h) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = scroll.clientWidth;
  c.style.left = scroll.scrollLeft + 'px';
  c.style.width = w + 'px'; c.style.height = h + 'px';
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return g;
}

function drawWave(g, m, srcFrom, speed, x0, x1, top, h, color, pps) {
  if (!m || !m.peaks) return;
  g.fillStyle = color;
  const mid = top + h / 2;
  for (let x = Math.max(0, Math.floor(x0)); x < x1; x += 2) {
    const tA = srcFrom + ((x - x0) / pps) * speed, tB = tA + (2 / pps) * speed;
    let peak = 0;
    for (let i = Math.floor(tA * PEAKS_RATE), e = Math.max(i + 1, Math.ceil(tB * PEAKS_RATE)); i < e && i < m.peaks.length; i++) if (m.peaks[i] > peak) peak = m.peaks[i];
    const a = Math.max(0.5, Math.min(1, Math.sqrt(peak)) * h / 2);
    g.fillRect(x, mid - a, 1.5, a * 2);
  }
}

function drawCanvases() {
  if (!vCanvas) return;
  const sl = scroll.scrollLeft, w = scroll.clientWidth, pps = S.pps;
  const gv = sizeCanvas(vCanvas, V_H);
  for (const l of layout()) {
    const x0 = l.start * pps - sl, x1 = l.end * pps - sl;
    if (x1 < 0 || x0 > w) continue;
    const c = l.clip, m = media.get(c.mediaId);
    if (!m) continue;
    const top = 3, h = V_H - 6;
    g_clip(gv, x0 + 1, top, x1 - x0 - 2, h, 6);
    gv.save(); gv.clip();
    if (m.thumbs.length) {
      const th = m.thumbs[0].c;
      const tw = Math.max(20, h * th.width / th.height);
      const startTile = Math.max(0, Math.floor(-x0 / tw));
      for (let x = x0 + startTile * tw; x < Math.min(x1, w); x += tw) {
        const st = m.kind === 'image' ? 0 : c.in + ((x - x0 + tw / 2) / pps) * (c.speed || 1);
        const img = m.kind === 'image' ? th : thumbAt(m, st);
        if (img) gv.drawImage(img, x, top, tw, h);
      }
    }
    // хвиля звуку в нижній частині кліпу
    if (m.peaks && !c.muted) {
      gv.fillStyle = 'rgba(0,0,0,.35)'; gv.fillRect(x0, top + h - 18, x1 - x0, 18);
      drawWave(gv, m, c.in, c.speed || 1, x0, Math.min(x1, w), top + h - 17, 16, 'rgba(255,255,255,.85)', pps);
    }
    gv.restore();
  }
  if (v2Canvas) {
    const g2 = sizeCanvas(v2Canvas, v2Rows * V2_H + 6);
    for (const o of S.project.overlays) {
      if (!isLayer(o)) continue;
      const x0 = o.start * pps - sl, x1 = (o.start + o.dur) * pps - sl;
      if (x1 < 0 || x0 > w) continue;
      const m = media.get(o.mediaId); if (!m || !m.thumbs.length) continue;
      const top = 3 + (v2RowOf.get(o.id) || 0) * V2_H, h = V2_H - 6;
      g_clip(g2, x0 + 1, top, x1 - x0 - 2, h, 6);
      g2.save(); g2.clip();
      const th = m.thumbs[0].c, tw = Math.max(20, h * th.width / th.height);
      const startTile = Math.max(0, Math.floor(-x0 / tw));
      for (let x = x0 + startTile * tw; x < Math.min(x1, w); x += tw) {
        const img = m.kind === 'image' ? th : thumbAt(m, (o.in || 0) + (x - x0 + tw / 2) / pps);
        if (img) g2.drawImage(img, x, top, tw, h);
      }
      if (m.peaks && o.type === 'video' && !o.muted) {
        g2.fillStyle = 'rgba(0,0,0,.35)'; g2.fillRect(x0, top + h - 14, x1 - x0, 14);
        drawWave(g2, m, o.in || 0, 1, x0, Math.min(x1, w), top + h - 13, 12, 'rgba(255,255,255,.85)', pps);
      }
      g2.restore();
    }
  }
  if (!aCanvas) return;
  const ga = sizeCanvas(aCanvas, A_H * muRows);
  const waveA = getComputedStyle(document.documentElement).getPropertyValue('--wave-a').trim() || '#10b981';
  for (const mu of S.project.music) {
    const x0 = mu.start * pps - sl, x1 = (mu.start + musicDur(mu)) * pps - sl;
    if (x1 < 0 || x0 > w) continue;
    const top = (muRowOf.get(mu.id) || 0) * A_H;
    drawWave(ga, media.get(mu.mediaId), mu.in, 1, x0, Math.min(x1, w), top + 6, A_H - 12, mu.voice ? '#f97316' : waveA, pps);
  }
}
function g_clip(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, Math.max(0, w), h, r); else g.rect(x, y, Math.max(0, w), h);
}

function drawRuler() {
  if (!ruler) return;
  const g = sizeCanvas(ruler, RULER_H);
  const sl = scroll.scrollLeft, w = scroll.clientWidth, pps = S.pps;
  const cs = getComputedStyle(document.documentElement);
  const muted = cs.getPropertyValue('--muted').trim() || '#8a919e';
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
  const major = steps.find(s => s * pps >= 70) || 3600;
  const minor = steps.slice().reverse().find(s => s < major && major / s <= 10 && s * pps >= 7) || major;
  g.fillStyle = muted; g.strokeStyle = muted;
  g.font = "10.5px 'IBM Plex Sans', system-ui, sans-serif";
  g.globalAlpha = 0.5;
  for (let t = Math.floor(sl / pps / minor) * minor; t * pps - sl < w; t += minor) {
    const x = Math.round(t * pps - sl) + 0.5;
    g.beginPath(); g.moveTo(x, RULER_H - 5); g.lineTo(x, RULER_H); g.stroke();
  }
  g.globalAlpha = 1;
  for (let t = Math.floor(sl / pps / major) * major; t * pps - sl < w; t += major) {
    const x = Math.round(t * pps - sl) + 0.5;
    g.beginPath(); g.moveTo(x, RULER_H - 11); g.lineTo(x, RULER_H); g.stroke();
    const lbl = major < 1 ? fmt(t, true) : fmt(t);
    g.fillText(lbl, x + 4, 12);
  }
  const mkCol = cs.getPropertyValue('--cc').trim() || '#e8c93a';
  for (const m of S.project.markers || []) {
    const x = Math.round(m.t * pps - sl) + 0.5; if (x < -80 || x > w + 8) continue;
    g.fillStyle = mkCol; g.strokeStyle = mkCol;
    g.beginPath(); g.moveTo(x, RULER_H); g.lineTo(x - 5, RULER_H - 9); g.lineTo(x - 5, 2); g.lineTo(x + 5, 2); g.lineTo(x + 5, RULER_H - 9); g.closePath(); g.fill();
    g.globalAlpha = 0.35; g.beginPath(); g.moveTo(x, RULER_H); g.lineTo(x, RULER_H + 3000); g.stroke(); g.globalAlpha = 1;
    if (m.name) { g.fillStyle = cs.getPropertyValue('--text').trim() || '#ddd'; g.fillText(m.name, x + 9, 12); }
  }
  if (S.markIn != null || S.markOut != null) {
    g.fillStyle = cs.getPropertyValue('--accent').trim();
    [S.markIn, S.markOut].forEach((m, i) => {
      if (m == null) return;
      const x = m * pps - sl;
      g.beginPath();
      if (i === 0) { g.moveTo(x, RULER_H); g.lineTo(x, RULER_H - 12); g.lineTo(x + 7, RULER_H - 12); }
      else { g.moveTo(x, RULER_H); g.lineTo(x, RULER_H - 12); g.lineTo(x - 7, RULER_H - 12); }
      g.closePath(); g.fill();
    });
  }
}

// ── взаємодія ──
// Виділення: клік — один елемент, Shift/Ctrl+клік — додати чи прибрати, рамка по порожньому місцю — кілька.
// Перетягування: кліп під курсором («привид»), на його місці порожній контур, сусіди розсуваються й показують, де він опиниться.
let drag = null, band = null, hud = null, lastEv = null, autoRaf = 0;
const timeAt = e => (e.clientX - inner.getBoundingClientRect().left) / S.pps;
const listOf = (P, kind) => ({ clip: P.clips, overlay: P.overlays, caption: P.captions, music: P.music }[kind] || []);
const itemOf = (kind, id, P = S.project) => listOf(P, kind).find(x => x.id === id);
const lockedItem = (kind, id) => { const o = itemOf(kind, id); return !o || laneLocked(laneOf(kind, o)); };

// маркери на лінійці
const MK_HIT = 7;
const markerAt = e => {
  const r = ruler.getBoundingClientRect(), x = e.clientX - r.left + scroll.scrollLeft;
  let best = null, bd = MK_HIT;
  for (const m of S.project.markers || []) { const d = Math.abs(m.t * S.pps - x); if (d <= bd) { bd = d; best = m; } }
  return best;
};

function onDown(e) {
  if (e.button !== 0) return;
  const it = e.target.closest('.it');
  if (!it) {
    if (e.target.closest('.tl-ruler-wrap')) {
      const mk = markerAt(e);
      if (mk) { if (e.altKey) removeMarker(mk.id); else seek(mk.t); return; }
      scrub(e);
      return;
    }
    if (e.target.closest('.lane')) { startBand(e); return; }
    scrub(e);
    return;
  }
  const kind = it.dataset.kind, id = it.dataset.id;
  if (lockedItem(kind, id)) { startBand(e); return; } // доріжка заблокована: працює як порожнє місце
  e.preventDefault();
  const onHandle = e.target.classList.contains('h-l') || e.target.classList.contains('h-r');
  if ((e.shiftKey || e.ctrlKey || e.metaKey) && !onHandle) { select(kind, id, 'toggle'); return; } // Shift за край кліпа — «стик», а не виділення
  select(kind, id);
  const mode = e.target.classList.contains('h-l') ? 'l' : e.target.classList.contains('h-r') ? 'r' : 'move';
  const group = mode === 'move' ? S.multi.filter(x => !lockedItem(x.kind, x.id)).filter(x => (kind === 'clip') === (x.kind === 'clip')) : [{ kind, id }];
  drag = { kind, id, mode, group: group.length ? group : [{ kind, id }], x0: e.clientX, y0: e.clientY, t0: timeAt(e), orig: structuredClone(S.project), moved: false, pointerId: e.pointerId, left0: it.offsetLeft };
  inner.setPointerCapture(e.pointerId);
  inner.addEventListener('pointermove', onMove);
  inner.addEventListener('pointerup', onUp, { once: true });
  inner.addEventListener('pointercancel', onUp, { once: true });
}

function scrub(e) {
  inner.setPointerCapture(e.pointerId);
  const go = ev => seek(Math.max(0, snap(timeAt(ev), null, 6)));
  go(e);
  const mv = ev => go(ev);
  inner.addEventListener('pointermove', mv);
  inner.addEventListener('pointerup', () => inner.removeEventListener('pointermove', mv), { once: true });
}

// назва маркера: поле просто над лінійкою
function editMarker(mk, e) {
  const inp = document.createElement('input');
  inp.className = 'mk-edit input'; inp.value = mk.name || ''; inp.placeholder = 'Назва маркера'; inp.maxLength = 60; inp.setAttribute('aria-label', 'Назва маркера');
  const r = ruler.getBoundingClientRect();
  Object.assign(inp.style, { left: Math.min(innerWidth - 190, e.clientX - 20) + 'px', top: r.bottom + 4 + 'px' });
  document.body.appendChild(inp); inp.focus(); inp.select();
  let done = false;
  const fin = save => { if (done) return; done = true; const v = inp.value; inp.remove(); if (save) renameMarker(mk.id, v); };
  inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') fin(true); else if (ev.key === 'Escape') fin(false); });
  inp.addEventListener('blur', () => fin(true));
}

// ── рамка виділення ──
function startBand(e) {
  band = { x0: e.clientX, y0: e.clientY, on: false, base: e.shiftKey || e.ctrlKey || e.metaKey ? S.multi.slice() : [], el: null, t0: timeAt(e), pointerId: e.pointerId };
  inner.setPointerCapture(e.pointerId);
  inner.addEventListener('pointermove', onBandMove);
  inner.addEventListener('pointerup', onBandUp, { once: true });
  inner.addEventListener('pointercancel', onBandUp, { once: true });
}
function bandHits() {
  const r = band.rect, out = [];
  lanes.querySelectorAll('.it').forEach(it => {
    const b = it.getBoundingClientRect();
    if (b.right < r.l || b.left > r.r || b.bottom < r.t || b.top > r.b) return;
    if (lockedItem(it.dataset.kind, it.dataset.id)) return;
    out.push({ kind: it.dataset.kind, id: it.dataset.id });
  });
  return out;
}
function onBandMove(e) {
  if (!band) return;
  if (!band.on && Math.hypot(e.clientX - band.x0, e.clientY - band.y0) < 4) return;
  if (!band.on) {
    band.on = true;
    band.el = document.createElement('div'); band.el.className = 'tl-band'; document.body.appendChild(band.el);
  }
  const l = Math.min(band.x0, e.clientX), r = Math.max(band.x0, e.clientX), t = Math.min(band.y0, e.clientY), b = Math.max(band.y0, e.clientY);
  band.rect = { l, r, t, b };
  Object.assign(band.el.style, { left: l + 'px', top: t + 'px', width: r - l + 'px', height: b - t + 'px' });
  const hits = bandHits(), ids = new Set([...band.base, ...hits].map(x => x.kind + ':' + x.id));
  lanes.querySelectorAll('.it').forEach(it => it.classList.toggle('sel', ids.has(it.dataset.kind + ':' + it.dataset.id)));
}
function onBandUp(e) {
  inner.removeEventListener('pointermove', onBandMove);
  const b = band; band = null;
  if (!b) return;
  if (b.el) b.el.remove();
  if (!b.on) { if (!b.base.length) select(null); seek(Math.max(0, snap(timeAt(e), null, 6))); return; } // простий клік по порожньому місцю: зняти виділення й перейти в цю мить
  const hits = bandHits(), seen = new Set(b.base.map(x => x.kind + ':' + x.id)), all = [...b.base];
  for (const h of hits) if (!seen.has(h.kind + ':' + h.id)) all.push(h);
  selectMany(all);
}

// ── підказка біля курсора ──
function showHud(text, e) {
  if (!hud) { hud = document.createElement('div'); hud.className = 'tl-hud'; document.body.appendChild(hud); }
  hud.textContent = text; hud.hidden = false;
  hud.style.left = Math.min(innerWidth - 150, e.clientX + 16) + 'px';
  hud.style.top = Math.max(8, e.clientY - 34) + 'px';
}
const hideHud = () => { if (hud) hud.hidden = true; };

// ── початок і кінець перетягування ──
function beginVisuals(e) {
  document.body.classList.add('tl-dragging');
  // перенесення між рядами: лише для накладань і звуку (кліпи основної доріжки йдуть послідовно)
  const prim = itemOf(drag.kind, drag.id);
  if (drag.mode === 'move' && prim && (drag.kind === 'music' || drag.kind === 'overlay')) {
    const lane = drag.kind === 'music' ? 'a' : isLayer(prim) ? 'v2' : 'ov';
    const map = lane === 'a' ? muRowOf : lane === 'v2' ? v2RowOf : ovRowOf, count = lane === 'a' ? muRows : lane === 'v2' ? v2Rows : ovRows;
    drag.rowKind = lane; drag.rowH = lane === 'a' ? A_H : lane === 'v2' ? V2_H : ROW; drag.maxRow = count; // індекс порожнього ряду внизу
    drag.rows0 = new Map(drag.group.map(g => [g.id, map.get(g.id) || 0]));
    dragRows = lane;
  }
  drag.srcEls = [...lanes.querySelectorAll('.it')].filter(el => drag.group.some(g => g.kind === el.dataset.kind && g.id === el.dataset.id));
  if (drag.kind === 'clip' && drag.mode === 'move') {
    const prim = drag.srcEls.find(el => el.dataset.id === drag.id) || drag.srcEls[0];
    const g = document.createElement('div');
    g.className = 'it clip tl-ghost';
    g.innerHTML = prim.innerHTML;
    const cs = prim.getBoundingClientRect(), ir = inner.getBoundingClientRect();
    Object.assign(g.style, { left: cs.left - ir.left + 'px', top: cs.top - ir.top + 'px', width: cs.width + 'px', height: cs.height + 'px' });
    if (drag.group.length > 1) { const n = document.createElement('b'); n.className = 'ghost-n'; n.textContent = drag.group.length + ' кліпи'; g.appendChild(n); }
    inner.appendChild(g);
    drag.ghost = g; drag.ghostLeft = cs.left - ir.left;
    drag.srcEls.forEach(el => el.classList.add('drag-src'));
  }
  autoScroll();
}
function endVisuals(d) {
  if (dragRows) { dragRows = null; queueMicrotask(render); }
  document.body.classList.remove('tl-dragging');
  if (d && d.ghost) d.ghost.remove();
  inner.querySelectorAll('.tl-ghost').forEach(g => g.remove());
  lanes.querySelectorAll('.drag-src').forEach(el => { el.classList.remove('drag-src'); el.style.transform = ''; });
  lanes.querySelectorAll('.it.clip').forEach(el => { el.style.transform = ''; el.classList.remove('shifted'); });
  insertEl.hidden = true; hideHud(); cancelAnimationFrame(autoRaf); autoRaf = 0;
}
// біля краю таймлайну він прокручується сам
function autoScroll() {
  cancelAnimationFrame(autoRaf);
  const step = () => {
    if (!drag || !drag.moved || !lastEv) { autoRaf = 0; return; }
    const r = scroll.getBoundingClientRect(), edge = 56;
    let v = 0;
    if (lastEv.clientX < r.left + edge) v = -Math.ceil((r.left + edge - lastEv.clientX) / 3);
    else if (lastEv.clientX > r.right - edge) v = Math.ceil((lastEv.clientX - (r.right - edge)) / 3);
    if (v) { const before = scroll.scrollLeft; scroll.scrollLeft += Math.max(-28, Math.min(28, v)); if (scroll.scrollLeft !== before) onMove(lastEv); }
    autoRaf = requestAnimationFrame(step);
  };
  autoRaf = requestAnimationFrame(step);
}
function cancelDrag() {
  if (!drag) return false;
  const d = drag; drag = null;
  inner.removeEventListener('pointermove', onMove);
  S.altNoSnap = false; S.snapAt = null; showSnap(null);
  endVisuals(d);
  S.project = structuredClone(d.orig);
  emit('project', {});
  return true;
}
function onMove(e) {
  if (!drag) return;
  lastEv = e;
  S.altNoSnap = e.altKey;
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 3) return;
  if (!drag.moved) { drag.moved = true; beginVisuals(e); }
  hoverEl.hidden = true;
  S.snapAt = null;
  const dt = timeAt(e) - drag.t0;
  const P = S.project = structuredClone(drag.orig);
  let hudText = '';
  if (drag.kind === 'clip') hudText = moveClip(P, dt, e);
  else if (drag.kind === 'music') hudText = moveMusic(P, dt);
  else hudText = moveTimed(P, drag.kind === 'overlay' ? P.overlays : P.captions, dt);
  if (drag.kind !== 'clip' || drag.mode !== 'move') emit('project', { live: true });
  showSnap(S.snapAt);
  if (hudText) showHud(hudText, e);
}

// край, що тягнеться: прилипає й запам'ятовує, куди, щоб показати напрямну
function snapEdge(t, id) { const h = snapHit(t, id); S.snapAt = h; return h == null ? t : h; }
function snapBoth(start, dur, id) {
  if (!snapOn()) { S.snapAt = null; return start; }
  const h1 = snapHit(start, id), h2 = snapHit(start + dur, id);
  const d1 = h1 == null ? Infinity : Math.abs(h1 - start), d2 = h2 == null ? Infinity : Math.abs(h2 - (start + dur));
  if (d1 === Infinity && d2 === Infinity) { S.snapAt = null; return start; }
  if (d1 <= d2) { S.snapAt = h1; return h1; }
  S.snapAt = h2; return h2 - dur;
}
const durOf = (kind, o) => (kind === 'music' ? musicDur(o) : o.dur);
const ids = () => drag.group.map(g => g.id);

// текст, накладання, субтитри, музика: рухаються на екрані разом із курсором, групою — на однакову відстань
function moveGroup(P, dt) {
  const prim = itemOf(drag.kind, drag.id, drag.orig), pd = durOf(drag.kind, prim);
  const start = Math.max(0, snapBoth(prim.start + dt, pd, ids()));
  let d = start - prim.start;
  const minStart = Math.min(...drag.group.map(g => itemOf(g.kind, g.id, drag.orig).start));
  if (minStart + d < 0) d = -minStart;
  const dRow = drag.rowKind && lastEv ? Math.round((lastEv.clientY - drag.y0) / drag.rowH) : 0;
  for (const g of drag.group) {
    const o = itemOf(g.kind, g.id, P), og = itemOf(g.kind, g.id, drag.orig);
    if (!o || !og) continue;
    o.start = Math.max(0, og.start + d);
    if (dRow !== 0) o.row = clamp((drag.rows0.get(g.id) || 0) + dRow, 0, drag.maxRow);
  }
  const rowTxt = dRow !== 0 ? ` · доріжка ${clamp((drag.rows0.get(drag.id) || 0) + dRow, 0, drag.maxRow) + 1}` : '';
  return `${fmt(Math.max(0, prim.start + d), true)}${drag.group.length > 1 ? ` · ${drag.group.length} елем.` : ''}${rowTxt}`;
}
function moveTimed(P, list, dt) {
  const o = list.find(x => x.id === drag.id), orig = (drag.kind === 'overlay' ? drag.orig.overlays : drag.orig.captions).find(x => x.id === drag.id);
  if (!o) return '';
  const end = orig.start + orig.dur;
  if (drag.mode === 'move') return moveGroup(P, dt);
  if (drag.mode === 'l') {
    o.start = clamp(snapEdge(orig.start + dt, o.id), 0, end - 0.2);
    if (o.type === 'video') { // ліву межу відео поверх не можна тягнути раніше за його початок
      const nin = (orig.in || 0) + (o.start - orig.start);
      if (nin < 0) o.start = orig.start - (orig.in || 0);
      o.in = Math.max(0, (orig.in || 0) + (o.start - orig.start));
    }
    o.dur = end - o.start;
  } else {
    o.dur = Math.max(0.2, snapEdge(end + dt, o.id) - orig.start);
    if (o.type === 'video') { const m = media.get(o.mediaId); if (m) o.dur = Math.min(o.dur, m.duration - (o.in || 0)); }
  }
  return `Тривалість ${fmt(o.dur, true)}`;
}
function moveMusic(P, dt) {
  const x = P.music.find(v => v.id === drag.id), orig = drag.orig.music.find(v => v.id === drag.id);
  if (!x) return '';
  const m = media.get(x.mediaId), max = m ? m.duration : orig.out;
  if (drag.mode === 'move') return moveGroup(P, dt);
  if (drag.mode === 'l') {
    let ns = snapEdge(orig.start + dt, x.id);
    let nin = orig.in + (ns - orig.start);
    if (nin < 0) { ns -= nin; nin = 0; }
    if (nin > orig.out - 0.2) { nin = orig.out - 0.2; ns = orig.start + (nin - orig.in); }
    x.in = nin; x.start = Math.max(0, ns);
  } else x.out = clamp(orig.out + (snapEdge(orig.start + musicDur(orig) + dt, x.id) - (orig.start + musicDur(orig))), orig.in + 0.2, max);
  return `Тривалість ${fmt(musicDur(x), true)}`;
}

// кліпи основної доріжки
const layoutOf = clips => { let t = 0; return clips.map(x => { const s = t; t += clipDur(x); return { id: x.id, s, e: t }; }); };
function moveClip(P, dt, e) {
  const idx = P.clips.findIndex(c => c.id === drag.id);
  if (idx < 0) return '';
  const c = P.clips[idx], orig = drag.orig.clips[idx];
  const m = media.get(c.mediaId);
  const sp = c.speed || 1;
  const L0 = layoutOf(drag.orig.clips);
  const oldEnd = L0[idx].e;
  if (drag.mode === 'move') return previewReorder(L0, e);
  // Shift: «стик» — обидва сусідні кліпи змінюють межу, загальна тривалість не змінюється
  const roll = e.shiftKey && ((drag.mode === 'r' && drag.orig.clips[idx + 1]) || (drag.mode === 'l' && idx > 0));
  if (roll) return rollEdit(P, idx, dt);
  if (m && m.kind === 'image') {
    const d0 = orig.out - orig.in;
    const nd = drag.mode === 'r' ? Math.max(0.3, d0 + dt) : Math.max(0.3, d0 - dt);
    c.in = 0; c.out = nd * sp;
  } else if (drag.mode === 'l') {
    c.in = clamp(orig.in + dt * sp, 0, orig.out - 0.1 * sp);
  } else {
    const maxOut = m ? m.duration : orig.out;
    const newEnd = snapEdge(oldEnd + dt, c.id);
    c.out = clamp(orig.out + (newEnd - oldEnd) * sp, orig.in + 0.1 * sp, maxOut);
  }
  // решта таймлайну (текст, субтитри) зсувається разом із вмістом кліпу
  const delta = clipDur(c) - clipDur(orig);
  if (drag.mode === 'l') rippleShift(L0[idx].s, delta);
  else rippleShift(oldEnd + Math.min(0, delta), delta);
  return `Тривалість ${fmt(clipDur(c), true)}${delta ? ` (${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1).replace('.', ',')} с)` : ''}`;
}
function rollEdit(P, idx, dt) {
  const left = drag.mode === 'r' ? idx : idx - 1, a = P.clips[left], b = P.clips[left + 1];
  const oa = drag.orig.clips[left], ob = drag.orig.clips[left + 1];
  const ma = media.get(a.mediaId), mb = media.get(b.mediaId);
  if (!ma || !mb || ma.kind === 'image' || mb.kind === 'image') return 'Стик працює лише для відео';
  const sa = a.speed || 1, sb = b.speed || 1;
  // зсув межі в секундах таймлайну: не далі, ніж дозволяють файли й мінімальна довжина обох кліпів
  const maxR = Math.min((ma.duration - oa.out) / sa, (ob.out - ob.in - 0.1 * sb) / sb);
  const maxL = Math.min((oa.out - oa.in - 0.1 * sa) / sa, ob.in / sb);
  const d = clamp(dt, -maxL, maxR);
  a.out = oa.out + d * sa; b.in = ob.in + d * sb;
  const L = layoutOf(P.clips);
  return `Стик ${fmt(L[left].e, true)} · ${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2).replace('.', ',')} с`;
}
// показуємо, куди стане перетягнутий кліп: сусіди розсуваються, на новому місці порожній контур
function previewReorder(L0, e) {
  const gset = new Set(ids()), t = timeAt(e);
  const rest = drag.orig.clips.filter(c => !gset.has(c.id)), Lr = layoutOf(rest);
  let target = rest.length;
  for (let i = 0; i < Lr.length; i++) { if (t < (Lr[i].s + Lr[i].e) / 2) { target = i; break; } }
  drag.target = target;
  const moving = drag.orig.clips.filter(c => gset.has(c.id));
  const order = [...rest.slice(0, target), ...moving, ...rest.slice(target)];
  const Ln = layoutOf(order), newStart = new Map(Ln.map(x => [x.id, x.s]));
  drag.newOrder = order.map(c => c.id);
  lanes.querySelectorAll('.it.clip').forEach(el => {
    const o = L0.find(x => x.id === el.dataset.id); if (!o) return;
    const dx = (newStart.get(el.dataset.id) - o.s) * S.pps;
    el.classList.add('shifted');
    el.style.transform = dx ? `translateX(${dx}px)` : '';
  });
  // привид іде за курсором
  if (drag.ghost) drag.ghost.style.transform = `translateX(${(timeAt(e) - drag.t0) * S.pps}px)`;
  const first = Ln.find(x => x.id === moving[0].id);
  insertEl.hidden = false;
  insertEl.style.transform = `translateX(${first.s * S.pps}px)`;
  const same = drag.newOrder.every((id, i) => id === drag.orig.clips[i].id);
  return same ? 'Лишається на місці' : `Позиція ${target + 1} з ${order.length}`;
}

function onUp() {
  inner.removeEventListener('pointermove', onMove);
  if (!drag) return;
  const d = drag; drag = null;
  S.altNoSnap = false; S.snapAt = null; showSnap(null);
  // порожні ряди після перенесення зникають: номери рядів стискаємо до щільних
  if (d.moved && d.rowKind && S.project.overlays.concat(S.project.music).some(o => o.row != null)) {
    render();
    const map = d.rowKind === 'a' ? muRowOf : d.rowKind === 'v2' ? v2RowOf : ovRowOf;
    const list = d.rowKind === 'a' ? S.project.music : S.project.overlays.filter(o => (d.rowKind === 'v2') === isLayer(o) && !(d.rowKind === 'a'));
    const used = [...new Set(list.map(o => map.get(o.id) || 0))].sort((a, b) => a - b);
    for (const o of list) if (o.row != null) o.row = Math.max(0, used.indexOf(map.get(o.id) || 0));
  }
  endVisuals(d);
  if (!d.moved) return;
  if (d.kind === 'clip' && d.mode === 'move') {
    S.project = structuredClone(d.orig);
    if (d.newOrder) {
      const byId = new Map(S.project.clips.map(c => [c.id, c]));
      S.project.clips = d.newOrder.map(id => byId.get(id)).filter(Boolean);
    }
  }
  if (!commit()) emit('project', {});
  else if (d.kind === 'clip' && d.mode !== 'move') emit('did-cut');
}

// ── перетягування файлів на таймлайн ──
export function timelineDropTarget() { return $('tl'); }
export const selectedLabel = () => findSel();
