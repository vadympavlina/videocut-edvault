// Малювання кадру сцени — однаково для перегляду й експорту.
// provider(layoutItem, sourceTime) → {src: CanvasImageSource | VideoSample, w, h} | null
import { S, media, layout, clipAt, srcTime } from './state.js';
import { capStyle, drawCaption, capState, capBox } from './cc.js';
import { drawLayer } from './layer.js';
import { tailFrame } from './media.js';

export const FONT_STACK = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const EMOJI_FONT = "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";

const clamp01 = v => Math.max(0, Math.min(1, v));
const smooth = p => p * p * (3 - 2 * p);
const easeOut = p => 1 - Math.pow(1 - p, 3);
const easeBack = p => { const c = 1.7; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };

// ── кольорові фільтри кліпів ──
export const LOOKS = {
  none: { name: 'Без фільтра' },
  vivid: { name: 'Яскравий', f: 'saturate(1.45) contrast(1.08)' },
  warm: { name: 'Теплий', f: 'saturate(1.12) brightness(1.02)', tint: ['#ff8a3d', 0.22] },
  cool: { name: 'Холодний', f: 'saturate(1.02)', tint: ['#3d8bff', 0.22] },
  bw: { name: 'Чорно-білий', f: 'grayscale(1) contrast(1.12)' },
  vintage: { name: 'Ретро', f: 'sepia(.5) contrast(.92) brightness(1.04) saturate(.9)', vignette: 0.45 },
  drama: { name: 'Драма', f: 'contrast(1.32) saturate(.82) brightness(.96)', vignette: 0.38 },
  bright: { name: 'Світліше', f: 'brightness(1.18) contrast(1.04)' },
};
export const FILTERS_OK = (() => {
  try { const c = document.createElement('canvas').getContext('2d'); c.filter = 'blur(2px)'; return c.filter === 'blur(2px)'; } catch (e) { return false; }
})();
export function lookFilter(c) {
  const parts = [];
  const L = LOOKS[c.look];
  if (L && L.f) parts.push(L.f);
  if (c.bri != null && Math.abs(c.bri - 1) > 1e-3) parts.push(`brightness(${c.bri})`);
  if (c.con != null && Math.abs(c.con - 1) > 1e-3) parts.push(`contrast(${c.con})`);
  if (c.sat != null && Math.abs(c.sat - 1) > 1e-3) parts.push(`saturate(${c.sat})`);
  return parts.length ? parts.join(' ') : 'none';
}
// тонування й віньєтка поверх уже намальованого кадру
export function applyLookOverlay(ctx, c, W, H) {
  const L = LOOKS[c.look];
  if (!L) return;
  if (L.tint) {
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = hexA(L.tint[0], L.tint[1] * 2.2);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  if (L.vignette) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${L.vignette})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
}

// ── переходи між кліпами ──
export const TRANSITIONS = {
  fade: 'Розчинення',
  black: 'Через чорне',
  slide: 'Зсув',
  wipe: 'Шторка',
  zoom: 'Наближення',
};

// висоти текстових блоків (для рамки виділення), обчислюються під час малювання
export const textBoxes = new WeakMap();

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexA(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(0,0,0,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}

// розбиття тексту на рядки під задану ширину
function wrapLines(ctx, text, maxW) {
  const out = [];
  String(text || '').split('\n').forEach(par => {
    const words = par.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (ctx.measureText(test).width > maxW && line.trim()) { out.push(line.trimEnd()); line = w.trimStart(); }
      else line = test;
      // дуже довге слово — ріжемо посимвольно
      while (ctx.measureText(line).width > maxW && line.length > 1) {
        let i = line.length - 1;
        while (i > 1 && ctx.measureText(line.slice(0, i)).width > maxW) i--;
        out.push(line.slice(0, i)); line = line.slice(i);
      }
    }
    out.push(line.trimEnd());
  });
  return out;
}

// коефіцієнт появи/зникання
export function fadeAlpha(t, start, dur, fin, fout) {
  let a = 1;
  if (fin > 0) a = Math.min(a, (t - start) / fin);
  if (fout > 0) a = Math.min(a, (start + dur - t) / fout);
  return Math.max(0, Math.min(1, a));
}

export function drawText(ctx, o, W, H, k, reveal = Infinity) {
  const size = (o.size || 64) * k;
  ctx.font = `${o.weight || 700} ${size}px ${FONT_STACK}`;
  ctx.textBaseline = 'alphabetic';
  const boxW = Math.max(20, o.w * W);
  const pad = o.bg === 'box' ? size * 0.35 : 0;
  const lines = wrapLines(ctx, o.text, boxW - pad * 2);
  const lh = size * 1.22;
  const boxH = lines.length * lh + pad * 2;
  const x = o.x * W, y = o.y * H;
  textBoxes.set(o, boxH / H);
  if (o.bg === 'box') {
    ctx.fillStyle = hexA(o.bgColor || '#000000', o.bgAlpha ?? 0.7);
    roundRectPath(ctx, x, y, boxW, boxH, size * 0.28);
    ctx.fill();
  }
  const align = o.align || 'left';
  ctx.textAlign = align;
  const tx = align === 'center' ? x + boxW / 2 : align === 'right' ? x + boxW - pad : x + pad;
  if (o.bg === 'shadow') { ctx.shadowColor = 'rgba(0,0,0,.65)'; ctx.shadowBlur = size * 0.22; ctx.shadowOffsetY = size * 0.05; }
  if (o.bg === 'outline') { ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.14; ctx.strokeStyle = o.bgColor || '#000000'; }
  ctx.fillStyle = o.color || '#ffffff';
  let left = reveal;
  lines.forEach((l, i) => {
    if (left <= 0) return;
    const part = left >= l.length ? l : l.slice(0, Math.floor(left));
    left -= l.length + 1;
    const ly = y + pad + lh * i + size * 0.95;
    // при «друкуванні» вирівнюємо за повним рядком, щоб текст не стрибав
    let px = tx;
    if (part.length < l.length && align !== 'left') {
      const full = ctx.measureText(l).width, cur = ctx.measureText(part).width;
      px = align === 'center' ? tx - full / 2 + cur / 2 : tx - full + cur;
    }
    if (o.bg === 'outline') ctx.strokeText(part, px, ly);
    ctx.fillText(part, px, ly);
  });
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.textAlign = 'left';
}

function drawArrow(ctx, o, W, H, k) {
  const x1 = o.x * W, y1 = o.y * H, x2 = (o.x + o.w) * W, y2 = (o.y + o.h) * H;
  const lw = (o.stroke || 10) * k;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.min(lw * 4.2, Math.hypot(x2 - x1, y2 - y1) * 0.6);
  ctx.strokeStyle = ctx.fillStyle = o.color || '#ef4444';
  ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = lw * 0.8;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2 - Math.cos(ang) * head * 0.7, y2 - Math.sin(ang) * head * 0.7);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - Math.cos(ang - 0.45) * head, y2 - Math.sin(ang - 0.45) * head);
  ctx.lineTo(x2 - Math.cos(ang + 0.45) * head, y2 - Math.sin(ang + 0.45) * head);
  ctx.closePath(); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
}

let blurCanvas = null;
function drawBlur(ctx, o, W, H) {
  let x = Math.round(o.x * W), y = Math.round(o.y * H), w = Math.round(o.w * W), h = Math.round(o.h * H);
  if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
  x = Math.max(0, x); y = Math.max(0, y); w = Math.min(W - x, w); h = Math.min(H - y, h);
  if (w < 2 || h < 2) return;
  const strength = Math.max(4, o.strength || 18) * Math.min(W, H) / 1080;
  const sw = Math.max(1, Math.round(w / strength)), sh = Math.max(1, Math.round(h / strength));
  if (!blurCanvas) blurCanvas = document.createElement('canvas');
  blurCanvas.width = sw; blurCanvas.height = sh;
  const b = blurCanvas.getContext('2d');
  b.imageSmoothingEnabled = true; b.imageSmoothingQuality = 'high';
  b.drawImage(ctx.canvas, x, y, w, h, 0, 0, sw, sh);
  ctx.save();
  roundRectPath(ctx, x, y, w, h, Math.min(w, h) * 0.08);
  ctx.clip();
  ctx.imageSmoothingEnabled = o.pixel ? false : true;
  ctx.drawImage(blurCanvas, 0, 0, sw, sh, x, y, w, h);
  ctx.restore();
  ctx.imageSmoothingEnabled = true;
}

export function drawOverlay(ctx, o, W, H, k, x = {}) {
  switch (o.type) {
    case 'text': drawText(ctx, o, W, H, k, x.reveal ?? Infinity); break;
    case 'emoji': {
      const bx = o.x * W, by = o.y * H, bw = o.w * W, bh = o.h * H;
      const s = Math.min(Math.abs(bw), Math.abs(bh));
      ctx.font = `${s * 0.86}px ${EMOJI_FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(o.emoji || '⭐', bx + bw / 2, by + bh / 2 + s * 0.04);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      break;
    }
    case 'progress': {
      const bx = o.x * W, by = o.y * H, bw = o.w * W, bh = Math.max(2, o.h * H);
      const p = clamp01(((x.t ?? o.start) - o.start) / Math.max(0.01, o.dur));
      ctx.fillStyle = hexA(o.track || '#ffffff', 0.28);
      roundRectPath(ctx, bx, by, bw, bh, bh / 2); ctx.fill();
      if (p > 0) { ctx.fillStyle = o.color || '#4F6BF4'; roundRectPath(ctx, bx, by, Math.max(bh, bw * p), bh, bh / 2); ctx.fill(); }
      break;
    }
    case 'rect': {
      let x = o.x * W, y = o.y * H, w = o.w * W, h = o.h * H;
      const lw = (o.stroke || 8) * k;
      if (o.fill) { ctx.fillStyle = hexA(o.color, 0.22); roundRectPath(ctx, x, y, w, h, (o.radius ?? 16) * k); ctx.fill(); }
      ctx.strokeStyle = o.color || '#ef4444'; ctx.lineWidth = lw;
      ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = lw;
      roundRectPath(ctx, x, y, w, h, (o.radius ?? 16) * k); ctx.stroke();
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
      break;
    }
    case 'arrow': drawArrow(ctx, o, W, H, k); break;
    case 'blur': drawBlur(ctx, o, W, H); break;
    case 'spot': {
      ctx.save();
      ctx.fillStyle = `rgba(0,0,0,${o.dim ?? 0.6})`;
      ctx.beginPath(); ctx.rect(0, 0, W, H);
      const x = o.x * W, y = o.y * H, w = o.w * W, h = o.h * H;
      if (o.shape === 'ellipse') { ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2); }
      else { const r = Math.min(Math.abs(w), Math.abs(h)) * 0.12; ctx.moveTo(x + r, y); ctx.arcTo(x, y, x, y + h, r); ctx.arcTo(x, y + h, x + w, y + h, r); ctx.arcTo(x + w, y + h, x + w, y, r); ctx.arcTo(x + w, y, x, y, r); ctx.closePath(); }
      ctx.fill('evenodd');
      ctx.restore();
      break;
    }
    case 'video': drawLayer(ctx, o, x.frame, W, H, k); break;
    case 'image': {
      const m = media.get(o.mediaId);
      if (m && m.el) drawLayer(ctx, o, { src: m.el, w: m.width || m.el.naturalWidth, h: m.height || m.el.naturalHeight }, W, H, k);
      break;
    }
  }
}

// Малює кадр основної доріжки з урахуванням вписування, зуму й затемнення
// малює джерело з поворотом/віддзеркаленням так, що (cx, cy) — центр, dw×dh — розмір на екрані (вже з урахуванням повороту)
function drawOriented(g, f, cx, cy, dw, dh, rot, flip) {
  const side = rot === 90 || rot === 270;
  const sw = side ? dh : dw, sh = side ? dw : dh;
  g.save();
  g.translate(cx, cy);
  if (rot) g.rotate(rot * Math.PI / 180);
  if (flip) g.scale(-1, 1);
  if (f.src && typeof f.src.draw === 'function' && !(f.src instanceof HTMLCanvasElement)) f.src.draw(g, -sw / 2, -sh / 2, sw, sh);
  else g.drawImage(f.src, -sw / 2, -sh / 2, sw, sh);
  g.restore();
}
// розмитий фон замість чорних смуг: кадр зменшується до кількох десятків пікселів і розтягується назад
let bgCv = null;
function drawBlurBg(ctx, c, f, W, H, rot, fw, fh, box) {
  const bw = 28, bh = Math.max(2, Math.round(bw * H / W));
  if (!bgCv) bgCv = document.createElement('canvas');
  if (bgCv.width !== bw || bgCv.height !== bh) { bgCv.width = bw; bgCv.height = bh; }
  const g = bgCv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, bw, bh);
  const k = bw / W;
  g.setTransform(k, 0, 0, k, 0, 0);
  const r = Math.max(W / fw, H / fh) * 1.08;
  const filt = FILTERS_OK ? lookFilter(c) : 'none';
  if (filt !== 'none') g.filter = filt;
  drawOriented(g, f, W / 2, H / 2, fw * r, fh * r, rot, !!c.flip);
  g.filter = 'none';
  // малюємо лише поля навколо кадру (під самим відео фон не видно) — це в рази швидше
  ctx.save();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low';
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  const sx = bw / W, sy = bh / H;
  const piece = (x, y, w, h) => {
    if (w < 0.5 || h < 0.5) return;
    ctx.drawImage(bgCv, x * sx, y * sy, w * sx, h * sy, x, y, w, h);
    ctx.fillRect(x, y, w, h);
  };
  const [x0, y0, x1, y1] = [Math.max(0, Math.floor(box.x) + 1), Math.max(0, Math.floor(box.y) + 1), Math.min(W, Math.ceil(box.x + box.w) - 1), Math.min(H, Math.ceil(box.y + box.h) - 1)];
  piece(0, 0, W, y0);            // верх
  piece(0, y1, W, H - y1);       // низ
  piece(0, y0, x0, y1 - y0);     // ліво
  piece(x1, y0, W - x1, y1 - y0); // право
  ctx.restore();
}
export const MOTIONS = { none: 'Без руху', in: 'Наближення', out: 'Віддалення', pan: 'Панорама' };
// prog — позиція всередині кліпу 0…1 (для плавного руху фото)
function drawFitted(ctx, c, f, W, H, prog = 0) {
  const rot = (((c.rot || 0) % 360) + 360) % 360;
  const side = rot === 90 || rot === 270;
  const fw = side ? f.h : f.w, fh = side ? f.w : f.h;
  const fit = c.fit || 'contain';
  const r = (fit === 'cover' ? Math.max : Math.min)(W / fw, H / fh);
  const dw0 = fw * r, dh0 = fh * r;
  if (fit === 'blur' && Math.abs(fw / fh - W / H) > 0.01) drawBlurBg(ctx, c, f, W, H, rot, fw, fh, { x: (W - dw0) / 2, y: (H - dh0) / 2, w: dw0, h: dh0 });
  let z = Math.max(1, c.zoom || 1);
  let fx = c.zx ?? 0.5, fy = c.zy ?? 0.5;
  const mo = c.motion;
  if (mo && mo !== 'none') {
    const e = smooth(clamp01(prog));
    if (mo === 'in') z *= 1 + 0.16 * e;
    else if (mo === 'out') z *= 1.16 - 0.16 * e;
    else if (mo === 'pan') { z *= 1.14; fx = 0.15 + 0.7 * e; }
  }
  const dw = dw0 * z, dh = dh0 * z;
  // точка фокусу лишається на тому самому місці екрана
  const px = W / 2 + (fx - 0.5) * dw0, py = H / 2 + (fy - 0.5) * dh0;
  let x = px - fx * dw, y = py - fy * dh;
  if (z > 1) { // не показуємо поля за межами кадру, якщо можна
    if (dw >= W) x = Math.min(0, Math.max(W - dw, x));
    if (dh >= H) y = Math.min(0, Math.max(H - dh, y));
  }
  const filt = FILTERS_OK ? lookFilter(c) : 'none';
  if (filt !== 'none') ctx.filter = filt;
  drawOriented(ctx, f, x + dw / 2, y + dh / 2, dw, dh, rot, !!c.flip);
  if (filt !== 'none') ctx.filter = 'none';
  applyLookOverlay(ctx, c, W, H);
}
export function drawClipFrame(ctx, l, f, W, H, t) {
  const c = l.clip;
  drawFitted(ctx, c, f, W, H, (t - l.start) / Math.max(0.01, l.end - l.start));
  const a = 1 - fadeAlpha(t, l.start, l.end - l.start, c.fadeIn || 0, c.fadeOut || 0);
  if (a > 0.001) { ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(0, 0, W, H); }
}

// opts.editing — перегляд на паузі: елементи показуємо повністю, без плавної появи, щоб їх було видно й зручно редагувати
export function renderScene(ctx, W, H, t, provider, L = layout(), opts = {}) {
  const p = S.project;
  const k = Math.min(W, H) / 1080;
  ctx.fillStyle = p.bg || '#000000';
  ctx.fillRect(0, 0, W, H);
  const l = clipAt(t, L);
  if (l) {
    const f = provider(l, srcTime(l, t));
    const tr = l.clip.tr;
    const idx = tr ? L.indexOf(l) : -1;
    if (tr && idx > 0 && t < l.start + (tr.d || 0.6)) {
      const prev = L[idx - 1];
      const tail = (opts.tailOf || tailFrame)(prev.clip);
      const pf = tail ? { src: tail, w: tail.naturalWidth || tail.width, h: tail.naturalHeight || tail.height } : null;
      drawTransition(ctx, tr, smooth(clamp01((t - l.start) / (tr.d || 0.6))), prev, pf, l, f, W, H, t);
    } else if (f && f.w && f.h) drawClipFrame(ctx, l, f, W, H, t);
  }
  for (const o of p.overlays) {
    if (t < o.start || t >= o.start + o.dur) continue;
    const frame = o.type === 'video' && opts.ovFrame ? opts.ovFrame(o, (o.in || 0) + (t - o.start)) : null;
    drawAnimated(ctx, o, W, H, k, t, opts.editing, frame);
  }
  capBox.id = null;
  const cap = p.captions.find(c => t >= c.start && t < c.start + c.dur);
  if (cap && cap.text.trim()) {
    const st = capStyle(p);
    // «не вшивати у відео»: у перегляді — напівпрозорі, в експорті їх немає
    if (st.show) drawCaption(ctx, cap, W, H, k, st, t);
    else if (!opts.export) drawCaption(ctx, cap, W, H, k, st, t, 0.4);
  }
}

// Перехід: попередній кліп «застигає» на останньому кадрі й поступається новому
function drawTransition(ctx, tr, p, prev, pf, l, f, W, H, t) {
  const drawNew = () => { if (f && f.w && f.h) drawClipFrame(ctx, l, f, W, H, t); };
  const drawOld = () => { if (pf && pf.w && pf.h) drawFitted(ctx, prev.clip, pf, W, H, 1); else { ctx.fillStyle = S.project.bg || '#000'; ctx.fillRect(0, 0, W, H); } };
  switch (tr.type) {
    case 'black':
      if (p < 0.5) { drawOld(); ctx.fillStyle = `rgba(0,0,0,${p * 2})`; ctx.fillRect(0, 0, W, H); }
      else { drawNew(); ctx.fillStyle = `rgba(0,0,0,${(1 - p) * 2})`; ctx.fillRect(0, 0, W, H); }
      break;
    case 'slide':
      ctx.save(); ctx.translate(-p * W, 0); drawOld(); ctx.restore();
      ctx.save(); ctx.translate((1 - p) * W, 0); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip(); drawNew(); ctx.restore();
      break;
    case 'wipe':
      drawNew();
      ctx.save(); ctx.beginPath(); ctx.rect(p * W, 0, W, H); ctx.clip(); drawOld(); ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,.85)'; if (p > 0 && p < 1) ctx.fillRect(p * W - 2, 0, 4, H);
      break;
    case 'zoom':
      drawNew();
      ctx.save(); ctx.globalAlpha = 1 - p;
      ctx.translate(W / 2, H / 2); ctx.scale(1 + p * 0.35, 1 + p * 0.35); ctx.translate(-W / 2, -H / 2);
      drawOld(); ctx.restore();
      break;
    default: // fade
      drawNew();
      ctx.save(); ctx.globalAlpha = 1 - p; drawOld(); ctx.restore();
  }
}

// Анімація появи елементів: плавно, знизу, пружинка, друк
export const ANIMS = { none: 'Одразу', fade: 'Плавно', up: 'Знизу', pop: 'Пружинка', type: 'Друк' };
export const animOf = o => o.anim || (o.fade ? 'fade' : 'none');
function drawAnimated(ctx, o, W, H, k, t, editing, frame) {
  const anim = editing ? 'none' : animOf(o);
  const x = { t, frame };
  if (anim === 'none') { drawOverlay(ctx, o, W, H, k, x); return; }
  const inD = Math.min(0.5, o.dur / 3), outD = Math.min(0.35, o.dur / 4);
  const pin = clamp01((t - o.start) / inD), pout = clamp01((o.start + o.dur - t) / outD);
  let alpha = Math.min(anim === 'type' ? 1 : easeOut(pin), pout);
  ctx.save();
  if (anim === 'up') ctx.translate(0, (1 - easeOut(pin)) * H * 0.05);
  else if (anim === 'pop') {
    const b = boxCenter(o, W, H);
    const s = 0.4 + 0.6 * easeBack(pin);
    ctx.translate(b.x, b.y); ctx.scale(s, s); ctx.translate(-b.x, -b.y);
  } else if (anim === 'type' && o.type === 'text') {
    const len = String(o.text || '').length;
    const typeDur = Math.max(0.3, Math.min(2.2, o.dur * 0.6, len * 0.055));
    x.reveal = Math.floor(len * clamp01((t - o.start) / typeDur) + 1e-6);
  } else if (anim === 'type') alpha = Math.min(easeOut(pin), pout);
  if (alpha <= 0) { ctx.restore(); return; }
  ctx.globalAlpha = alpha;
  drawOverlay(ctx, o, W, H, k, x);
  ctx.restore();
}
function boxCenter(o, W, H) {
  const h = o.type === 'text' ? (textBoxes.get(o) || 0.1) : o.h;
  return { x: (o.x + o.w / 2) * W, y: (o.y + h / 2) * H };
}

// Чи кадр у момент t нічим не відрізняється від сусідніх (фото без руху, текст без анімації).
// Повертає ключ сцени або null, якщо в кадрі щось рухається. Експорт не кодує однакові кадри повторно.
export function staticKey(t, L) {
  const p = S.project;
  const l = clipAt(t, L);
  let key = 'bg';
  if (l) {
    const c = l.clip, m = media.get(c.mediaId);
    if (!m || m.kind !== 'image') return null;
    if (c.motion && c.motion !== 'none') return null;
    if ((c.fadeIn || 0) > 0 && t < l.start + c.fadeIn + 0.02) return null;
    if ((c.fadeOut || 0) > 0 && t > l.end - c.fadeOut - 0.02) return null;
    if (c.tr && L.indexOf(l) > 0 && t < l.start + (c.tr.d || 0.6) + 0.02) return null;
    key = c.id;
  }
  for (const o of p.overlays) {
    if (t < o.start || t >= o.start + o.dur) continue;
    if (o.type === 'video' || o.type === 'progress') return null;
    const anim = animOf(o);
    if (anim !== 'none') {
      const inD = anim === 'type' ? 2.3 : Math.min(0.5, o.dur / 3), outD = Math.min(0.35, o.dur / 4);
      if (t < o.start + inD + 0.02 || t > o.start + o.dur - outD - 0.02) return null;
    }
    key += '|' + o.id;
  }
  const cap = p.captions.find(c => t >= c.start && t < c.start + c.dur);
  if (cap) { const s = capState(cap, t, capStyle(p)); if (s === null) return null; key += '|' + s; }
  return key;
}
