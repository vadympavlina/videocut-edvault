// Дрібні спільні речі інтерфейсу: іконки, тости, діалоги, форматування часу.

export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const P = {
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  film: '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M7 3v18M17 3v18M2 8h5M2 16h5M17 8h5M17 16h5"/>',
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>',
  prev: '<path d="M19 20 9 12l10-8v16z"/><path d="M5 19V5"/>',
  next: '<path d="m5 4 10 8-10 8V4z"/><path d="M19 5v14"/>',
  stepBack: '<path d="m15 18-6-6 6-6"/>',
  stepFwd: '<path d="m9 18 6-6-6-6"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  redo: '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>',
  split: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  media: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  text: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  shapes: '<path d="M8.3 10a.7.7 0 0 1-.63-1.02l3.7-6.46a.7.7 0 0 1 1.23 0l3.68 6.46A.7.7 0 0 1 15.66 10z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>',
  cc: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  video: '<path d="m22 8-6 4 6 4V8z"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m23 9-6 6M17 9l6 6"/>',
  arrow: '<path d="M5 19 19 5"/><path d="M9 5h10v10"/>',
  rect: '<rect x="3" y="5" width="18" height="14" rx="2"/>',
  blur: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  spot: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/>',
  fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  magnet: '<path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"/><path d="m5 8 4 4M12 15l4 4"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
  full: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
  bracketL: '<path d="M10 4H6v16h4"/>',
  bracketR: '<path d="M14 4h4v16h-4"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  alignL: '<path d="M21 6H3M15 12H3M17 18H3"/>',
  alignC: '<path d="M21 6H3M17 12H7M19 18H5"/>',
  alignR: '<path d="M21 6H3M21 12H9M21 18H7"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  menu: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  grip: '<circle cx="9" cy="6" r="1.4" fill="currentColor"/><circle cx="15" cy="6" r="1.4" fill="currentColor"/><circle cx="9" cy="12" r="1.4" fill="currentColor"/><circle cx="15" cy="12" r="1.4" fill="currentColor"/><circle cx="9" cy="18" r="1.4" fill="currentColor"/><circle cx="15" cy="18" r="1.4" fill="currentColor"/>',
  front: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V4h12"/>',
  pip: '<rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="16" cy="14" r="3.2" fill="currentColor"/>',
  rotL: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  rotR: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  flipH: '<path d="M12 3v18"/><path d="M8 7 3 12l5 5V7Z"/><path d="M16 7l5 5-5 5V7Z"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>',
  progress: '<rect x="2" y="10" width="20" height="4" rx="2"/><rect x="2" y="10" width="11" height="4" rx="2" fill="currentColor"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v4M8 21h8"/>',
  wand: '<path d="m15 4 5 5L9 20H4v-5Z"/><path d="M13 6l5 5"/><path d="M20 2v3M18.5 3.5h3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  merge: '<path d="M8 6h8M8 18h8"/><path d="m12 2 0 8m-3-3 3 3 3-3M12 22v-8m-3 3 3-3 3 3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>',
  chevR: '<path d="m9 18 6-6-6-6"/>',
  sparkle: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
};
export function icon(name, cls = 'ico') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}
// перемикач, що не вміщається в рядок, ділимо на рівні ряди замість «хвоста» з однієї кнопки
// чи людина зараз друкує в полі всередині el
export const typingIn = el => { const a = document.activeElement; return !!a && el.contains(a) && (a.matches('textarea, input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=color])') || a.isContentEditable); };
// ── «м'яке» оновлення панелей ──
// Панелі раніше повністю перемальовувались через innerHTML: елемент, який людина саме тягнула (повзунок) чи в якому
// друкувала, підмінявся новим — перетягування обривалось, курсор і прокрутка «злітали». Тепер новий HTML порівнюється
// з наявним, і змінюється лише те, що справді відрізняється; живі елементи лишаються на місці.
let pointerDown = false;
['pointerdown'].forEach(ev => document.addEventListener(ev, () => { pointerDown = true; }, true));
['pointerup', 'pointercancel', 'dragend', 'blur'].forEach(ev => addEventListener(ev, () => { pointerDown = false; }, true));

const FIELD = /^(INPUT|TEXTAREA|SELECT)$/;
// Заповнення доріжки повзунка: CSS-змінна --p (відсоток), яку виставляє код
export function paintRange(r) {
  const min = +r.min || 0, max = r.max === '' ? 100 : +r.max, v = +r.value;
  r.style.setProperty('--p', (max > min ? Math.max(0, Math.min(1, (v - min) / (max - min))) * 100 : 0).toFixed(1) + '%');
}
export const paintRanges = root => root.querySelectorAll('input[type=range]').forEach(paintRange);
document.addEventListener('input', e => { if (e.target && e.target.type === 'range') paintRange(e.target); }, true);

function syncAttrs(a, b) {
  if (a.nodeName === 'INPUT' && a.type === 'range') { // style повзунка веде код (--p)
    for (const at of [...a.attributes]) if (at.name !== 'style' && !b.hasAttribute(at.name)) a.removeAttribute(at.name);
    for (const at of b.attributes) if (at.name !== 'style' && a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
    return;
  }
  const keepRows = a.classList.contains('seg-rows'); // клас і стиль, які додає balanceSegs
  const isItem = a.classList.contains('it'); // доступність елементів таймлайну виставляє timeline.js після малювання
  for (const at of [...a.attributes]) {
    if (keepRows && (at.name === 'class' || at.name === 'style')) continue;
    if (isItem && /^(tabindex|role|aria-)/.test(at.name)) continue;
    if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
  }
  for (const at of b.attributes) {
    if (keepRows && (at.name === 'class' || at.name === 'style')) continue;
    if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
  }
}
function syncField(a, b) {
  const t = a.type;
  if (t === 'checkbox' || t === 'radio') { a.checked = b.hasAttribute('checked'); return; }
  const want = a.tagName === 'TEXTAREA' ? b.value : a.tagName === 'SELECT' ? null : (b.getAttribute('value') ?? '');
  if (a.tagName === 'SELECT') { const i = [...b.options].findIndex(o => o.selected); if (i >= 0 && a.selectedIndex !== i) a.selectedIndex = i; return; }
  if (a.value === want) return;
  // поле, у якому зараз друкують чи яке тягнуть, не чіпаємо
  if (a === document.activeElement && (t !== 'range' || pointerDown)) return;
  a.value = want;
}
function morphNode(a, b, parent) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { parent.replaceChild(document.importNode(b, true), a); return; }
  if (b.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
  if (a.nodeName === 'CANVAS') return; // полотна малює код (розмір, позиція) — їх не чіпаємо
  syncAttrs(a, b);
  if (FIELD.test(a.nodeName)) { syncField(a, b); if (a.nodeName !== 'SELECT') return; morphChildren(a, b); return; }
  morphChildren(a, b);
}
function morphChildren(a, b) {
  const n = b.childNodes.length;
  for (let i = 0; i < n; i++) {
    const nb = b.childNodes[i], na = a.childNodes[i];
    if (!na) a.appendChild(document.importNode(nb, true)); else morphNode(na, nb, a);
  }
  while (a.childNodes.length > n) a.removeChild(a.lastChild);
}

// Записує HTML у панель, змінюючи лише відмінне. Повертає true, якщо щось змінилось.
// Якщо людина встигла змінити поле (input/toggle), кеш скидається, щоб панель точно оновилася.
export function setHtml(el, html) {
  if (!el.__bound) {
    el.__bound = true;
    const drop = () => { el.__html = null; };
    el.addEventListener('input', drop, true);
    el.addEventListener('change', drop, true);
    el.addEventListener('toggle', drop, true);
  }
  if (el.__html === html) return false;
  el.__html = html;
  if (!el.firstChild) { el.innerHTML = html; paintRanges(el); return true; }
  const t = document.createElement('template');
  t.innerHTML = html;
  morphChildren(el, t.content);
  paintRanges(el);
  return true;
}
// Перемальовує панель, не збиваючи людину: повертає фокус у те саме поле, курсор, виділення й прокрутку.
export function keepFocus(el, render) {
  const a = document.activeElement;
  let sel = null, pos = null;
  if (a && a !== el && el.contains(a) && a.matches('input, textarea, select')) {
    const attrs = [...a.attributes].filter(x => x.name.startsWith('data-') && x.name !== 'data-tip');
    if (attrs.length) {
      sel = a.tagName.toLowerCase() + attrs.map(x => `[${x.name}="${CSS.escape(x.value)}"]`).join('');
      try { pos = [a.selectionStart, a.selectionEnd, a.selectionDirection, a.scrollTop]; } catch { pos = null; }
    }
  }
  // прокрутка самої панелі й вкладених списків (наприклад, перелік субтитрів)
  const top = el.scrollTop;
  const inner = [...el.querySelectorAll('[data-keep-scroll]')].map(n => [n.dataset.keepScroll, n.scrollTop]);
  if (!el.__scrollBound) {
    el.__scrollBound = true;
    const mark = () => { el.__userAt = performance.now(); };
    ['wheel', 'touchmove', 'pointerdown', 'keydown'].forEach(ev => el.addEventListener(ev, mark, { passive: true, capture: true }));
  }
  const at = performance.now();
  render();
  el.scrollTop = top;
  inner.forEach(([k, v]) => { const n = el.querySelector(`[data-keep-scroll="${CSS.escape(k)}"]`); if (n) n.scrollTop = v; });
  // картинки й шрифти довантажуються вже після перемальовування і змінюють висоту — повертаємо прокрутку ще раз,
  // але лише якщо людина сама не крутила панель
  requestAnimationFrame(() => { if ((el.__userAt || 0) < at && el.scrollTop !== top && el.scrollHeight - el.clientHeight >= top) el.scrollTop = top; });
  if (!sel) return;
  const n = el.querySelector(sel);
  if (!n) return;
  n.focus({ preventScroll: true });
  if (pos && pos[0] != null) { try { n.setSelectionRange(pos[0], pos[1], pos[2] || 'none'); n.scrollTop = pos[3]; } catch { /* поле без курсора */ } }
}
export function balanceSegs(el) {
  el.querySelectorAll('.seg').forEach(g => {
    const b = g.children;
    if (b.length < 3 || g.classList.contains('seg-rows') || b[b.length - 1].offsetTop === b[0].offsetTop) return;
    g.classList.add('seg-rows');
    g.style.gridTemplateColumns = `repeat(${Math.ceil(b.length / 2)}, 1fr)`;
  });
}
// <span data-icon="name"> → SVG
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => { el.outerHTML = icon(el.dataset.icon, el.className ? 'ico ' + el.className : 'ico'); });
}

// ── час ──
export function fmt(t, precise = false) {
  if (!isFinite(t)) t = 0;
  t = Math.max(0, t);
  const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  const ss = precise ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + ss;
}
export function fmtShort(t) {
  if (t < 60) return (Math.round(t * 10) / 10).toString().replace('.', ',') + ' с';
  return fmt(t);
}
export function parseTime(str) {
  // "1:23.4", "83.4", "1:02:03"
  const s = String(str).trim().replace(',', '.');
  if (!s) return NaN;
  const parts = s.split(':').map(Number);
  if (parts.some(n => !isFinite(n))) return NaN;
  return parts.reduce((a, n) => a * 60 + n, 0);
}
export const fmtBytes = b => b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' КБ' : (b / 1048576).toFixed(b < 10485760 ? 1 : 0).replace('.', ',') + ' МБ';

// ── тост ──
let toastTimer = 0;
export function toast(msg, kind, ms) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms || 3000);
}

// ── модалки ──
export function openModal(id) {
  const o = $(id);
  o.classList.add('open');
  const m = o.querySelector('.modal');
  if (m) m.scrollTop = 0;
  const f = o.querySelector('[autofocus]') || o.querySelector('.btn-primary');
  // preventScroll: інакше довге вікно прокручується до кнопки внизу і верх «зникає»
  if (f) setTimeout(() => f.focus({ preventScroll: true }), 20);
}
export function closeModal(id) { $(id).classList.remove('open'); }
export const anyModalOpen = () => !!document.querySelector('.overlay.open');

export function confirmDialog(title, msg, yes = 'Так', danger = true) {
  return new Promise(res => {
    $('confirmTitle').textContent = title;
    $('confirmMsg').textContent = msg;
    const y = $('confirmYes');
    y.textContent = yes;
    y.className = 'btn ' + (danger ? 'btn-danger-solid' : 'btn-primary');
    openModal('confirmModal');
    const done = v => { closeModal('confirmModal'); y.onclick = $('confirmNo').onclick = null; res(v); };
    y.onclick = () => done(true);
    $('confirmNo').onclick = () => done(false);
  });
}

// ── тултіпи ──
export function initTips() {
  const tip = $('tip');
  let timer = 0, cur = null;
  document.addEventListener('pointerover', e => {
    const el = e.target.closest('[data-tip]');
    if (el === cur) return;
    cur = el; clearTimeout(timer); tip.classList.remove('show');
    if (!el || e.pointerType === 'touch') return;
    timer = setTimeout(() => {
      tip.innerHTML = esc(el.dataset.tip) + (el.dataset.key ? `<span class="k">${esc(el.dataset.key)}</span>` : '');
      tip.classList.add('show');
      const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
      let top = r.bottom + 8;
      if (top + th > innerHeight - 6) top = r.top - th - 8;
      tip.style.left = clamp(r.left + r.width / 2 - tw / 2, 6, innerWidth - tw - 6) + 'px';
      tip.style.top = top + 'px';
    }, 420);
  });
  document.addEventListener('pointerdown', () => { clearTimeout(timer); tip.classList.remove('show'); cur = null; }, true);
}

// ── тема ──
export function initTheme(btn) {
  const sync = () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    btn.innerHTML = icon(dark ? 'sun' : 'moon');
    btn.dataset.tip = dark ? 'Світла тема' : 'Темна тема';
    const mt = document.querySelector('meta[name="theme-color"]'); if (mt) mt.content = dark ? '#1e1e1e' : '#1c2869';
  };
  btn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('edvault-theme', next); } catch (e) { /* ignore */ }
    sync();
  });
  sync();
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export const safeName = s => (String(s || '').trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120)) || 'відео';
