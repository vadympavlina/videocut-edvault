// Ліва панель (медіа, текст, елементи, субтитри) і права панель властивостей.
import { S, media, on, emit, commit, select, findSel, layout, clipDur, musicDur, mainEnd, duration, rippleShift, outputSize } from './state.js';
import { MOTIONS, textBoxes, LOOKS, lookFilter, applyLookOverlay, FILTERS_OK, TRANSITIONS, ANIMS, animOf } from './render.js';
import { addToTimeline, addOverlay, addLayerAt, TEXT_PRESETS, splitAt, duplicateSel, deleteSel, copySel, moveZ, addCaption, setCaptions, trimMusicToVideo, CARD_STYLES, addTitleCard, normalizeSel, transitionsAll, freezeFrame } from './ops.js';
import { removeMedia, thumbAt } from './media.js';
import { seek } from './player.js';
import { hasKf, keyHere, setKeyHere, removeKeyHere, autoKey, syncBase, localTime, itemLength } from './kf.js';
import { parseSubtitles } from './srt.js';
import { renderCapTab, markActiveCaption, capTabClick, capTabInput, capTabChange, capTabToggle, captionInspector, ccAction, speedHtml } from './cc-panel.js';
import { KEY_DEFAULT } from './chroma.js';
import { isLayer, BLENDS, blendOf, LAYOUTS, layoutOf, applyLayout, cropSides, setCropSide, setScale, setShape, resetCrop } from './layer.js';
import { $, esc, icon, fmt, fmtShort, parseTime, toast, confirmDialog, fmtBytes, balanceSegs, keepFocus, typingIn, setHtml } from './ui.js';

const COLORS = ['#ffffff', '#1a1d23', '#ef4444', '#f59e0b', '#ffd43b', '#10b981', '#0ea5e9', '#4F6BF4', '#8b5cf6', '#ec4899'];
const EMOJIS = ['👍', '👏', '✅', '❌', '⭐', '🔥', '❗', '❓', '💡', '📌', '👉', '👆', '😀', '😮', '🤔', '🎉', '❤️', '⚠️', '🏆', '📝', '🎯', '🚀', '⏰', '🔍'];

// ══════════ Ліва панель ══════════
let tab = 'media';
let mediaFilter = 'all';
const libQ = {}, libOpen = { shapes: true, stickers: true, cards: true, pip: true, imgs: true };
const searchBox = ph => `<label class="lib-search">${icon('search')}<input type="search" data-libq autocomplete="off" placeholder="${ph}" aria-label="${ph}" value="${esc(libQ[tab] || '')}"></label>`;
const lfold = (key, name, n, html) => `<details class="lfold" data-lfold="${key}"${libOpen[key] ? ' open' : ''}><summary><span>${name}</span><i>${n}</i></summary><div class="lfold-b">${html}</div></details>`;
const KIND_NAME = { video: 'Відео', image: 'Фото', audio: 'Звук' };
const tabScroll = {};
export function initLibrary() {
  $('libTabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    tabScroll[tab] = $('libBody').scrollTop;
    tab = b.dataset.tab; renderLibrary();
    $('libBody').scrollTop = tabScroll[tab] || 0; // кожна вкладка пам'ятає, де ви зупинились
  });
  $('libBody').addEventListener('click', onLibClick);
  $('libBody').addEventListener('input', e => { const i = e.target.closest('[data-libq]'); if (!i) return; libQ[tab] = i.value; applyLibFilter(); });
  $('libBody').addEventListener('toggle', e => { const d = e.target.closest && e.target.closest('details[data-lfold]'); if (d && !d.hidden) libOpen[d.dataset.lfold] = d.open; }, true);
  $('libBody').addEventListener('dblclick', e => {
    const card = e.target.closest('.mcard'); if (!card) return;
    const m = media.get(card.dataset.id); if (m) addToTimeline(m);
  });
  $('libBody').addEventListener('dragstart', e => {
    const card = e.target.closest && e.target.closest('.mcard'); if (!card) return;
    e.dataTransfer.setData('application/x-vc-media', card.dataset.id);
    e.dataTransfer.effectAllowed = 'copy';
    document.body.classList.add('dragging-media');
  });
  $('libBody').addEventListener('dragend', () => document.body.classList.remove('dragging-media'));
  $('libBody').addEventListener('input', onLibInput);
  $('libBody').addEventListener('change', onLibChange);
  $('libBody').addEventListener('toggle', capTabToggle, true);
  on('show-tab', t => { showTab(t); document.body.classList.add('show-lib'); });
  on('media', () => { if (tab === 'media' || tab === 'elements') renderLibrary(); });
  on('thumbs', () => { if (tab === 'media') renderLibrary(); });
  on('proxy', () => { if (tab === 'media') renderLibrary(); });
  on('project', d => {
    updateTabCounts();
    if (tab !== 'captions' || (d && d.from === 'lib')) return;
    // текст субтитру змінюють праворуч — лише оновлюємо рядок у списку
    if (d && d.live && d.from === 'insp' && S.sel && S.sel.kind === 'caption') {
      const c = S.project.captions.find(x => x.id === S.sel.id);
      const ta = c && $('libBody').querySelector(`textarea[data-cap="${c.id}"]`);
      if (ta) { if (ta.value !== c.text) ta.value = c.text; return; }
    }
    // поки людина друкує в списку, автозбереження не перемальовує його
    if (typingIn($('libBody')) && !(d && d.restored)) return;
    renderLibrary();
  });
  on('select', () => { if (tab === 'captions') markActiveCaption(); });
  on('time', () => { if (tab === 'captions') markActiveCaption(); });
  let kfT = 0;
  on('time', () => { const o = findSel(); if (!o || !hasKf(o) || kfT) return; kfT = setTimeout(() => { kfT = 0; const s = findSel(); if (s && hasKf(s) && !typingIn($('inspector'))) { syncBase(kindOfSel(), s); renderInspector(); } }, 120); });
  renderLibrary();
}
export function showTab(t) { tab = t; renderLibrary(); }

function thumbURL(m) {
  const c = m.thumbs[Math.min(m.thumbs.length - 1, Math.floor(m.thumbs.length / 3))];
  return c ? c.c.toDataURL('image/jpeg', 0.7) : '';
}
const thumbCache = new Map();

// числа на вкладках: скільки файлів і субтитрів у проєкті
function updateTabCounts() {
  const set = (t, n) => { const el = $('libTabs').querySelector(`[data-tab="${t}"] .tab-n`); if (el) { el.textContent = n || ''; el.hidden = !n; } };
  set('media', media.size); set('captions', S.project.captions.length);
}
function renderLibrary() { keepFocus($('libBody'), drawLibrary); }
function drawLibrary() {
  $('libTabs').querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
  const body = $('libBody');
  updateTabCounts();
  if (tab === 'media') {
    const all = [...media.values()];
    const KINDS = [['all', 'Усе'], ['video', 'Відео'], ['image', 'Фото'], ['audio', 'Звук']];
    const showFilter = all.length >= 4;
    if (!showFilter) mediaFilter = 'all';
    const items = mediaFilter === 'all' ? all : all.filter(m => m.kind === mediaFilter);
    const used = new Set([...S.project.clips.map(c => c.mediaId), ...S.project.music.map(m => m.mediaId), ...S.project.overlays.map(o => o.mediaId)]);
    setHtml(body, `
      <button class="drop${all.length ? ' drop-sm' : ''}" id="btnImport2">${icon('upload')}<b>Додати файли</b>${all.length ? '' : '<span>Відео, фото або аудіо — або перетягніть їх у вікно</span>'}</button>
      ${showFilter ? `<div class="seg lib-filter">${KINDS.map(([k, n]) => `<button data-filter="${k}" class="${mediaFilter === k ? 'on' : ''}">${n}</button>`).join('')}</div>` : ''}
      ${items.length ? `<div class="mlist">${items.map(m => {
        let url = thumbCache.get(m.id + ':' + m.thumbs.length);
        if (url === undefined && m.thumbs.length) { url = thumbURL(m); thumbCache.set(m.id + ':' + m.thumbs.length, url); }
        return `<div class="mcard mrow${used.has(m.id) ? ' used' : ''}" data-id="${m.id}" title="${esc(m.name)}" draggable="true">
          <div class="mthumb">${url ? `<img src="${url}" alt="" draggable="false">` : icon(m.kind === 'audio' ? 'music' : m.kind === 'image' ? 'image' : 'video')}
            ${m.kind !== 'image' ? `<span class="mdur">${fmt(m.duration)}</span>` : ''}
            ${m.analyzing ? '<span class="mbusy"></span>' : ''}
            ${m.proxy && m.proxy.state === 'working' ? `<span class="mproxy" title="Готуємо легку копію для плавного перегляду. Експорт піде з оригіналу.">Копія ${Math.round(m.proxy.p * 100)}%</span>` : m.proxyUrl ? '<span class="mproxy ok" title="Перегляд іде з легкою копією (720p), а експорт — з оригіналу в повній якості.">720p</span>' : ''}
          </div>
          <div class="minfo"><div class="mname">${esc(m.name)}</div><div class="msub">${KIND_NAME[m.kind] || ''}${m.kind !== 'image' ? ' · ' + fmt(m.duration) : ''}${used.has(m.id) ? ' · <em>використано</em>' : ''}</div></div>
            <button class="mquick" data-act="add" data-tip="${m.kind === 'audio' ? 'Додати на звукову доріжку' : 'Додати в кінець таймлайну'}" aria-label="Додати на таймлайн">${icon('plus')}</button>
            <div class="mact">
              ${m.kind !== 'audio' && S.project.clips.length ? `<button class="btn btn-sm btn-icon" data-act="layer" data-tip="Поверх основного відео (доріжка «Поверх»)">${icon('pip')}</button>` : ''}
              <button class="btn btn-sm btn-icon" data-act="rm" data-tip="Прибрати з проєкту">${icon('trash')}</button>
            </div>

        </div>`;
      }).join('')}</div>` : all.length ? '<p class="lib-hint">Файлів такого типу ще немає.</p>' : '<p class="lib-hint">Усе обробляється у вашому браузері — нічого не завантажується на сервер.</p>'}`);
  } else if (tab === 'text') {
    setHtml(body, `${searchBox('Пошук напису')}<p class="lib-hint tight">Натисніть — напис з’явиться в позиції курсора.</p><div class="presets">${Object.entries(TEXT_PRESETS).map(([k, v]) => `
      <button class="preset pr-${k}" data-preset="${k}" data-q="${esc(v.label)}" data-tip="${esc(v.label)}"><span class="pr-demo">${esc(v.o.text.split('\n')[0])}</span><span class="pr-name">${esc(v.label)}</span></button>`).join('')}</div>`);
  } else if (tab === 'elements') {
    const imgs = [...media.values()].filter(m => m.kind === 'image');
    const vids = [...media.values()].filter(m => m.kind === 'video');
    const el = (type, ic, name, sub) => `<button class="elem" data-el="${type}" data-q="${name} ${sub}" data-tip="${sub}">${icon(ic)}<b>${name}</b></button>`;
    const pick = (attr, m, src) => `<button class="mcard img-pick" ${attr}="${m.id}" data-q="${esc(m.name)}" title="${esc(m.name)}"><div class="mthumb">${src ? `<img src="${src}" alt="">` : icon(m.kind === 'image' ? 'image' : 'video')}${m.kind === 'video' ? `<span class="mdur">${fmt(m.duration)}</span>` : ''}</div><div class="mname">${esc(m.name)}</div></button>`;
    const shapes = [['arrow', 'arrow', 'Стрілка', 'Вказати на кнопку чи деталь'], ['rect', 'rect', 'Рамка', 'Обвести важливе'], ['spot', 'spot', 'Прожектор', 'Затемнити все, крім області'], ['blur', 'blur', 'Розмиття', 'Сховати пароль, пошту, обличчя'], ['progress', 'progress', 'Прогрес', 'Смужка внизу — скільки ще лишилось']];
    setHtml(body, `${searchBox('Пошук елемента')}
      ${lfold('shapes', 'Пояснення на кадрі', shapes.length, `<div class="elems">${shapes.map(s => el(...s)).join('')}</div>`)}
      ${lfold('stickers', 'Емодзі-стікери', EMOJIS.length, `<div class="emoji-grid">${EMOJIS.map(e => `<button data-emoji="${e}" data-q="стікер емодзі" title="Додати ${e}">${e}</button>`).join('')}</div>`)}
      ${lfold('cards', 'Заставка з назвою', Object.keys(CARD_STYLES).length, `<div class="card-grid">${Object.entries(CARD_STYLES).map(([k, [a, b]]) => `<button class="card-pick" data-card="${k}" data-q="заставка назва" style="background:linear-gradient(135deg,${a},${b})" title="Додати заставку"><span style="color:${k === 'light' ? '#1a1d23' : '#fff'}">Аа</span></button>`).join('')}</div><p class="lib-hint" style="margin-top:6px">3 секунди з великим заголовком — на початку відео або в місці курсора.</p>`)}
      ${lfold('pip', 'Відео поверх відео', vids.length, vids.length ? `<div class="mgrid">${vids.map(m => pick('data-pip', m, m.thumbs[0] ? thumbURL(m) : '')).join('')}</div>` : '<p class="lib-hint">Додайте ще одне відео (наприклад, запис з вебкамери) — і його можна буде показати в кружечку в кутку.</p>')}
      ${lfold('imgs', 'Зображення поверх відео', imgs.length, `${imgs.length ? `<div class="mgrid">${imgs.map(m => pick('data-img', m, m.thumbs[0] ? m.thumbs[0].c.toDataURL() : '')).join('')}</div>` : ''}<button class="btn btn-outline btn-block" id="btnAddLogo">${icon('image')} Логотип або картинка…</button>`)}
      <p class="lib-hint lib-none" hidden>Нічого не знайдено.</p>`);
  } else if (tab === 'captions') renderCapTab(body);
  applyLibFilter();
}

// Пошук у вкладках «Текст» і «Елементи»: ховає непотрібні пункти й порожні розділи
function applyLibFilter() {
  const body = $('libBody'), q = (libQ[tab] || '').trim().toLowerCase();
  if (tab !== 'text' && tab !== 'elements') return;
  let any = false;
  body.querySelectorAll('[data-q]').forEach(n => { const ok = !q || n.dataset.q.toLowerCase().includes(q); n.hidden = !ok; if (ok) any = true; });
  body.querySelectorAll('details.lfold').forEach(d => { const vis = d.querySelector('[data-q]:not([hidden])'); d.hidden = !!q && !vis; if (q && vis) d.open = true; });
  const none = body.querySelector('.lib-none'); if (none) none.hidden = !q || any;
  if (tab === 'text') { let n = body.querySelector('.lib-none'); if (!n) { n = document.createElement('p'); n.className = 'lib-hint lib-none'; n.textContent = 'Нічого не знайдено.'; body.append(n); } n.hidden = !q || any; }
}

async function onLibClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'btnImport2') return $('fileInput').click();
  if (b.dataset.filter) { mediaFilter = b.dataset.filter; renderLibrary(); return; }
  if (b.dataset.act === 'add') { const m = media.get(b.closest('.mcard').dataset.id); if (m) addToTimeline(m); return; }
  if (b.dataset.act === 'layer') { const m = media.get(b.closest('.mcard').dataset.id); if (m) addLayerAt(m, { start: S.t }); return; }
  if (b.dataset.act === 'pip' || b.dataset.pip) { const m = media.get(b.dataset.pip || b.closest('.mcard').dataset.id); if (m) addPip(m); return; }
  if (b.dataset.act === 'rm') {
    const m = media.get(b.closest('.mcard').dataset.id); if (!m) return;
    const p = S.project;
    const uses = p.clips.filter(c => c.mediaId === m.id).length + p.music.filter(x => x.mediaId === m.id).length + p.overlays.filter(o => o.mediaId === m.id).length;
    if (uses && !(await confirmDialog('Прибрати файл?', `«${m.name}» використовується на таймлайні (${uses}). Ці фрагменти теж буде прибрано.`, 'Прибрати'))) return;
    p.clips = p.clips.filter(c => c.mediaId !== m.id);
    p.music = p.music.filter(x => x.mediaId !== m.id);
    p.overlays = p.overlays.filter(o => o.mediaId !== m.id);
    if (S.sel && !findSel()) select(null);
    commit();
    removeMedia(m.id);
    return;
  }
  if (b.dataset.preset) { addOverlay('text', { preset: b.dataset.preset }); emit('focus-inspector'); return; }
  if (b.dataset.el) { addOverlay(b.dataset.el); return; }
  if (b.dataset.img) { addOverlay('image', { mediaId: b.dataset.img }); return; }
  if (b.dataset.emoji) { addOverlay('emoji', { emoji: b.dataset.emoji }); return; }
  if (b.dataset.card) {
    try { await addTitleCard(b.dataset.card); emit('focus-inspector'); toast('Заставку додано — змініть текст праворуч', 'ok'); }
    catch (er) { console.error(er); toast('Не вдалося створити заставку', 'err'); }
    return;
  }
  if (b.id === 'btnAddLogo') { $('fileInput').dataset.target = 'logo'; $('fileInput').click(); return; }
  if (tab === 'captions') await capTabClick(b);
}

let capTimer = 0;
function onLibInput(e) {
  const ta = e.target.closest('textarea[data-cap]');
  if (ta) {
    const c = S.project.captions.find(x => x.id === ta.dataset.cap);
    if (c) { c.text = ta.value; emit('project', { live: true, from: 'lib' }); clearTimeout(capTimer); capTimer = setTimeout(() => { commit(); }, 600); }
    return;
  }
  capTabInput(e);
}
function onLibChange(e) {
  capTabChange(e);
}
// Enter у полі субтитру — новий субтитр після поточного
document.addEventListener('keydown', e => {
  const ta = e.target.closest && e.target.closest('#libBody textarea[data-cap]');
  if (!ta || e.key !== 'Enter' || e.shiftKey) return;
  e.preventDefault();
  const c = S.project.captions.find(x => x.id === ta.dataset.cap);
  commit();
  if (c) seek(c.start + c.dur);
  const n = addCaption('');
  renderLibrary();
  const next = document.querySelector(`#libBody textarea[data-cap="${n.id}"]`);
  if (next) { next.focus(); next.select(); }
});

export async function importCaptionFile(file) {
  const list = parseSubtitles(await file.text());
  if (!list.length) { toast('У файлі не знайдено субтитрів', 'err'); return; }
  let replace = false;
  if (S.project.captions.length) replace = await confirmDialog('Замінити субтитри?', `У файлі ${list.length} субтитрів. Замінити поточні (${S.project.captions.length})? «Скасувати» — додати до наявних.`, 'Замінити', false);
  setCaptions(list, replace);
  showTab('captions');
  toast(`Імпортовано субтитрів: ${list.length}`, 'ok');
}

// ══════════ Права панель (властивості) ══════════
const box = () => $('inspector');
export function initInspector() {
  on('select', renderInspector);
  on('project', d => {
    if (d && d.from === 'insp') return;
    if (d && d.live && box().contains(document.activeElement)) return;
    // текст субтитру змінюють у списку ліворуч — лише оновлюємо поле праворуч
    if (d && d.live && d.from === 'lib' && S.sel && S.sel.kind === 'caption') {
      const c = findSel(), ta = c && box().querySelector('textarea[data-f="text"]');
      if (ta) { if (ta.value !== c.text) ta.value = c.text; const sp = box().querySelector('[data-cc-speed]'); if (sp) sp.innerHTML = speedHtml(c); return; }
    }
    // автозбереження під час набору не чіпає поле, у якому людина пише
    if (typingIn(box()) && !(d && d.restored)) return;
    renderInspector();
  });
  on('media', () => { if (!S.sel) renderInspector(); });
  on('focus-inspector', () => {
    const f = box().querySelector('textarea, input[type=text]');
    if (f) { f.focus(); f.select?.(); }
  });
  box().addEventListener('input', onInput);
  box().addEventListener('change', onChange);
  box().addEventListener('click', onClick);
  // клік по значенню біля повзунка: ввести точне число з клавіатури
  box().addEventListener('click', e => {
    const a = e.target.closest('.prow .aux'); if (!a || a.querySelector('input')) return;
    const r = a.closest('.prow').querySelector('input[type=range]'); if (!r) return;
    const m = a.textContent.trim().match(/^(-?[\d.,]+)\s*(.*)$/); if (!m) return;
    const suffix = m[2], k = suffix === '%' ? 100 : 1;
    const inp = document.createElement('input');
    inp.className = 'aux-edit'; inp.type = 'text'; inp.inputMode = 'decimal'; inp.value = m[1].replace(',', '.'); inp.setAttribute('aria-label', 'Точне значення' + (suffix ? ', ' + suffix : ''));
    a.textContent = ''; a.appendChild(inp); inp.focus(); inp.select();
    let done = false;
    const fin = ok => {
      if (done) return; done = true;
      const v = parseFloat(inp.value.replace(',', '.'));
      if (ok && isFinite(v)) {
        const min = +r.min, max = +r.max, step = +r.step || 0.01;
        let x = Math.min(max, Math.max(min, v / k));
        x = Math.round(x / step) * step; x = +x.toFixed(4);
        r.value = String(x);
        r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true }));
      }
      renderInspector();
    };
    inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') fin(true); else if (ev.key === 'Escape') { ev.preventDefault(); fin(false); } });
    inp.addEventListener('blur', () => fin(true));
  });
  box().addEventListener('toggle', e => { const d = e.target.closest && e.target.closest('details[data-more]'); if (d) { if (d.open) openMore.add(d.dataset.more); else openMore.delete(d.dataset.more); if (d.open && d.classList.contains('fold') && !d.querySelector('.fold-body')) renderInspector(); } }, true);
  renderInspector();
}

function swatches(cur, key) {
  return `<div class="swatches">${COLORS.map(c => `<button class="sw${String(cur).toLowerCase() === c.toLowerCase() ? ' on' : ''}" style="background:${c}" data-sw="${key}" data-c="${c}" aria-label="${c}"></button>`).join('')}
    <label class="sw sw-custom" data-tip="Свій колір"><input type="color" value="${/^#[0-9a-f]{6}$/i.test(cur) ? cur : '#ffffff'}" data-color="${key}"></label></div>`;
}
// ── рядки властивостей: підпис ліворуч, керування праворуч; усе в одному вигляді ──
const aux = (f, show) => `<span class="aux" data-show="${f}">${show}</span>`;
const range = (f, label, min, max, step, val, unit = '', show = null, pct = false) =>
  `<div class="prow"><label>${label}</label><input type="range" data-f="${f}" min="${min}" max="${max}" step="${step}" value="${val}" data-unit="${unit}"${pct ? ' data-pct="1"' : ''} aria-label="${label}">${aux(f, show ?? String(val).replace('.', ',') + unit)}</div>`;
const near = (a, b) => Math.abs(+a - +b) < 1e-6;
// короткі варіанти — в одному рядку з підписом, довгі — підпис зверху
const seg = (f, label, opts, cur, hint = '') => {
  const long = opts.length > 4 || opts.reduce((s, [, n]) => s + String(n).replace(/<[^>]*>/g, '').length, 0) > (opts.length > 3 ? 14 : 17);
  return `<div class="prow${long ? ' stack' : ' wide'}"><label>${label}</label><div class="seg">${opts.map(([v, n]) => `<button data-set="${f}" data-v="${v}" class="${String(cur) === String(v) || (!isNaN(+v) && !isNaN(+cur) && near(v, cur)) ? 'on' : ''}">${n}</button>`).join('')}</div></div>${hint ? `<p class="hint">${hint}</p>` : ''}`;
};
const timeField = (f, label, val) => `<div class="field half"><label>${label}</label><input class="input" data-time="${f}" value="${fmt(val, true)}" inputmode="decimal"></div>`;
// швидкі дії під заголовком: з підписами, а не безіменні значки
const actions = (...btns) => `<div class="iquick">${btns.join('')}</div>`;
const act = (a, ic, label, extra = '') => `<button class="btn btn-outline btn-sm" data-a="${a}" data-tip="${label}" aria-label="${label}" ${extra}>${icon(ic)}<span>${label}</span></button>`;
// перемикач: вмикає значення `on`, вимикає в 0/false
const tgl = (f, label, cur, on, hint = '') => `<div class="prow"><label>${label}</label><button type="button" class="tgl${cur ? ' on' : ''}" role="switch" aria-checked="${!!cur}" aria-label="${label}" data-toggle="${f}" data-on="${on}"><i></i></button></div>${hint ? `<p class="hint">${hint}</p>` : ''}`;
// стара назва: кнопка-чіп лишається для субтитрів (cc-panel.js)
const chip = (f, label, cur, on, ic) => `<button class="chip${cur ? ' on' : ''}" data-toggle="${f}" data-on="${on}">${icon(cur ? 'check' : ic)}${label}</button>`;
// згорнутий розділ (лише там, де вміст справді рідко потрібен)
const openMore = new Set();
const fold = (key, label, val, build) => `<details class="fold" data-more="${key}" ${openMore.has(key) ? 'open' : ''}><summary><span>${label}</span><b>${val}</b></summary>${openMore.has(key) ? `<div class="fold-body">${build()}</div>` : ''}</details>`;
const more = (key, html) => `<details class="more" data-more="${key}" ${openMore.has(key) ? 'open' : ''}><summary>Точніше</summary><div class="more-body">${html}</div></details>`;

// розділ: назва й кнопка «Скинути» (ключі:значення через кому; 'del' — прибрати поле)
// Ключові кадри: рух, положення й масштаб у часі
const kindOfSel = () => (S.sel && S.sel.kind === 'clip' ? 'clip' : 'overlay');
function motionSec(kind, o) {
  const has = hasKf(o), here = keyHere(kind, o), len = itemLength(kind, o);
  const list = has ? o.kf.map(k => `<button type="button" class="kf-chip${here === k ? ' on' : ''}" data-a="kfGo" data-v="${k.t}" data-tip="Перейти до ключового кадру">${fmt(k.t, true)}</button>`).join('') : '';
  return sec('Рух у часі', `<p class="hint">${has ? 'Змініть положення чи масштаб у іншому місці кліпа, і кадр запишеться сам. Між ключовими кадрами рух плавний.' : 'Поставте ключовий кадр, перейдіть далі за часом і змініть положення чи масштаб. Рух виникне сам.'}</p>
    <div class="kfbar"><button type="button" class="btn btn-sm ${here ? 'btn-outline' : 'btn-primary'}" data-a="kfAdd">${icon('kf')}${here ? 'Прибрати кадр тут' : 'Ключовий кадр тут'}</button>
    ${has ? `<button type="button" class="btn btn-sm btn-icon" data-a="kfStep" data-v="-1" data-tip="Попередній ключовий кадр" aria-label="Попередній ключовий кадр">${icon('chevL')}</button><button type="button" class="btn btn-sm btn-icon" data-a="kfStep" data-v="1" data-tip="Наступний ключовий кадр" aria-label="Наступний ключовий кадр">${icon('chevR')}</button>` : ''}</div>
    ${has ? `<div class="kflist">${list}</div><div class="iaction"><button type="button" class="btn btn-outline btn-sm btn-block" data-a="kfClear">Прибрати весь рух</button></div>` : ''}`);
}
const sec = (title, html, reset = '') => `<section class="isec"><h2 class="isec-h"><span>${title}</span>${reset ? `<button type="button" class="reset" data-a="reset" data-v="${reset}" data-tip="Повернути типові значення" aria-label="Скинути розділ «${title}»">Скинути</button>` : ''}</h2>${html}</section>`;

// вкладки: вміст будується лише для відкритої, пам'ятаємо вибір для кожного типу елемента
const inspTab = {};
function tabbed(kind, list) {
  const cur = list.some(t => t[0] === inspTab[kind]) ? inspTab[kind] : list[0][0];
  const body = list.find(t => t[0] === cur)[2];
  return `<div class="itabs" role="tablist" aria-label="Розділи параметрів">${list.map(([id, label]) => `<button type="button" role="tab" id="itab-${id}" aria-selected="${id === cur}" aria-controls="ipanel" data-a="itab" data-k="${kind}" data-v="${id}" class="${id === cur ? 'on' : ''}">${label}</button>`).join('')}</div>
    <div class="ipanel" id="ipanel" role="tabpanel" aria-labelledby="itab-${cur}">${body()}</div>`;
}
// типові значення для кнопки «Скинути»
function parseReset(spec) {
  return spec.split(',').map(p => { const i = p.indexOf(':'); const k = p.slice(0, i), v = p.slice(i + 1); return [k, v === 'del' ? undefined : v === 'true' ? true : v === 'false' ? false : v !== '' && !isNaN(+v) ? +v : v]; });
}

// панель праворуч з'являється лише коли є що налаштовувати: виділено елемент або відкрито параметри проєкту
let projOpen = false;
export function showProject(on = true) {
  projOpen = on;
  if (on && S.sel) select(null); else renderInspector();
}
function renderInspector() { keepFocus(box(), drawInspector); }
function drawInspector() {
  const el = box();
  const o = findSel(), s = S.sel;
  if (o) projOpen = false;
  let html = '';
  if (S.multi.length > 1) html = multiPanel();
  else if (!o) html = projectPanel();
  else if (s.kind === 'clip') html = clipPanel(o);
  else if (s.kind === 'overlay') html = overlayPanel(o);
  else if (s.kind === 'caption') html = captionPanel(o);
  else if (s.kind === 'music') html = musicPanel(o);
  // перемальовування замінює панель — прокрутку вмісту зберігаємо (окрім переходу на іншу вкладку чи елемент)
  const sp = el.querySelector('.ipanel'), keepTop = sp && !resetScroll && el.dataset.who === inspWho() ? sp.scrollTop : 0;
  resetScroll = false;
  el.dataset.who = inspWho();
  if (setHtml(el, html)) balanceSegs(el);
  const np = el.querySelector('.ipanel'); if (np && keepTop) np.scrollTop = keepTop;
}
let resetScroll = false;
const inspWho = () => (S.multi.length > 1 ? 'multi' : S.sel ? S.sel.kind + ':' + S.sel.id : 'project') + ':' + JSON.stringify(inspTab);

function head(ic, title, sub) {
  return `<div class="insp-head"><span class="insp-ico">${icon(ic)}</span><div><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
    <button class="btn btn-icon btn-sm" data-a="deselect" data-tip="Готово (Esc)">${icon('x')}</button></div>`;
}

// ── Проєкт ──
function projectPanel() {
  const p = S.project;
  const FORMATS = [['16:9', 'YouTube, урок', 'r169'], ['9:16', 'Reels, Shorts', 'r916'], ['1:1', 'Квадрат', 'r11'], ['4:3', 'Класичний', 'r43']];
  const { W, H } = outputSize();
  return `<div class="insp-head"><span class="insp-ico">${icon('film')}</span><div><b>Проєкт</b><small>${p.clips.length ? fmtShort(duration()) : 'Порожній'} · ${W}×${H}</small></div></div>
    <div class="ipanel solo">
    ${sec('Основне', `<div class="prow stack"><label for="pfName">Назва</label><input id="pfName" class="input" data-pf="name" value="${esc(p.name)}" maxlength="80"></div>`)}
    ${sec('Формат кадру', `<div class="fmt-cards">${FORMATS.map(([v, n, cls]) => `<button class="fmt-card${p.aspect === v ? ' on' : ''}" data-set="p:aspect" data-v="${v}" title="${n}" aria-label="${v}, ${n}"><i class="fmt-shape ${cls}"></i><b>${v}</b></button>`).join('')}</div>
      ${seg('p:fps', 'Кадрів за секунду', [[24, '24'], [25, '25'], [30, '30'], [60, '60']], p.fps, '30 — стандарт. 60 — для плавних рухів мишею чи ігор.')}`)}
    ${sec('Фон', `<div class="prow stack"><label>Колір там, де немає відео</label>${swatches(p.bg, 'p:bg')}</div>`)}
    <p class="hint">Виділіть кліп чи елемент на таймлайні, щоб налаштувати його. Кілька елементів: Shift+клік або рамка.</p></div>`;
}

// ── Кілька елементів ──
function multiPanel() {
  const names = { clip: 'кліп', overlay: 'накладання', caption: 'субтитр', music: 'звук' }, count = {};
  S.multi.forEach(x => { count[x.kind] = (count[x.kind] || 0) + 1; });
  const list = Object.entries(count).map(([k, n]) => `<li><b>${n}</b> ${names[k]}</li>`).join('');
  return `<div class="insp-head"><span class="insp-ico">${icon('shapes')}</span><div><b>Виділено: ${S.multi.length}</b><small>Групові дії</small></div>
    <button class="btn btn-icon btn-sm" data-a="deselect" data-tip="Зняти виділення (Esc)">${icon('x')}</button></div>
    ${actions(act('dup', 'copy', 'Дублювати'), act('copy', 'copy', 'Копіювати'), act('del', 'trash', 'Видалити', 'data-danger="1"'))}
    <div class="ipanel solo">${sec('Що виділено', `<ul class="multi-list">${list}</ul>`)}
    <p class="hint">Перетягніть будь-який виділений елемент, щоб зсунути всю групу. Shift+клік додає чи знімає елемент. Ctrl+A виділяє все.</p></div>`;
}

// ── Кліп ──
function clipPanel(c) {
  const m = media.get(c.mediaId);
  const l = layout().find(x => x.clip.id === c.id);
  const isImg = m && m.kind === 'image';
  const sp = c.speed || 1, z = c.zoom || 1;
  const sub = l ? `${fmt(l.start, true)} – ${fmt(l.end, true)} · ${fmtShort(clipDur(c))}` : '';
  const idx = S.project.clips.indexOf(c);
  const { W, H } = outputSize();
  const side = (((c.rot || 0) % 360) + 360) % 360 % 180 === 90;
  const mw = m ? (side ? m.height : m.width) : W, mh = m ? (side ? m.width : m.height) : H;
  const otherShape = m && Math.abs(mw / mh - W / H) > 0.02;
  const speedHint = sp === 1 ? '' : sp > 1 ? 'Голос залишиться природним, без «мультяшного» ефекту.' : 'Уповільнення зручне, щоб показати швидкі дії.';
  const frame = () => sec('Масштаб і положення', `${range('zoom', 'Наближення', 1, 4, 0.05, z, '×', z.toFixed(2).replace('.', ',') + '×')}
      ${z > 1.001 ? '<p class="hint">Перетягніть хрестик на перегляді туди, що треба показати ближче.</p>' : ''}`, 'zoom:1,zx:0.5,zy:0.5') + motionSec('clip', c) +
    sec('Поворот і дзеркало', `<div class="prow stack"><div class="seg"><button data-a="rot" data-v="-90" aria-label="Повернути вліво">${icon('rotL')}</button><button data-a="rot" data-v="90" aria-label="Повернути вправо">${icon('rotR')}</button><button data-a="flip" class="${c.flip ? 'on' : ''}" aria-label="Дзеркало">${icon('flipH')}</button></div></div>
      <p class="hint">Для відео з телефона, знятого боком.</p>`, 'rot:0,flip:false') +
    sec('Поля кадру', seg('fit', 'Чим заповнити', [['blur', 'Розмиті'], ['contain', 'Чорні'], ['cover', 'Обрізати']], c.fit || 'contain', otherShape ? 'Форма відео відрізняється від кадру проєкту.' : ''), 'fit:blur') +
    sec('Рух кадру', seg('motion', 'Повільний рух', Object.entries(MOTIONS), c.motion || 'none'), 'motion:none');
  const sound = () => sec('Гучність', `${tgl('muted', 'Без звуку', !!c.muted, 'true')}
      ${c.muted ? '' : range('volume', 'Гучність', 0, 2, 0.05, c.volume ?? 1, '%', Math.round((c.volume ?? 1) * 100) + '%', true)}`, 'volume:1,muted:false') +
    `<div class="iaction"><button class="btn btn-outline btn-sm btn-block" data-a="norm">${icon('volume')}Вирівняти гучність</button></div>`;
  const time = () => (isImg
    ? sec('Скільки показувати', `<div class="prow stack"><label>Тривалість</label><div class="seg">${[3, 5, 8, 10].map(v => `<button data-a="imgDur" data-v="${v}" class="${near(clipDur(c), v) ? 'on' : ''}">${v} с</button>`).join('')}</div></div>`)
    : sec('Швидкість', seg('speed', 'Темп', [[0.5, '0,5×'], [1, '1×'], [1.25, '1,25×'], [1.5, '1,5×'], [2, '2×']], sp, speedHint))) +
    sec('Поява й зникнення', `${range('fadeIn', 'Поява', 0, 3, 0.1, c.fadeIn || 0, ' с')}${range('fadeOut', 'Зникнення', 0, 3, 0.1, c.fadeOut || 0, ' с')}`, 'fadeIn:0,fadeOut:0') +
    (idx > 0 ? sec('Перехід до цього кліпу', `<div class="tr-grid">${[['', 'Немає']].concat(Object.entries(TRANSITIONS)).map(([k, n]) => `<button data-a="tr" data-v="${k}" class="tr-card tr-${k || 'none'}${(c.tr ? c.tr.type : '') === k ? ' on' : ''}"><i></i><small>${n}</small></button>`).join('')}</div>
        ${c.tr ? range('tr.d', 'Тривалість', 0.2, 2, 0.1, c.tr.d || 0.6, ' с') : ''}
        <button class="btn btn-sm btn-block btn-ghost-sm" data-a="trAll">${icon('sparkle')}${S.project.clips.slice(1).every(x => x.tr) ? 'Прибрати переходи всюди' : 'Переходи між усіма кліпами'}</button>`, 'tr:del') : '') +
    (isImg ? '' : `<div class="iaction"><button class="btn btn-outline btn-sm btn-block" data-a="freeze">${icon('camera')}Стоп-кадр (3 с)</button></div><p class="hint">Фрагмент ${fmt(c.in)}–${fmt(c.out)} з файлу тривалістю ${fmt(m ? m.duration : 0)}.</p>`);
  const look = () => sec('Фільтр', m ? lookCards(c, m) : '<p class="hint">Файл недоступний.</p>', 'look:none') +
    (FILTERS_OK ? sec('Колір', `${range('bri', 'Яскравість', 0.5, 1.6, 0.02, c.bri ?? 1, '%', Math.round((c.bri ?? 1) * 100) + '%')}${range('con', 'Контраст', 0.5, 1.8, 0.02, c.con ?? 1, '%', Math.round((c.con ?? 1) * 100) + '%')}${range('sat', 'Насиченість', 0, 2, 0.02, c.sat ?? 1, '%', Math.round((c.sat ?? 1) * 100) + '%')}`, 'bri:1,con:1,sat:1') : '');
  const tabs = [['frame', 'Кадр', frame]];
  if (!isImg) tabs.push(['sound', 'Звук', sound]);
  tabs.push(['time', 'Час', time], ['look', 'Вигляд', look]);
  return head(isImg ? 'image' : 'video', m ? m.name : 'Кліп', sub) +
    actions(act('split', 'split', 'Розрізати', 'data-key="S"'), act('dup', 'copy', 'Дублювати'), act('del', 'trash', 'Видалити', 'data-danger="1"')) +
    tabbed('clip', tabs);
}


// мініатюри фільтрів з кадру цього кліпу
const lookCache = new Map();
function lookCards(c, m) {
  if (!m) return '';
  const src = m.kind === 'image' ? m.el : thumbAt(m, c.in + Math.min(1.5, (c.out - c.in) / 2));
  const key = c.mediaId + ':' + (src ? (m.kind === 'image' ? 'img' : m.thumbs.length) : 'none') + ':' + Math.round(c.in);
  let urls = lookCache.get(key);
  if (!urls && src) {
    urls = {};
    const cv = document.createElement('canvas'); cv.width = 96; cv.height = 54;
    const g = cv.getContext('2d');
    const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
    for (const k of Object.keys(LOOKS)) {
      g.clearRect(0, 0, 96, 54);
      const r = Math.max(96 / sw, 54 / sh), dw = sw * r, dh = sh * r;
      const f = FILTERS_OK ? lookFilter({ look: k }) : 'none';
      if (f !== 'none') g.filter = f;
      g.drawImage(src, (96 - dw) / 2, (54 - dh) / 2, dw, dh);
      g.filter = 'none';
      applyLookOverlay(g, { look: k }, 96, 54);
      urls[k] = cv.toDataURL('image/jpeg', 0.75);
    }
    lookCache.set(key, urls);
  }
  const cur = c.look || 'none';
  return `<div class="field"><div class="look-grid">${Object.entries(LOOKS).map(([k, v]) => `<button class="look-card${cur === k ? ' on' : ''}" data-set="look" data-v="${k}">${urls ? `<img src="${urls[k]}" alt="">` : '<i></i>'}<small>${v.name}</small></button>`).join('')}</div>
    ${FILTERS_OK ? '' : '<p class="hint">У цьому браузері частина фільтрів недоступна — краще відкрити редактор у Chrome чи Edge.</p>'}</div>`;
}

// ── Текст і елементи ──
const OV_NAMES = { video: 'Відео поверх', text: 'Текст', rect: 'Рамка', arrow: 'Стрілка', blur: 'Розмиття', spot: 'Прожектор', image: 'Зображення', emoji: 'Емодзі', progress: 'Прогрес-бар' };
const OV_ICONS = { video: 'pip', text: 'text', rect: 'rect', arrow: 'arrow', blur: 'blur', spot: 'spot', image: 'image', emoji: 'smile', progress: 'progress' };
const STYLES = [['shadow', 'Тінь'], ['outline', 'Контур'], ['box', 'Плашка'], ['none', 'Просто']];

// ── час показу накладання ──
function timing(o) {
  const end = mainEnd();
  const toEnd = end > o.start + 0.3 && near(o.start + o.dur, end);
  return sec('Коли показувати', `<div class="insp-row">${timeField('start', 'Початок', o.start)}${timeField('dur', 'Тривалість', o.dur)}</div>
    <div class="prow stack"><label>Швидко</label><div class="seg">${[2, 4, 8].map(v => `<button data-a="durPreset" data-v="${v}" class="${near(o.dur, v) ? 'on' : ''}">${v} с</button>`).join('')}<button data-a="durPreset" data-v="end" class="${toEnd ? 'on' : ''}" ${end > o.start + 0.3 ? '' : 'disabled'}>До кінця</button></div></div>
    <div class="iaction"><button class="btn btn-outline btn-sm btn-block" data-a="toCursor">${icon('stepFwd')}Почати з курсора</button></div>`) +
    (o.type === 'progress' ? '' : sec('Як з’являється', animSeg(o), 'anim:none,fade:false'));
}

// ── відео чи фото поверх (доріжка «Відео 2») ──
function layerPanel(o) {
  const m = media.get(o.mediaId), video = o.type === 'video';
  if (video && o.shadow == null) o.shadow = true;
  const lo = layoutOf(o), cs = cropSides(o);
  const cropped = cs.l + cs.r + cs.t + cs.b > 0.004;
  const shape = o.shape || (video ? 'circle' : 'rect');
  const cropR = (side, label) => `<div class="prow"><label>${label}</label><input type="range" data-l="crop" data-side="${side}" min="0" max="0.9" step="0.005" value="${cs[side]}" aria-label="${label}"><span class="aux" data-show="crop-${side}">${Math.round(cs[side] * 100)}%</span></div>`;
  const place = () => sec('Розташування', `<div class="layouts">${Object.entries(LAYOUTS).map(([k, n]) => `<button data-a="layout" data-v="${k}" class="lo-${k}${lo === k ? ' on' : ''}"><i></i>${n}</button>`).join('')}</div>
      ${['full', 'left', 'right', 'top', 'bottom'].includes(lo) ? '' : `<div class="prow wide"><label>Кут</label><div class="corner-grid">${[['tl', '↖', 'угорі ліворуч'], ['tr', '↗', 'угорі праворуч'], ['bl', '↙', 'внизу ліворуч'], ['br', '↘', 'внизу праворуч']].map(([v, n, t]) => `<button data-a="pipCorner" data-v="${v}" aria-label="${t}">${n}</button>`).join('')}</div></div>`}
      <div class="prow"><label>Розмір</label><input type="range" data-l="scale" min="0.08" max="1" step="0.01" value="${Math.min(1, o.w)}" aria-label="Розмір"><span class="aux" data-show="scale">${Math.round(o.w * 100)}%</span></div>
      <p class="hint">Або перетягніть на перегляді. Кути змінюють розмір, бокові маркери обрізають.</p>`) +
    sec('Обрізка країв', `${cropR('l', 'Зліва')}${cropR('r', 'Справа')}${cropR('t', 'Зверху')}${cropR('b', 'Знизу')}`, cropped ? 'crop:del' : '') + motionSec('overlay', o);
  const view = () => sec('Форма', seg('shape', 'Форма', [['rect', 'Прямокутник'], ['round', 'Заокруглена'], ['circle', 'Коло']], shape)) +
    sec('Накладання', `${seg('blend', 'Режим', Object.entries(BLENDS), o.blend || 'normal', blendOf(o) ? 'Чорне тло футажа зникає, лишаються світлі частини.' : '')}
      ${range('opacity', 'Непрозорість', 0.1, 1, 0.01, o.opacity ?? 1, '%', Math.round((o.opacity ?? 1) * 100) + '%', true)}`, 'opacity:1,blend:normal') +
    sec('Рамка й тінь', `<div class="prow stack"><label>Колір рамки</label>${swatches(o.border && o.border !== 'none' ? o.border : '', 'border')}<button class="chip${!o.border || o.border === 'none' ? ' on' : ''}" data-a="noBorder" style="margin-top:6px">${icon('x')}Без рамки</button></div>
      ${video ? tgl('shadow', 'Тінь', !!o.shadow, 'true') : ''}${tgl('flip', 'Дзеркально', !!o.flip, 'true')}`);
  const key = () => keySection(o);
  const sound = () => sec('Звук', `${tgl('muted', 'Без звуку', !!o.muted, 'true')}${!o.muted ? range('volume', 'Гучність', 0, 2, 0.05, o.volume ?? 1, '%', Math.round((o.volume ?? 1) * 100) + '%', true) : ''}`, 'volume:1,muted:false');
  const time = () => (video ? sec('Фрагмент файлу', `<p class="hint">Файл ${fmt(o.in || 0)}–${fmt((o.in || 0) + o.dur)}${m ? ` з ${fmt(m.duration)}` : ''}. Краї на доріжці «Поверх» обрізають початок і кінець.</p>
      <div class="iaction"><button class="btn btn-outline btn-sm btn-block" data-a="pipSync">${icon('fit')}Разом з відео</button></div>`) : '') + timing(o);
  const tabs = [['place', 'Положення', place], ['view', 'Вигляд', view], ['key', 'Фон', key]];
  if (video) tabs.push(['sound', 'Звук', sound]);
  tabs.push(['time', 'Час', time]);
  return head(video ? 'pip' : 'image', video ? 'Відео поверх' : 'Зображення поверх', m ? m.name : '') +
    actions(act('split', 'split', 'Розрізати', 'data-key="S"'), act('dup', 'copy', 'Дублювати'), act('front', 'front', 'Наперед'), act('del', 'trash', 'Видалити', 'data-danger="1"')) +
    tabbed('layer', tabs);
}

// ── хромакей (зелений екран): прибирає однотонний фон у відео чи картинки поверх ──
function keySection(o) {
  const K = { ...KEY_DEFAULT, ...(o.key || {}) }, on = !!K.on;
  const sl = (f, label, min, max, step, val) => range('key.' + f, label, min, max, step, val, '%', Math.round(val * 100) + '%', true);
  return sec('Зелений екран', `<div class="prow"><label>Прибрати фон</label><button type="button" class="tgl${on ? ' on' : ''}" role="switch" aria-checked="${on}" aria-label="Прибрати фон" data-a="keyToggle"><i></i></button></div>
    ${on ? `<div class="prow stack key-row"><label>Колір фону</label><div class="key-pick"><input type="color" class="key-color" data-f="key.color" value="${K.color}" aria-label="Колір фону"><button class="btn btn-outline btn-sm" data-a="keyPick" data-tip="Клікніть на зелений фон на перегляді">${icon('dropper')}<span>${S.pickKey === o.id ? 'Клікніть по фону…' : 'Піпетка'}</span></button><button class="btn btn-outline btn-sm" data-a="keyAuto" data-tip="Знайти колір фону по краях кадру">${icon('wand')}Знайти</button></div></div>
      ${sl('tol', 'Наскільки прибирати', 0.02, 0.6, 0.005, K.tol)}${sl('soft', 'М’який край', 0.01, 0.4, 0.005, K.soft)}${sl('spill', 'Зелений відблиск', 0, 1, 0.01, K.spill)}
      ${sl('clean', 'Чистота фону', 0, 1, 0.01, K.clean)}${sl('choke', 'Стиснути край', 0, 1, 0.01, K.choke)}
      <div class="prow"><label>Показати маску</label><button type="button" class="tgl${S.keyMatte === o.id ? ' on' : ''}" role="switch" aria-checked="${S.keyMatte === o.id}" aria-label="Показати маску" data-a="keyMatte"><i></i></button></div>
      <p class="hint">Постав фон під людиною: основне відео чи картинку. Маска: біле лишається, чорне зникає.</p>` : '<p class="hint">Вимкнено. Увімкніть, щоб прибрати однотонний фон (наприклад, зелений).</p>'}`, on ? 'key:del' : '');
}

function animSeg(o) {
  if (o.type === 'progress') return '';
  const keys = o.type === 'text' ? Object.keys(ANIMS) : (o.type === 'blur' || o.type === 'spot') ? ['none', 'fade'] : ['none', 'fade', 'up', 'pop'];
  return seg('anim', 'Ефект', keys.map(k => [k, ANIMS[k]]), animOf(o));
}

function overlayPanel(o) {
  if (isLayer(o)) return layerPanel(o);
  let look = null, text = null;
  if (o.type === 'text') {
    text = () => sec('Текст', `<div class="prow stack"><textarea class="input" rows="3" data-f="text" spellcheck="true" placeholder="Введіть текст" aria-label="Текст">${esc(o.text)}</textarea></div>`) +
      sec('Положення', `<div class="prow stack"><label>Де розмістити</label><div class="seg">${[['top', 'Вгорі'], ['middle', 'По центру'], ['bottom', 'Внизу']].map(([v, n]) => `<button data-a="place" data-v="${v}">${n}</button>`).join('')}</div></div>
        <div class="prow wide"><label>Вирівнювання</label><div class="seg">${[['left', 'alignL', 'ліворуч'], ['center', 'alignC', 'по центру'], ['right', 'alignR', 'праворуч']].map(([v, ic, t]) => `<button data-set="align" data-v="${v}" class="${(o.align || 'left') === v ? 'on' : ''}" aria-label="${t}">${icon(ic)}</button>`).join('')}</div></div>
        <p class="hint">Або просто перетягніть текст на перегляді.</p>`);
    look = () => sec('Стиль', `<div class="style-grid">${STYLES.map(([v, n]) => `<button class="style-card st-${v}${(o.bg || 'none') === v ? ' on' : ''}" data-set="bg" data-v="${v}"><span>Aa</span><small>${n}</small></button>`).join('')}</div>`, 'bg:none') +
      sec('Шрифт', `${range('size', 'Розмір', 20, 220, 1, o.size)}${seg('weight', 'Товщина', [[400, 'Звичайні'], [600, 'Напівжирні'], [800, 'Жирні']], o.weight || 700)}
        <div class="prow stack"><label>Колір тексту</label>${swatches(o.color, 'color')}</div>`) +
      (o.bg === 'box' || o.bg === 'outline' ? sec(o.bg === 'box' ? 'Плашка' : 'Контур', `<div class="prow stack"><label>Колір</label>${swatches(o.bgColor || '#000000', 'bgColor')}</div>${o.bg === 'box' ? range('bgAlpha', 'Прозорість', 0.2, 1, 0.05, o.bgAlpha ?? 0.7, '%', Math.round((o.bgAlpha ?? 0.7) * 100) + '%') : ''}`) : '');
  } else if (o.type === 'rect' || o.type === 'arrow') {
    const cur = o.stroke || (o.type === 'arrow' ? 10 : 8);
    look = () => sec('Лінія', `<div class="prow stack"><label>Колір</label>${swatches(o.color, 'color')}</div>
      ${seg('stroke', 'Товщина', [[5, 'Тонка'], [10, 'Середня'], [16, 'Товста']], [5, 10, 16].reduce((a, b) => (Math.abs(b - cur) < Math.abs(a - cur) ? b : a)))}
      ${range('stroke', 'Точна товщина', 2, 30, 1, cur)}
      <p class="hint">${o.type === 'arrow' ? 'Тягніть кінці стрілки на перегляді.' : 'Тягніть рамку та її кути на перегляді.'}</p>`) +
      (o.type === 'rect' ? sec('Форма', `${range('radius', 'Кути', 0, 80, 1, o.radius ?? 16)}${seg('fill', 'Заливка', [['false', 'Немає'], ['true', 'Напівпрозора']], String(!!o.fill))}`) : '');
  } else if (o.type === 'blur') {
    const st = o.strength || 20;
    look = () => sec('Розмиття', `${seg('strength', 'Сила', [[10, 'Слабке'], [20, 'Середнє'], [40, 'Сильне']], [10, 20, 40].reduce((a, b) => (Math.abs(b - st) < Math.abs(a - st) ? b : a)))}
      ${range('strength', 'Точна сила', 6, 60, 1, st)}${seg('pixel', 'Вигляд', [['false', 'Розмиття'], ['true', 'Пікселі']], String(!!o.pixel))}
      <p class="hint">Перетягніть область на перегляді туди, де пароль, пошта чи обличчя, і змініть розмір за кути.</p>`);
  } else if (o.type === 'spot') {
    const d = o.dim ?? 0.6;
    look = () => sec('Прожектор', `${seg('dim', 'Затемнення', [[0.4, 'Легке'], [0.6, 'Середнє'], [0.8, 'Сильне']], [0.4, 0.6, 0.8].reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a)))}
      ${range('dim', 'Точне затемнення', 0.2, 0.9, 0.02, d, '%', Math.round(d * 100) + '%')}${seg('shape', 'Форма', [['rect', 'Прямокутник'], ['ellipse', 'Овал']], o.shape || 'rect')}
      <p class="hint">Усе, крім світлої області, затемниться. Увага глядача буде саме там.</p>`);
  } else if (o.type === 'emoji') {
    look = () => sec('Емодзі', `<div class="emoji-grid sm">${EMOJIS.map(e => `<button data-set="emoji" data-v="${e}" class="${o.emoji === e ? 'on' : ''}">${e}</button>`).join('')}</div><p class="hint">Перетягніть емодзі на перегляді, розмір змінюйте за кути.</p>`);
  } else if (o.type === 'progress') {
    look = () => sec('Смужка', `<div class="prow stack"><label>Колір</label>${swatches(o.color || '#4F6BF4', 'color')}</div>
      ${seg('h', 'Товщина', [[0.008, 'Тонка'], [0.015, 'Середня'], [0.03, 'Товста']], [0.008, 0.015, 0.03].reduce((a, b) => (Math.abs(b - o.h) < Math.abs(a - o.h) ? b : a)))}
      <div class="prow wide"><label>Де</label><div class="seg"><button data-a="pbPos" data-v="bottom" class="${o.y > 0.5 ? 'on' : ''}">Внизу</button><button data-a="pbPos" data-v="top" class="${o.y <= 0.5 ? 'on' : ''}">Вгорі</button></div></div>
      <div class="iaction"><button class="btn btn-outline btn-sm btn-block" data-a="pbFull">${icon('fit')}На все відео</button></div>`);
  }
  const tabs = [];
  if (text) tabs.push(['text', 'Текст', text]);
  tabs.push(['look', 'Вигляд', look], ['time', 'Час', () => timing(o) + motionSec('overlay', o) + `<div class="iaction"><button class="btn btn-outline btn-sm btn-block" data-a="front">${icon('front')}Перенести наперед</button></div>`]);
  return head(OV_ICONS[o.type], OV_NAMES[o.type], `${fmt(o.start, true)} – ${fmt(o.start + o.dur, true)}`) +
    actions(act('dup', 'copy', 'Дублювати'), act('del', 'trash', 'Видалити', 'data-danger="1"')) +
    tabbed('ov-' + o.type, tabs);
}

function captionPanel(c) {
  const list = [...S.project.captions].sort((a, b) => a.start - b.start), i = list.findIndex(x => x.id === c.id);
  const text = () => sec('Текст субтитра', `<div class="prow stack"><textarea class="input" rows="4" data-f="text" spellcheck="true" placeholder="Що говориться в цей момент" aria-label="Текст субтитра">${esc(c.text)}</textarea></div><p class="cc-speed" data-cc-speed>${speedHtml(c)}</p>`) +
    sec('Перехід між субтитрами', `<div class="row2 cc-nav"><button class="btn btn-sm btn-outline btn-grow" data-a="ccPrev" ${i > 0 ? '' : 'disabled'}>${icon('chevL')}Попередній</button><button class="btn btn-sm btn-outline btn-grow" data-a="ccNext" ${i < list.length - 1 ? '' : 'disabled'}>Наступний${icon('chevR')}</button></div>`);
  const time = () => sec('Коли показувати', `<div class="insp-row">${timeField('start', 'Початок', c.start)}${timeField('dur', 'Тривалість', c.dur)}</div><p class="hint">Перетягніть субтитр на таймлайні, щоб зсунути, або за краї, щоб змінити тривалість.</p>`);
  const look = () => sec('Вигляд', `<p class="hint">Шрифт, колір і положення спільні для всіх субтитрів. Перетягніть субтитр на перегляді, щоб змінити висоту.</p><div class="iaction"><button class="btn btn-outline btn-sm btn-block" data-a="ccStyle">${icon('cc')}Вигляд усіх субтитрів</button></div>`);
  return head('cc', `Субтитр ${i + 1} з ${list.length}`, `${fmt(c.start, true)} – ${fmt(c.start + c.dur, true)}`) +
    actions(act('ccSplit', 'split', 'Розділити'), i < list.length - 1 ? act('ccMerge', 'merge', 'Об\u2019єднати') : '', act('dup', 'copy', 'Дублювати'), act('del', 'trash', 'Видалити', 'data-danger="1"')) +
    tabbed('caption', [['text', 'Текст', text], ['time', 'Час', time], ['look', 'Вигляд', look]]);
}

function musicPanel(x) {
  const m = media.get(x.mediaId);
  const v = x.volume ?? 1;
  const sound = () => sec('Гучність', `${seg('volume', 'Рівень', [[0.2, 'Тихо'], [0.4, 'Фон'], [0.7, 'Середньо'], [1, 'Повно']], [0.2, 0.4, 0.7, 1].reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a)), x.voice ? '' : 'Для музики під голос обирайте «Фон».')}
      ${range('volume', 'Точно', 0, 2, 0.05, v, '%', Math.round(v * 100) + '%', true)}`, 'volume:1') +
    (x.voice ? '' : sec('Музика під голос', `${tgl('duck', 'Тихіше, коли говорять', !!x.duck, 'true', x.duck ? 'Музика сама стишується, коли у відео звучить голос, і повертається в паузах.' : '')}`)) +
    `<div class="iaction"><button class="btn btn-outline btn-sm btn-block" data-a="norm">${icon('volume')}Вирівняти гучність</button></div>`;
  const time = () => sec('Поява й зникнення', `${range('fadeIn', 'Поява', 0, 5, 0.1, x.fadeIn || 0, ' с')}${range('fadeOut', 'Зникнення', 0, 8, 0.1, x.fadeOut || 0, ' с')}`, 'fadeIn:0,fadeOut:0') +
    sec('Коли звучить', `<div class="insp-row">${timeField('start', 'Початок', x.start)}<div class="field half"><label>Тривалість</label><div class="static">${fmtShort(musicDur(x))}</div></div></div>
      ${x.voice ? '' : `<div class="iaction"><button class="btn btn-outline btn-sm btn-block" data-a="fitMusic" ${mainEnd() > x.start ? '' : 'disabled'}>${icon('fit')}Підігнати під відео</button></div>`}`);
  return head(x.voice ? 'mic' : 'music', x.voice ? 'Ваш голос' : m ? m.name : 'Аудіо', `${fmt(x.start, true)} – ${fmt(x.start + musicDur(x), true)}`) +
    actions(act('split', 'split', 'Розрізати'), act('dup', 'copy', 'Дублювати'), act('del', 'trash', 'Видалити', 'data-danger="1"')) +
    tabbed('music', [['sound', 'Звук', sound], ['time', 'Час', time]]);
}

function keyToggle(o) {
  const was = !!(o.key && o.key.on);
  o.key = { ...KEY_DEFAULT, ...(o.key || {}), on: !was };
  if (!was) {
    // фон прозорий — рамка, коло й тінь тільки заважатимуть
    if (o.type === 'video' && (!o.shape || o.shape === 'circle')) o.shape = 'rect';
    o.border = 'none'; o.shadow = false;
    keyAuto(o, false);
  } else { S.keyMatte = null; S.pickKey = null; document.body.classList.remove('picking-key'); }
  commit(); renderInspector();
}
// колір фону береться зі зразків біля країв кадру
async function keyAuto(o, say) {
  const { autoKeyColor } = await import('./chroma.js');
  const { ovFrameNow } = await import('./player.js');
  const f = ovFrameNow(o);
  const hx = f && f.src ? autoKeyColor(f.src, f.w, f.h) : null;
  if (hx) { o.key = { ...KEY_DEFAULT, ...o.key, color: hx }; commit(); renderInspector(); if (say) toast('Колір фону знайдено: ' + hx); }
  else if (say) toast('Не вдалося знайти однотонний фон — оберіть колір піпеткою', 'err');
}

// ── обробка введення ──
let commitTimer = 0;
const softCommit = () => { clearTimeout(commitTimer); commitTimer = setTimeout(() => commit(), 500); };

function onInput(e) {
  const t = e.target;
  if (t.dataset.pf) { S.project[t.dataset.pf] = t.value; emit('project', { live: true, from: 'insp' }); emit('title'); softCommit(); return; }
  const o = findSel(); if (!o) return;
  if (t.dataset.l) {
    const v = +t.value;
    if (t.dataset.l === 'scale') setScale(o, v);
    else setCropSide(o, t.dataset.side, v);
    if (t.dataset.l === 'scale') autoKey('overlay', o);
    const sh = box().querySelector(`[data-show="${t.dataset.l === 'scale' ? 'scale' : 'crop-' + t.dataset.side}"]`);
    if (sh) sh.textContent = Math.round(v * 100) + '%';
    emit('project', { live: true, from: 'insp' });
    if (t.type !== 'range') softCommit(); // повзунок зберігається один раз — коли його відпустили (change)
    return;
  }
  if (t.dataset.f) {
    const f = t.dataset.f;
    let v = t.type === 'checkbox' ? t.checked : t.type === 'range' ? +t.value : t.value;
    if (f.includes('.')) { const [a, b] = f.split('.'); o[a] = { ...(o[a] || {}), [b]: v }; }
    else o[f] = v;
    if (S.sel && (S.sel.kind === 'clip' || S.sel.kind === 'overlay')) autoKey(kindOfSel(), o);
    const show = box().querySelector(`[data-show="${f}"]`);
    if (show) show.textContent = t.dataset.pct ? Math.round(v * 100) + '%' : t.dataset.unit === '%' ? Math.round(v * 100) + '%' : t.dataset.unit === '×' ? v.toFixed(2).replace('.', ',') + '×' : String(v).replace('.', ',') + (t.dataset.unit || '');
    if (S.sel.kind === 'caption') { const sp = box().querySelector('[data-cc-speed]'); if (sp) sp.innerHTML = speedHtml(o); }
    emit('project', { live: true, from: 'insp' });
    if (t.type !== 'range') softCommit();
    return;
  }
  if (t.dataset.color) { setColor(o, t.dataset.color, t.value); }
}
function onChange(e) {
  const t = e.target;
  if (t.dataset.time) {
    const o = findSel(); if (!o) return;
    const v = parseTime(t.value);
    if (!isFinite(v) || v < 0) { t.value = ''; renderInspector(); return; }
    const f = t.dataset.time;
    if (f === '_dur') { o.in = 0; o.out = Math.max(0.3, v); }
    else if (f === 'dur') o.dur = Math.max(0.2, v);
    else o[f] = v;
    commit();
    return;
  }
  if (t.dataset.l) { clearTimeout(commitTimer); commit(); renderInspector(); return; }
  if (t.dataset.f && t.type === 'range') { clearTimeout(commitTimer); commit(); if (t.dataset.f === 'zoom' || t.dataset.f === 'size') renderInspector(); }
  if (t.dataset.f === 'fade') commit();
  if (t.dataset.color) { clearTimeout(commitTimer); commit(); }
}
function setColor(o, key, val) {
  if (key.startsWith('p:')) S.project[key.slice(2)] = val;
  else o[key] = val;
  emit('project', { live: true, from: 'insp' });
  softCommit();
}

function onClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  const o = findSel();
  if (b.dataset.toggle) {
    if (!o) return;
    const f = b.dataset.toggle, on = b.dataset.on;
    const val = on === 'true' ? true : +on;
    o[f] = o[f] ? (on === 'true' ? false : 0) : val;
    commit(); return;
  }
  if (b.dataset.sw) {
    const key = b.dataset.sw;
    if (key.startsWith('p:')) S.project[key.slice(2)] = b.dataset.c; else if (o) o[key] = b.dataset.c;
    commit(); return;
  }
  if (b.dataset.set) {
    const f = b.dataset.set;
    let v = b.dataset.v;
    if (f.startsWith('p:')) {
      const k = f.slice(2);
      S.project[k] = k === 'fps' ? +v : v;
      commit(); emit('aspect'); return;
    }
    if (!o) return;
    if (v === 'true' || v === 'false') v = v === 'true';
    else if (!isNaN(+v) && f !== 'align' && f !== 'bg' && f !== 'fit' && f !== 'shape' && f !== 'emoji' && f !== 'motion') v = +v;
    if (f === 'anim') { o.anim = v; o.fade = v !== 'none'; commit(); return; }
    if (f === 'speed') {
      // зміна швидкості змінює довжину кліпу — зсуваємо все далі
      const l = layout().find(x => x.clip.id === o.id);
      const before = clipDur(o);
      o.speed = v;
      const delta = clipDur(o) - before;
      rippleShift(l.end + Math.min(0, delta), delta);
      commit();
      return;
    }
    if (isLayer(o) && f === 'shape') { setShape(o, v); commit(); return; }
    if (isLayer(o) && f === 'blend') {
      o.blend = v;
      if (v !== 'normal') { if (o.type === 'video' && (!o.shape || o.shape === 'circle')) o.shape = 'rect'; o.shadow = false; o.border = 'none'; } // тінь, коло й рамка заважають
      commit(); renderInspector(); return;
    }
    o[f] = v;
    if (o.type === 'progress' && f === 'h' && o.y > 0.5) o.y = 1 - v;
    commit(); return;
  }
  if (b.dataset.a && ccAction(b.dataset.a, o)) return;
  switch (b.dataset.a) {
    case 'deselect': select(null); break;
    case 'itab': inspTab[b.dataset.k] = b.dataset.v; resetScroll = true; renderInspector(); break;
    case 'copy': copySel(); break;
    case 'reset': if (o) {
      let aspect = false;
      for (const [k, v] of parseReset(b.dataset.v)) {
        if (k === 'crop') resetCrop(o);
        else if (v === undefined) delete o[k];
        else o[k] = v;
        if (k === 'rot' || k === 'fit') aspect = true;
      }
      commit(); if (aspect) emit('aspect'); renderInspector();
    } break;
    case 'kfAdd': if (o) {
      const kind = kindOfSel();
      if (keyHere(kind, o)) { removeKeyHere(kind, o); commit('Прибрано ключовий кадр'); } else { setKeyHere(kind, o); commit('Ключовий кадр'); }
      emit('project', { from: 'insp' }); renderInspector();
    } break;
    case 'kfClear': if (o) { delete o.kf; commit('Прибрано рух'); emit('project', { from: 'insp' }); renderInspector(); } break;
    case 'kfGo': if (o) { const kind = kindOfSel(); const l = kind === 'clip' ? layout().find(x => x.clip.id === o.id) : null; seek((kind === 'clip' ? (l ? l.start : 0) : o.start) + (+b.dataset.v)); } break;
    case 'kfStep': if (o && hasKf(o)) {
      const kind = kindOfSel(), cur = localTime(kind, o), dir = +b.dataset.v;
      const k = dir > 0 ? o.kf.find(x => x.t > cur + 0.03) : [...o.kf].reverse().find(x => x.t < cur - 0.03);
      if (k) { const l = kind === 'clip' ? layout().find(x => x.clip.id === o.id) : null; seek((kind === 'clip' ? (l ? l.start : 0) : o.start) + k.t); }
    } break;
    case 'closeProject': showProject(false); break;
    case 'split': splitAt(); break;
    case 'dup': duplicateSel(); break;
    case 'del': deleteSel(); break;
    case 'front': moveZ(1); break;
    case 'mute': if (o) { o.muted = !o.muted; commit(); } break;
    case 'toCursor': if (o) { o.start = S.t; commit(); } break;
    case 'fitMusic': if (o) trimMusicToVideo(o); break;
    case 'norm': normalizeSel(); break;
    case 'freeze': freezeFrame(3); break;
    case 'rot': if (o) { o.rot = ((((o.rot || 0) + +b.dataset.v) % 360) + 360) % 360; commit(); emit('aspect'); } break;
    case 'flip': if (o) { o.flip = !o.flip; commit(); } break;
    case 'pipSize': if (o) { const { W, H } = outputSize(); const w = +b.dataset.v, ratio = o.h / o.w; const right = o.x + o.w > 0.75, bottom = o.y + o.h > 0.75; o.w = w; o.h = (o.shape === 'circle' ? w * W / H : w * ratio); if (right) o.x = Math.min(o.x, 0.97 - o.w); if (bottom) o.y = Math.min(o.y, 0.95 - o.h); commit(); } break;
    case 'pipCorner': if (o) { const v = b.dataset.v; o.x = v.includes('l') ? 0.03 : 0.97 - o.w; o.y = v.includes('t') ? 0.05 : 0.95 - o.h; commit(); } break;
    case 'layout': if (o) { applyLayout(o, b.dataset.v); commit(); } break;
    case 'resetCrop': if (o) { resetCrop(o); commit(); } break;
    case 'noBorder': if (o) { o.border = 'none'; commit(); } break;
    case 'keyToggle': if (o) keyToggle(o); break;
    case 'keyPick': if (o) { S.pickKey = S.pickKey === o.id ? null : o.id; document.body.classList.toggle('picking-key', !!S.pickKey); if (S.pickKey) toast('Клікніть по зеленому фону на перегляді'); renderInspector(); } break;
    case 'keyAuto': if (o) keyAuto(o, true); break;
    case 'keyMatte': if (o) { S.keyMatte = S.keyMatte === o.id ? null : o.id; emit('project', { live: true, from: 'insp' }); renderInspector(); } break;
    case 'pipSync': if (o) { const m = media.get(o.mediaId); o.start = 0; o.in = 0; o.dur = m ? m.duration : o.dur; commit(); } break;
    case 'trAll': transitionsAll(); break;
    case 'tr': if (o) { if (b.dataset.v) o.tr = { type: b.dataset.v, d: (o.tr && o.tr.d) || 0.6 }; else delete o.tr; commit(); if (b.dataset.v) { const l = layout().find(x => x.clip.id === o.id); if (l) seek(Math.max(0, l.start - 0.8)); } } break;
    case 'silences': emit('open-silences'); break;
    case 'voice': emit('open-voice'); break;
    case 'asr': emit('open-asr'); break;
    case 'pbPos': if (o) { o.y = b.dataset.v === 'top' ? 0 : 1 - o.h; commit(); } break;
    case 'pbFull': if (o) { o.start = 0; o.dur = Math.max(1, mainEnd() || duration()); commit(); } break;
    case 'import': $('fileInput').dataset.target = ''; $('fileInput').click(); break;
    case 'export': emit('open-export'); break;
    case 'tab': showTab(b.dataset.v); document.body.classList.add('show-lib'); break;
    case 'imgDur': if (o) {
      const l = layout().find(x => x.clip.id === o.id);
      const before = clipDur(o);
      o.in = 0; o.out = +b.dataset.v * (o.speed || 1);
      const delta = clipDur(o) - before;
      rippleShift(l.end + Math.min(0, delta), delta);
      commit();
    } break;
    case 'durPreset': if (o) {
      o.dur = b.dataset.v === 'end' ? Math.max(0.3, mainEnd() - o.start) : +b.dataset.v;
      commit();
    } break;
    case 'place': if (o) {
      const h = textBoxes.get(o) || 0.12;
      o.y = b.dataset.v === 'top' ? 0.07 : b.dataset.v === 'middle' ? (1 - h) / 2 : 0.93 - h;
      commit();
    } break;
  }
}

export { renderInspector, renderLibrary, fmtBytes };

function addPip(m) {
  if (!S.project.clips.length) { toast('Спочатку додайте основне відео'); return; }
  const startAtZero = S.t < 1;
  const o = addOverlay('video', { mediaId: m.id, start: startAtZero ? 0 : S.t });
  if (o) toast('Відео додано в кутку — перетягніть, змініть розмір чи форму праворуч', 'ok', 4000);
}
