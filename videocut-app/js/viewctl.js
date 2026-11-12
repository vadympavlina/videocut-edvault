// Перегляд: масштаб («Підігнати», 25–400 %), сітка третин, безпечні поля, пересування стисненою кнопкою миші.
import { S } from './state.js';
import { $ } from './ui.js';

const KEY = 'vc_view', LEVELS = ['fit', '25', '50', '100', '200', '400'];
export function initView(refit) {
  try { Object.assign(S.view, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* немає доступу */ }
  if (!LEVELS.includes(String(S.view.zoom))) S.view.zoom = 'fit';
  const sel = $('pvZoom'), bg = $('btnGrid'), bs = $('btnSafe'), gd = $('pvGuides'), scr = $('stageScroll'), stage = $('stage');
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ zoom: S.view.zoom, grid: S.view.grid, safe: S.view.safe })); } catch { /* не страшно */ } };
  const paint = () => {
    sel.value = String(S.view.zoom);
    bg.classList.toggle('on', !!S.view.grid); bg.setAttribute('aria-pressed', String(!!S.view.grid));
    bs.classList.toggle('on', !!S.view.safe); bs.setAttribute('aria-pressed', String(!!S.view.safe));
    gd.hidden = !S.view.grid && !S.view.safe;
    gd.classList.toggle('show-grid', !!S.view.grid); gd.classList.toggle('show-safe', !!S.view.safe);
    stage.classList.toggle('zoomed', S.view.zoom !== 'fit');
  };
  const setZoom = z => { S.view.zoom = String(z); paint(); save(); refit(); if (z === 'fit' && scr) { scr.scrollLeft = 0; scr.scrollTop = 0; } else centre(); };
  const centre = () => { if (!scr) return; scr.scrollLeft = (scr.scrollWidth - scr.clientWidth) / 2; scr.scrollTop = (scr.scrollHeight - scr.clientHeight) / 2; };
  sel.addEventListener('change', () => setZoom(sel.value));
  bg.addEventListener('click', () => { S.view.grid = !S.view.grid; paint(); save(); });
  bs.addEventListener('click', () => { S.view.safe = !S.view.safe; paint(); save(); });
  // Ctrl + колесо: масштаб перегляду по сходинках
  scr.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const cur = LEVELS.indexOf(String(S.view.zoom)), nx = Math.max(0, Math.min(LEVELS.length - 1, cur + (e.deltaY < 0 ? 1 : -1)));
    if (nx !== cur) setZoom(LEVELS[nx]);
  }, { passive: false });
  // середня кнопка або пробіл+перетягування: пересунути збільшений кадр
  let pan = null;
  scr.addEventListener('pointerdown', e => {
    if (e.button !== 1 || S.view.zoom === 'fit') return;
    e.preventDefault(); pan = { x: e.clientX, y: e.clientY, l: scr.scrollLeft, t: scr.scrollTop };
    scr.setPointerCapture(e.pointerId); scr.classList.add('panning');
  });
  scr.addEventListener('pointermove', e => { if (pan) { scr.scrollLeft = pan.l - (e.clientX - pan.x); scr.scrollTop = pan.t - (e.clientY - pan.y); } });
  const end = () => { pan = null; scr.classList.remove('panning'); };
  scr.addEventListener('pointerup', end); scr.addEventListener('pointercancel', end);
  scr.addEventListener('scroll', () => window.dispatchEvent(new Event('vc-pv-scroll')), { passive: true });
  paint();
  if (S.view.zoom !== 'fit') setTimeout(() => { refit(); centre(); }, 0);
}
