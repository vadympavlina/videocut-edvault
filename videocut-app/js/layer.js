// Накладання (друга відеодоріжка): відео й картинки поверх основного відео —
// розташування, обрізка країв, форма, рамка, прозорість і малювання на кадрі.
import { media, outputSize } from './state.js';

export const isLayer = o => !!o && (o.type === 'video' || o.type === 'image');
const FULL = { x: 0, y: 0, w: 1, h: 1 };
export const cropOf = o => o.crop || FULL;
export function srcDims(o) {
  const m = media.get(o.mediaId);
  return m && m.width && m.height ? { fw: m.width, fh: m.height } : { fw: 16, fh: 9 };
}

// Видима частина джерела (частки кадру джерела) і масштаб r (пікселів виходу на піксель джерела).
// Якщо пропорції рамки й обрізки не збігаються — рамка заповнюється, зайве ховається по центру.
export function visibleCrop(o, W, H, fw, fh) {
  const c = cropOf(o);
  const bw = Math.abs(o.w) * W, bh = Math.abs(o.h) * H;
  const sw = c.w * fw, sh = c.h * fh;
  const r = Math.max(bw / sw, bh / sh);
  const vw = bw / r, vh = bh / r;
  return { x: (c.x * fw + (sw - vw) / 2) / fw, y: (c.y * fh + (sh - vh) / 2) / fh, w: vw / fw, h: vh / fh, r };
}
// обрізка всередині c, що має пропорції aspect (ширина/висота в пікселях), по центру
function coverCrop(c, fw, fh, aspect) {
  const sw = c.w * fw, sh = c.h * fh;
  let w = sw, h = sh;
  if (sw / sh > aspect) w = sh * aspect; else h = sw / aspect;
  return { x: (c.x * fw + (sw - w) / 2) / fw, y: (c.y * fh + (sh - h) / 2) / fh, w: w / fw, h: h / fh };
}
function normBox(o) {
  if (o.w < 0) { o.x += o.w; o.w = -o.w; }
  if (o.h < 0) { o.y += o.h; o.h = -o.h; }
}

// ── готові розташування ──
export const LAYOUTS = {
  corner: 'У кутку', center: 'По центру', full: 'Весь кадр',
  left: 'Ліва половина', right: 'Права половина', top: 'Верхня половина', bottom: 'Нижня половина',
};
const BOXES = { full: [0, 0, 1, 1], left: [0, 0, 0.5, 1], right: [0.5, 0, 0.5, 1], top: [0, 0, 1, 0.5], bottom: [0, 0.5, 1, 0.5] };
export function applyLayout(o, key) {
  const { W, H } = outputSize();
  const { fw, fh } = srcDims(o);
  if (BOXES[key]) {
    const [x, y, w, h] = BOXES[key];
    Object.assign(o, { x, y, w, h, shape: 'rect', border: 'none', shadow: false });
    o.crop = coverCrop(FULL, fw, fh, (w * W) / (h * H));
    return;
  }
  const circle = o.shape === 'circle';
  const w = key === 'center' ? 0.6 : (o.type === 'video' ? 0.3 : 0.24);
  let h = circle ? w * W / H : w * W * (fh / fw) / H;
  let ww = w;
  if (h > 0.9) { ww = w * 0.9 / h; h = 0.9; }
  o.w = ww; o.h = h;
  o.crop = circle ? coverCrop(FULL, fw, fh, 1) : { ...FULL };
  if (key === 'center') { o.x = (1 - ww) / 2; o.y = (1 - h) / 2; }
  else { o.x = 0.97 - ww; o.y = o.type === 'image' ? 0.05 : 0.95 - h; } // картинка (логотип) — вгорі праворуч
  if (o.type === 'video' && o.shadow === false) o.shadow = true;
}
export function layoutOf(o) {
  const near = (a, b) => Math.abs(a - b) < 0.01;
  for (const [k, [x, y, w, h]] of Object.entries(BOXES)) if (near(o.x, x) && near(o.y, y) && near(o.w, w) && near(o.h, h)) return k;
  if (near(o.x + o.w / 2, 0.5) && near(o.y + o.h / 2, 0.5)) return 'center';
  return '';
}
export function cornerTo(o, v) {
  o.x = v.includes('l') ? 0.03 : 0.97 - o.w;
  o.y = v.includes('t') ? 0.05 : 0.95 - o.h;
}

export function setShape(o, shape) {
  const { W, H } = outputSize();
  const { fw, fh } = srcDims(o);
  normBox(o);
  if (shape === 'circle' && o.shape !== 'circle') {
    const vis = visibleCrop(o, W, H, fw, fh);
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    const s = Math.min(o.w * W, o.h * H);
    o.w = s / W; o.h = s / H; o.x = cx - o.w / 2; o.y = cy - o.h / 2;
    o.crop = coverCrop(vis, fw, fh, 1);
  } else if (shape !== 'circle' && o.shape === 'circle') {
    // з кола — повертаємо природні пропорції кадру
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    o.h = Math.min(0.95, o.w * W * (fh / fw) / H);
    o.y = cy - o.h / 2; o.x = cx - o.w / 2;
    o.crop = { ...FULL };
  }
  o.shape = shape;
}

// розмір (частка ширини кадру) зі збереженням центру й пропорцій
export function setScale(o, w) {
  normBox(o);
  const k = w / o.w, cx = o.x + o.w / 2, cy = o.y + o.h / 2;
  o.w *= k; o.h *= k; o.x = cx - o.w / 2; o.y = cy - o.h / 2;
}

// Сторони обрізки (частки джерела, що сховані): l, r, t, b
export function cropSides(o) {
  const { W, H } = outputSize();
  const { fw, fh } = srcDims(o);
  const v = visibleCrop(o, W, H, fw, fh);
  return { l: v.x, r: 1 - v.x - v.w, t: v.y, b: 1 - v.y - v.h };
}
// Змінює одну сторону обрізки. Вміст лишається на місці — рухається лише відповідний край рамки.
export function setCropSide(o, side, val) {
  const { W, H } = outputSize();
  const { fw, fh } = srcDims(o);
  normBox(o);
  const v = visibleCrop(o, W, H, fw, fh), r = v.r;
  const s = { l: v.x, r: 1 - v.x - v.w, t: v.y, b: 1 - v.y - v.h };
  const MIN = 0.05;
  if (side === 'l') s.l = Math.max(0, Math.min(1 - s.r - MIN, val));
  if (side === 'r') s.r = Math.max(0, Math.min(1 - s.l - MIN, val));
  if (side === 't') s.t = Math.max(0, Math.min(1 - s.b - MIN, val));
  if (side === 'b') s.b = Math.max(0, Math.min(1 - s.t - MIN, val));
  const nc = { x: s.l, y: s.t, w: 1 - s.l - s.r, h: 1 - s.t - s.b };
  const bx = o.x * W, by = o.y * H, bw = o.w * W, bh = o.h * H;
  const dL = (nc.x - v.x) * fw * r, dR = (nc.x + nc.w - v.x - v.w) * fw * r;
  const dT = (nc.y - v.y) * fh * r, dB = (nc.y + nc.h - v.y - v.h) * fh * r;
  // у дзеркальному відео лівий край джерела показано праворуч
  const left = o.flip ? bx - dR : bx + dL, right = o.flip ? bx + bw - dL : bx + bw + dR;
  o.x = left / W; o.w = (right - left) / W;
  o.y = (by + dT) / H; o.h = (bh - dT + dB) / H;
  o.crop = nc;
}
// перетягування бокового маркера на перегляді: a — стан до початку, dx/dy — зсув у частках кадру
export function cropDrag(o, a, mode, dx, dy) {
  Object.assign(o, { x: a.x, y: a.y, w: a.w, h: a.h, crop: a.crop ? { ...a.crop } : undefined });
  const { W, H } = outputSize();
  const { fw, fh } = srcDims(o);
  const v = visibleCrop(o, W, H, fw, fh);
  const s = cropSides(o);
  const ux = dx * W / (fw * v.r), uy = dy * H / (fh * v.r); // зсув у частках джерела
  if (mode === 'e') { if (o.flip) setCropSide(o, 'l', s.l - ux); else setCropSide(o, 'r', s.r - ux); }
  else if (mode === 'w') { if (o.flip) setCropSide(o, 'r', s.r + ux); else setCropSide(o, 'l', s.l + ux); }
  else if (mode === 'n') setCropSide(o, 't', s.t + uy);
  else if (mode === 's') setCropSide(o, 'b', s.b - uy);
}
export function resetCrop(o) {
  const { W, H } = outputSize();
  const { fw, fh } = srcDims(o);
  normBox(o);
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
  if (o.shape === 'circle') o.crop = coverCrop(FULL, fw, fh, (o.w * W) / (o.h * H));
  else {
    o.crop = { ...FULL };
    o.h = o.w * W * (fh / fw) / H;
    if (o.h > 1) { o.w /= o.h; o.h = 1; }
  }
  o.x = cx - o.w / 2; o.y = cy - o.h / 2;
}

// ── малювання ──
function rrect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
export function drawLayer(ctx, o, f, W, H, k) {
  let bx = o.x * W, by = o.y * H, bw = o.w * W, bh = o.h * H;
  if (bw < 0) { bx += bw; bw = -bw; } if (bh < 0) { by += bh; bh = -bh; }
  if (bw < 1 || bh < 1) return;
  const video = o.type === 'video';
  const shape = o.shape || (video ? 'circle' : o.radius ? 'round' : 'rect');
  const rad = shape === 'round' ? (!o.shape && o.radius ? o.radius * k : Math.min(bw, bh) * 0.1) : 0;
  const path = () => {
    ctx.beginPath();
    if (shape === 'circle') ctx.ellipse(bx + bw / 2, by + bh / 2, bw / 2, bh / 2, 0, 0, Math.PI * 2);
    else if (rad > 0) rrect(ctx, bx, by, bw, bh, rad);
    else ctx.rect(bx, by, bw, bh);
  };
  ctx.save();
  ctx.globalAlpha *= o.opacity ?? 1;
  if (video) {
    ctx.save();
    if (o.shadow !== false) { ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 24 * k; ctx.shadowOffsetY = 6 * k; }
    path(); ctx.fillStyle = '#111'; ctx.fill();
    ctx.restore();
  }
  if (f && f.w && f.h) {
    const v = visibleCrop(o, W, H, f.w, f.h), r = v.r;
    ctx.save(); path(); ctx.clip();
    if (o.flip) { ctx.translate(bx + bw / 2, 0); ctx.scale(-1, 1); ctx.translate(-(bx + bw / 2), 0); }
    const dw = f.w * r, dh = f.h * r, dx = bx - v.x * f.w * r, dy = by - v.y * f.h * r;
    try {
      if (f.src && typeof f.src.draw === 'function' && !(f.src instanceof HTMLCanvasElement)) f.src.draw(ctx, dx, dy, dw, dh);
      else ctx.drawImage(f.src, dx, dy, dw, dh);
    } catch (e) { /* кадр ще не готовий */ }
    ctx.restore();
  }
  if (o.border && o.border !== 'none') { path(); ctx.lineWidth = (o.bw || 6) * k; ctx.strokeStyle = o.border; ctx.stroke(); }
  ctx.restore();
}
