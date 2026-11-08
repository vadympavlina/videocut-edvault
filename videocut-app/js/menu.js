// Рядок меню як у настільних програмах: «Файл · Редагування · …» з випадними списками.
// Пункт: { label, key?, run?, enabled?: () => bool, checked?: () => bool, sub?: [...] } або { sep: true } чи { head: 'Назва' }.
import { icon, esc } from './ui.js';

export function initMenu(root, menus) {
  root.innerHTML = `<button type="button" class="mb-btn mb-burger" data-m="all" aria-haspopup="true" aria-label="Меню">${icon('menu')}<span>Меню</span></button>` +
    menus.map((m, i) => `<button type="button" class="mb-btn mb-top" data-m="${i}" aria-haspopup="true">${esc(m.label)}</button>`).join('');
  root.setAttribute('role', 'menubar');
  let openIdx = null, dd = null, sub = null;

  const isOn = it => !it.enabled || it.enabled();
  function itemsHtml(items) {
    return items.map((it, i) => {
      if (it.sep) return '<div class="mb-sep" role="separator"></div>';
      if (it.head) return `<div class="mb-head">${esc(it.head)}</div>`;
      const on = isOn(it), chk = it.checked ? it.checked() : null;
      return `<button type="button" class="mb-it" role="menuitem" data-i="${i}" ${on ? '' : 'disabled'}>
        <span class="mb-ck">${chk ? icon('check') : it.ic && chk == null ? icon(it.ic) : ''}</span><span class="mb-l">${esc(it.label)}</span>
        ${it.sub ? `<span class="mb-k">${icon('chevR')}</span>` : it.key ? `<span class="mb-k">${esc(it.key)}</span>` : ''}</button>`;
    }).join('');
  }
  function build(items, x, y, cls = '') {
    const el = document.createElement('div');
    el.className = 'mb-dd ' + cls; el.setAttribute('role', 'menu');
    el.innerHTML = itemsHtml(items);
    el._items = items;
    document.body.appendChild(el);
    // не виходимо за межі вікна
    const r = el.getBoundingClientRect();
    el.style.left = Math.max(6, Math.min(x, innerWidth - r.width - 6)) + 'px';
    el.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + 'px';
    return el;
  }
  function closeSub() { if (sub) { sub.remove(); sub = null; } }
  function close() {
    closeSub();
    if (dd) { dd.remove(); dd = null; }
    if (openIdx != null) root.querySelector(`[data-m="${openIdx}"]`)?.classList.remove('on');
    openIdx = null;
  }
  function open(idx, focusFirst = false) {
    close();
    openIdx = idx;
    const btn = root.querySelector(`[data-m="${idx}"]`);
    btn.classList.add('on');
    const r = btn.getBoundingClientRect();
    // на вузькому екрані — усе меню одним списком з розділами
    const items = idx === 'all' ? menus.flatMap((m, i) => [...(i ? [{ sep: true }] : []), { head: m.label }, ...m.items]) : menus[idx].items;
    dd = build(items, r.left, r.bottom + 4, idx === 'all' ? 'mb-all' : '');
    if (focusFirst) dd.querySelector('.mb-it:not(:disabled)')?.focus();
  }
  function openSub(btn) {
    const it = btn.parentElement._items[+btn.dataset.i];
    if (!it || !it.sub) return closeSub();
    if (sub && sub._from === btn) return;
    closeSub();
    const r = btn.getBoundingClientRect();
    sub = build(it.sub, r.right - 2, r.top - 5, 'mb-sub');
    sub._from = btn;
    if (sub.getBoundingClientRect().left < r.right - 10) sub.style.left = Math.max(6, r.left - sub.offsetWidth + 2) + 'px';
  }
  function activate(btn) {
    const it = btn.parentElement._items[+btn.dataset.i];
    if (!it || btn.disabled) return;
    if (it.sub) { openSub(btn); sub?.querySelector('.mb-it:not(:disabled)')?.focus(); return; }
    close();
    it.run && it.run();
  }

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    const idx = b.dataset.m === 'all' ? 'all' : +b.dataset.m;
    openIdx === idx ? close() : open(idx);
  });
  // коли меню відкрите — наведення на сусіднє перемикає його, як у звичних програмах
  root.addEventListener('pointerover', e => {
    const b = e.target.closest('.mb-top'); if (!b || openIdx == null || openIdx === 'all') return;
    if (+b.dataset.m !== openIdx) open(+b.dataset.m);
  });
  document.addEventListener('click', e => {
    const it = e.target.closest('.mb-dd .mb-it');
    if (it) { activate(it); return; }
    if (!e.target.closest('.mb-dd') && !root.contains(e.target)) close();
  });
  document.addEventListener('pointerover', e => {
    const it = e.target.closest('.mb-dd .mb-it'); if (!it) return;
    if (it.parentElement === dd) openSub(it);
    if (!it.disabled) it.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', e => {
    if (openIdx == null) return;
    const cur = document.activeElement.closest?.('.mb-dd') || dd;
    const list = [...cur.querySelectorAll('.mb-it:not(:disabled)')];
    const i = list.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (cur === sub) { const f = sub._from; closeSub(); f.focus(); } else { const k = openIdx; close(); root.querySelector(`[data-m="${k}"]`)?.focus(); } }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const it = document.activeElement.closest('.mb-it');
      if (it && it.parentElement === dd && dd._items[+it.dataset.i]?.sub) activate(it);
      else if (openIdx !== 'all') open((openIdx + 1) % menus.length, true);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (cur === sub) { const f = sub._from; closeSub(); f.focus(); }
      else if (openIdx !== 'all') open((openIdx - 1 + menus.length) % menus.length, true);
    } else if (e.key === 'Enter' || e.key === ' ') { const it = document.activeElement.closest('.mb-it'); if (it) { e.preventDefault(); activate(it); } }
    else return;
    e.stopImmediatePropagation();
  }, true);
  // клавіатура: Alt або F10 — перейти до меню
  document.addEventListener('keydown', e => {
    if (e.key === 'F10') { e.preventDefault(); open(getComputedStyle(root.querySelector('.mb-burger')).display !== 'none' ? 'all' : 0, true); }
  });
  addEventListener('resize', close);
  addEventListener('blur', close);
  return { close };
}
