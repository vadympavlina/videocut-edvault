// Таймлайн: доріжки, перетягування, обрізання, прилипання, зум.
// Мініатюри й хвилі малюються лише для видимої частини — це тримає швидкість навіть на годинних відео.
import { S, media, emit, on, layout, duration, clipDur, musicDur, snap, snapHit, snapOn, commit, rippleShift, select, findSel } from './state.js';
import { thumbAt, PEAKS_RATE } from './media.js';
import { isLayer } from './layer.js';
import { addToTimeline, addLayerAt } from './ops.js';
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
function assignRows(items) {
  const rows = [];
  const sorted = items.slice().sort((a, b) => a.start - b.start);
  const rowOf = new Map();
  for (const o of sorted) {
    let r = rows.findIndex(end => end <= o.start + 1e-6);
    if (r < 0) { r = rows.length; rows.push(0); }
    rows[r] = o.start + o.dur;
    rowOf.set(o.id, r);
  }
  return { rowOf, n: Math.max(1, rows.length) };
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
  const selCls = (k, id) => (sel && sel.kind === k && sel.id === id ? ' sel' : '');
  const hnd = '<i class="h h-l"></i><i class="h h-r"></i>';

  const layers = p.overlays.filter(isLayer), graphics = p.overlays.filter(o => !isLayer(o));
  const { rowOf, n } = assignRows(graphics);
  ovRows = n;
  const ovH = n * ROW + 6;
  const lr = assignRows(layers);
  v2Rows = lr.n; v2RowOf = lr.rowOf;
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
  const mr = assignRows(p.music.map(x => ({ id: x.id, start: x.start, dur: musicDur(x) })));
  muRows = mr.n; muRowOf = mr.rowOf;
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
  setHtml(lanes, rows.map(([h, cls, html]) => `<div class="lane ${cls}" style="height:${h}px">${html}</div>`).join(''));
  setHtml(heads, `<div class="head" style="height:${RULER_H}px"></div>` +
    rows.map(([h, cls, , ic, name, tip]) => `<div class="head head-${cls.slice(5)}" style="height:${h}px" title="${tip}">${icon(ic)}<span>${name}</span></div>`).join('') + '<div style="height:40px"></div>');
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
let drag = null;
const timeAt = e => (e.clientX - inner.getBoundingClientRect().left) / S.pps;

function onDown(e) {
  if (e.button !== 0) return;
  const it = e.target.closest('.it');
  if (!it) {
    // клік по лінійці або порожньому місцю — перемотування (і скидання виділення на доріжках)
    if (e.target.closest('.lane')) select(null);
    scrub(e);
    return;
  }
  e.preventDefault();
  const kind = it.dataset.kind, id = it.dataset.id;
  select(kind, id);
  const mode = e.target.classList.contains('h-l') ? 'l' : e.target.classList.contains('h-r') ? 'r' : 'move';
  drag = { kind, id, mode, x0: e.clientX, t0: timeAt(e), orig: structuredClone(S.project), moved: false, pointerId: e.pointerId };
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

function onMove(e) {
  if (!drag) return;
  S.altNoSnap = e.altKey;
  if (!drag.moved && Math.abs(e.clientX - drag.x0) < 3) return;
  drag.moved = true;
  hoverEl.hidden = true;
  S.snapAt = null;
  const dt = timeAt(e) - drag.t0;
  const P = S.project = structuredClone(drag.orig);
  if (drag.kind === 'clip') moveClip(P, dt, e);
  else if (drag.kind === 'music') moveMusic(P, dt);
  else moveTimed(P, drag.kind === 'overlay' ? P.overlays : P.captions, dt);
  emit('project', { live: true });
  showSnap(S.snapAt);
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

function moveTimed(P, list, dt) {
  const o = list.find(x => x.id === drag.id), orig = (drag.kind === 'overlay' ? drag.orig.overlays : drag.orig.captions).find(x => x.id === drag.id);
  if (!o) return;
  const end = orig.start + orig.dur;
  if (drag.mode === 'move') o.start = Math.max(0, snapBoth(orig.start + dt, orig.dur, o.id));
  else if (drag.mode === 'l') {
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
}

function moveMusic(P, dt) {
  const x = P.music.find(v => v.id === drag.id), orig = drag.orig.music.find(v => v.id === drag.id);
  if (!x) return;
  const m = media.get(x.mediaId), max = m ? m.duration : orig.out;
  if (drag.mode === 'move') x.start = Math.max(0, snapBoth(orig.start + dt, musicDur(orig), x.id));
  else if (drag.mode === 'l') {
    let ns = snapEdge(orig.start + dt, x.id);
    let nin = orig.in + (ns - orig.start);
    if (nin < 0) { ns -= nin; nin = 0; }
    if (nin > orig.out - 0.2) { nin = orig.out - 0.2; ns = orig.start + (nin - orig.in); }
    x.in = nin; x.start = Math.max(0, ns);
  } else x.out = clamp(orig.out + (snapEdge(orig.start + musicDur(orig) + dt, x.id) - (orig.start + musicDur(orig))), orig.in + 0.2, max);
}

function moveClip(P, dt, e) {
  const idx = P.clips.findIndex(c => c.id === drag.id);
  if (idx < 0) return;
  const c = P.clips[idx], orig = drag.orig.clips[idx];
  const m = media.get(c.mediaId);
  const sp = c.speed || 1;
  const L0 = (() => { let t = 0; return drag.orig.clips.map(x => { const s = t; t += clipDur(x); return { s, e: t }; }); })();
  const oldEnd = L0[idx].e;
  if (drag.mode === 'move') {
    // переставлення кліпу: місце вставки за положенням курсора
    const t = timeAt(e);
    let target = drag.orig.clips.length;
    for (let i = 0; i < L0.length; i++) { if (t < (L0[i].s + L0[i].e) / 2) { target = i; break; } }
    drag.target = target;
    const x = (target < L0.length ? L0[target].s : L0[L0.length - 1].e) * S.pps;
    insertEl.hidden = target === idx || target === idx + 1;
    insertEl.style.transform = `translateX(${x}px)`;
    return;
  }
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
}

function onUp() {
  inner.removeEventListener('pointermove', onMove);
  if (!drag) return;
  const d = drag; drag = null;
  S.altNoSnap = false; S.snapAt = null; showSnap(null);
  insertEl.hidden = true;
  if (!d.moved) return;
  if (d.kind === 'clip' && d.mode === 'move') {
    S.project = structuredClone(d.orig);
    const i = S.project.clips.findIndex(c => c.id === d.id);
    let target = d.target ?? i;
    if (target !== i && target !== i + 1) {
      const [c] = S.project.clips.splice(i, 1);
      if (target > i) target--;
      S.project.clips.splice(target, 0, c);
    }
  }
  if (!commit()) emit('project', {});
  else if (d.kind === 'clip' && d.mode !== 'move') emit('did-cut');
}

// ── перетягування файлів на таймлайн ──
export function timelineDropTarget() { return $('tl'); }
export const selectedLabel = () => findSel();
