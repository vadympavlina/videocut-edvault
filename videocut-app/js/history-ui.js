// Вікно «Історія змін»: усі кроки з назвами, перехід до будь-якого, підказки на кнопках скасування.
import { historyList, historyJump, undoLabel, redoLabel, canUndo, canRedo, on } from './state.js';
import { $, esc, openModal } from './ui.js';

export function renderHistory() {
  const { items, index } = historyList(), el = $('histList');
  el.innerHTML = items.map((it, i) => `<li><button type="button" class="hist-row ${it.state}${i === index ? ' cur' : ''}" data-i="${i}" ${i === index ? 'aria-current="step"' : ''}><span class="hn">${i}</span><span class="hl">${esc(it.label)}</span>${i === index ? '<em>зараз</em>' : it.state === 'undone' ? '<em>скасовано</em>' : ''}</button></li>`).join('');
  el.querySelector('.cur')?.scrollIntoView({ block: 'nearest' });
}
export function openHistory() { renderHistory(); openModal('historyModal'); }
export function initHistoryUi() {
  $('histList').addEventListener('click', e => { const b = e.target.closest('.hist-row'); if (!b) return; historyJump(+b.dataset.i); renderHistory(); });
  const tips = () => {
    const u = $('btnUndo'), r = $('btnRedo');
    u.dataset.tip = canUndo() ? `Скасувати: ${undoLabel()}` : 'Нічого скасовувати'; u.setAttribute('aria-label', u.dataset.tip);
    r.dataset.tip = canRedo() ? `Повторити: ${redoLabel()}` : 'Нічого повторювати'; r.setAttribute('aria-label', r.dataset.tip);
    if ($('historyModal').classList.contains('open')) renderHistory();
  };
  on('history', tips); tips();
}
