// Контекстне меню таймлайну (права кнопка миші): найчастіші дії просто під рукою.
import { S, select } from './state.js';
import { seek } from './player.js';
import { splitAt, copySel, pasteClip, canPaste, duplicateSel, deleteSel, addCaption, addOverlay } from './ops.js';
import { $, icon, esc, fmt } from './ui.js';

let menu = null;
export function closeCtx() { if (menu) { menu.remove(); menu = null; } }

export function initCtx() {
  const host = $('tlScroll');
  host.addEventListener('contextmenu', e => {
    e.preventDefault();
    const inner = $('tlInner');
    const t = Math.max(0, (e.clientX - inner.getBoundingClientRect().left) / S.pps);
    const it = e.target.closest('.it');
    if (it) select(it.dataset.kind, it.dataset.id);
    seek(t);
    const X = [];
    if (it) {
      const kind = it.dataset.kind;
      X.push({ l: 'Розрізати тут', ic: 'split', k: 'S', run: () => splitAt(t) });
      X.push({ sep: true });
      X.push({ l: 'Копіювати', ic: 'copy', k: 'Ctrl+C', run: () => copySel() });
      X.push({ l: 'Вирізати', k: 'Ctrl+X', run: () => copySel(true) });
      X.push({ l: 'Дублювати', k: 'Ctrl+D', run: () => duplicateSel() });
      if (canPaste()) X.push({ l: 'Вставити тут', k: 'Ctrl+V', run: () => pasteClip() });
      X.push({ sep: true });
      X.push({ l: kind === 'clip' ? 'Видалити (решта зсунеться)' : 'Видалити', ic: 'trash', k: 'Delete', danger: true, run: () => deleteSel() });
    } else {
      X.push({ l: `Вставити тут · ${fmt(t, true)}`, k: 'Ctrl+V', off: !canPaste(), run: () => pasteClip() });
      X.push({ sep: true });
      X.push({ l: 'Додати субтитр тут', ic: 'cc', run: () => addCaption('') });
      X.push({ l: 'Додати текст тут', ic: 'text', run: () => addOverlay('text', { preset: 'plain' }) });
      X.push({ sep: true });
      X.push({ l: 'Позначити початок шматка', k: 'I', run: () => $('btnMarkIn').click() });
      X.push({ l: 'Позначити кінець шматка', k: 'O', run: () => $('btnMarkOut').click() });
    }
    show(e.clientX, e.clientY, X);
  });
  // закрити: клік деінде, Esc, прокрутка, зміна розміру
  document.addEventListener('pointerdown', e => { if (menu && !menu.contains(e.target)) closeCtx(); }, true);
  document.addEventListener('keydown', e => { if (menu && e.key === 'Escape') { e.stopPropagation(); closeCtx(); } }, true);
  host.addEventListener('scroll', closeCtx, { passive: true });
  addEventListener('resize', closeCtx);
  addEventListener('blur', closeCtx);
}

function show(x, y, items) {
  closeCtx();
  menu = document.createElement('div');
  menu.className = 'ctx'; menu.setAttribute('role', 'menu');
  menu.innerHTML = items.map((it, i) => it.sep ? '<div class="ctx-sep" role="separator"></div>'
    : `<button type="button" class="ctx-it${it.danger ? ' danger' : ''}" role="menuitem" data-i="${i}" ${it.off ? 'disabled' : ''}><span class="ctx-ic">${it.ic ? icon(it.ic) : ''}</span><span class="ctx-l">${esc(it.l)}</span>${it.k ? `<span class="ctx-k">${esc(it.k)}</span>` : ''}</button>`).join('');
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(6, Math.min(x, innerWidth - r.width - 6)) + 'px';
  menu.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + 'px';
  menu.addEventListener('click', e => {
    const b = e.target.closest('.ctx-it'); if (!b || b.disabled) return;
    const run = items[+b.dataset.i].run;
    closeCtx();
    run();
  });
  menu.querySelector('.ctx-it:not(:disabled)')?.focus({ preventScroll: true });
  menu.addEventListener('keydown', e => {
    const list = [...menu.querySelectorAll('.ctx-it:not(:disabled)')], i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
  });
}
