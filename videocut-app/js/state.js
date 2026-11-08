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
    captionStyle: { ...CC_DEFAULT },
  };
}

export const S = {
  project: newProject(),
  sel: null,        // {kind: 'clip'|'overlay'|'caption'|'music', id}
  t: 0,             // позиція курсора на таймлайні, с
  playing: false,
  pps: 60,          // пікселів на секунду на таймлайні
  snap: true,
  markIn: null, markOut: null,
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
export function select(kind, id) {
  S.sel = kind ? { kind, id } : null;
  emit('select');
}

// ── історія ──
const undoStack = [], redoStack = [];
let last = JSON.stringify(S.project);
export function commit() {
  const snap = JSON.stringify(S.project);
  if (snap === last) return false;
  undoStack.push(last);
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
  emit('project', { committed: true, restored: true });
  emit('select');
  emit('history');
}
export function undo() { if (!undoStack.length) return false; redoStack.push(last); restore(undoStack.pop()); return true; }
export function redo() { if (!redoStack.length) return false; undoStack.push(last); restore(redoStack.pop()); return true; }
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
export function resetHistory() { undoStack.length = 0; redoStack.length = 0; last = JSON.stringify(S.project); emit('history'); }
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
  const p = S.project;
  p.overlays.forEach(o => { if (o.id !== excludeId) pts.push(o.start, o.start + o.dur); });
  p.captions.forEach(c => { if (c.id !== excludeId) pts.push(c.start, c.start + c.dur); });
  p.music.forEach(m => { if (m.id !== excludeId) pts.push(m.start, m.start + musicDur(m)); });
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
  pts.push(duration());
  return [...new Set(pts.map(v => Math.round(v * 1000) / 1000))].filter(isFinite).sort((x, y) => x - y);
}
