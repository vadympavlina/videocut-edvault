// Доступність: імена для кнопок-значків, прив'язка підписів до полів, ролі вкладок. Працює над усім документом і стежить за новими вузлами.
let uid = 0;
const text = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
function fixButtons(root) {
  root.querySelectorAll('button:not([aria-label]):not([aria-labelledby]), [role=button]:not([aria-label])').forEach(b => {
    if (text(b) || b.querySelector('img[alt]:not([alt=""])')) return;
    const tip = b.dataset.tip || b.title; if (tip) b.setAttribute('aria-label', tip);
  });
}
function fixFields(root) {
  // підпис у .field без for: зв'язуємо з першим полем поруч
  root.querySelectorAll('.field > label:not([for])').forEach(l => {
    if (l.querySelector('input,select,textarea')) return;
    const c = l.parentElement.querySelector('input:not([type=hidden]):not([aria-label]):not([aria-labelledby]), select:not([aria-label]), textarea:not([aria-label])');
    if (!c || (c.labels && c.labels.length)) return;
    if (!c.id) c.id = 'f' + (++uid);
    l.setAttribute('for', c.id);
  });
  // решта полів без імені: беремо назву з підказки, плейсхолдера або сусіднього підпису
  root.querySelectorAll('input:not([type=hidden]):not([type=file]):not([aria-label]):not([aria-labelledby]), select:not([aria-label]), textarea:not([aria-label])').forEach(c => {
    if ([...(c.labels || [])].some(l => text(l))) return;
    const lab = c.closest('label')?.dataset.tip || c.dataset.tip || c.placeholder || c.closest('.field')?.querySelector('label')?.textContent || c.title;
    if (lab) c.setAttribute('aria-label', String(lab).replace(/\s+/g, ' ').trim());
  });
}
// системна підказка (title) показується поверх нашої (data-tip) і закриває її: переносимо текст у нашу й прибираємо title
function fixTitles(root) {
  root.querySelectorAll('[title]').forEach(el => {
    if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml') return;
    const tt = el.getAttribute('title');
    if (tt && !el.dataset.tip) el.dataset.tip = tt;
    if (tt && !el.getAttribute('aria-label') && !(el.textContent || '').trim() && /^(BUTTON|A|INPUT|SELECT)$/.test(el.tagName)) el.setAttribute('aria-label', tt);
    el.removeAttribute('title');
  });
}
export function fixA11y(root = document) { fixTitles(root); fixButtons(root); fixFields(root); }
export function initA11y() {
  fixA11y();
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fixA11y(); }); }).observe(document.body, { childList: true, subtree: true });
}
