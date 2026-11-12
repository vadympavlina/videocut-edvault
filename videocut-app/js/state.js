// Модель проєкту, похідні величини та історія змін (undo/redo).
//
// Проєкт — це чистий JSON (зберігається в IndexedDB і в історії):
//   clips    — основна відеодоріжка, кліпи йдуть підряд без проміжків
//              {id, mediaId, in, out, speed, volume, muted, fadeIn, fadeOut, fit, zoom, zx, zy}
//   overlays — текст, фігури, розмиття, картинки поверх відео {id, type, start, dur, x, y, w, h, fade, …}
//   captions — субтитри {id, start, dur, text}; їхній вигляд — captionStyle (див. cc.js)
//   music    — окрема аудіодоріжка {id, mediaId, start, in, out, volume, fadeIn, fadeOut}

import { CC_DEFAULT } from './cc.js';

export const uid = (p = 'x') => p + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 7);

export const ASPECTS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:3': [1440, 1080] };

export function newProject() {
  return {
    v: 1, name: 'Новий проєкт', aspect: '16:9', fps: 30, bg: '#000000',
    clips: [], overlays: [], captions: [], music: [],
    tracks: {}, markers: [],
    captionStyle: { ...CC_DEFAULT },
  };
}

// Проєкт з диска чи бази може бути пошкоджений або старий: приводимо до очікуваної форми, щоб редактор не падав на запуску
export const LANES = ['v', 'v2', 'a', 'cc', 'ov']; // основне відео, відео поверх, звук, субтитри, графіка
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v, d) => (Number.isFinite(v) ? v : d);
export function repairProject(p) {
  const base = newProject();
  if (!isObj(p)) return base;
  const out = { ...base, ...p };
  for (const k of ['clips', 'overlays', 'captions', 'music']) out[k] = Array.isArray(p[k]) ? p[k].filter(x => isObj(x) && x.id) : [];
  out.name = typeof out.name === 'string' ? out.name.slice(0, 200) : base.name;
  if (!ASPECTS[out.aspect]) out.aspect = base.aspect;
  out.fps = [24, 25, 30, 60].includes(out.fps) ? out.fps : base.fps;
  if (!/^#[0-9a-f]{6}$/i.test(out.bg || '')) out.bg = base.bg;
  out.tracks = {};
  for (const k of LANES) { const s = isObj(p.tracks) && isObj(p.tracks[k]) ? p.tracks[k] : {}; out.tracks[k] = { hide: !!s.hide, mute: !!s.mute, lock: !!s.lock, solo: !!s.solo }; }
  out.markers = (Array.isArray(p.markers) ? p.markers : []).filter(m => isObj(m) && Number.isFinite(m.t) && m.t >= 0).map(m => ({ id: String(m.id || uid('m')), t: m.t, name: typeof m.name === 'string' ? m.name.slice(0, 60) : '' }));
  out.captionStyle = isObj(p.captionStyle) ? { ...CC_DEFAULT, ...p.captionStyle } : { ...CC_DEFAULT };
  const time = (o, k, d) => { o[k] = Math.max(0, num(o[k], d)); };
  for (const c of out.clips) { time(c, 'in', 0); c.out = num(c.out, c.in + 1); if (c.out <= c.in) c.out = c.in + 0.1; c.speed = Math.min(8, Math.max(0.1, num(c.speed, 1))); }
  for (const m of out.music) { time(m, 'in', 0); m.out = num(m.out, m.in + 1); if (m.out <= m.in) m.out = m.in + 0.1; }
  out.luts = Array.isArray(p.luts) ? p.luts.filter(l => isObj(l) && l.id && Number.isInteger(l.size) && l.size >= 2 && l.size <= 64 && typeof l.b64 === 'string').slice(0, 24) : [];
  for (const c of out.clips) if (c.lut && !out.luts.some(l => l.id === c.lut.id)) delete c.lut;
  for (const o of [...out.clips, ...out.overlays]) { if (!Array.isArray(o.kf)) delete o.kf; else { o.kf = o.kf.filter(k => isObj(k) && Number.isFinite(k.t)).sort((x, y) => x.t - y.t); if (!o.kf.length) delete o.kf; } }
  for (const o of [...out.overlays, ...out.music]) if (o.row != null && !(Number.isInteger(o.row) && o.row >= 0 && o.row < 50)) delete o.row;
  for (const o of [...out.overlays, ...out.captions, ...out.music]) { time(o, 'start', 0); if ('dur' in o) o.dur = Math.max(0.05, num(o.dur, 1)); }
  return out;
}

export const S = {
  project: newProject(),
  sel: null,        // {kind: 'clip'|'overlay'|'caption'|'music', id}: головний виділений елемент
  multi: [],        // усі виділені елементи (разом із головним)
  t: 0,             // позиція курсора на таймлайні, с
  playing: false,
  view: { zoom: 'fit', grid: false, safe: false }, // перегляд: масштаб, сітка, безпечні поля
  pps: 60,          // пікселів на секунду на таймлайні
  snap: true,
  markIn: null, markOut: null,
  pickKey: null,    // id накладання, для якого вибираємо колір піпеткою
  keyMatte: null,   // id накладання, для якого показуємо маску хромакею (лише в перегляді)
};

// Медіафайли, що використовує проєкт (не серіалізуються): id → запис з media.js
export const media = new Map();

// ── події ──
const listeners = new Map();
export function on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); }
export function emit(ev, data) { (listeners.get(ev) || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); }

// ── похідні ──
export const clipDur = c => Math.max(0.01, (c.out - c.in) / (c.speed || 1));
export const musicDur = m => Math.max(0.01, m.out - m.in);

export function layout() {
  let t = 0;
  return S.project.clips.map(c => { const start = t; t += clipDur(c); return { clip: c, start, end: t }; });
}
export const mainEnd = () => S.project.clips.reduce((a, c) => a + clipDur(c), 0);
export function duration() {
  const p = S.project;
  let d = mainEnd();
  p.overlays.forEach(o => { d = Math.max(d, o.start + o.dur); });
  p.captions.forEach(c => { d = Math.max(d, c.start + c.dur); });
  p.music.forEach(m => { d = Math.max(d, m.start + musicDur(m)); });
  return d;
}
export function clipAt(t, L = layout()) {
  for (const l of L) if (t >= l.start - 1e-6 && t < l.end - 1e-6) return l;
  return null;
}
export const srcTime = (l, t) => l.clip.in + (t - l.start) * (l.clip.speed || 1);

export function outputSize(p = S.project) { const [w, h] = ASPECTS[p.aspect] || ASPECTS['16:9']; return { W: w, H: h }; }

export function findSel() {
  const s = S.sel; if (!s) return null;
  const list = { clip: S.project.clips, overlay: S.project.overlays, caption: S.project.captions, music: S.project.music }[s.kind];
  return list ? list.find(x => x.id === s.id) || null : null;
}
// Виділення: S.sel — головний елемент (його показує права панель), S.multi — усі виділені (разом із головним)
export function select(kind, id, mode) {
  if (!kind) { S.sel = null; S.multi = []; emit('select'); return; }
  const has = S.multi.some(x => x.kind === kind && x.id === id);
  if (mode === 'toggle') {
    if (has) { S.multi = S.multi.filter(x => !(x.kind === kind && x.id === id)); S.sel = S.multi.at(-1) || null; }
    else { S.multi = [...S.multi, { kind, id }]; S.sel = { kind, id }; }
  } else if (mode === 'add') { if (!has) S.multi = [...S.multi, { kind, id }]; S.sel = { kind, id }; }
  else if (!has || S.multi.length < 2) { S.sel = { kind, id }; S.multi = [{ kind, id }]; }
  else S.sel = { kind, id }; // клік по вже виділеному елементу групи: група лишається
  emit('select');
}
export function selectMany(list) {
  S.multi = list.map(x => ({ kind: x.kind, id: x.id }));
  S.sel = S.multi.at(-1) || null;
  emit('select');
}
export const isSel = (kind, id) => S.multi.some(x => x.kind === kind && x.id === id);
export const multiCount = () => S.multi.length;
export function laneOf(kind, o) { return kind === 'clip' ? 'v' : kind === 'music' ? 'a' : kind === 'caption' ? 'cc' : (o && (o.type === 'video' || o.type === 'image') ? 'v2' : 'ov'); }
// стан доріжок: сховати, вимкнути звук, заблокувати, соло
export const trackOf = k => (S.project.tracks && S.project.tracks[k]) || {};
export const laneVisible = k => !trackOf(k).hide;
export const laneLocked = k => !!trackOf(k).lock;
export function laneAudible(k) {
  const T = S.project.tracks || {};
  if (T[k] && T[k].mute) return false;
  const solo = ['v', 'v2', 'a'].filter(x => T[x] && T[x].solo);
  return !solo.length || solo.includes(k);
}

// ── історія ──
// Кожен крок має людську назву: її визначаємо автоматично за різницею між станами (див. describeChange).
const undoStack = [], redoStack = []; // { s: знімок до дії, label: що було зроблено }
let last = JSON.stringify(S.project);
const ITEM_KEYS = { clips: 'clip', overlays: 'overlay', captions: 'caption', music: 'music' };
const PROP_LABELS = [
  [['speed'], 'Швидкість'], [['volume', 'duck'], 'Гучність'], [['muted'], 'Звук увімкнено/вимкнено'], [['fadeIn', 'fadeOut'], 'Поява й зникнення'],
  [['zoom', 'zx', 'zy'], 'Масштаб кадру'], [['look', 'bri', 'con', 'sat'], 'Фільтр і колір'], [['tr'], 'Перехід'], [['rot', 'flip'], 'Поворот чи дзеркало'],
  [['fit'], 'Поля кадру'], [['motion'], 'Рух кадру'], [['text'], 'Текст'], [['size', 'weight', 'color', 'bg', 'bgColor', 'bgAlpha', 'align'], 'Вигляд тексту'],
  [['stroke', 'radius', 'fill', 'strength', 'pixel', 'dim', 'emoji'], 'Вигляд елемента'], [['opacity'], 'Прозорість'], [['blend'], 'Режим накладання'],
  [['key'], 'Зелений екран'], [['shape', 'crop', 'cropL', 'cropR', 'cropT', 'cropB', 'border', 'shadow'], 'Форма й рамка'], [['anim', 'fade'], 'Анімація'],
  [['x', 'y', 'w', 'h'], 'Положення на кадрі'], [['row'], 'Інша доріжка'],
];
const OV_ADD = { text: 'Додати текст', arrow: 'Додати стрілку', rect: 'Додати рамку', blur: 'Додати розмиття', spot: 'Додати прожектор', emoji: 'Додати емодзі', progress: 'Додати прогрес-бар', video: 'Додати відео поверх', image: 'Додати зображення поверх' };
export function describeChange(a, b) {
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  // 1) кількість елементів
  if (b.clips.length > a.clips.length) return a.clips.some(c => { const n = b.clips.find(x => x.id === c.id); return n && (n.out !== c.out || n.in !== c.in); }) ? 'Розрізати' : 'Додати кліп';
  if (b.clips.length < a.clips.length) return 'Видалити кліп';
  if (b.overlays.length > a.overlays.length) { const n = b.overlays.find(o => !a.overlays.some(x => x.id === o.id)); return n && b.overlays.length - a.overlays.length === 1 ? (OV_ADD[n.type] || 'Додати накладання') : 'Додати накладання'; }
  if (b.overlays.length < a.overlays.length) return 'Видалити накладання';
  if (b.captions.length > a.captions.length) return b.captions.length - a.captions.length > 2 ? 'Субтитри з мовлення чи файлу' : 'Додати субтитр';
  if (b.captions.length < a.captions.length) return 'Видалити субтитр';
  if (b.music.length > a.music.length) { const n = b.music.find(o => !a.music.some(x => x.id === o.id)); return n && n.voice ? 'Записати голос' : 'Додати звук'; }
  if (b.music.length < a.music.length) return 'Видалити звук';
  // 2) порядок кліпів
  if (!same(a.clips.map(c => c.id), b.clips.map(c => c.id))) return 'Змінити порядок кліпів';
  // 3) властивості проєкту
  for (const [k, name] of [['aspect', 'Формат кадру'], ['fps', 'Частота кадрів'], ['bg', 'Колір фону'], ['name', 'Назва проєкту'], ['captionStyle', 'Вигляд субтитрів']]) if (!same(a[k], b[k])) return name;
  if (!same(a.markers, b.markers)) return (b.markers || []).length > (a.markers || []).length ? 'Додати маркер' : (b.markers || []).length < (a.markers || []).length ? 'Прибрати маркер' : 'Змінити маркер';
  if (!same(a.tracks, b.tracks)) {
    for (const k of Object.keys(b.tracks || {})) for (const f of ['lock', 'hide', 'mute', 'solo']) if (!!(a.tracks || {})[k]?.[f] !== !!b.tracks[k][f]) return ({ lock: b.tracks[k].lock ? 'Заблокувати доріжку' : 'Розблокувати доріжку', hide: b.tracks[k].hide ? 'Сховати доріжку' : 'Показати доріжку', mute: b.tracks[k].mute ? 'Вимкнути звук доріжки' : 'Увімкнути звук доріжки', solo: 'Соло доріжки' })[f];
  }
  // 4) зміни в елементах
  const changed = [];
  for (const list of Object.keys(ITEM_KEYS)) for (const o of b[list]) { const p = a[list].find(x => x.id === o.id); if (p && !same(p, o)) changed.push([list, p, o]); }
  if (changed.length) {
    const [list, p, o] = changed[0];
    const keys = [...new Set([...Object.keys(p), ...Object.keys(o)])].filter(k => !same(p[k], o[k]));
    let name = null;
    if (keys.some(k => ['start', 'in', 'out', 'dur'].includes(k))) {
      const dur = list === 'clips' ? keys.includes('in') || keys.includes('out') : keys.includes('dur') || keys.includes('in') || keys.includes('out');
      const moved = keys.includes('start') && !keys.some(k => ['dur', 'out'].includes(k)) && !(list === 'music' && keys.includes('in'));
      name = moved ? 'Перемістити' : dur ? 'Обрізати' : 'Перемістити';
    }
    if (!name) for (const [ks, label] of PROP_LABELS) if (keys.some(k => ks.includes(k))) { name = label; break; }
    const n = changed.filter(c => c[0] === list).length; // зсув інших елементів — наслідок, а не окрема дія
    return (name || 'Зміна') + (n > 1 ? ` (${n})` : '');
  }
  return 'Зміна';
}
export function commit(label) {
  const snap = JSON.stringify(S.project);
  if (snap === last) return false;
  let name = label;
  if (!name) { try { name = describeChange(JSON.parse(last), JSON.parse(snap)); } catch { name = 'Зміна'; } }
  undoStack.push({ s: last, label: name });
  if (undoStack.length > 150) undoStack.shift();
  redoStack.length = 0;
  last = snap;
  emit('project', { committed: true });
  emit('history');
  return true;
}
function restore(snap) {
  S.project = JSON.parse(snap);
  last = snap;
  if (S.sel && !findSel()) S.sel = null;
  S.multi = S.multi.filter(x => ({ clip: S.project.clips, overlay: S.project.overlays, caption: S.project.captions, music: S.project.music }[x.kind] || []).some(o => o.id === x.id));
  if (S.sel && !S.multi.length) S.multi = [S.sel];
  emit('project', { committed: true, restored: true });
  emit('select');
  emit('history');
}
export function undo() { if (!undoStack.length) return false; const e = undoStack.pop(); redoStack.push({ s: last, label: e.label }); restore(e.s); return true; }
export function redo() { if (!redoStack.length) return false; const e = redoStack.pop(); undoStack.push({ s: last, label: e.label }); restore(e.s); return true; }
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
export const undoLabel = () => (undoStack.length ? undoStack.at(-1).label : '');
export const redoLabel = () => (redoStack.length ? redoStack.at(-1).label : '');
export function resetHistory() { undoStack.length = 0; redoStack.length = 0; last = JSON.stringify(S.project); emit('history'); }
// усі кроки по порядку: початок, зроблені дії, а далі ті, що можна повторити; index — де ми зараз
export function historyList() {
  const items = [{ label: 'Початок', state: 'done' }];
  undoStack.forEach(e => items.push({ label: e.label, state: 'done' }));
  const idx = undoStack.length;
  [...redoStack].reverse().forEach(e => items.push({ label: e.label, state: 'undone' }));
  return { items, index: idx };
}
// перейти до кроку i за один раз
export function historyJump(i) {
  const all = [...undoStack.map(e => e.s), last, ...[...redoStack].reverse().map(e => e.s)];
  const labels = [...undoStack.map(e => e.label), ...[...redoStack].reverse().map(e => e.label)];
  const cur = undoStack.length;
  if (i === cur || i < 0 || i >= all.length) return false;
  const stackSnaps = all.slice();
  undoStack.length = 0; redoStack.length = 0;
  for (let k = 0; k < i; k++) undoStack.push({ s: stackSnaps[k], label: labels[k] });
  for (let k = stackSnaps.length - 1; k > i; k--) redoStack.push({ s: stackSnaps[k], label: labels[k - 1] });
  restore(stackSnaps[i]);
  return true;
}
// повернути незакомічені зміни (наприклад, після скасованого перетягування)
export function revert() { S.project = JSON.parse(last); emit('project', { restored: true }); }

// ── зсув елементів, прив'язаних до часу (після вирізання шматка з основної доріжки) ──
// Усе, що починається після `at`, зсувається на `delta` (від'ємне — вліво).
// Елементи, що перетинають вирізаний інтервал [at, at-delta), обрізаються.
export function rippleShift(at, delta) {
  if (Math.abs(delta) < 1e-6) return;
  const p = S.project;
  const cutEnd = at - delta; // для delta<0 — кінець вирізаного шматка
  const shift = item => {
    if (delta < 0) {
      const a = item.start, b = item.start + item.dur;
      if (a >= cutEnd - 1e-6) { item.start += delta; return true; }
      if (b <= at + 1e-6) return true;
      // перетинає вирізаний шматок — прибираємо вирізану частину
      const keepBefore = Math.max(0, at - a), keepAfter = Math.max(0, b - cutEnd);
      if (keepBefore + keepAfter < 0.1) return false;
      item.start = Math.min(a, at);
      item.dur = keepBefore + keepAfter;
      return true;
    }
    if (item.start >= at - 1e-6) item.start += delta;
    return true;
  };
  p.overlays = p.overlays.filter(shift);
  p.captions = p.captions.filter(shift);
}

// межі для «прилипання» на таймлайні
export function snapPoints(excludeId) {
  const pts = [0, S.t];
  layout().forEach(l => { pts.push(l.start, l.end); });
  const p = S.project, ex = id => (Array.isArray(excludeId) ? excludeId.includes(id) : id === excludeId);
  p.overlays.forEach(o => { if (!ex(o.id)) pts.push(o.start, o.start + o.dur); });
  p.captions.forEach(c => { if (!ex(c.id)) pts.push(c.start, c.start + c.dur); });
  p.music.forEach(m => { if (!ex(m.id)) pts.push(m.start, m.start + musicDur(m)); });
  (p.markers || []).forEach(m => pts.push(m.t));
  if (S.markIn != null) pts.push(S.markIn);
  if (S.markOut != null) pts.push(S.markOut);
  return pts;
}
// Alt під час перетягування тимчасово вимикає прилипання
export const snapOn = () => S.snap && !S.altNoSnap;
// найближча межа в радіусі px пікселів (або null)
export function snapHit(t, excludeId, px = 8) {
  if (!snapOn()) return null;
  const th = px / S.pps;
  let best = null, bd = th;
  for (const p of snapPoints(excludeId)) { const d = Math.abs(p - t); if (d < bd) { bd = d; best = p; } }
  return best;
}
export function snap(t, excludeId, px = 8) {
  const h = snapHit(t, excludeId, px);
  return h == null ? t : h;
}
// точки монтажу: початки й кінці кліпів та елементів — для переходів клавішами ↑ ↓
export function editPoints() {
  const p = S.project, pts = [0];
  layout().forEach(l => { pts.push(l.start, l.end); });
  p.overlays.forEach(o => { pts.push(o.start, o.start + o.dur); });
  p.captions.forEach(c => { pts.push(c.start, c.start + c.dur); });
  p.music.forEach(m => { pts.push(m.start, m.start + musicDur(m)); });
  (p.markers || []).forEach(m => pts.push(m.t));
  pts.push(duration());
  return [...new Set(pts.map(v => Math.round(v * 1000) / 1000))].filter(isFinite).sort((x, y) => x - y);
}
