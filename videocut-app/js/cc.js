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

export const CC_BGS = { none: 'Немає', shadow: 'Тінь', outline: 'Контур', box: 'Плашка', block: 'Блок', glow: 'Сяйво', depth: 'Об’єм' };
export const CC_HI = { color: 'Колір', pill: 'Плашка', underline: 'Підкреслення', scale: 'Збільшення' };
export const CC_ANIMS = { none: 'Без анімації', fade: 'Плавно', pop: 'Виринання', karaoke: 'Підсвітка слова', words: 'Слово за словом', chunk: 'По 1–3 слова' };

export const CC_DEFAULT = {
  preset: 'classic', font: 'inter', size: 46, bold: false, upper: false,
  color: '#ffffff', hi: '#ffd43b', bg: 'box', bgColor: '#000000', bgAlpha: 0.66,
  y: 0.93, width: 0.84, lines: 2, anim: 'none', show: true,
  strokeColor: '#000000', strokeW: 0.2, shadow: 0.28, shadowColor: '#000000', spacing: 0, lineH: 1.24, hiMode: 'color', safe: false,
};
// усе, що задає «вигляд» шаблону: перед застосуванням нового шаблону повертаємо до типового
export const CC_LOOK_KEYS = ['strokeColor', 'strokeW', 'shadow', 'shadowColor', 'spacing', 'lineH', 'hiMode', 'safe', 'bgColor', 'bgAlpha', 'hi'];

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
  hormozi: { name: 'Динамічний', font: 'montserrat', size: 78, bold: true, upper: true, color: '#ffffff', hi: '#ffd43b', bg: 'outline', strokeW: 0.26, anim: 'chunk', width: 0.88, lines: 2, safe: true },
  podcast: { name: 'Подкаст', font: 'rubik', size: 54, bold: true, upper: false, color: '#ffffff', hi: '#22c55e', hiMode: 'pill', bg: 'shadow', shadow: 0.35, anim: 'karaoke', width: 0.84, safe: true },
  under: { name: 'Підкреслення', font: 'montserrat', size: 52, bold: true, upper: false, color: '#ffffff', hi: '#ffd43b', hiMode: 'underline', bg: 'shadow', anim: 'karaoke', width: 0.84 },
  zoom: { name: 'Крупно слово', font: 'montserrat', size: 66, bold: true, upper: true, color: '#ffffff', hi: '#ff3d6e', hiMode: 'scale', bg: 'depth', anim: 'karaoke', width: 0.86, spacing: 0.01 },
  neon: { name: 'Неон', font: 'montserrat', size: 50, bold: false, upper: false, color: '#ffffff', bg: 'glow', shadowColor: '#4F6BF4', shadow: 0.9, anim: 'fade', width: 0.82 },
  depth: { name: 'Об’ємний', font: 'rubik', size: 60, bold: true, upper: true, color: '#ffffff', hi: '#ffd43b', bg: 'depth', shadowColor: '#000000', anim: 'pop', width: 0.84 },
  minimal: { name: 'Мінімалізм', font: 'inter', size: 42, bold: false, upper: false, color: '#ffffff', bg: 'shadow', shadow: 0.5, anim: 'fade', width: 0.78, lineH: 1.3 },
  wide: { name: 'Широкий', font: 'oswald', size: 50, bold: false, upper: true, color: '#ffffff', bg: 'shadow', anim: 'none', width: 0.8, spacing: 0.08 },
};

// стиль проєкту зі значеннями за замовчуванням (старі проєкти мали лише size/color/bg/pos)
export function capStyle(p) {
  const s = p.captionStyle || {};
  const o = { ...CC_DEFAULT, ...s };
  if (s.y == null) o.y = s.pos === 'top' ? 0.06 : CC_DEFAULT.y;
  if (!CC_FONTS[o.font]) o.font = 'inter';
  if (!CC_BGS[o.bg]) o.bg = 'box';
  if (!CC_ANIMS[o.anim]) o.anim = 'none';
  if (!CC_HI[o.hiMode]) o.hiMode = 'color';
  const n = (v, d, a, b) => (Number.isFinite(+v) ? Math.min(b, Math.max(a, +v)) : d);
  o.strokeW = n(o.strokeW, 0.2, 0, 0.45); o.shadow = n(o.shadow, 0.28, 0, 1.5); o.spacing = n(o.spacing, 0, -0.05, 0.3); o.lineH = n(o.lineH, 1.24, 0.9, 1.8);
  for (const k of ['strokeColor', 'shadowColor']) if (!/^#[0-9a-f]{6}$/i.test(o[k] || '')) o[k] = '#000000';
  o.safe = !!o.safe;
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
  // вага слова: літери й голосні (складів більше — слово довше), мала пауза між словами, довша після розділового знака
  const wt = words.map(w => { const l = w.replace(/[^\p{L}\p{N}]/gu, ''); const v = (l.match(/[аеєиіїоуюяaeiouy]/gi) || []).length; return l.length * 0.6 + v * 1.1 + 1.6 + (/[.!?…]$/.test(w) ? 4 : /[,;:—]$/.test(w) ? 2.5 : 0); });
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


// ── розумні розриви рядків ──
// Короткі службові слова не лишаємо в кінці рядка, число тримаємо з одиницею, пунктуацію — зі словом.
const GLUE_AFTER = new Set(['в', 'у', 'з', 'із', 'зі', 'до', 'на', 'по', 'за', 'від', 'о', 'об', 'при', 'про', 'без', 'над', 'під', 'для', 'між', 'через', 'і', 'й', 'та', 'а', 'але', 'що', 'як', 'чи', 'не', 'ні', 'це', 'то', 'ж', 'б', 'би', 'мій', 'ця', 'цей', 'ці', 'я', 'ти', 'ми', 'ви']);
const clean = w => w.toLocaleLowerCase('uk').replace(/[^\p{L}\p{N}]/gu, '');
const isNum = w => /^[\d\s.,]+%?$/.test(w.replace(/[^\p{L}\p{N}.,%]/gu, '')) && /\d/.test(w);
export function glueAfter(words, i) {
  const w = words[i], n = words[i + 1];
  if (n == null) return false;
  if (/[.!?…]$/.test(w)) return false;
  if (/^[—–\-%.,;:!?…»)]/.test(n)) return true;                     // тире й знаки лишаються при слові
  if (/[«(]$/.test(w)) return true;
  if (GLUE_AFTER.has(clean(w)) && clean(w).length <= 4) return true;   // прийменники, сполучники
  if (isNum(w) && !isNum(n) && clean(n).length <= 6) return true;       // 5 хвилин, 20 %
  const cap = x => /^\p{Lu}/u.test(x.replace(/^[«"(]+/, ''));
  if (i > 0 && cap(w) && cap(n) && !/[.!?…,;:]$/.test(w) && !/[.!?…]$/.test(words[i - 1])) return true; // ім’я й прізвище
  return false;
}
// widths — ширини слів, space — ширина пробілу. Повертає масив рядків (масивів індексів слів).
// Мінімізуємо нерівність рядків; «сирота» (одне коротке слово в останньому рядку) і розрив після службового слова штрафуються.
export function breakLines(words, widths, space, maxW) {
  const n = words.length;
  if (!n) return [];
  const best = new Array(n + 1).fill(Infinity), from = new Array(n + 1).fill(0);
  best[0] = 0;
  const lineW = (a, b) => { let w = 0; for (let i = a; i < b; i++) w += widths[i] + (i > a ? space : 0); return w; };
  for (let b = 1; b <= n; b++) {
    for (let a = b - 1; a >= 0; a--) {
      const w = lineW(a, b), last = b === n;
      if (w > maxW && b - a > 1) break;                                  // довші не рахуємо (крім одного слова, що саме не вміщається)
      const slack = Math.max(0, maxW - w) / maxW;
      let cost = last ? slack * slack * 0.8 : slack * slack;
      if (w > maxW) cost += 50 + (w - maxW) / maxW * 100;
      if (last && b - a === 1 && n > 1 && w < maxW * 0.45) cost += 2.2;   // сирота
      if (!last && glueAfter(words, b - 1)) cost += 3;
      const t = best[a] + cost + 0.02;                                   // невеликий штраф за кожен рядок — менше зайвих переносів
      if (t < best[b]) { best[b] = t; from[b] = a; }
    }
  }
  const out = []; for (let b = n; b > 0; b = from[b]) out.unshift(Array.from({ length: b - from[b] }, (_, j) => from[b] + j));
  return out;
}

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
  if ('letterSpacing' in ctx) ctx.letterSpacing = (st.spacing || 0) * size + 'px';
  const disp = i => st.upper ? all[i].w.toLocaleUpperCase('uk') : all[i].w;
  const space = ctx.measureText(' ').width;
  const box = st.bg === 'box', block = st.bg === 'block';
  const pad = box ? size * 0.32 : block ? size * 0.5 : 0;
  const maxW = Math.max(size * 2, st.width * W - pad * 2);
  // рядки: розумне розбиття; примусові переноси (Enter у тексті) ділять текст на окремі абзаци
  const lines = [];
  {
    let seg = [];
    const flush = () => {
      if (!seg.length) return;
      const ws = seg.map(i => disp(i)), wd = ws.map(x => ctx.measureText(x).width);
      for (const ln of breakLines(ws, wd, space, maxW)) { const items = ln.map(j => ({ i: seg[j], w: wd[j] })); lines.push({ words: items, w: items.reduce((a, x, q) => a + x.w + (q ? space : 0), 0) }); }
      seg = [];
    };
    for (const i of idx) { if (breaks.has(i)) flush(); seg.push(i); }
    flush();
  }
  const lh = size * (st.lineH || 1.24);
  const textH = lines.length * lh;
  const blockH = textH + pad * (box ? 0.6 : 2);
  const maxLine = Math.max(...lines.map(l => l.w));
  // положення: верхня частина кадру — від верху, нижня — від низу, середина — по центру
  const anchor = Math.max(0, Math.min(1, (st.y - 0.38) / 0.24)); // 0 — від верху, 1 — від низу, плавно між ними
  let top = st.y * H - blockH * anchor;
  // безпечна зона соцмереж: у вертикальному відео низ займають підписи й кнопки, верх — рядок пошуку
  const portrait = H / W > 1.5;
  const lo = st.safe ? H * (portrait ? 0.12 : 0.06) : H * 0.01, hi = st.safe ? H * (portrait ? 0.78 : 0.94) : H * 0.99;
  top = Math.max(lo, Math.min(hi - blockH, top));
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
    for (const w of L.words) { pos.push({ i: w.i, x, y: y + size * 0.96, w: w.w }); x += w.w + space; }
  });
  const visible = p => !(anim === 'words' && p.i > cur);
  const hiOn = p => (anim === 'karaoke' || anim === 'chunk') && p.i === cur;
  const mode = st.hiMode || 'color';
  // плашка або підкреслення під словом, що звучить, малюються до тексту
  for (const p of pos) {
    if (!visible(p) || !hiOn(p)) continue;
    if (mode === 'pill') { ctx.fillStyle = st.hi; rr(ctx, p.x - size * 0.12, p.y - size * 0.84, p.w + size * 0.24, size * 1.12, size * 0.24); ctx.fill(); }
    else if (mode === 'underline') { ctx.fillStyle = st.hi; rr(ctx, p.x, p.y + size * 0.1, p.w, Math.max(2, size * 0.09), size * 0.045); ctx.fill(); }
  }
  const onPill = (() => { const m = /^#?([0-9a-f]{6})$/i.exec(st.hi || ''); if (!m) return '#ffffff'; const n = parseInt(m[1], 16); return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) > 150 ? '#111111' : '#ffffff'; })();
  const drawWord = (p, dx = 0, dy = 0, stroke = false) => {
    const sc = mode === 'scale' && hiOn(p) ? 1.16 : 1;
    if (sc === 1) { stroke ? ctx.strokeText(disp(p.i), p.x + dx, p.y + dy) : ctx.fillText(disp(p.i), p.x + dx, p.y + dy); return; }
    ctx.save(); ctx.translate(p.x + p.w / 2 + dx, p.y + dy - size * 0.3); ctx.scale(sc, sc); ctx.translate(-p.w / 2, size * 0.3);
    stroke ? ctx.strokeText(disp(p.i), 0, 0) : ctx.fillText(disp(p.i), 0, 0); ctx.restore();
  };
  if (st.bg === 'outline') {
    ctx.lineJoin = 'round'; ctx.miterLimit = 2;
    ctx.lineWidth = size * (st.strokeW ?? 0.2); ctx.strokeStyle = st.strokeColor || '#000000';
    for (const p of pos) if (visible(p)) drawWord(p, 0, 0, true);
  }
  if (st.bg === 'depth') { // жорстка тінь-об’єм: кілька зсунутих копій
    ctx.fillStyle = st.shadowColor || '#000000';
    const d = size * 0.09 * Math.max(0.4, (st.shadow ?? 0.28) / 0.28);
    for (const p of pos) if (visible(p)) for (let q = 1; q <= 4; q++) drawWord(p, d * q / 4, d * q / 4 * 1.0);
  }
  if (st.bg === 'shadow') { ctx.shadowColor = rgba(st.shadowColor || '#000000', 0.85); ctx.shadowBlur = size * (st.shadow ?? 0.28); ctx.shadowOffsetY = size * 0.05; }
  if (st.bg === 'glow') { ctx.shadowColor = st.shadowColor || '#4F6BF4'; ctx.shadowBlur = size * (st.shadow ?? 0.6) * 0.9; ctx.shadowOffsetY = 0; }
  for (const p of pos) {
    if (!visible(p)) continue;
    const hot = hiOn(p);
    ctx.fillStyle = hot ? (mode === 'pill' ? onPill : mode === 'underline' ? st.color : st.hi) : st.color;
    drawWord(p);
    if (st.bg === 'glow') drawWord(p); // двічі: сяйво щільніше
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
