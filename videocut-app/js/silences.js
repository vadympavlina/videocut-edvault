// «Прибрати паузи й тишу»: пошук тиші за хвилею звуку, перегляд на таймлайні, вирізання.
import { S, emit, duration, mainEnd } from './state.js';
import { pause } from './player.js';
import { zoomFit } from './timeline.js';
import { findSilences, cutRanges } from './ops.js';
import { $, fmt, toast, openModal, closeModal } from './ui.js';
import { on } from './state.js';

// ══════════ Прибрати паузи ══════════
const silOpt = { level: 'mid', minLen: 0.8 };
let silFound = [];
function silSeg(id, key, conv) {
  $(id).addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    $(id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    silOpt[key] = conv(b.dataset.v);
    analyzeSilences();
  });
}
silSeg('silLevel', 'level', v => v);
silSeg('silMin', 'minLen', Number);
function analyzeSilences() {
  const r = findSilences({ level: silOpt.level, minLen: silOpt.minLen, pad: 0.15 });
  silFound = r.list;
  S.silPreview = silFound;
  emit('silences');
  const total = silFound.reduce((a, [x, y]) => a + y - x, 0);
  let html;
  if (r.missing && !silFound.length) html = '<span class="warn">Звук ще аналізується — зачекайте кілька секунд і відкрийте це вікно знову.</span>';
  else if (!silFound.length) html = 'Пауз такої довжини не знайдено. Спробуйте коротшу паузу або сильніший режим.';
  else html = `Знайдено <b>${silFound.length}</b> ${silFound.length === 1 ? 'паузу' : silFound.length < 5 ? 'паузи' : 'пауз'} · разом <b>${fmt(total, true)}</b>. Відео стане <b>${fmt(mainEnd() - total, true)}</b> замість ${fmt(mainEnd(), true)}.`;
  $('silInfo').innerHTML = html;
  $('silApply').disabled = !silFound.length;
  $('silApply').lastChild.textContent = silFound.length ? `Прибрати ${silFound.length}` : 'Прибрати';
}
export function openSilences() {
  if (!S.project.clips.length) { toast('Спочатку додайте відео'); return; }
  pause();
  openModal('silModal');
  analyzeSilences();
  if (duration() > 0) zoomFit();
}
function clearSilPreview() { if (S.silPreview) { S.silPreview = null; emit('silences'); } }
$('btnSilences').addEventListener('click', openSilences);
on('open-silences', openSilences);
$('silApply').addEventListener('click', () => {
  if (!silFound.length) return;
  const n = silFound.length;
  const total = cutRanges(silFound);
  silFound = [];
  closeModal('silModal');
  clearSilPreview();
  toast(`Прибрано ${n} ${n === 1 ? 'паузу' : n < 5 ? 'паузи' : 'пауз'} · ${fmt(total, true)}`, 'ok', 4000);
});
new MutationObserver(() => { if (!$('silModal').classList.contains('open')) clearSilPreview(); }).observe($('silModal'), { attributes: true, attributeFilter: ['class'] });
