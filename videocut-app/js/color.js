// Колірний граф кліпа: вузли (Вхід → Первинна → Криві → HSL → LUT → Змішати → Вихід) і їхній рендер на відеокарті.
// Один і той самий рендер працює в перегляді й в експорті (див. render.js → drawClipFrame).
//
// Модель (clip.cg), чистий JSON:
//   { v:1, nodes:[{ id, type, x, y, off?:true, p:{…параметри…} }], links:[{ from, to, port:0|1 }] }
//   port 0 — головний вхід, port 1 — другий вхід (лише «Змішати»).
// Колеса — {x, y, l}: вектор на колі (довжина ≤ 1) і загальний рівень l −1…1.

import { lutStrip } from './lut.js';

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v, d, lo = -Infinity, hi = Infinity) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const clamp01 = v => Math.min(1, Math.max(0, v));
const sstep = (a, b, x) => { const t = clamp01((x - a) / ((b - a) || 1e-6)); return t * t * (3 - 2 * t); };

/* ═════════ типи вузлів ═════════ */
export const NODE_TYPES = {
  in: { name: 'Вхід', color: '#c2c2c2', ins: 0 },
  prim: { name: 'Первинна', color: '#9aabff', ins: 1 },
  curves: { name: 'Криві', color: '#5fd39b', ins: 1 },
  hsl: { name: 'HSL', color: '#e8c93a', ins: 1 },
  lut: { name: 'LUT', color: '#f08a82', ins: 1 },
  fx: { name: 'Ефекти', color: '#7fd0e8', ins: 1 },
  mix: { name: 'Змішати', color: '#c3a6ff', ins: 2 },
  out: { name: 'Вихід', color: '#c2c2c2', ins: 1 },
};
export const ADDABLE = ['prim', 'curves', 'hsl', 'lut', 'fx', 'mix'];
export const MIX_MODES = { normal: 'Звичайний', add: 'Додати', multiply: 'Множення', screen: 'Екран', overlay: 'Накладання', soft: 'М’яке світло', diff: 'Різниця' };
const MIX_ID = Object.keys(MIX_MODES);

const wheel0 = () => ({ x: 0, y: 0, l: 0 });
export const DEFAULTS = {
  prim: () => ({ lift: wheel0(), gamma: wheel0(), gain: wheel0(), offset: wheel0(), exp: 0, con: 1, sat: 1, temp: 0, tint: 0, hi: 0, sh: 0 }),
  curves: () => ({ m: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] }),
  hsl: () => ({ hue: 30, width: 60, smin: 0.15, smax: 1, lmin: 0, lmax: 1, soft: 0.4, dh: 0, ds: 1, dl: 0, inv: false, amount: 1 }),
  lut: () => ({ lut: null, mix: 1 }),
  fx: () => ({ vig: 0, vigSize: 0.55, grain: 0, glow: 0, fade: 0 }),
  mix: () => ({ mode: 'normal', amount: 0.5 }),
  in: () => ({}), out: () => ({ amount: 1 }),
};

export const MASKABLE = ['prim', 'curves', 'hsl', 'lut', 'fx'];
export const MASK_SHAPES = { none: 'Без маски', ellipse: 'Коло', rect: 'Прямокутник', linear: 'Градієнт' };
export const maskDefault = () => ({ type: 'ellipse', x: 0.5, y: 0.5, w: 0.5, h: 0.5, rot: 0, soft: 0.35, inv: false });
function fixMask(m) {
  if (!isObj(m) || !MASK_SHAPES[m.type] || m.type === 'none') return undefined;
  return { type: m.type, x: num(m.x, 0.5, -0.5, 1.5), y: num(m.y, 0.5, -0.5, 1.5), w: num(m.w, 0.5, 0.02, 2), h: num(m.h, 0.5, 0.02, 2), rot: num(m.rot, 0, -180, 180), soft: num(m.soft, 0.35, 0, 1), inv: !!m.inv };
}
// значення маски 0…1 у точці кадру (u, v від лівого верхнього кута, 0…1); aspect = ширина / висота кадру
export function maskValue(m, u, v, aspect = 16 / 9) {
  if (!m) return 1;
  let px = (u - m.x) * aspect, py = v - m.y; const a = -m.rot * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
  [px, py] = [px * c - py * sn, px * sn + py * c];
  const hx = Math.max(1e-3, m.w * aspect * 0.5), hy = Math.max(1e-3, m.h * 0.5), s_ = Math.max(0.02, m.soft);
  let r;
  if (m.type === 'ellipse') r = 1 - sstep(1 - s_, 1, Math.hypot(px / hx, py / hy));
  else if (m.type === 'rect') r = 1 - sstep(1 - s_, 1, Math.max(Math.abs(px) / hx, Math.abs(py) / hy));
  else r = 1 - sstep(-s_, s_, py / hy);
  return m.inv ? 1 - r : r;
}

/* ═════════ ключові кадри параметрів ═════════
   node.kf = { 'p.exp': [[t, v], …], 'mask.x': […] }, t — секунди від початку кліпа. Між ключами значення змінюється лінійно (тому розріз і обрізання кліпа нічого не псують), поза ними тримається. */
const KF_PATH = /^(p|mask)(\.[a-zA-Z0-9]+){1,2}$/;
export const getPath = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
export function setPath(o, path, v) { const ks = path.split('.'), last = ks.pop(); let a = o; for (const k of ks) { if (a[k] == null) return false; a = a[k]; } if (a[last] === undefined) return false; a[last] = v; return true; }
// Зіставлення кольору: вирівнюємо розподіл яскравості кожного каналу кадру src за кадром ref (відповідність гістограм).
// Повертає криві r, g, b (9 точок) із силою strength 0…1 — готові для вузла «Криві».
export function matchCurves(src, ref, strength = 0.85, pts = 9) {
  const cdf = d => { const out = [0, 1, 2].map(() => new Float64Array(256)); const n = d.length / 4; for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) out[c][d[i + c]]++; for (const h of out) { let a = 0; for (let k = 0; k < 256; k++) { a += h[k]; h[k] = a / n; } } return out; };
  const S = cdf(src), R = cdf(ref), res = {};
  ['r', 'g', 'b'].forEach((ch, c) => {
    const map = new Float64Array(256); let j = 0;
    for (let v = 0; v < 256; v++) { while (j < 255 && R[c][j] < S[c][v] - 1e-9) j++; map[v] = j / 255; }
    const out = [];
    for (let i = 0; i < pts; i++) {
      const x = i / (pts - 1), v = Math.round(x * 255);
      // згладжуємо: середнє по сусідніх рівнях, щоб крива не мала сходинок
      let a = 0, n = 0; for (let k = Math.max(0, v - 6); k <= Math.min(255, v + 6); k++) { a += map[k]; n++; }
      let y = x + (a / n - x) * strength; y = Math.min(1, Math.max(0, y));
      if (out.length && y < out[out.length - 1][1]) y = out[out.length - 1][1];
      out.push([+x.toFixed(4), +y.toFixed(4)]);
    }
    out[0][0] = 0; out[out.length - 1][0] = 1;
    res[ch] = out;
  });
  return res;
}
export const hasKf = n => !!n.kf && Object.keys(n.kf).length > 0;
export function kfValue(keys, t) {
  if (!keys.length) return undefined;
  if (t <= keys[0][0]) return keys[0][1]; if (t >= keys[keys.length - 1][0]) return keys[keys.length - 1][1];
  let i = 0; while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const [t0, v0] = keys[i], [t1, v1] = keys[i + 1]; return v0 + (v1 - v0) * ((t - t0) / ((t1 - t0) || 1e-6));  // лінійно: розріз і обрізання кліпа не змінюють форму переходу
}
export function kfSet(n, path, t, v) {
  const keys = ((n.kf ||= {})[path] ||= []); const i = keys.findIndex(k => Math.abs(k[0] - t) < 0.04);
  if (i >= 0) keys[i] = [keys[i][0], v]; else { keys.push([Math.max(0, +t.toFixed(3)), v]); keys.sort((a, b) => a[0] - b[0]); }
}
export function kfRemove(n, path, t) {
  const keys = n.kf?.[path]; if (!keys) return; const i = keys.findIndex(k => Math.abs(k[0] - t) < 0.04); if (i >= 0) keys.splice(i, 1);
  if (!keys.length) { delete n.kf[path]; if (!Object.keys(n.kf).length) delete n.kf; }
}
export const kfAt = (n, path, t) => !!n.kf?.[path]?.some(k => Math.abs(k[0] - t) < 0.04);
// усі моменти ключових кадрів вузла (для смужки під кадром)
export const kfTimes = n => [...new Set(Object.values(n.kf || {}).flatMap(a => a.map(k => +k[0].toFixed(3))))].sort((a, b) => a - b);
// граф у момент t (секунди від початку кліпа): значення з ключів підставлено у копію
export function animatedGraph(cg, t) {
  if (!cg || !cg.nodes.some(hasKf)) return cg;
  return { ...cg, nodes: cg.nodes.map(n => {
    if (!hasKf(n)) return n;
    const m = { ...n, p: JSON.parse(JSON.stringify(n.p)), ...(n.mask ? { mask: { ...n.mask } } : {}) };
    for (const [path, keys] of Object.entries(n.kf)) { const v = kfValue(keys, t); if (v !== undefined) setPath(m, path, v); }
    return m;
  }) };
}
// розріз кліпа: ключі графа діляться між половинами (b — копія a); на межі з'являється ключ зі значенням у точці розрізу
export function splitGraphKf(a, b, cut) {
  if (!a || !b) return;
  a.nodes.forEach((na, i) => {
    const nb = b.nodes[i]; if (!hasKf(na) || !nb) return;
    for (const [path, keys] of Object.entries(na.kf)) {
      const v = kfValue(keys, cut);
      na.kf[path] = [...keys.filter(k => k[0] < cut - 0.02), [cut, v]];
      nb.kf = nb.kf || {}; nb.kf[path] = [[0, v], ...keys.filter(k => k[0] > cut + 0.02).map(k => [k[0] - cut, k[1]])];
    }
  });
}
// початок кліпа змінено на dt секунд (dt > 0 — відрізано, dt < 0 — наростили): ключі зсуваються, анімація лишається прив'язаною до вмісту
export function shiftGraphKf(cg, dt) {
  if (!cg || !dt) return;
  for (const n of cg.nodes) if (hasKf(n)) for (const [path, keys] of Object.entries(n.kf)) {
    n.kf[path] = dt > 0 ? [[0, kfValue(keys, dt)], ...keys.filter(k => k[0] > dt + 0.02).map(k => [k[0] - dt, k[1]])] : keys.map(k => [k[0] - dt, k[1]]);
  }
}
// швидкість кліпа змінилась: тривалість обернено пропорційна, тож час ключів множимо на f = стара швидкість / нова
export function scaleGraphKf(cg, f) {
  if (!cg || !Number.isFinite(f) || Math.abs(f - 1) < 1e-6 || f <= 0) return;
  for (const n of cg.nodes) if (hasKf(n)) for (const keys of Object.values(n.kf)) for (const k of keys) k[0] = +(k[0] * f).toFixed(4);
}
// статичний граф зі значеннями на момент t (для стоп-кадру)
export function freezeGraph(cg, t) {
  if (!cg) return undefined;
  const g = JSON.parse(JSON.stringify(animatedGraph(cg, t))); for (const n of g.nodes) delete n.kf; return g;
}
function fixKf(kf) {
  if (!isObj(kf)) return undefined; const out = {};
  for (const [path, keys] of Object.entries(kf).slice(0, 14)) {
    if (!KF_PATH.test(path) || !Array.isArray(keys)) continue;
    const k = keys.filter(q => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1])).map(q => [Math.max(0, q[0]), q[1]]).sort((a, b) => a[0] - b[0]).slice(0, 40);
    if (k.length) out[path] = k;
  }
  return Object.keys(out).length ? out : undefined;
}

let idn = 0;
export const nodeId = () => 'n' + Date.now().toString(36).slice(-4) + (idn++).toString(36) + Math.random().toString(36).slice(2, 5);
export const newNode = (type, x = 0, y = 0) => ({ id: nodeId(), type, x, y, p: DEFAULTS[type]() });
export function newGraph() {
  const a = { id: 'in', type: 'in', x: 20, y: 40, p: {} }, b = { id: 'out', type: 'out', x: 520, y: 40, p: { amount: 1 } };
  const p = { ...newNode('prim', 200, 40), id: 'prim1' };
  return { v: 1, nodes: [a, p, b], links: [{ from: 'in', to: 'prim1', port: 0 }, { from: 'prim1', to: 'out', port: 0 }] };
}

/* ═════════ перевірка й ремонт (проєкт може бути старим чи пошкодженим) ═════════ */
const wheelFix = (w, d) => (isObj(w) ? { x: num(w.x, 0, -1, 1), y: num(w.y, 0, -1, 1), l: num(w.l, 0, -1, 1) } : d);
const ptsFix = (a, d) => {
  if (!Array.isArray(a)) return d;
  const pts = a.filter(q => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1])).map(q => [clamp01(q[0]), clamp01(q[1])]).sort((m, n) => m[0] - n[0]);
  const out = []; for (const q of pts) if (!out.length || q[0] - out[out.length - 1][0] > 0.01) out.push(q);
  if (out.length < 2) return d;
  out[0] = [0, out[0][1]]; out[out.length - 1] = [1, out[out.length - 1][1]];
  return out.slice(0, 16);
};
function fixParams(type, p) {
  const d = DEFAULTS[type](); p = isObj(p) ? p : {};
  if (type === 'prim') return { lift: wheelFix(p.lift, d.lift), gamma: wheelFix(p.gamma, d.gamma), gain: wheelFix(p.gain, d.gain), offset: wheelFix(p.offset, d.offset), exp: num(p.exp, 0, -4, 4), con: num(p.con, 1, 0, 3), sat: num(p.sat, 1, 0, 3), temp: num(p.temp, 0, -1, 1), tint: num(p.tint, 0, -1, 1), hi: num(p.hi, 0, -1, 1), sh: num(p.sh, 0, -1, 1) };
  if (type === 'curves') return { m: ptsFix(p.m, d.m), r: ptsFix(p.r, d.r), g: ptsFix(p.g, d.g), b: ptsFix(p.b, d.b) };
  if (type === 'hsl') return { hue: num(p.hue, 30, 0, 360), width: num(p.width, 60, 1, 360), smin: num(p.smin, 0.15, 0, 1), smax: num(p.smax, 1, 0, 1), lmin: num(p.lmin, 0, 0, 1), lmax: num(p.lmax, 1, 0, 1), soft: num(p.soft, 0.4, 0, 1), dh: num(p.dh, 0, -180, 180), ds: num(p.ds, 1, 0, 3), dl: num(p.dl, 0, -1, 1), inv: !!p.inv, amount: num(p.amount, 1, 0, 1) };
  if (type === 'lut') return { lut: typeof p.lut === 'string' ? p.lut.slice(0, 40) : null, mix: num(p.mix, 1, 0, 1) };
  if (type === 'fx') return { vig: num(p.vig, 0, 0, 1), vigSize: num(p.vigSize, 0.55, 0.1, 1), grain: num(p.grain, 0, 0, 1), glow: num(p.glow, 0, 0, 1), fade: num(p.fade, 0, 0, 1) };
  if (type === 'mix') return { mode: MIX_ID.includes(p.mode) ? p.mode : 'normal', amount: num(p.amount, 0.5, 0, 1) };
  if (type === 'out') return { amount: num(p.amount, 1, 0, 1) };
  return {};
}
// повертає справний граф або undefined
export function repairGraph(cg) {
  if (!isObj(cg) || !Array.isArray(cg.nodes)) return undefined;
  const seen = new Set(), nodes = [];
  for (const n of cg.nodes.slice(0, 40)) {
    if (!isObj(n) || typeof n.id !== 'string' || !NODE_TYPES[n.type] || seen.has(n.id)) continue;
    seen.add(n.id);
    nodes.push({ id: n.id.slice(0, 24), type: n.type, x: num(n.x, 0, -5000, 5000), y: num(n.y, 0, -5000, 5000), ...(n.off ? { off: true } : {}), ...(typeof n.label === 'string' && n.label.trim() ? { label: n.label.trim().slice(0, 24) } : {}), ...(MASKABLE.includes(n.type) && fixMask(n.mask) ? { mask: fixMask(n.mask) } : {}), ...(fixKf(n.kf) && n.type !== 'in' ? { kf: fixKf(n.kf) } : {}), p: fixParams(n.type, n.p) });
  }
  if (nodes.filter(n => n.type === 'in').length !== 1 || nodes.filter(n => n.type === 'out').length !== 1) return undefined;
  const ids = new Set(nodes.map(n => n.id)), links = [], used = new Set();
  const out = new Map(nodes.map(n => [n.id, []]));
  for (const l of Array.isArray(cg.links) ? cg.links : []) {
    if (!isObj(l) || !ids.has(l.from) || !ids.has(l.to) || l.from === l.to) continue;
    const to = nodes.find(n => n.id === l.to), port = l.port === 1 ? 1 : 0;
    if (to.type === 'in' || port >= NODE_TYPES[to.type].ins) continue;
    if (nodes.find(n => n.id === l.from).type === 'out') continue;
    const key = l.to + ':' + port; if (used.has(key)) continue;
    // не допускаємо циклів
    const reach = new Set(); const st = [l.to]; while (st.length) { const c = st.pop(); if (reach.has(c)) continue; reach.add(c); st.push(...(out.get(c) || [])); }
    if (reach.has(l.from)) continue;
    used.add(key); links.push({ from: l.from, to: l.to, port }); out.get(l.from).push(l.to);
  }
  return { v: 1, nodes, links };
}

/* ═════════ порядок обчислення й «нейтральність» ═════════ */
const inputOf = (cg, id, port = 0) => cg.links.find(l => l.to === id && l.port === port)?.from || null;
// вузли, що впливають на вихід, у порядку обчислення
export function graphOrder(cg) {
  const out = cg.nodes.find(n => n.type === 'out'), seen = new Set(), order = [];
  const visit = id => {
    if (!id || seen.has(id)) return; seen.add(id);
    const n = cg.nodes.find(x => x.id === id); if (!n) return;
    for (let p = 0; p < NODE_TYPES[n.type].ins; p++) visit(inputOf(cg, id, p));
    order.push(n);
  };
  visit(out.id); return order;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const wz = w => Math.abs(w.x) < 1e-4 && Math.abs(w.y) < 1e-4 && Math.abs(w.l) < 1e-4;
export function nodeNeutral(n) {
  if (n.off) return true;
  if (hasKf(n)) return false;
  const p = n.p;
  switch (n.type) {
    case 'prim': return wz(p.lift) && wz(p.gamma) && wz(p.gain) && wz(p.offset) && !p.exp && p.con === 1 && p.sat === 1 && !p.temp && !p.tint && !p.hi && !p.sh;
    case 'curves': return ['m', 'r', 'g', 'b'].every(k => p[k].length === 2 && same(p[k], [[0, 0], [1, 1]]));
    case 'hsl': return p.amount <= 0.001 || (!p.dh && p.ds === 1 && !p.dl);
    case 'lut': return !p.lut || p.mix <= 0.001;
    case 'fx': return !p.vig && !p.grain && !p.glow && !p.fade;
    case 'mix': return p.amount <= 0.001;
    default: return true;
  }
}
// граф нічого не змінює — рендер можна пропустити
export function isIdentityGraph(cg) {
  if (!cg) return true;
  return graphOrder(cg).every(n => n.type === 'in' || n.type === 'out' || nodeNeutral(n));
}

/* ═════════ математика (однакова в JS-еталоні й у шейдері) ═════════ */
export const hsv2rgb = (h, s, v) => { const k = n => (n + h * 6) % 6; const f = n => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1)); return [f(5), f(3), f(1)]; };
export function rgb2hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d > 1e-6) { if (mx === r) h = ((g - b) / d + 6) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; }
  return [h, mx > 1e-6 ? d / mx : 0, mx];
}
// колесо → зсув кольору RGB (сума компонент нуль) + загальний рівень
export function wheelRGB(w, amp = 0.35) {
  const r = Math.min(1, Math.hypot(w.x, w.y)); if (r < 1e-6 && !w.l) return [0, 0, 0];
  const h = ((Math.atan2(w.y, w.x) / (2 * Math.PI)) + 1) % 1, v = hsv2rgb(h, 1, 1), m = (v[0] + v[1] + v[2]) / 3;
  return v.map(c => (c - m) * r * amp * 1.5 + w.l * amp * 1.4);
}
export const LUMA = [0.2126, 0.7152, 0.0722];
const luma = c => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];

// монотонна кубічна крива (Фрітч—Карлсон) → таблиця з 256 значень
export function curveTable(pts, n = 256) {
  const k = pts.length, x = pts.map(q => q[0]), y = pts.map(q => q[1]), d = [], m = new Array(k).fill(0);
  for (let i = 0; i < k - 1; i++) d.push((y[i + 1] - y[i]) / ((x[i + 1] - x[i]) || 1e-6));
  m[0] = d[0]; m[k - 1] = d[k - 2];
  for (let i = 1; i < k - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < k - 1; i++) { if (Math.abs(d[i]) < 1e-9) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b; if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; } }
  const out = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const t = j / (n - 1); let i = 0; while (i < k - 2 && t > x[i + 1]) i++;
    const h = (x[i + 1] - x[i]) || 1e-6, u = (t - x[i]) / h, u2 = u * u, u3 = u2 * u;
    out[j] = clamp01((2 * u3 - 3 * u2 + 1) * y[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * y[i + 1] + (u3 - u2) * h * m[i + 1]);
  }
  return out;
}
const curveRGB = p => { const M = curveTable(p.m), R = curveTable(p.r), G = curveTable(p.g), B = curveTable(p.b); const f = (T, v) => { const t = clamp01(v) * 255, i = Math.min(254, Math.floor(t)); return T[i] + (T[i + 1] - T[i]) * (t - i); }; return [R, G, B].map(T => v => f(T, f(M, v))); };

/* ═════════ еталон на CPU (для перевірки шейдерів і тестів) ═════════ */
function cpuPrim(c, p) {
  const lift = wheelRGB(p.lift), gamma = wheelRGB(p.gamma), gain = wheelRGB(p.gain, 0.5), off = wheelRGB(p.offset, 0.25);
  let v = c.map(x => x * 2 ** p.exp);
  v = v.map((x, i) => x + lift[i] * (1 - x));
  v = v.map((x, i) => x * (1 + gain[i]));
  v = v.map((x, i) => Math.max(0, x + off[i]));
  v = v.map((x, i) => Math.pow(x, 1 / Math.max(0.1, 1 + gamma[i] * 2)));
  v = [v[0] * (1 + p.temp * 0.2), v[1] * (1 - p.tint * 0.15), v[2] * (1 - p.temp * 0.2)];
  const y = luma(v);
  const fs = 1 + p.sh * 0.6 * (1 - sstep(0, 0.5, y)), fh = 1 + p.hi * 0.6 * sstep(0.5, 1, y);
  v = v.map(x => x * fs * fh);
  v = v.map(x => (x - 0.5) * p.con + 0.5);
  const y2 = luma(v); return v.map(x => y2 + (x - y2) * p.sat);
}
const hueBand = (h, hc, hw, soft) => { let d = Math.abs(h - hc); d = Math.min(d, 1 - d); const half = hw / 2, sf = soft * half * 0.8 + 1e-3; return 1 - sstep(half - sf, half + sf, d); };
const bandV = (x, lo, hi, soft) => { const sf = soft * 0.2 + 1e-3; return sstep(lo - sf, lo + sf, x) * (1 - sstep(hi - sf, hi + sf, x)); };
export function hslMask(c, p) {
  const [h, s] = rgb2hsv(clamp01(c[0]), clamp01(c[1]), clamp01(c[2])), y = luma(c);
  let m = hueBand(h, p.hue / 360, p.width / 360, p.soft) * bandV(s, p.smin, p.smax, p.soft) * bandV(y, p.lmin, p.lmax, p.soft);
  return p.inv ? 1 - m : m;
}
function cpuHsl(c, p) {
  const m = hslMask(c, p) * p.amount; if (m <= 0) return c;
  let [h, s, v] = rgb2hsv(clamp01(c[0]), clamp01(c[1]), clamp01(c[2]));
  h = (h + p.dh / 360 + 1) % 1; s = Math.min(1, s * p.ds); v = clamp01(v + p.dl * 0.5);
  const a = hsv2rgb(h, s, v); return c.map((x, i) => x + (a[i] - x) * m);
}
function blendMode(a, b, mode) {
  switch (mode) {
    case 'add': return a + b;
    case 'multiply': return a * b;
    case 'screen': return 1 - (1 - a) * (1 - b);
    case 'overlay': return a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b);
    case 'soft': return (1 - 2 * b) * a * a + 2 * b * a;
    case 'diff': return Math.abs(a - b);
    default: return b;
  }
}
// граф для одного пікселя (RGB 0…1); luts — S.project.luts
export function evalPixel(cg, rgb, luts = [], pos = null) {
  const memo = new Map();
  const ev = id => {
    if (memo.has(id)) return memo.get(id);
    const n = cg.nodes.find(x => x.id === id); let r;
    const a = () => { const f = inputOf(cg, id, 0); return f ? ev(f) : evInput(); };
    if (n.type === 'in') r = rgb.slice();
    else if (n.type === 'out') { const A = a().map(clamp01), k = n.p.amount ?? 1; r = A.map((v, i) => rgb[i] + (v - rgb[i]) * k); }
    else if (n.off || nodeNeutral(n)) r = n.type === 'mix' ? a() : a();
    else if (n.type === 'prim') r = cpuPrim(a(), n.p);
    else if (n.type === 'curves') { const f = curveRGB(n.p); const c = a(); r = c.map((v, i) => f[i](v)); }
    else if (n.type === 'hsl') r = cpuHsl(a(), n.p);
    else if (n.type === 'mix') { const A = a(), fb = inputOf(cg, id, 1), B = fb ? ev(fb) : A; r = A.map((v, i) => v + (blendMode(v, B[i], n.p.mode) - v) * n.p.amount); }
    else if (n.type === 'fx') r = a().map(v => v * (1 - n.p.fade * 0.15) + n.p.fade * 0.08);
    else r = a();
    if (n.mask && !n.off && !nodeNeutral(n) && pos) { const base = a(), k = maskValue(n.mask, pos.u, pos.v, pos.aspect); r = base.map((v, i) => v + (r[i] - v) * k); }
    memo.set(id, r); return r;
  };
  const evInput = () => rgb.slice();
  return ev(cg.nodes.find(n => n.type === 'out').id).map(clamp01);
}

/* ═════════ GPU (WebGL2) ═════════ */
const VS = `#version 300 es
in vec2 p; out vec2 vUv; void main(){ vUv=p*.5+.5; gl_Position=vec4(p,0.,1.); }`;
const HEAD = `#version 300 es
precision highp float; precision highp sampler3D; in vec2 vUv; out vec4 o;
uniform sampler2D uA,uB,uC; uniform sampler3D uL; uniform vec2 uPx; uniform float uSeed;
const vec3 LU=vec3(.2126,.7152,.0722);
vec3 hsv2rgb(float h,float s,float v){ vec3 k=mod(vec3(5.,3.,1.)+h*6.,6.); return v-v*s*clamp(min(k,4.-k),0.,1.); }
vec3 rgb2hsv(vec3 c){ float mx=max(c.r,max(c.g,c.b)),mn=min(c.r,min(c.g,c.b)),d=mx-mn,h=0.;
  if(d>1e-6){ if(mx==c.r) h=mod((c.g-c.b)/d+6.,6.); else if(mx==c.g) h=(c.b-c.r)/d+2.; else h=(c.r-c.g)/d+4.; h/=6.; }
  return vec3(h,mx>1e-6?d/mx:0.,mx); }
`;
const FS = {
  in: HEAD + `void main(){ o=vec4(texture(uA,vec2(vUv.x,1.-vUv.y)).rgb,1.); }`,
  copy: HEAD + `void main(){ o=vec4(texture(uA,vUv).rgb,1.); }`,
  out: HEAD + `uniform float uSplit,uAmt; void main(){ vec3 inp=clamp(texture(uB,vUv).rgb,0.,1.); vec3 c=mix(inp,clamp(texture(uA,vUv).rgb,0.,1.),uAmt); if(vUv.x<uSplit) c=inp; o=vec4(c,1.); }`,
  prim: HEAD + `uniform vec3 uLift,uGamma,uGain,uOff; uniform float uExp,uCon,uSat,uTemp,uTint,uHi,uSh;
void main(){ vec3 c=texture(uA,vUv).rgb; c*=exp2(uExp); c+=uLift*(1.-c); c*=1.+uGain; c=max(c+uOff,0.);
  c=pow(c,1./max(vec3(.1),1.+uGamma*2.)); c*=vec3(1.+uTemp*.2,1.-uTint*.15,1.-uTemp*.2);
  float y=dot(c,LU); c*=(1.+uSh*.6*(1.-smoothstep(0.,.5,y)))*(1.+uHi*.6*smoothstep(.5,1.,y));
  c=(c-.5)*uCon+.5; float y2=dot(c,LU); c=mix(vec3(y2),c,uSat); o=vec4(c,1.); }`,
  curves: HEAD + `void main(){ vec3 c=clamp(texture(uA,vUv).rgb,0.,1.); vec2 u=c.rr*(255./256.)+.5/256.;
  o=vec4(texture(uC,vec2(c.r*(255./256.)+.5/256.,.5)).r,texture(uC,vec2(c.g*(255./256.)+.5/256.,.5)).g,texture(uC,vec2(c.b*(255./256.)+.5/256.,.5)).b,1.); }`,
  hsl: HEAD + `uniform float uHue,uHw,uSmin,uSmax,uLmin,uLmax,uSoft,uDh,uDs,uDl,uInv,uAmt,uShow;
float band(float x,float lo,float hi,float s){ float sf=s*.2+1e-3; return smoothstep(lo-sf,lo+sf,x)*(1.-smoothstep(hi-sf,hi+sf,x)); }
void main(){ vec3 c=texture(uA,vUv).rgb; vec3 q=rgb2hsv(clamp(c,0.,1.)); float y=dot(c,LU);
  float d=abs(q.x-uHue); d=min(d,1.-d); float half_=uHw*.5, sf=uSoft*half_*.8+1e-3; float hm=1.-smoothstep(half_-sf,half_+sf,d);
  float m=hm*band(q.y,uSmin,uSmax,uSoft)*band(y,uLmin,uLmax,uSoft); m=mix(m,1.-m,uInv);
  if(uShow>.5){ o=vec4(vec3(m),1.); return; }
  m*=uAmt; vec3 a=hsv2rgb(mod(q.x+uDh+1.,1.),min(1.,q.y*uDs),clamp(q.z+uDl*.5,0.,1.)); o=vec4(mix(c,a,m),1.); }`,
  lut: HEAD + `uniform float uMix;
void main(){ vec3 c=texture(uA,vUv).rgb; vec3 cc=clamp(c,0.,1.); vec3 l=texture(uL,cc).rgb; o=vec4(mix(c,l,uMix),1.); }`,
  fx: HEAD + `uniform float uVig,uVsz,uGrain,uGlow,uFade;
float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
void main(){ vec3 c=texture(uA,vUv).rgb;
  if(uGlow>0.){ vec3 s=vec3(0.); float w=0.; for(int i=0;i<12;i++){ float a=float(i)*.5236; for(int j=1;j<=2;j++){ vec2 off=vec2(cos(a)*uPx.x/uPx.y,sin(a))*float(j)*.0085; vec3 t=texture(uA,vUv+off).rgb; float k=smoothstep(.55,1.,dot(t,LU)); s+=t*k; w+=1.; } } c+=s/w*uGlow*1.4; }
  float d=distance(vUv,vec2(.5))*1.414; c*=1.-uVig*smoothstep(uVsz,1.1,d);
  c+=(hash(floor(vUv*vec2(1280.,720.))*.37+uSeed)-.5)*uGrain*.18; c=c*(1.-uFade*.15)+uFade*.08; o=vec4(c,1.); }`,
  maskmix: HEAD + `uniform float uShape,uSoft,uInv,uAsp; uniform vec4 uM; uniform float uRot;
void main(){ vec3 a=texture(uA,vUv).rgb,b=texture(uB,vUv).rgb;
  vec2 p=(vec2(vUv.x,1.-vUv.y)-uM.xy)*vec2(uAsp,1.); float ca=cos(-uRot),sa=sin(-uRot); p=vec2(p.x*ca-p.y*sa,p.x*sa+p.y*ca);
  float hx=max(1e-3,uM.z*uAsp*.5),hy=max(1e-3,uM.w*.5),s=max(.02,uSoft),r;
  if(uShape<1.5) r=1.-smoothstep(1.-s,1.,length(p/vec2(hx,hy)));
  else if(uShape<2.5) r=1.-smoothstep(1.-s,1.,max(abs(p.x)/hx,abs(p.y)/hy));
  else r=1.-smoothstep(-s,s,p.y/hy);
  r=mix(r,1.-r,uInv); o=vec4(mix(a,b,r),1.); }`,
  mix: HEAD + `uniform float uAmt,uMode;
vec3 bl(vec3 a,vec3 b,int m){ if(m==1) return a+b; if(m==2) return a*b; if(m==3) return 1.-(1.-a)*(1.-b);
  if(m==4) return mix(2.*a*b,1.-2.*(1.-a)*(1.-b),step(.5,a)); if(m==5) return (1.-2.*b)*a*a+2.*b*a; if(m==6) return abs(a-b); return b; }
void main(){ vec3 a=texture(uA,vUv).rgb,b=texture(uB,vUv).rgb; o=vec4(mix(a,bl(a,b,int(uMode+.5)),uAmt),1.); }`,
};

class GPU {
  constructor() { this.cv = null; this.gl = null; this.broken = false; this.pool = []; this.progs = {}; this.tex = {}; this.fmt = null; this.size = [0, 0]; }
  init() {
    if (this.gl || this.broken) return !!this.gl;
    try {
      const cv = typeof OffscreenCanvas !== 'undefined' && false ? new OffscreenCanvas(2, 2) : document.createElement('canvas');
      const gl = cv.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
      if (!gl) throw new Error('WebGL2 недоступний');
      this.cv = cv; this.gl = gl;
      this.half = !!gl.getExtension('EXT_color_buffer_float');
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.fbo = gl.createFramebuffer();
      this.src = this.mkTex(); this.curveTex = this.mkTex();
      cv.addEventListener('webglcontextlost', e => { e.preventDefault(); this.gl = null; this.progs = {}; this.pool = []; this.lutCache = null; this.curveKey = null; this.size = [0, 0]; });
      return true;
    } catch (e) { console.warn('Колір: WebGL2 недоступний, колірний граф не застосовується', e); this.broken = true; return false; }
  }
  mkTex(filter = this.gl.LINEAR) { const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return t; }
  prog(name) {
    if (this.progs[name]) return this.progs[name];
    const gl = this.gl, sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(name + ': ' + gl.getShaderInfoLog(x)); return x; };
    const pr = gl.createProgram(); gl.bindAttribLocation(pr, 0, 'p'); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS[name]));
    gl.linkProgram(pr); if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    const u = {}; const n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(pr, i); u[a.name] = gl.getUniformLocation(pr, a.name); }
    return (this.progs[name] = { pr, u });
  }
  // тимчасова текстура-ціль потрібного розміру (пул, щоб не створювати щокадру)
  take(W, H) {
    const gl = this.gl;
    if (this.size[0] !== W || this.size[1] !== H) { for (const t of this.pool) gl.deleteTexture(t.t); this.pool = []; this.size = [W, H]; }
    let e = this.pool.find(x => !x.busy);
    if (!e) {
      const t = this.mkTex(gl.NEAREST); gl.bindTexture(gl.TEXTURE_2D, t);
      if (this.half) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, W, H, 0, gl.RGBA, gl.HALF_FLOAT, null); else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      e = { t, busy: false }; this.pool.push(e);
    }
    e.busy = true; return e;
  }
  curves(p) {
    const gl = this.gl, key = JSON.stringify(p); if (this.curveKey === key) return;
    const M = curveTable(p.m), R = curveTable(p.r), G = curveTable(p.g), B = curveTable(p.b), d = new Uint8Array(256 * 4);
    const f = (T, v) => { const t = clamp01(v) * 255, i = Math.min(254, Math.floor(t)); return T[i] + (T[i + 1] - T[i]) * (t - i); };
    for (let i = 0; i < 256; i++) { const v = M[i]; d[i * 4] = Math.round(f(R, v) * 255); d[i * 4 + 1] = Math.round(f(G, v) * 255); d[i * 4 + 2] = Math.round(f(B, v) * 255); d[i * 4 + 3] = 255; }
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.curveTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, d); this.curveKey = key;
  }
  lut3d(lut) {
    const gl = this.gl; if (this.lutCache?.id === lut.id && this.lutCache.b64 === lut.b64) return this.lutCache.tex;
    const e = lutStrip(lut), s = e.size, d = new Uint8Array(s * s * s * 4);
    for (let b = 0; b < s; b++) for (let g = 0; g < s; g++) for (let r = 0; r < s; r++) { const si = (g * s * s + b * s + r) * 4, di = (b * s * s + g * s + r) * 4; d[di] = e.rgba[si]; d[di + 1] = e.rgba[si + 1]; d[di + 2] = e.rgba[si + 2]; d[di + 3] = 255; }
    if (this.lutCache) gl.deleteTexture(this.lutCache.tex);
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, v);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, s, s, s, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
    this.lutCache = { id: lut.id, b64: lut.b64, tex: t }; return t;
  }
  // виконує граф над кадром src (canvas/bitmap). opts.collect — зібрати результат кожного вузла (мініатюри), opts.mask — id вузла HSL, що показує маску
  run(src, cg, W, H, luts, opts = {}) {
    if (!this.init() || !this.gl) return null;
    const gl = this.gl;
    if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; }
    gl.bindVertexArray(this.vao); gl.disable(gl.BLEND); gl.viewport(0, 0, W, H);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const order = graphOrder(cg), res = new Map(), refs = new Map(), inId = cg.nodes.find(n => n.type === 'in').id;
    for (const n of order) for (let p = 0; p < NODE_TYPES[n.type].ins; p++) { const f = inputOf(cg, n.id, p); if (f) refs.set(f, (refs.get(f) || 0) + 1); }
    const collected = opts.collect ? new Map() : null;
    const pass = (name, inA, inB, target, setU) => {
      const P = this.prog(name); gl.useProgram(P.pr);
      if (target) { gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.t, 0); } else gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, inA); if (P.u.uA) gl.uniform1i(P.u.uA, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, inB || inA); if (P.u.uB) gl.uniform1i(P.u.uB, 1);
      if (P.u.uC) gl.uniform1i(P.u.uC, 2); if (P.u.uL) gl.uniform1i(P.u.uL, 3);
      if (P.u.uPx) gl.uniform2f(P.u.uPx, 1 / W, 1 / H); if (P.u.uSeed) gl.uniform1f(P.u.uSeed, opts.seed || 0);
      const u = (k, ...v) => { if (P.u[k] != null) gl['uniform' + v.length + 'f'](P.u[k], ...v); };
      setU?.(u, P);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const showView = tex => pass('out', tex, res.get(inId).tex, null, u => { u('uSplit', 0); u('uAmt', 1); });
    // вхід тримаємо до кінця: він потрібен виходу для «До / Після» і загальної сили
    const release = id => { if (id === inId) return; const r = (refs.get(id) || 0) - 1; refs.set(id, r); if (r <= 0 && res.get(id)?.own) { res.get(id).own.busy = false; } };
    let last = null;
    for (const n of order) {
      const fa = inputOf(cg, n.id, 0), fb = n.type === 'mix' ? inputOf(cg, n.id, 1) : null;
      const A = fa ? res.get(fa) : res.get(inId), Bt = fb ? res.get(fb) : null;
      const isOut = n.type === 'out';
      let outTex, own = null;
      if (n.type === 'in') { own = this.take(W, H); pass('in', this.src, null, own); outTex = own.t; }
      else if (isOut) { pass('out', A.tex, res.get(inId).tex, null, u => { u('uSplit', opts.split || 0); u('uAmt', n.p.amount ?? 1); }); outTex = null; }
      else if (nodeNeutral(n) && !(n.type === 'hsl' && opts.mask === n.id)) { outTex = A.tex; own = null; res.set(n.id, { tex: outTex, own: null }); if (collected) collected.set(n.id, null); if (opts.view === n.id) { showView(outTex); break; } continue; }
      else {
        own = this.take(W, H); const p = n.p;
        const wv = (w, a) => wheelRGB(w, a);
        if (n.type === 'prim') pass('prim', A.tex, null, own, u => { u('uLift', ...wv(p.lift, 0.35)); u('uGamma', ...wv(p.gamma, 0.35)); u('uGain', ...wv(p.gain, 0.5)); u('uOff', ...wv(p.offset, 0.25)); u('uExp', p.exp); u('uCon', p.con); u('uSat', p.sat); u('uTemp', p.temp); u('uTint', p.tint); u('uHi', p.hi); u('uSh', p.sh); });
        else if (n.type === 'curves') { gl.activeTexture(gl.TEXTURE2); this.curves(p); gl.bindTexture(gl.TEXTURE_2D, this.curveTex); pass('curves', A.tex, null, own); }
        else if (n.type === 'hsl') pass('hsl', A.tex, null, own, u => { u('uHue', p.hue / 360); u('uHw', p.width / 360); u('uSmin', p.smin); u('uSmax', p.smax); u('uLmin', p.lmin); u('uLmax', p.lmax); u('uSoft', p.soft); u('uDh', p.dh / 360); u('uDs', p.ds); u('uDl', p.dl); u('uInv', p.inv ? 1 : 0); u('uAmt', p.amount); u('uShow', opts.mask === n.id ? 1 : 0); });
        else if (n.type === 'lut') { const lut = luts.find(l => l.id === p.lut); if (!lut) { pass('copy', A.tex, null, own); } else { gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_3D, this.lut3d(lut)); pass('lut', A.tex, null, own, u => u('uMix', p.mix)); } }
        else if (n.type === 'fx') pass('fx', A.tex, null, own, u => { u('uVig', p.vig); u('uVsz', p.vigSize); u('uGrain', p.grain); u('uGlow', p.glow); u('uFade', p.fade); });
        else if (n.type === 'mix') pass('mix', A.tex, Bt ? Bt.tex : A.tex, own, u => { u('uAmt', p.amount); u('uMode', MIX_ID.indexOf(p.mode)); });
        if (n.mask && MASKABLE.includes(n.type)) {
          const m = n.mask, own2 = this.take(W, H), shape = { ellipse: 1, rect: 2, linear: 3 }[m.type];
          pass('maskmix', A.tex, own.t, own2, u => { u('uShape', shape); u('uSoft', m.soft); u('uInv', m.inv ? 1 : 0); u('uAsp', W / H); u('uM', m.x, m.y, m.w, m.h); u('uRot', m.rot * Math.PI / 180); });
          own.busy = false; own = own2;
        }
        outTex = own.t;
      }
      res.set(n.id, { tex: outTex, own });
      if (opts.view === n.id && !isOut && outTex) { showView(outTex); break; } // «перегляд вузла»: показуємо його вихід і далі не рахуємо
      if (collected && !isOut) collected.set(n.id, this.read(own, W, H));
      if (collected && isOut) collected.set('__out', null);
      if (fa) release(fa); if (fb) release(fb);
      if (!isOut) last = n.id;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (const e of this.pool) e.busy = false;
    return collected || true;
  }
  read(entry, W, H) {
    const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, entry.t, 0);
    if (this.half) { const f = new Float32Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, f); const d = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = ((H - 1 - y) * W + x) * 4, o = (y * W + x) * 4; d[o] = f[s] * 255; d[o + 1] = f[s + 1] * 255; d[o + 2] = f[s + 2] * 255; d[o + 3] = 255; } return new ImageData(d, W, H); }
    const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) d.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4); return new ImageData(d, W, H);
  }
}
const MAIN = new GPU(), SMALL = new GPU();
export const gpuAvailable = () => MAIN.init();
export const __gpu = () => MAIN; // для тестів (імітація втрати контексту)

// застосовує граф до всього вмісту ctx.canvas (перегляд і експорт)
let frameNo = 0;
// Стан вікна «Колір» лише для перегляду: роздільник «До / Після», показ маски HSL, вимкнення корекції. В експорті не діє.
export const COLOR_VIEW = { on: false, split: 0, mask: null, bypass: false, node: null }; // node — показати вихід цього вузла замість результату
export function applyGraph(ctx, W, H, cg, luts = [], opts = {}) {
  const v = !opts.export && COLOR_VIEW.on ? COLOR_VIEW : null;
  if (!cg || v?.bypass) return false;
  cg = animatedGraph(cg, opts.t || 0);
  const mask = v?.mask && cg.nodes.some(n => n.id === v.mask) ? v.mask : null, split = v?.split || 0;
  const view = v?.node && cg.nodes.some(n => n.id === v.node && n.type !== 'out') ? v.node : null;
  if (isIdentityGraph(cg) && !mask && !view) return false;
  const ok = MAIN.run(ctx.canvas, cg, W, H, luts, { seed: (++frameNo % 1000) * 0.137, mask, split, view });
  if (!ok) return false;
  ctx.save(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'copy'; ctx.drawImage(MAIN.cv, 0, 0, W, H); ctx.restore();
  return true;
}
// мініатюри всіх вузлів (для редактора вузлів) і масштабована копія результату для осцилографів
export function renderThumbs(src, cg, luts, w, h, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(src, 0, 0, w, h);
  const m = SMALL.run(c, cg, w, h, luts, { collect: true, seed: 0, ...opts });
  return m instanceof Map ? m : null;
}

/* ═════════ рецепти (готові графи) ═════════ */
const W_ = (a, r, l = 0) => ({ x: Math.cos(a * Math.PI / 180) * r, y: Math.sin(a * Math.PI / 180) * r, l });
const mk = (type, id, x, y, p) => ({ id, type, x, y, p: { ...DEFAULTS[type](), ...p } });
const chain = (nodes) => {
  const ns = [{ id: 'in', type: 'in', x: 20, y: 40, p: {} }, ...nodes, { id: 'out', type: 'out', x: 40 + (nodes.length + 1) * 180, y: 40, p: {} }];
  const links = []; for (let i = 0; i < ns.length - 1; i++) links.push({ from: ns[i].id, to: ns[i + 1].id, port: 0 });
  return { v: 1, nodes: ns, links };
};
export const RECIPES = [
  { id: 'golden', name: 'Золота година', note: 'Теплі світла, м’які тіні', make: () => chain([mk('prim', 'p1', 200, 40, { gain: { x: 0.35, y: 0.1, l: 0.02 }, lift: { x: -0.1, y: -0.25, l: 0 }, temp: 0.3, con: 1.08, sat: 1.12 }), mk('curves', 'c1', 380, 40, { m: [[0, 0.02], [0.5, 0.52], [1, 0.97]] })]) },
  { id: 'cinema', name: 'Холодне кіно', note: 'Бірюзові тіні, оранжеві шкіри', make: () => chain([mk('prim', 'p1', 200, 40, { lift: { x: -0.55, y: 0.3, l: 0 }, gain: { x: 0.45, y: 0.15, l: 0 }, con: 1.12, sat: 0.92, temp: -0.05 }), mk('hsl', 'h1', 380, 40, { hue: 215, width: 80, smin: 0.2, dh: 0.02, ds: 1.2 }), mk('fx', 'f1', 560, 40, { vig: 0.25, grain: 0.15 })]) },
  { id: 'noir', name: 'Нуар', note: 'Чорно-біле, високий контраст', make: () => chain([mk('prim', 'p1', 200, 40, { sat: 0, con: 1.35, exp: -0.1 }), mk('curves', 'c1', 380, 40, { m: [[0, 0], [0.25, 0.16], [0.75, 0.86], [1, 1]] }), mk('fx', 'f1', 560, 40, { vig: 0.5, grain: 0.3 })]) },
  { id: 'retro', name: 'Ретро плівка', note: 'Вицвілі чорні, зерно', make: () => chain([mk('prim', 'p1', 200, 40, { sat: 0.85, con: 0.94, temp: 0.12, tint: 0.08, lift: { x: 0.3, y: 0.35, l: 0.04 } }), mk('curves', 'c1', 380, 40, { r: [[0, 0.04], [1, 0.97]], b: [[0, 0.07], [1, 0.9]] }), mk('fx', 'f1', 560, 40, { grain: 0.45, vig: 0.3, fade: 0.5 })]) },
  { id: 'fresh', name: 'Яскраво й свіжо', note: 'Соковиті кольори, чисті світла', make: () => chain([mk('prim', 'p1', 200, 40, { exp: 0.15, con: 1.1, sat: 1.35, sh: 0.25, hi: -0.15 }), mk('hsl', 'h1', 380, 40, { hue: 120, width: 90, smin: 0.2, ds: 1.25 })]) },
  { id: 'teal', name: 'Небо бірюзове', note: 'Вузол HSL змінює лише небо', make: () => chain([mk('prim', 'p1', 200, 40, { con: 1.06, sat: 1.1 }), mk('hsl', 'h1', 380, 40, { hue: 210, width: 70, smin: 0.2, dh: -0.06, ds: 1.4, dl: -0.05 })]) },
];
export function recipeGraph(id) { const r = RECIPES.find(x => x.id === id); return r ? repairGraph(r.make()) : undefined; }

// розкладка вузлів зліва направо за глибиною у графі
export function tidyGraph(cg, gapX = 200, gapY = 96) {
  const depth = new Map(), order = graphOrder(cg);
  for (const n of order) { let d = 0; for (let p = 0; p < NODE_TYPES[n.type].ins; p++) { const f = inputOf(cg, n.id, p); if (f) d = Math.max(d, (depth.get(f) ?? 0) + 1); } depth.set(n.id, d); }
  const cols = new Map(); for (const n of order) { const d = depth.get(n.id); (cols.get(d) || cols.set(d, []).get(d)).push(n); }
  const h = Math.max(...[...cols.values()].map(c => c.length)), mid = (h - 1) / 2;
  for (const [d, list] of cols) list.forEach((n, i) => { n.x = 24 + d * gapX; n.y = Math.round(24 + (mid - (list.length - 1) / 2 + i) * gapY); });
  // вузли, що не потрапили до виходу, ставимо знизу
  let k = 0; for (const n of cg.nodes) if (!depth.has(n.id)) { n.x = 24 + (k++) * gapX; n.y = Math.round(24 + (h + 0.3) * gapY); }
  return cg;
}
