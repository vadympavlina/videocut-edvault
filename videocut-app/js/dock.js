// Розмір бічних панелей: розділювачі між панелями й переглядом; ширина запам'ятовується.
const KEY = 'vc_panels', LIM = { lib: [220, 520], insp: [240, 560] };
const root = document.documentElement;
let sizes = { lib: 300, insp: 300 };
try { Object.assign(sizes, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* немає доступу */ }
const clamp = (k, v) => Math.max(LIM[k][0], Math.min(LIM[k][1], Math.round(v)));
const apply = () => { for (const k of ['lib', 'insp']) { root.style.setProperty(`--${k}-w`, clamp(k, sizes[k]) + 'px'); } };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(sizes)); } catch { /* не страшно */ } };
export function initDock() {
  if (!matchMedia('(min-width: 981px)').matches || !Object.values(sizes).every(Number.isFinite)) sizes = { lib: 300, insp: 300 };
  apply();
  for (const [id, key] of [['vsLib', 'lib'], ['vsInsp', 'insp']]) {
    const el = document.getElementById(id); if (!el) continue;
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('active'); document.body.style.cursor = 'col-resize';
      const work = el.parentElement.getBoundingClientRect();
      const move = ev => { sizes[key] = clamp(key, key === 'lib' ? ev.clientX - work.left : work.right - ev.clientX); apply(); window.dispatchEvent(new Event('resize')); };
      const up = () => { el.classList.remove('active'); document.body.style.cursor = ''; el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); save(); };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
    el.addEventListener('dblclick', () => { sizes[key] = 300; apply(); save(); window.dispatchEvent(new Event('resize')); });
    el.addEventListener('keydown', e => { const d = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0; if (!d) return; e.preventDefault(); sizes[key] = clamp(key, sizes[key] + (key === 'lib' ? d : -d)); apply(); save(); window.dispatchEvent(new Event('resize')); });
  }
}
