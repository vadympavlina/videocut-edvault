// Субтитри: стилі й шаблони, час окремих слів, розбивка тексту, малювання на кадрі.

const BASE = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export const CC_FONTS = {
  inter: { name: 'Inter', fam: 'Inter', n: 600, b: 800 },
  montserrat: { name: 'Montserrat', fam: 'Montserrat', n: 600, b: 900 },
  rubik: { name: 'Rubik', fam: 'Rubik', n: 500, b: 800 },
  oswald: { name: 'Oswald', fam: 'Oswald', n: 500, b: 700, scale: 1.08 },
  slab: { name: 'Roboto Slab', fam: 'Roboto Slab', n: 500, b: 800 },
  comfortaa: { name: 'Comfortaa', fam: 'Comfortaa', n: 600, b: 700 },
  caveat: { name: 'Caveat', fam: 'Caveat', n: 600, b: 700, scale: 1.3 },
};

export const CC_BGS = { none: 'Немає', shadow: 'Тінь', outline: 'Контур', box: 'Плашка', block: 'Блок' };
export const CC_ANIMS = { none: 'Без анімації', fade: 'Плавно', pop: 'Виринання', karaoke: 'Підсвітка слова', words: 'Слово за словом', chunk: 'По 1–3 слова' };

export const CC_DEFAULT = {
  preset: 'classic', font: 'inter', size: 46, bold: false, upper: false,
  color: '#ffffff', hi: '#ffd43b', bg: 'box', bgColor: '#000000', bgAlpha: 0.66,
  y: 0.93, width: 0.84, lines: 2, anim: 'none', show: true,
};

// шаблони — набір готових значень; позиція й «показувати» лишаються як були
export const CC_PRESETS = {
  classic: { name: 'Класика', font: 'inter', size: 46, bold: false, upper: false, color: '#ffffff', bg: 'box', bgColor: '#000000', bgAlpha: 0.66, anim: 'none', width: 0.84 },
  outline: { name: 'Контур', font: 'inter', size: 50, bold: true, upper: false, color: '#ffffff', bg: 'outline', anim: 'none', width: 0.84 },
  movie: { name: 'Кіно', font: 'slab', size: 46, bold: false, upper: false, color: '#ffd43b', bg: 'shadow', anim: 'fade', width: 0.8 },
  karaoke: { name: 'Караоке', font: 'montserrat', size: 52, bold: true, upper: true, color: '#ffffff', hi: '#ffd43b', bg: 'outline', anim: 'karaoke', width: 0.84 },
  reels: { name: 'Reels', font: 'montserrat', size: 74, bold: true, upper: true, color: '#ffffff', hi: '#22c55e', bg: 'outline', anim: 'chunk', width: 0.86 },
  pill: { name: 'Яскрава плашка', font: 'rubik', size: 48, bold: true, upper: false, color: '#ffffff', hi: '#ffd43b', bg: 'block', bgColor: '#4F6BF4', bgAlpha: 1, anim: 'pop', width: 0.8 },
  news: { name: 'Новини', font: 'oswald', size: 48, bold: false, upper: true, color: '#ffffff', bg: 'block', bgColor: '#000000', bgAlpha: 0.82, anim: 'fade', width: 0.9 },
  hand: { name: 'Від руки', font: 'caveat', size: 50, bold: true, upper: false, color: '#ffffff', bg: 'shadow', anim: 'words', width: 0.8 },
};

// стиль проєкту зі значеннями за замовчуванням (старі проєкти мали лише size/color/bg/pos)
export function capStyle(p) {
  const s = p.captionStyle || {};
  const o = { ...CC_DEFAULT, ...s };
  if (s.y == null) o.y = s.pos === 'top' ? 0.06 : CC_DEFAULT.y;
  if (!CC_FONTS[o.font]) o.font = 'inter';
  if (!CC_BGS[o.bg]) o.bg = 'box';
  if (!CC_ANIMS[o.anim]) o.anim = 'none';
  return o;
}
export function ccFont(st, size) {
  const F = CC_FONTS[st.font] || CC_FONTS.inter;
  return `${st.bold ? F.b : F.n} ${size}px "${F.fam}", ${BASE}`;
}
export const ccSize = (st, k) => st.size * k * ((CC_FONTS[st.font] || {}).scale || 1);

// шрифти з Google Fonts підвантажуються лише коли потрібні (canvas сам їх не просить)
const fontReady = new Map();
const fontListeners = new Set();
export const onCcFont = fn => fontListeners.add(fn); // перемалювати, коли шрифт довантажився
// CSS з додатковими шрифтами підвантажується у фоні — чекаємо на нього, інакше document.fonts.load нічого не знайде
const fontsCss = new Promise(res => {
  if (typeof window === 'undefined' || window.__ccFontsReady) return res();
  window.addEventListener('cc-fonts-css', res, { once: true });
  setTimeout(res, 6000);
});
export function loadCcFont(st) {
  const F = CC_FONTS[st.font] || CC_FONTS.inter;
  const key = F.fam + (st.bold ? F.b : F.n);
  if (!fontReady.has(key)) {
    const p = document.fonts && document.fonts.load ? fontsCss.then(() => document.fonts.load(`${st.bold ? F.b : F.n} 40px "${F.fam}"`, 'АаЇїZz')).catch(() => []) : Promise.resolve([]);
    fontReady.set(key, Promise.race([p.then(() => fontListeners.forEach(fn => fn())), new Promise(r => setTimeout(r, 4000))]));
  }
  return fontReady.get(key);
}

// ── слова й час ──
// вага слова ≈ кількість літер; після розділових знаків — коротка пауза
const wcache = new WeakMap();
export function capWords(c) {
  const hit = wcache.get(c);
  if (hit && hit.text === c.text && hit.dur === c.dur) return hit.list;
  const words = String(c.text || '').split(/\s+/).filter(Boolean);
  const wt = words.map(w => w.replace(/[^\p{L}\p{N}]/gu, '').length + 2 + (/[.,!?;:…—]$/.test(w) ? 3 : 0));
  const total = wt.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  const list = words.map((w, i) => { const s = acc / total * c.dur; acc += wt[i]; return { w, s, e: acc / total * c.dur }; });
  wcache.set(c, { text: c.text, dur: c.dur, list });
  return list;
}
export function wordAt(c, t) {
  const list = capWords(c), rel = t - c.start;
  for (let i = 0; i < list.length; i++) if (rel < list[i].e) return i;
  return list.length - 1;
}
// групи по 1–3 слова для стилю Reels
export function capChunks(c) {
  const list = capWords(c), out = [];
  let cur = [];
  list.forEach((x, i) => {
    const len = cur.reduce((a, j) => a + list[j].w.length + 1, 0) + x.w.length;
    if (cur.length && (cur.length >= 3 || len > 18)) { out.push(cur); cur = []; }
    cur.push(i);
    if (/[.,!?;:…—]$/.test(x.w)) { out.push(cur); cur = []; }
  });
  if (cur.length) out.push(cur);
  return out;
}

// стан субтитру для пропуску однакових кадрів при експорті: null — кадр змінюється
export function capState(c, t, st) {
  if (!st.show) return '';
  const rel = t - c.start;
  if ((st.anim === 'fade' || st.anim === 'pop') && (rel < 0.3 || c.dur - rel < 0.22)) return null;
  if (st.anim === 'karaoke' || st.anim === 'words') return c.id + ':' + wordAt(c, t);
  if (st.anim === 'chunk') {
    const i = wordAt(c, t), ch = capChunks(c).find(g => g.includes(i));
    if (ch && rel - capWords(c)[ch[0]].s < 0.14) return null;
    return c.id + ':' + i;
  }
  return c.id;
}

// розбиття довгого тексту на шматки не довші за max символів (краще — після розділових знаків)
export function splitText(text, max) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t ? [t] : [];
  // рівні частини: n шматків приблизно однакової довжини, розрив — по слову, краще після розділового знака
  const words = t.split(' '), out = [];
  let parts = Math.ceil(t.length / max), left = t.length, cur = [], len = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i], next = words[i + 1];
    cur.push(w); len += (cur.length > 1 ? 1 : 0) + w.length;
    if (!next || parts <= 1) continue;
    const target = left / parts;
    const punct = /[.!?;:…,—]$/.test(w) && len >= target * (/[,—]$/.test(w) ? 0.75 : 0.55);
    if (punct || len + 1 + next.length > Math.min(max, target * 1.12)) {
      out.push(cur.join(' ')); left -= len + 1; parts = Math.max(1, Math.ceil(left / max)); cur = []; len = 0;
    }
  }
  if (cur.length) out.push(cur.join(' '));
  return out;
}
// скільки символів уміщається в субтитр при поточному стилі й форматі
export function capMaxChars(st, W, H) {
  const k = Math.min(W, H) / 1080;
  const per = Math.floor(st.width * W / (ccSize(st, k) * (st.upper ? 0.62 : 0.53)));
  return Math.max(12, Math.min(42, per)) * (st.anim === 'chunk' ? 2 : st.lines || 2);
}
// розбити текст субтитру на кілька з пропорційним часом
export function splitCaption(c, max) {
  const parts = splitText(c.text, max);
  if (parts.length < 2) return [c];
  const total = parts.reduce((a, p) => a + p.length, 0);
  let s = c.start;
  return parts.map(p => { const d = c.dur * p.length / total; const r = { start: s, dur: d, text: p }; s += d; return r; });
}
// впорядкувати: без накладань, без дрібних пауз між фразами, не коротше 0,7 с
export function tidyCaptions(list) {
  list.sort((a, b) => a.start - b.start);
  for (let i = 0; i < list.length; i++) {
    const c = list[i], n = list[i + 1];
    if (n) {
      const gap = n.start - (c.start + c.dur);
      if (gap < 0) c.dur = Math.max(0.2, n.start - c.start);
      else if (gap < 0.35) c.dur = n.start - c.start;
    }
    if (c.dur < 0.7) {
      if (!n) c.dur = 0.7;
      else {
        c.dur = Math.max(c.dur, Math.min(0.7, n.start - c.start));
        // замало часу — позичаємо в наступного, якщо в нього є запас
        const need = 0.7 - c.dur;
        if (need > 0 && n.dur - need >= 0.7) { n.start += need; n.dur -= need; c.dur = 0.7; }
        else if (need > 0 && i > 0) { // …або в попереднього, що закінчується впритул
          const pr = list[i - 1], give = Math.min(need, pr.dur - 0.7);
          if (give > 0 && Math.abs(pr.start + pr.dur - c.start) < 1e-3) { pr.dur -= give; c.start -= give; c.dur += give; }
        }
      }
    }
  }
  return list;
}
// швидкість читання (символів за секунду)
export const cps = c => String(c.text || '').replace(/\s+/g, ' ').trim().length / Math.max(0.1, c.dur);

// ── малювання ──
export const capBox = { id: null, x: 0, y: 0, w: 0, h: 0 }; // де намальовано субтитр (частки кадру), для перегляду

function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function rgba(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}
const easeBack = x => { const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

export function drawCaption(ctx, c, W, H, k, st, t, alphaMul = 1, track = true) {
  const all = capWords(c);
  if (!all.length) return;
  const rel = t - c.start;
  const anim = st.anim;
  const cur = anim === 'karaoke' || anim === 'words' || anim === 'chunk' ? wordAt(c, t) : -1;
  // які слова показуємо і чи є примусові переноси рядка
  let idx = all.map((_, i) => i);
  let scale = 1, alpha = alphaMul;
  if (anim === 'chunk') {
    const ch = capChunks(c).find(g => g.includes(cur)) || [cur];
    idx = ch;
    const r0 = rel - all[ch[0]].s;
    if (r0 < 0.14) { const p = Math.max(0, r0 / 0.14); scale = 0.82 + 0.18 * easeBack(p); }
  } else if (anim === 'fade') {
    alpha *= Math.max(0, Math.min(1, rel / 0.2, (c.dur - rel) / 0.15));
  } else if (anim === 'pop') {
    if (rel < 0.28) { const p = Math.max(0, rel / 0.28); scale = 0.7 + 0.3 * easeBack(p); alpha *= Math.min(1, p * 2.5); }
    alpha *= Math.max(0, Math.min(1, (c.dur - rel) / 0.15));
  }
  if (alpha <= 0.001) return;
  const breaks = new Set();
  { let i = 0; String(c.text).split(/(\s+)/).forEach(tok => { if (!tok) return; if (/^\s+$/.test(tok)) { if (tok.includes('\n')) breaks.add(i); } else i++; }); }

  const size = ccSize(st, k);
  ctx.save();
  ctx.font = ccFont(st, size);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const disp = i => st.upper ? all[i].w.toLocaleUpperCase('uk') : all[i].w;
  const space = ctx.measureText(' ').width;
  const box = st.bg === 'box', block = st.bg === 'block';
  const pad = box ? size * 0.32 : block ? size * 0.5 : 0;
  const maxW = Math.max(size * 2, st.width * W - pad * 2);
  // рядки
  const lines = [];
  let line = [], lw = 0;
  for (const i of idx) {
    const w = ctx.measureText(disp(i)).width;
    const add = line.length ? space + w : w;
    if (line.length && (lw + add > maxW || breaks.has(i))) { lines.push({ words: line, w: lw }); line = []; lw = 0; }
    line.push({ i, w }); lw += line.length > 1 ? space + w : w;
  }
  if (line.length) lines.push({ words: line, w: lw });
  const lh = size * 1.24;
  const textH = lines.length * lh;
  const blockH = textH + pad * (box ? 0.6 : 2);
  const maxLine = Math.max(...lines.map(l => l.w));
  // положення: верхня частина кадру — від верху, нижня — від низу, середина — по центру
  const anchor = Math.max(0, Math.min(1, (st.y - 0.38) / 0.24)); // 0 — від верху, 1 — від низу, плавно між ними
  let top = st.y * H - blockH * anchor;
  top = Math.max(H * 0.01, Math.min(H * 0.99 - blockH, top));
  const cx = W / 2, cy = top + blockH / 2;
  if (track) capBox.id = c.id, capBox.x = (cx - maxLine / 2 - pad) / W, capBox.w = (maxLine + pad * 2) / W, capBox.y = top / H, capBox.h = blockH / H;

  ctx.globalAlpha *= alpha;
  if (scale !== 1) { ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-cx, -cy); }
  const y0 = top + (box ? pad * 0.3 : block ? pad : 0);
  if (block) {
    ctx.fillStyle = rgba(st.bgColor, st.bgAlpha ?? 0.8);
    rr(ctx, cx - maxLine / 2 - pad, top, maxLine + pad * 2, blockH, size * 0.38);
    ctx.fill();
  }
  const pos = [];
  lines.forEach((L, li) => {
    const y = y0 + li * lh;
    let x = cx - L.w / 2;
    if (box) {
      ctx.fillStyle = rgba(st.bgColor, st.bgAlpha ?? 0.66);
      rr(ctx, x - pad, y - pad * 0.15, L.w + pad * 2, lh + pad * 0.3, size * 0.22);
      ctx.fill();
    }
    for (const w of L.words) { pos.push({ i: w.i, x, y: y + size * 0.96 }); x += w.w + space; }
  });
  const visible = p => !(anim === 'words' && p.i > cur);
  if (st.bg === 'outline') {
    ctx.lineJoin = 'round'; ctx.miterLimit = 2;
    ctx.lineWidth = size * 0.2; ctx.strokeStyle = 'rgba(0,0,0,.92)';
    for (const p of pos) if (visible(p)) ctx.strokeText(disp(p.i), p.x, p.y);
  }
  if (st.bg === 'shadow') { ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = size * 0.28; ctx.shadowOffsetY = size * 0.05; }
  for (const p of pos) {
    if (!visible(p)) continue;
    const hi = (anim === 'karaoke' || anim === 'chunk') && p.i === cur;
    ctx.fillStyle = hi ? st.hi : st.color;
    ctx.fillText(disp(p.i), p.x, p.y);
  }
  ctx.restore();
}

// мініатюра шаблону для панелі
export function presetThumb(st, w = 160, h = 90) {
  const cv = document.createElement('canvas'); cv.width = w * 2; cv.height = h * 2;
  const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, cv.width, cv.height);
  gr.addColorStop(0, '#3b4a6b'); gr.addColorStop(1, '#7a5c48');
  g.fillStyle = gr; g.fillRect(0, 0, cv.width, cv.height);
  const c = { id: '_p', start: 0, dur: 2, text: 'Привіт, як справи?' };
  const s = { ...st, y: 0.5, show: true };
  const t = s.anim === 'chunk' ? 0.25 : s.anim === 'words' ? 1.1 : 0.9;
  drawCaption(g, c, cv.width, cv.height, (cv.height / 1080) * 3.1, s, t, 1, false);
  return cv.toDataURL('image/jpeg', 0.8);
}
