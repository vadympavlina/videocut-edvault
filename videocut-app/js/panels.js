// Ліва панель (медіа, текст, елементи, субтитри) і права панель властивостей.
import { S, media, on, emit, commit, select, findSel, layout, clipDur, musicDur, mainEnd, duration, rippleShift, outputSize } from './state.js';
import { MOTIONS, textBoxes, LOOKS, lookFilter, applyLookOverlay, FILTERS_OK, TRANSITIONS, ANIMS, animOf } from './render.js';
import { addToTimeline, addOverlay, addLayerAt, TEXT_PRESETS, splitAt, duplicateSel, deleteSel, moveZ, addCaption, setCaptions, trimMusicToVideo, CARD_STYLES, addTitleCard, normalizeSel, transitionsAll, freezeFrame } from './ops.js';
import { removeMedia, thumbAt } from './media.js';
import { seek } from './player.js';
import { parseSubtitles } from './srt.js';
import { renderCapTab, markActiveCaption, capTabClick, capTabInput, capTabChange, capTabToggle, captionInspector, ccAction, speedHtml } from './cc-panel.js';
import { isLayer, LAYOUTS, layoutOf, applyLayout, cropSides, setCropSide, setScale, setShape, resetCrop } from './layer.js';
import { $, esc, icon, fmt, fmtShort, parseTime, toast, confirmDialog, fmtBytes, balanceSegs, keepFocus, typingIn, setHtml } from './ui.js';

const COLORS = ['#ffffff', '#1a1d23', '#ef4444', '#f59e0b', '#ffd43b', '#10b981', '#0ea5e9', '#4F6BF4', '#8b5cf6', '#ec4899'];
const EMOJIS = ['👍', '👏', '✅', '❌', '⭐', '🔥', '❗', '❓', '💡', '📌', '👉', '👆', '😀', '😮', '🤔', '🎉', '❤️', '⚠️', '🏆', '📝', '🎯', '🚀', '⏰', '🔍'];

// ══════════ Ліва панель ══════════
let tab = 'media';
let mediaFilter = 'all';
const tabScroll = {};
export function initLibrary() {
  $('libTabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    tabScroll[tab] = $('libBody').scrollTop;
    tab = b.dataset.tab; renderLibrary();
    $('libBody').scrollTop = tabScroll[tab] || 0; // кожна вкладка пам'ятає, де ви зупинились
  });
  $('libBody').addEventListener('click', onLibClick);
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
  $('libTabs').querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
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
      ${items.length ? `<div class="mgrid">${items.map(m => {
        let url = thumbCache.get(m.id + ':' + m.thumbs.length);
        if (url === undefined && m.thumbs.length) { url = thumbURL(m); thumbCache.set(m.id + ':' + m.thumbs.length, url); }
        return `<div class="mcard${used.has(m.id) ? ' used' : ''}" data-id="${m.id}" title="${esc(m.name)}" draggable="true">
          <div class="mthumb">${url ? `<img src="${url}" alt="" draggable="false">` : icon(m.kind === 'audio' ? 'music' : m.kind === 'image' ? 'image' : 'video')}
            ${m.kind !== 'image' ? `<span class="mdur">${fmt(m.duration)}</span>` : ''}
            ${m.analyzing ? '<span class="mbusy"></span>' : ''}
            ${m.proxy && m.proxy.state === 'working' ? `<span class="mproxy" title="Готуємо легку копію для плавного перегляду. Експорт піде з оригіналу.">Копія ${Math.round(m.proxy.p * 100)}%</span>` : m.proxyUrl ? '<span class="mproxy ok" title="Перегляд іде з легкою копією (720p), а експорт — з оригіналу в повній якості.">720p</span>' : ''}
            <button class="mquick" data-act="add" data-tip="${m.kind === 'audio' ? 'Додати на звукову доріжку' : 'Додати в кінець таймлайну'}" aria-label="Додати на таймлайн">${icon('plus')}</button>
            <div class="mact">
              ${m.kind !== 'audio' && S.project.clips.length ? `<button class="btn btn-sm btn-icon" data-act="layer" data-tip="Поверх основного відео (доріжка «Поверх»)">${icon('pip')}</button>` : ''}
              <button class="btn btn-sm btn-icon" data-act="rm" data-tip="Прибрати з проєкту">${icon('trash')}</button>
            </div>
          </div>
          <div class="mname">${used.has(m.id) ? '<i class="mused" title="Використовується на таймлайні"></i>' : ''}${esc(m.name)}</div>
        </div>`;
      }).join('')}</div>` : all.length ? '<p class="lib-hint">Файлів такого типу ще немає.</p>' : '<p class="lib-hint">Усе обробляється у вашому браузері — нічого не завантажується на сервер.</p>'}`);
  } else if (tab === 'text') {
    setHtml(body, `<div class="lib-sub first">Готові написи</div><p class="lib-hint tight">Натисніть — напис з’явиться в позиції курсора.</p><div class="presets">${Object.entries(TEXT_PRESETS).map(([k, v]) => `
      <button class="preset pr-${k}" data-preset="${k}"><span class="pr-demo">${esc(v.o.text.split('\n')[0])}</span><span class="pr-name">${esc(v.label)}</span></button>`).join('')}</div>`);
  } else if (tab === 'elements') {
    const imgs = [...media.values()].filter(m => m.kind === 'image');
    const vids = [...media.values()].filter(m => m.kind === 'video');
    const el = (type, ic, name, sub) => `<button class="elem" data-el="${type}" title="${sub}">${icon(ic)}<b>${name}</b></button>`;
    setHtml(body, `<div class="lib-sub first">Пояснення на кадрі</div><div class="elems">
      ${el('arrow', 'arrow', 'Стрілка', 'Вказати на кнопку чи деталь')}
      ${el('rect', 'rect', 'Рамка', 'Обвести важливе')}
      ${el('spot', 'spot', 'Прожектор', 'Затемнити все, крім області')}
      ${el('blur', 'blur', 'Розмиття', 'Сховати пароль, пошту, обличчя')}
      ${el('progress', 'progress', 'Прогрес', 'Смужка внизу — скільки ще лишилось')}
    </div>
    <div class="lib-sub">Відео поверх відео</div>
    ${vids.length ? `<div class="mgrid">${vids.map(m => `<button class="mcard img-pick" data-pip="${m.id}" title="${esc(m.name)}"><div class="mthumb">${m.thumbs[0] ? `<img src="${thumbURL(m)}" alt="">` : icon('video')}<span class="mdur">${fmt(m.duration)}</span></div><div class="mname">${esc(m.name)}</div></button>`).join('')}</div>` : `<p class="lib-hint">Додайте ще одне відео (наприклад, запис з вебкамери) — і його можна буде показати в кружечку в кутку.</p>`}
    <div class="lib-sub">Емодзі-стікери</div>
    <div class="emoji-grid">${EMOJIS.map(e => `<button data-emoji="${e}" title="Додати ${e}">${e}</button>`).join('')}</div>
    <div class="lib-sub">Заставка з назвою</div>
    <div class="card-grid">${Object.entries(CARD_STYLES).map(([k, [a, b]]) => `<button class="card-pick" data-card="${k}" style="background:linear-gradient(135deg,${a},${b})" title="Додати заставку"><span style="color:${k === 'light' ? '#1a1d23' : '#fff'}">Аа</span></button>`).join('')}</div>
    <p class="lib-hint" style="margin-top:6px">3 секунди з великим заголовком — на початку відео або в місці курсора.</p>
    <div class="lib-sub">Зображення поверх відео</div>
    ${imgs.length ? `<div class="mgrid">${imgs.map(m => `<button class="mcard img-pick" data-img="${m.id}" title="${esc(m.name)}"><div class="mthumb">${m.thumbs[0] ? `<img src="${m.thumbs[0].c.toDataURL()}" alt="">` : icon('image')}</div><div class="mname">${esc(m.name)}</div></button>`).join('')}</div>` : ''}
    <button class="btn btn-outline btn-block" id="btnAddLogo">${icon('image')} Логотип або картинка…</button>`);
  } else if (tab === 'captions') renderCapTab(body);
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
  box().addEventListener('toggle', e => { const d = e.target.closest && e.target.closest('details[data-more]'); if (d) { if (d.open) openMore.add(d.dataset.more); else openMore.delete(d.dataset.more); if (d.open && d.classList.contains('fold') && !d.querySelector('.fold-body')) renderInspector(); } }, true);
  renderInspector();
}

function swatches(cur, key) {
  return `<div class="swatches">${COLORS.map(c => `<button class="sw${String(cur).toLowerCase() === c.toLowerCase() ? ' on' : ''}" style="background:${c}" data-sw="${key}" data-c="${c}" aria-label="${c}"></button>`).join('')}
    <label class="sw sw-custom" data-tip="Свій колір"><input type="color" value="${/^#[0-9a-f]{6}$/i.test(cur) ? cur : '#ffffff'}" data-color="${key}"></label></div>`;
}
const range = (f, label, min, max, step, val, unit = '', show = null) =>
  `<div class="field"><label>${label}<span class="aux" data-show="${f}">${show ?? String(val).replace('.', ',')}${unit}</span></label><input type="range" data-f="${f}" min="${min}" max="${max}" step="${step}" value="${val}" data-unit="${unit}"></div>`;
const near = (a, b) => Math.abs(+a - +b) < 1e-6;
const seg = (f, label, opts, cur, hint = '') =>
  `<div class="field"><label>${label}</label><div class="seg">${opts.map(([v, n]) => `<button data-set="${f}" data-v="${v}" class="${String(cur) === String(v) || (!isNaN(+v) && !isNaN(+cur) && near(v, cur)) ? 'on' : ''}">${n}</button>`).join('')}</div>${hint ? `<p class="hint">${hint}</p>` : ''}</div>`;
const timeField = (f, label, val) => `<div class="field half"><label>${label}</label><input class="input" data-time="${f}" value="${fmt(val, true)}" inputmode="decimal"></div>`;
const actions = (...btns) => `<div class="insp-actions">${btns.join('')}</div>`;
const act = (a, ic, label, extra = '') => `<button class="btn btn-outline btn-sm" data-a="${a}" data-tip="${label}" aria-label="${label}" ${extra}>${icon(ic)}<span>${label}</span></button>`;
// кнопка-перемикач: вмикає значення `on`, вимикає в 0/false
const chip = (f, label, cur, on, ic) => `<button class="chip${cur ? ' on' : ''}" data-toggle="${f}" data-on="${on}">${icon(cur ? 'check' : ic)}${label}</button>`;
// розгортання «Точніше» пам'ятає, чи було відкрите
const openMore = new Set();
// згорнутий розділ із поточним значенням у заголовку; вміст будується лише коли відкрито
const fold = (key, label, val, build) => `<details class="fold" data-more="${key}" ${openMore.has(key) ? 'open' : ''}><summary><span>${label}</span><b>${val}</b></summary>${openMore.has(key) ? `<div class="fold-body">${build()}</div>` : ''}</details>`;
const more = (key, html) => `<details class="more" data-more="${key}" ${openMore.has(key) ? 'open' : ''}><summary>Точніше</summary><div class="more-body">${html}</div></details>`;

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
  document.body.classList.toggle('insp-off', !o && !projOpen);
  let html = '';
  if (!o) html = projOpen ? projectPanel() : '';
  else if (s.kind === 'clip') html = clipPanel(o);
  else if (s.kind === 'overlay') html = overlayPanel(o);
  else if (s.kind === 'caption') html = captionPanel(o);
  else if (s.kind === 'music') html = musicPanel(o);
  if (setHtml(el, html)) balanceSegs(el);
}

function head(ic, title, sub) {
  return `<div class="insp-head"><span class="insp-ico">${icon(ic)}</span><div><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
    <button class="btn btn-icon btn-sm" data-a="deselect" data-tip="Готово (Esc)">${icon('x')}</button></div>`;
}

// Розділ панелі: заголовок з іконкою і група пов'язаних налаштувань
const sec = (title, ic, html, aux = '') => `<section class="isec"><h4 class="isec-h">${icon(ic)}<span>${title}</span>${aux ? `<em>${aux}</em>` : ''}</h4>${html}</section>`;

// ── Проєкт: назва, формат, тонкі налаштування ──
function projectPanel() {
  const p = S.project;
  const FORMATS = [['16:9', 'YouTube, урок', 'r169'], ['9:16', 'Reels, Shorts', 'r916'], ['1:1', 'Квадрат', 'r11'], ['4:3', 'Класичний', 'r43']];
  return `<div class="insp-head"><span class="insp-ico">${icon('film')}</span><div><b>Проєкт</b><small>${p.clips.length ? fmtShort(duration()) : 'Порожній'}</small></div>
    <button class="btn btn-icon btn-sm" data-a="closeProject" data-tip="Закрити (Esc)">${icon('x')}</button></div>
    <div class="field"><label>Назва</label><input class="input" data-pf="name" value="${esc(p.name)}" maxlength="80"></div>
    <div class="field"><label>Форма кадру</label><div class="fmt-cards">${FORMATS.map(([v, n, cls]) => `<button class="fmt-card${p.aspect === v ? ' on' : ''}" data-set="p:aspect" data-v="${v}" title="${n}"><i class="fmt-shape ${cls}"></i><b>${v}</b></button>`).join('')}</div></div>
    ${seg('p:fps', 'Кадрів за секунду', [[24, '24'], [25, '25'], [30, '30'], [60, '60']], p.fps, '30 — стандарт. 60 — для плавних рухів мишею чи ігор.')}
    <div class="field"><label>Колір фону (де немає відео)</label>${swatches(p.bg, 'p:bg')}</div>`;
}

// ── Кліп ──
function clipPanel(c) {
  const m = media.get(c.mediaId);
  const l = layout().find(x => x.clip.id === c.id);
  const isImg = m && m.kind === 'image';
  const sp = c.speed || 1;
  const z = c.zoom || 1;
  const sub = l ? `${fmt(l.start, true)} – ${fmt(l.end, true)} · ${fmtShort(clipDur(c))}` : '';
  const idx = S.project.clips.indexOf(c);
  const { W, H } = outputSize();
  const side = (((c.rot || 0) % 360) + 360) % 360 % 180 === 90;
  const mw = m ? (side ? m.height : m.width) : W, mh = m ? (side ? m.width : m.height) : H;
  const otherShape = m && Math.abs(mw / mh - W / H) > 0.02;
  const fitSeg = seg('fit', 'Поля навколо кадру', [['blur', 'Розмиті'], ['contain', 'Чорні'], ['cover', 'Обрізати']], c.fit || 'contain');
  const speedHint = sp === 1 ? '' : sp > 1 ? 'Голос залишиться природним — без «мультяшного» ефекту.' : 'Уповільнення — зручно, щоб показати швидкі дії.';
  const sound = isImg
    ? `<div class="field"><label>Скільки показувати</label><div class="seg">${[3, 5, 8, 10].map(v => `<button data-a="imgDur" data-v="${v}" class="${near(clipDur(c), v) ? 'on' : ''}">${v} с</button>`).join('')}</div></div>
       ${seg('motion', 'Рух фото', Object.entries(MOTIONS), c.motion || 'none')}`
    : `${seg('speed', 'Швидкість', [[0.5, '0,5×'], [1, '1×'], [1.25, '1,25×'], [1.5, '1,5×'], [2, '2×']], sp, speedHint)}
       ${c.muted ? '' : `<div class="field"><label>Гучність<span class="aux" data-show="volume">${Math.round((c.volume ?? 1) * 100)}%</span></label><input type="range" data-f="volume" data-pct="1" min="0" max="2" step="0.05" value="${c.volume ?? 1}"></div>`}
       <div class="chips">${chip('muted', 'Без звуку', !!c.muted, 'true', 'mute')}</div>`;
  return head(isImg ? 'image' : 'video', m ? m.name : 'Кліп', sub) +
    sec(isImg ? 'Показ' : 'Швидкість і звук', isImg ? 'image' : 'volume', sound) +
    sec('Плавність', 'sparkle', `<div class="chips">${chip('fadeIn', 'Плавна поява', c.fadeIn > 0, 0.8, 'sparkle')}${chip('fadeOut', 'Плавне зникнення', c.fadeOut > 0, 0.8, 'sparkle')}</div>` +
      (idx > 0 ? fold('tr', 'Перехід', c.tr && TRANSITIONS[c.tr.type] ? TRANSITIONS[c.tr.type] : 'Немає', () => `<div class="tr-grid">${[['', 'Немає']].concat(Object.entries(TRANSITIONS)).map(([k, n]) => `<button data-a="tr" data-v="${k}" class="tr-card tr-${k || 'none'}${(c.tr ? c.tr.type : '') === k ? ' on' : ''}"><i></i><small>${n}</small></button>`).join('')}</div>
        <button class="btn btn-sm btn-block btn-ghost-sm" data-a="trAll">${icon('sparkle')}${S.project.clips.slice(1).every(x => x.tr) ? 'Прибрати переходи всюди' : 'Переходи між усіма кліпами'}</button>`) : '')) +
    sec('Кадр і вигляд', 'shapes', `${seg('zoom', 'Наблизити частину кадру', [[1, 'Ні'], [1.5, '1,5×'], [2, '2×'], [3, '3×']], z, z > 1.001 ? 'Перетягніть синій хрестик на перегляді туди, що треба показати ближче.' : '')}
      ${otherShape ? fitSeg : ''}
      ${m ? fold('look', 'Фільтр', LOOKS[c.look || 'none'] ? LOOKS[c.look || 'none'].name : '', () => lookCards(c, m)) : ''}`) +
    actions(act('split', 'split', 'Розрізати', 'data-key="S"'), isImg ? '' : act('freeze', 'camera', 'Стоп-кадр'), act('dup', 'copy', 'Дублювати'), isImg ? '' : act('norm', 'volume', 'Вирівняти'), act('del', 'trash', 'Видалити', 'data-danger="1"')) +
    more('clip', `${range('fadeIn', 'Тривалість появи', 0, 3, 0.1, c.fadeIn || 0, ' с')}
      ${range('fadeOut', 'Тривалість зникнення', 0, 3, 0.1, c.fadeOut || 0, ' с')}
      ${range('zoom', 'Наближення', 1, 4, 0.05, z, '×', z.toFixed(2).replace('.', ','))}
      ${FILTERS_OK ? range('bri', 'Яскравість', 0.5, 1.6, 0.02, c.bri ?? 1, '%', Math.round((c.bri ?? 1) * 100)) + range('con', 'Контраст', 0.5, 1.8, 0.02, c.con ?? 1, '%', Math.round((c.con ?? 1) * 100)) + range('sat', 'Насиченість', 0, 2, 0.02, c.sat ?? 1, '%', Math.round((c.sat ?? 1) * 100)) : ''}
      ${c.tr && idx > 0 ? range('tr.d', 'Тривалість переходу', 0.2, 2, 0.1, c.tr.d || 0.6, ' с') : ''}
      <div class="field"><label>Поворот і дзеркало</label><div class="seg"><button data-a="rot" data-v="-90">${icon('rotL')} Вліво</button><button data-a="rot" data-v="90">${icon('rotR')} Вправо</button><button data-a="flip" class="${c.flip ? 'on' : ''}">${icon('flipH')} Дзеркало</button></div><p class="hint">Для відео з телефона, знятого боком.</p></div>
      ${otherShape ? '' : fitSeg}
      ${isImg ? '' : seg('motion', 'Повільний рух кадру', Object.entries(MOTIONS), c.motion || 'none')}
      ${isImg ? '' : `<p class="hint">Фрагмент ${fmt(c.in)}–${fmt(c.out)} з файлу тривалістю ${fmt(m ? m.duration : 0)}.</p>`}`);
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

function timing(o) {
  const end = mainEnd();
  const toEnd = end > o.start + 0.3 && near(o.start + o.dur, end);
  return `<div class="field"><label>Показувати<span class="aux">${fmt(o.start, true)} – ${fmt(o.start + o.dur, true)}</span></label>
    <div class="seg">${[2, 4, 8].map(v => `<button data-a="durPreset" data-v="${v}" class="${near(o.dur, v) ? 'on' : ''}">${v} с</button>`).join('')}<button data-a="durPreset" data-v="end" class="${toEnd ? 'on' : ''}" ${end > o.start + 0.3 ? '' : 'disabled'}>До кінця</button></div></div>
    ${animSeg(o)}
    <div class="chips"><button class="chip" data-a="toCursor">${icon('stepFwd')}Почати з курсора</button></div>`;
}

// ── відео чи фото поверх (доріжка «Відео 2») ──
function layerPanel(o) {
  const m = media.get(o.mediaId), video = o.type === 'video';
  if (video && o.shadow == null) o.shadow = true;
  const lo = layoutOf(o), cs = cropSides(o);
  const cropped = cs.l + cs.r + cs.t + cs.b > 0.004;
  const shape = o.shape || (video ? 'circle' : 'rect');
  const cropR = (side, label) => `<div class="field"><label>${label}<span class="aux" data-show="crop-${side}">${Math.round(cs[side] * 100)}%</span></label><input type="range" data-l="crop" data-side="${side}" min="0" max="0.9" step="0.005" value="${cs[side]}"></div>`;
  return head(video ? 'pip' : 'image', video ? 'Відео поверх' : 'Зображення поверх', m ? m.name : '') +
    sec('Розташування', 'pip', `<div class="field"><div class="layouts">${Object.entries(LAYOUTS).map(([k, n]) => `<button data-a="layout" data-v="${k}" class="lo-${k}${lo === k ? ' on' : ''}"><i></i>${n}</button>`).join('')}</div>
      <p class="hint">Або перетягніть на перегляді. Кути — розмір, темні маркери по боках — обрізка.</p></div>
    ${['full', 'left', 'right', 'top', 'bottom'].includes(lo) ? '' : `<div class="field"><label>Кут</label><div class="corner-grid">${[['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']].map(([v, n]) => `<button data-a="pipCorner" data-v="${v}">${n}</button>`).join('')}</div></div>`}
    <div class="field"><label>Розмір<span class="aux" data-show="scale">${Math.round(o.w * 100)}%</span></label><input type="range" data-l="scale" min="0.08" max="1" step="0.01" value="${Math.min(1, o.w)}"></div>`) +
    sec('Вигляд', 'shapes', `${seg('shape', 'Форма', [['rect', 'Прямокутник'], ['round', 'Заокруглена'], ['circle', 'Коло']], shape)}
    <details class="fold" data-more="crop" ${openMore.has('crop') || cropped ? 'open' : ''}><summary><span>Обрізати краї</span><b>${cropped ? 'обрізано' : 'ні'}</b></summary><div class="fold-body">
      <div class="crop-grid">${cropR('l', 'Зліва')}${cropR('r', 'Справа')}${cropR('t', 'Зверху')}${cropR('b', 'Знизу')}</div>
      ${cropped ? `<button class="btn btn-sm btn-outline btn-block" data-a="resetCrop">${icon('undo')}Без обрізки</button>` : ''}
    </div></details>
    <div class="field" style="margin-top:12px"><label>Непрозорість<span class="aux" data-show="opacity">${Math.round((o.opacity ?? 1) * 100)}%</span></label><input type="range" data-f="opacity" data-pct="1" min="0.1" max="1" step="0.01" value="${o.opacity ?? 1}"></div>
    <div class="field"><label>Рамка</label>${swatches(o.border && o.border !== 'none' ? o.border : '', 'border')}<button class="chip${!o.border || o.border === 'none' ? ' on' : ''}" data-a="noBorder" style="margin-top:6px">${icon('x')}Без рамки</button></div>
    <div class="chips">${video ? chip('shadow', 'Тінь', !!o.shadow, 'true', 'sparkle') : ''}${chip('flip', 'Дзеркально', !!o.flip, 'true', 'flipH')}</div>`) +
    (video ? sec('Звук', 'volume', `<div class="chips">${chip('muted', 'Без звуку', !!o.muted, 'true', 'mute')}</div>${!o.muted ? `<div class="field"><label>Гучність<span class="aux" data-show="volume">${Math.round((o.volume ?? 1) * 100)}%</span></label><input type="range" data-f="volume" data-pct="1" min="0" max="2" step="0.05" value="${o.volume ?? 1}"></div>` : ''}`) : '') +
    sec('Показ', 'play', video ? `<div class="field"><label>Показувати<span class="aux">${fmt(o.start, true)} – ${fmt(o.start + o.dur, true)}</span></label></div>${animSeg(o)}
      <div class="chips"><button class="chip" data-a="toCursor">${icon('stepFwd')}Почати з курсора</button><button class="chip" data-a="pipSync">${icon('fit')}Разом з відео</button></div>` : timing(o)) +
    actions(act('split', 'split', 'Розрізати', 'data-key="S"'), act('dup', 'copy', 'Дублювати'), act('front', 'front', 'Наперед'), act('del', 'trash', 'Видалити', 'data-danger="1"')) +
    more('ov-layer', `<div class="insp-row">${timeField('start', 'Початок', o.start)}${timeField('dur', 'Тривалість', o.dur)}</div>
      ${video ? `<p class="hint">Фрагмент файлу ${fmt(o.in || 0)}–${fmt((o.in || 0) + o.dur)}${m ? ` з ${fmt(m.duration)}` : ''}. Краї на доріжці «Поверх» обрізають початок і кінець.</p>` : ''}`);
}

function animSeg(o) {
  if (o.type === 'progress') return '';
  const keys = o.type === 'text' ? Object.keys(ANIMS) : (o.type === 'blur' || o.type === 'spot') ? ['none', 'fade'] : ['none', 'fade', 'up', 'pop'];
  return `<div class="field"><label>Як з’являється</label><div class="seg">${keys.map(k => `<button data-set="anim" data-v="${k}" class="${animOf(o) === k ? 'on' : ''}">${ANIMS[k]}</button>`).join('')}</div></div>`;
}
function overlayPanel(o) {
  if (isLayer(o)) return layerPanel(o);
  let body = '', extra = '';
  if (o.type === 'text') {
    body = `<div class="field"><textarea class="input" rows="3" data-f="text" spellcheck="true" placeholder="Введіть текст">${esc(o.text)}</textarea></div>
      <div class="field"><label>Вигляд</label><div class="style-grid">${STYLES.map(([v, n]) => `<button class="style-card st-${v}${(o.bg || 'none') === v ? ' on' : ''}" data-set="bg" data-v="${v}"><span>Aa</span><small>${n}</small></button>`).join('')}</div></div>
      ${range('size', 'Розмір', 20, 220, 1, o.size)}
      <div class="field"><label>Колір тексту</label>${swatches(o.color, 'color')}</div>
      <div class="field"><label>Де розмістити</label><div class="seg">${[['top', 'Вгорі'], ['middle', 'По центру'], ['bottom', 'Внизу']].map(([v, n]) => `<button data-a="place" data-v="${v}">${n}</button>`).join('')}</div><p class="hint">Або просто перетягніть текст на перегляді.</p></div>`;
    extra = `${seg('weight', 'Товщина літер', [[400, 'Звичайні'], [600, 'Напівжирні'], [800, 'Жирні']], o.weight || 700)}
      <div class="field"><label>Вирівнювання</label><div class="seg">${[['left', 'alignL'], ['center', 'alignC'], ['right', 'alignR']].map(([v, ic]) => `<button data-set="align" data-v="${v}" class="${(o.align || 'left') === v ? 'on' : ''}">${icon(ic)}</button>`).join('')}</div></div>
      ${o.bg === 'box' || o.bg === 'outline' ? `<div class="field"><label>Колір ${o.bg === 'box' ? 'плашки' : 'контуру'}</label>${swatches(o.bgColor || '#000000', 'bgColor')}</div>` : ''}
      ${o.bg === 'box' ? range('bgAlpha', 'Прозорість плашки', 0.2, 1, 0.05, o.bgAlpha ?? 0.7, '%', Math.round((o.bgAlpha ?? 0.7) * 100)) : ''}`;
  } else if (o.type === 'rect' || o.type === 'arrow') {
    const cur = o.stroke || (o.type === 'arrow' ? 10 : 8);
    body = `<div class="field"><label>Колір</label>${swatches(o.color, 'color')}</div>
      ${seg('stroke', 'Товщина', [[5, 'Тонка'], [10, 'Середня'], [16, 'Товста']], [5, 10, 16].reduce((a, b) => (Math.abs(b - cur) < Math.abs(a - cur) ? b : a)))}
      <p class="hint">${o.type === 'arrow' ? 'Тягніть кінці стрілки на перегляді.' : 'Тягніть рамку та її кути на перегляді.'}</p>`;
    extra = `${range('stroke', 'Точна товщина', 2, 30, 1, cur)}${o.type === 'rect' ? range('radius', 'Заокруглення кутів', 0, 80, 1, o.radius ?? 16) + seg('fill', 'Заливка всередині', [['false', 'Немає'], ['true', 'Напівпрозора']], String(!!o.fill)) : ''}`;
  } else if (o.type === 'blur') {
    const st = o.strength || 20;
    body = `${seg('strength', 'Сила', [[10, 'Слабке'], [20, 'Середнє'], [40, 'Сильне']], [10, 20, 40].reduce((a, b) => (Math.abs(b - st) < Math.abs(a - st) ? b : a)))}
      ${seg('pixel', 'Вигляд', [['false', 'Розмиття'], ['true', 'Пікселі']], String(!!o.pixel))}
      <p class="hint">Перетягніть область на перегляді туди, де пароль, пошта чи обличчя, і змініть її розмір за кути.</p>`;
    extra = range('strength', 'Точна сила', 6, 60, 1, st);
  } else if (o.type === 'spot') {
    const d = o.dim ?? 0.6;
    body = `${seg('dim', 'Затемнення довкола', [[0.4, 'Легке'], [0.6, 'Середнє'], [0.8, 'Сильне']], [0.4, 0.6, 0.8].reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a)))}
      ${seg('shape', 'Форма', [['rect', 'Прямокутник'], ['ellipse', 'Овал']], o.shape || 'rect')}
      <p class="hint">Все, крім світлої області, затемниться — увага глядача буде саме там.</p>`;
    extra = range('dim', 'Точне затемнення', 0.2, 0.9, 0.02, d, '%', Math.round(d * 100));
  } else if (o.type === 'emoji') {
    body = `<div class="field"><label>Емодзі</label><div class="emoji-grid sm">${EMOJIS.map(e => `<button data-set="emoji" data-v="${e}" class="${o.emoji === e ? 'on' : ''}">${e}</button>`).join('')}</div></div>
      <p class="hint">Перетягніть емодзі на перегляді, розмір — за кути.</p>`;
  } else if (o.type === 'progress') {
    body = `<div class="field"><label>Колір</label>${swatches(o.color || '#4F6BF4', 'color')}</div>
      ${seg('h', 'Товщина', [[0.008, 'Тонка'], [0.015, 'Середня'], [0.03, 'Товста']], [0.008, 0.015, 0.03].reduce((a, b) => (Math.abs(b - o.h) < Math.abs(a - o.h) ? b : a)))}
      <div class="field"><label>Де</label><div class="seg"><button data-a="pbPos" data-v="bottom" class="${o.y > 0.5 ? 'on' : ''}">Внизу</button><button data-a="pbPos" data-v="top" class="${o.y <= 0.5 ? 'on' : ''}">Вгорі</button></div></div>
      <button class="btn btn-outline btn-sm btn-block" data-a="pbFull">${icon('fit')}На все відео</button>`;
  }
  return head(OV_ICONS[o.type], OV_NAMES[o.type], `${fmt(o.start, true)} – ${fmt(o.start + o.dur, true)}`) +
    sec(o.type === 'text' ? 'Текст' : 'Вигляд', OV_ICONS[o.type], body) + sec('Показ', 'play', timing(o)) +
    actions(act('dup', 'copy', 'Дублювати'), act('del', 'trash', 'Видалити', 'data-danger="1"')) +
    more('ov-' + o.type, `${extra}<div class="insp-row">${timeField('start', 'Початок', o.start)}${timeField('dur', 'Тривалість', o.dur)}</div>
      <button class="btn btn-outline btn-sm btn-block" data-a="front">${icon('front')}Перенести наперед</button>`);
}

function captionPanel(c) { return captionInspector(c, head, timeField, actions, act); }

function musicPanel(x) {
  const m = media.get(x.mediaId);
  const v = x.volume ?? 1;
  return head(x.voice ? 'mic' : 'music', x.voice ? 'Ваш голос' : m ? m.name : 'Аудіо', `${fmt(x.start, true)} – ${fmt(x.start + musicDur(x), true)}`) +
    sec('Звук', 'volume', `${seg('volume', 'Гучність', [[0.2, 'Тихий фон'], [0.4, 'Фон'], [0.7, 'Середня'], [1, 'Повна']], [0.2, 0.4, 0.7, 1].reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a)), x.voice ? '' : 'Для музики під голос найкраще «Фон» або «Тихий фон».')}
      ${x.voice ? '' : `<div class="chips">${chip('duck', 'Тихіше, коли говорять', !!x.duck, 'true', 'volume')}</div>`}
      ${x.duck && !x.voice ? '<p class="hint">Музика сама стишується, коли у відео звучить голос, і повертається в паузах.</p>' : ''}`) +
    sec('Плавність', 'sparkle', `<div class="chips">${chip('fadeIn', 'Плавна поява', x.fadeIn > 0, 1, 'sparkle')}${chip('fadeOut', 'Плавне зникнення', x.fadeOut > 0, 2, 'sparkle')}</div>`) +
    actions(x.voice ? '' : act('fitMusic', 'fit', 'Під відео', mainEnd() > x.start ? '' : 'disabled'), act('norm', 'volume', 'Вирівняти'), act('split', 'split', 'Розрізати'), act('del', 'trash', 'Видалити', 'data-danger="1"')) +
    more('music', `<div class="field"><label>Точна гучність<span class="aux" data-show="volume">${Math.round(v * 100)}%</span></label><input type="range" data-f="volume" data-pct="1" min="0" max="2" step="0.05" value="${v}"></div>
      ${range('fadeIn', 'Тривалість появи', 0, 5, 0.1, x.fadeIn || 0, ' с')}
      ${range('fadeOut', 'Тривалість зникнення', 0, 8, 0.1, x.fadeOut || 0, ' с')}
      <div class="insp-row">${timeField('start', 'Початок', x.start)}<div class="field half"><label>Тривалість</label><div class="static">${fmtShort(musicDur(x))}</div></div></div>`);
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
    o[f] = v;
    if (o.type === 'progress' && f === 'h' && o.y > 0.5) o.y = 1 - v;
    commit(); return;
  }
  if (b.dataset.a && ccAction(b.dataset.a, o)) return;
  switch (b.dataset.a) {
    case 'deselect': select(null); break;
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
