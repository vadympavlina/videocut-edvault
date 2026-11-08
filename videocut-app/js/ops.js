// Операції редагування — кожна змінює проєкт і записує крок в історію.
import { S, media, uid, emit, layout, clipAt, srcTime, clipDur, musicDur, mainEnd, duration, commit, select, findSel, rippleShift, outputSize, ASPECTS } from './state.js';
import { applyLayout } from './layer.js';
import { seek } from './player.js';
import { toast } from './ui.js';
import { addMedia, peakIn, PEAKS_RATE, grabFrame } from './media.js';

const FPS_EPS = 0.05;

function nearestAspect(w, h) {
  const r = w / h;
  let best = '16:9', bd = Infinity;
  for (const [k, [aw, ah]] of Object.entries(ASPECTS)) { const d = Math.abs(Math.log(r / (aw / ah))); if (d < bd) { bd = d; best = k; } }
  return best;
}

export function newClip(m) {
  return { id: uid('c'), mediaId: m.id, in: 0, out: m.kind === 'image' ? 5 : m.duration, speed: 1, volume: 1, muted: false, fadeIn: 0, fadeOut: 0, fit: 'blur', zoom: 1, zx: 0.5, zy: 0.5, motion: m.kind === 'image' ? 'in' : 'none' };
}

// Додає відео/фото в кінець основної доріжки, аудіо — на музичну доріжку
export function addToTimeline(m, { silent = false, at = null } = {}) {
  const p = S.project;
  if (m.kind === 'audio') return addMusic(m, silent);
  if (!p.clips.length && m.width && m.height) p.aspect = nearestAspect(m.width, m.height);
  const c = newClip(m);
  if (at != null) p.clips.splice(at, 0, c); else p.clips.push(c);
  commit();
  if (!silent) { select('clip', c.id); toast(`«${m.name}» додано на таймлайн`); }
  return c;
}

export function addMusic(m, silent, at = null) {
  const p = S.project;
  const start = at != null ? Math.max(0, at) : p.music.length ? Math.min(S.t, duration()) : 0;
  const len = mainEnd() > 0 ? Math.min(m.duration, Math.max(1, mainEnd() - start)) : m.duration;
  const x = { id: uid('a'), mediaId: m.id, start, in: 0, out: len, volume: mainEnd() > 0 ? 0.5 : 1, fadeIn: 0.5, fadeOut: 1.5, duck: mainEnd() > 0 };
  p.music.push(x);
  commit();
  if (!silent) { select('music', x.id); toast(mainEnd() > 0 ? 'Музику додано під відео — вона сама стишується, коли хтось говорить' : 'Аудіо додано'); }
  return x;
}

// ── розрізання ──
function splitList(list, id, t) {
  const i = list.findIndex(x => x.id === id);
  const o = list[i];
  if (!o || t <= o.start + 0.1 || t >= o.start + o.dur - 0.1) return false;
  const b = { ...structuredClone(o), id: uid(o.id[0]), start: t, dur: o.start + o.dur - t };
  if (o.type === 'video') b.in = (o.in || 0) + (t - o.start); // друга половина відео продовжується з того ж місця
  o.dur = t - o.start;
  list.splice(i + 1, 0, b);
  return b;
}
export function splitAt(t = S.t) {
  const p = S.project, sel = findSel();
  // спершу — виділений елемент, якщо курсор на ньому
  if (sel && S.sel.kind === 'overlay' && splitList(p.overlays, sel.id, t)) { commit(); toast('Розрізано'); return true; }
  if (sel && S.sel.kind === 'caption' && splitList(p.captions, sel.id, t)) { commit(); toast('Розрізано'); return true; }
  if (sel && S.sel.kind === 'music') {
    const m = sel, d = musicDur(m);
    if (t > m.start + 0.1 && t < m.start + d - 0.1) {
      const b = { ...structuredClone(m), id: uid('a'), start: t, in: m.in + (t - m.start), fadeIn: 0 };
      m.out = m.in + (t - m.start); m.fadeOut = 0;
      p.music.splice(p.music.indexOf(m) + 1, 0, b);
      commit(); toast('Розрізано'); return true;
    }
  }
  const l = clipAt(t);
  if (!l || t <= l.start + FPS_EPS || t >= l.end - FPS_EPS) { toast('Поставте курсор усередину кліпу, щоб розрізати'); return false; }
  const c = l.clip, st = srcTime(l, t);
  const b = { ...structuredClone(c), id: uid('c'), in: st, fadeIn: 0 };
  delete b.tr; // розріз — без переходу
  c.out = st; c.fadeOut = 0;
  p.clips.splice(p.clips.indexOf(c) + 1, 0, b);
  commit();
  emit('did-cut');
  select('clip', b.id);
  return true;
}

// ── видалення ──
export function deleteSel() {
  const s = S.sel, o = findSel();
  if (!s || !o) return false;
  const p = S.project;
  if (s.kind === 'clip') {
    const l = layout().find(x => x.clip.id === o.id);
    p.clips = p.clips.filter(c => c.id !== o.id);
    rippleShift(l.start, -(l.end - l.start));
    if (S.t > l.start) seek(Math.max(l.start, S.t - (l.end - l.start)));
    emit('did-cut');
  } else if (s.kind === 'overlay') p.overlays = p.overlays.filter(x => x.id !== o.id);
  else if (s.kind === 'caption') p.captions = p.captions.filter(x => x.id !== o.id);
  else if (s.kind === 'music') p.music = p.music.filter(x => x.id !== o.id);
  select(null);
  commit();
  return true;
}

export function duplicateSel() {
  const s = S.sel, o = findSel();
  if (!o) return;
  const p = S.project;
  const copy = { ...structuredClone(o), id: uid(o.id[0]) };
  if (s.kind === 'clip') p.clips.splice(p.clips.indexOf(o) + 1, 0, copy);
  else if (s.kind === 'music') { copy.start = o.start + musicDur(o); p.music.push(copy); }
  else {
    copy.start = o.start + o.dur;
    (s.kind === 'overlay' ? p.overlays : p.captions).push(copy);
  }
  commit();
  select(s.kind, copy.id);
}

// ── вирізання діапазону [a, b) з основної доріжки ──
// без запису в історію — щоб кілька вирізань (паузи) були одним кроком «скасувати»
function cutRangeRaw(a, b) {
  const p = S.project;
  const out = [];
  for (const l of layout()) {
    const c = l.clip, sp = c.speed || 1;
    if (l.end <= a || l.start >= b) { out.push(c); continue; }
    if (l.start < a) out.push({ ...structuredClone(c), out: c.in + (a - l.start) * sp, fadeOut: 0 });
    if (l.end > b) out.push({ ...structuredClone(c), id: l.start < a ? uid('c') : c.id, in: c.in + (b - l.start) * sp, fadeIn: 0, tr: l.start < a ? undefined : c.tr });
  }
  p.clips = out;
  rippleShift(a, -(b - a));
}
export function cutRanges(list) {
  if (!list.length) return 0;
  const sorted = list.slice().sort((x, y) => y[0] - x[0]); // з кінця, щоб попередні позиції не зсувалися
  let total = 0;
  for (const [a, b] of sorted) { cutRangeRaw(a, b); total += b - a; }
  S.markIn = S.markOut = null;
  select(null);
  commit();
  seek(Math.min(S.t, mainEnd()));
  emit('did-cut');
  return total;
}
export function cutRange(a, b) {
  if (a == null || b == null) { toast('Спочатку позначте початок (I) і кінець (O) шматка'); return false; }
  if (b < a) [a, b] = [b, a];
  const end = mainEnd();
  b = Math.min(b, end);
  if (b - a < 0.05) { toast('Позначений шматок порожній'); return false; }
  cutRangeRaw(a, b);
  S.markIn = S.markOut = null;
  select(null);
  commit();
  seek(a);
  toast(`Вирізано ${(b - a).toFixed(1).replace('.', ',')} с`);
  emit('did-cut');
  return true;
}

// ── текст і елементи ──
export const TEXT_PRESETS = {
  title: { label: 'Заголовок', o: { text: 'Заголовок', size: 116, weight: 800, color: '#ffffff', bg: 'shadow', align: 'center', x: 0.08, y: 0.36, w: 0.84 } },
  subtitle: { label: 'Підзаголовок', o: { text: 'Короткий опис теми', size: 60, weight: 600, color: '#ffffff', bg: 'shadow', align: 'center', x: 0.12, y: 0.56, w: 0.76 } },
  lower: { label: 'Підпис (нижня третина)', o: { text: 'Ім’я Прізвище\nвчитель інформатики', size: 46, weight: 700, color: '#ffffff', bg: 'box', bgColor: '#4F6BF4', bgAlpha: 0.94, align: 'left', x: 0.05, y: 0.73, w: 0.4 } },
  step: { label: 'Крок', o: { text: 'Крок 1', size: 56, weight: 800, color: '#1a1d23', bg: 'box', bgColor: '#ffd43b', bgAlpha: 1, align: 'center', x: 0.04, y: 0.06, w: 0.16 } },
  note: { label: 'Примітка', o: { text: 'Зверніть увагу!', size: 50, weight: 700, color: '#ffffff', bg: 'box', bgColor: '#000000', bgAlpha: 0.72, align: 'left', x: 0.54, y: 0.07, w: 0.42 } },
  plain: { label: 'Звичайний текст', o: { text: 'Текст', size: 64, weight: 700, color: '#ffffff', bg: 'outline', bgColor: '#000000', align: 'left', x: 0.08, y: 0.1, w: 0.5 } },
};

export function addOverlay(type, extra = {}) {
  const p = S.project;
  const { W, H } = outputSize();
  const base = { id: uid('o'), type, start: Math.min(S.t, Math.max(0, duration() - 0.5)), dur: 4, fade: type === 'text' };
  let o;
  if (type === 'text') o = { ...base, ...structuredClone(TEXT_PRESETS[extra.preset || 'plain'].o), anim: 'fade' };
  else if (type === 'emoji') { const w = 0.13; o = { ...base, emoji: extra.emoji || '⭐', x: 0.78, y: 0.08, w, h: w * W / H, anim: 'pop', dur: 3 }; }
  else if (type === 'video') {
    const m = media.get(extra.mediaId);
    const w = 0.24, h = w * W / H; // коло
    const start = extra.start ?? S.t;
    base.start = start;
    o = { ...base, mediaId: extra.mediaId, in: 0, start, dur: m ? m.duration : 5, x: 0.97 - w, y: 0.95 - h, w, h, shape: 'circle', border: '#ffffff', volume: 1, muted: false, fade: true, anim: 'pop', flip: false, shadow: true, opacity: 1 };
    if (extra.shape && extra.shape !== 'circle') { o.shape = extra.shape; o.border = 'none'; o.anim = 'fade'; }
  }
  else if (type === 'progress') o = { ...base, start: 0, dur: Math.max(1, mainEnd() || duration() || 10), x: 0, y: 0.985, w: 1, h: 0.015, color: '#4F6BF4', fade: false };
  else if (type === 'rect') o = { ...base, x: 0.3, y: 0.3, w: 0.4, h: 0.3, color: '#ef4444', stroke: 8, radius: 16, fill: false };
  else if (type === 'arrow') o = { ...base, x: 0.28, y: 0.3, w: 0.18, h: 0.16 * W / H, color: '#ef4444', stroke: 10 };
  else if (type === 'blur') o = { ...base, x: 0.35, y: 0.35, w: 0.3, h: 0.2, strength: 20, pixel: false, dur: 5 };
  else if (type === 'spot') o = { ...base, x: 0.3, y: 0.25, w: 0.4, h: 0.45, dim: 0.62, shape: 'rect', dur: 5, fade: true };
  else if (type === 'image') {
    const m = media.get(extra.mediaId);
    if (extra.start != null) base.start = extra.start;
    const w = 0.22, h = m ? w * (W / H) * (m.height / m.width) : 0.2;
    o = { ...base, mediaId: extra.mediaId, x: 0.74, y: 0.05, w, h, radius: 0, dur: extra.dur || Math.max(4, duration() - base.start) };
  }
  if (!o) return null;
  if (S.t >= duration() && duration() === 0) o.start = 0;
  if (o.type === 'video' || o.type === 'image') {
    if (extra.shape) o.shape = extra.shape;
    if (o.type === 'image' && !o.shape) o.shape = 'rect';
    applyLayout(o, extra.layout || 'corner');
    if (extra.cx != null) { o.x = Math.min(1 - o.w, Math.max(0, extra.cx - o.w / 2)); o.y = Math.min(1 - o.h, Math.max(0, extra.cy - o.h / 2)); }
  }
  p.overlays.push(o);
  commit();
  select('overlay', o.id);
  return o;
}

// відео чи фото поверх основного (доріжка «Відео 2»); аудіо — на музичну доріжку
export function addLayerAt(m, { start = S.t, cx = null, cy = null, layout = 'corner' } = {}) {
  if (m.kind === 'audio') return addMusic(m, false, start);
  const o = addOverlay(m.kind === 'video' ? 'video' : 'image', { mediaId: m.id, start, shape: 'rect', layout, cx, cy, dur: m.kind === 'image' ? 5 : undefined });
  if (o) toast('Додано поверх відео — тягніть кути, щоб змінити розмір, а бокові маркери — щоб обрізати', 'ok', 4500);
  return o;
}

export function moveZ(dir) {
  const s = S.sel; if (!s || s.kind !== 'overlay') return;
  const a = S.project.overlays, i = a.findIndex(o => o.id === s.id);
  const j = dir > 0 ? a.length - 1 : 0;
  if (i < 0 || i === j) return;
  const [o] = a.splice(i, 1);
  if (dir > 0) a.push(o); else a.unshift(o);
  commit();
}

// ── субтитри ──
export function addCaption(text = '') {
  const p = S.project;
  const start = S.t;
  // не накладаємо на наступний субтитр
  const next = p.captions.filter(c => c.start > start + 0.01).sort((a, b) => a.start - b.start)[0];
  const dur = Math.max(0.5, Math.min(3, next ? next.start - start : 3));
  const c = { id: uid('s'), start, dur, text: text || 'Новий субтитр' };
  p.captions.push(c);
  p.captions.sort((a, b) => a.start - b.start);
  commit();
  select('caption', c.id);
  return c;
}
export function setCaptions(list, replace) {
  const p = S.project;
  const items = list.map(c => ({ id: uid('s'), start: c.start, dur: c.dur, text: c.text }));
  p.captions = replace ? items : p.captions.concat(items).sort((a, b) => a.start - b.start);
  commit();
}

// Автосубтитри: 'replace' прибирає наявні субтитри лише на відрізку [a, b], 'add' лишає їх
export function setCaptionsIn(list, mode, range) {
  const p = S.project;
  const [a, b] = range || [0, Infinity];
  const keep = mode === 'replace' ? p.captions.filter(c => !(c.start < b && c.start + c.dur > a)) : p.captions;
  const items = list.map(c => ({ id: uid('s'), start: c.start, dur: c.dur, text: c.text }));
  p.captions = keep.concat(items).sort((x, y) => x.start - y.start);
  commit();
}

export function trimMusicToVideo(x) {
  const end = mainEnd();
  if (end <= x.start) return;
  x.out = Math.min(x.out, x.in + (end - x.start));
  commit();
}

export function clipLabel(c) { const m = media.get(c.mediaId); return m ? m.name : 'Кліп'; }
export { clipDur };

// ── чарівні дії ──

// Пошук тиші в основній доріжці. level: 'soft' | 'mid' | 'hard'; minLen — найкоротша пауза, с; pad — запас по краях, с
export function findSilences({ level = 'mid', minLen = 0.8, pad = 0.15 } = {}) {
  const K = { soft: 0.07, mid: 0.12, hard: 0.2 }[level] || 0.12;
  const found = [];
  let missing = 0;
  for (const l of layout()) {
    const c = l.clip, m = media.get(c.mediaId);
    if (!m || m.kind !== 'video' || c.muted) continue;
    if (!m.peaks) { if (m.hasAudio) missing++; continue; }
    const sp = c.speed || 1;
    const i0 = Math.floor(c.in * PEAKS_RATE), i1 = Math.min(m.peaks.length, Math.ceil(c.out * PEAKS_RATE));
    if (i1 - i0 < 5) continue;
    // поріг відносно гучності мовлення в цьому кліпі (95-й перцентиль)
    const arr = Array.from(m.peaks.subarray(i0, i1)).sort((a, b) => a - b);
    const loud = arr[Math.floor(arr.length * 0.95)] || 0;
    if (loud < 0.01) continue;
    const thr = loud * K;
    let runStart = null;
    const flush = (iEnd) => {
      if (runStart == null) return;
      const sa = runStart / PEAKS_RATE, sb = iEnd / PEAKS_RATE;
      runStart = null;
      // у час таймлайну
      const ta = l.start + (sa - c.in) / sp + pad, tb = l.start + (sb - c.in) / sp - pad;
      // паузи на самому початку / в кінці кліпу прибираємо повністю
      const a = sa <= c.in + 0.02 ? l.start : ta, b = sb >= c.out - 0.02 ? l.end : tb;
      if (b - a >= minLen - 2 * pad && b - a > 0.15) found.push([Math.max(l.start, a), Math.min(l.end, b)]);
    };
    for (let i = i0; i < i1; i++) {
      if (m.peaks[i] < thr) { if (runStart == null) runStart = i; }
      else flush(i);
    }
    flush(i1);
  }
  // не дозволяємо вирізати все відео
  const total = found.reduce((s, [a, b]) => s + b - a, 0);
  return { list: total < mainEnd() - 0.5 ? found : [], total, missing };
}

// Заставка: кольоровий фон + великий заголовок на кількох секундах на початку чи в позиції курсора
export const CARD_STYLES = {
  blue: ['#4F6BF4', '#8b5cf6'], sunset: ['#f97316', '#ec4899'], green: ['#10b981', '#0ea5e9'], dark: ['#0f172a', '#334155'], light: ['#f8fafc', '#e2e8f0'],
};
export async function addTitleCard(style = 'blue', text = 'Назва уроку') {
  const { W, H } = outputSize();
  const [c1, c2] = CARD_STYLES[style] || CARD_STYLES.blue;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  // легкі кола для глибини
  g.globalAlpha = 0.12; g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(W * 0.85, H * 0.15, Math.min(W, H) * 0.35, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(W * 0.1, H * 0.95, Math.min(W, H) * 0.25, 0, Math.PI * 2); g.fill();
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  const m = await addMedia(blob, 'Заставка.png');
  const p = S.project;
  const L = layout();
  // вставляємо на межі кліпу, найближчій до курсора
  let idx = p.clips.length, at = mainEnd();
  const cur = L.find(x => S.t >= x.start && S.t < x.end);
  if (cur) { const i = L.indexOf(cur); if (S.t - cur.start < cur.end - S.t) { idx = i; at = cur.start; } else { idx = i + 1; at = cur.end; } }
  const dur = 3;
  const c = { ...newClip(m), out: dur };
  p.clips.splice(idx, 0, c);
  rippleShift(at, dur);
  const dark = style === 'light';
  p.overlays.push({ id: uid('o'), type: 'text', start: at, dur, text, size: 120, weight: 800, color: dark ? '#1a1d23' : '#ffffff', bg: dark ? 'none' : 'shadow', align: 'center', x: 0.08, y: 0.38, w: 0.84, anim: 'up' });
  commit();
  seek(at + 0.6);
  select('overlay', p.overlays[p.overlays.length - 1].id);
  return c;
}

// Вирівняти гучність: найгучніший момент → ~90%
export function normalizeSel() {
  const s = S.sel, o = findSel();
  if (!o) return false;
  const m = media.get(o.mediaId);
  if (!m || !m.peaks) { toast(m && m.analyzing ? 'Ще аналізуємо звук — спробуйте за мить' : 'У цьому файлі немає звуку'); return false; }
  const peak = peakIn(m, o.in, o.out);
  if (!peak || peak < 0.005) { toast('Тут майже тиша — нічого вирівнювати'); return false; }
  const v = Math.max(0.1, Math.min(2, Math.round((0.9 / peak) * 20) / 20));
  o.volume = v;
  if (s.kind === 'clip') o.muted = false;
  commit();
  toast(`Гучність: ${Math.round(v * 100)}%`, 'ok');
  return true;
}

// Переходи між усіма кліпами: вмикає або (якщо вже всюди) прибирає
export function transitionsAll(type = 'fade') {
  const cl = S.project.clips.slice(1);
  if (!cl.length) { toast('Потрібно хоча б два кліпи'); return; }
  const all = cl.every(c => c.tr);
  cl.forEach(c => { if (all) delete c.tr; else if (!c.tr) c.tr = { type, d: 0.6 }; });
  commit();
  toast(all ? 'Переходи прибрано' : 'Переходи додано між усіма кліпами', 'ok');
}

// Озвучення: записаний голос лягає на звукову доріжку з місця початку запису
export function addVoice(m, start, trim = 0) {
  // trim — затримка мікрофона: початок запису відрізаємо, щоб голос збігався з відео
  const skip = Math.max(0, Math.min(trim, m.duration - 0.2));
  const x = { id: uid('a'), mediaId: m.id, start, in: skip, out: m.duration, volume: 1, fadeIn: 0, fadeOut: 0, voice: true };
  S.project.music.push(x);
  commit();
  select('music', x.id);
  return x;
}

// Стоп-кадр: поточний кадр застигає на кілька секунд (вставляється як фото в позиції курсора)
export async function freezeFrame(dur = 3) {
  const l = clipAt(S.t);
  if (!l) { toast('Поставте курсор на відео'); return false; }
  const c = l.clip, m = media.get(c.mediaId);
  if (!m || m.kind !== 'video') { toast('Стоп-кадр можна зробити лише з відео'); return false; }
  const cv = await grabFrame(m, srcTime(l, S.t), 1920);
  if (!cv) { toast('Не вдалося взяти кадр', 'err'); return false; }
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.92));
  const fm = await addMedia(blob, 'Стоп-кадр.jpg');
  const p = S.project, t = S.t;
  const idx = p.clips.indexOf(c);
  const fc = { ...newClip(fm), out: dur, fit: c.fit, rot: c.rot, flip: c.flip, look: c.look, bri: c.bri, con: c.con, sat: c.sat, zoom: c.zoom, zx: c.zx, zy: c.zy, motion: 'none' };
  if (t <= l.start + 0.05) p.clips.splice(idx, 0, fc);
  else if (t >= l.end - 0.05) p.clips.splice(idx + 1, 0, fc);
  else {
    const st = srcTime(l, t);
    const b = { ...structuredClone(c), id: uid('c'), in: st, fadeIn: 0 }; delete b.tr;
    c.out = st; c.fadeOut = 0;
    p.clips.splice(idx + 1, 0, fc, b);
  }
  rippleShift(t, dur);
  commit();
  select('clip', fc.id);
  toast(`Стоп-кадр на ${dur} с додано`, 'ok');
  return true;
}

// ── копіювати / вирізати / вставити ──
let clipboard = null; // { kind, item }
export const canPaste = () => !!clipboard;
export function copySel(cut = false) {
  const o = findSel(), s = S.sel;
  if (!o || !s) { toast('Спочатку виділіть елемент на таймлайні'); return false; }
  clipboard = { kind: s.kind, item: structuredClone(o) };
  if (cut) { deleteSel(); toast('Вирізано — Ctrl+V вставить у позиції курсора'); }
  else toast('Скопійовано — Ctrl+V вставить у позиції курсора');
  return true;
}
export function pasteClip() {
  if (!clipboard) { toast('Нічого вставляти — спершу скопіюйте елемент (Ctrl+C)'); return false; }
  const { kind, item } = clipboard, p = S.project;
  const copy = { ...structuredClone(item), id: uid(item.id[0]) };
  if (kind !== 'caption' && item.mediaId && !media.has(item.mediaId)) { toast('Файл цього елемента вже прибрано з проєкту', 'err'); return false; }
  if (kind === 'clip') {
    delete copy.tr;
    // вставляємо на межу кліпу, найближчу до курсора
    const L = layout();
    let idx = p.clips.length;
    const cur = L.find(x => S.t >= x.start && S.t < x.end);
    if (cur) { const i = L.indexOf(cur); idx = S.t - cur.start < cur.end - S.t ? i : i + 1; }
    const at = idx < L.length ? L[idx].start : mainEnd();
    p.clips.splice(idx, 0, copy);
    rippleShift(at, clipDur(copy));
  } else {
    copy.start = Math.max(0, S.t);
    (kind === 'overlay' ? p.overlays : kind === 'caption' ? p.captions : p.music).push(copy);
    if (kind === 'caption') p.captions.sort((a, b) => a.start - b.start);
  }
  commit();
  select(kind, copy.id);
  return true;
}
