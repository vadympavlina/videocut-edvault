// Вкладка «Субтитри» (вигляд, інструменти, список) і властивості одного субтитру.
import { S, commit, emit, select, outputSize, uid } from './state.js';
import { CC_FONTS, CC_BGS, CC_ANIMS, CC_PRESETS, capStyle, presetThumb, loadCcFont, onCcFont, cps, splitCaption, capMaxChars, tidyCaptions } from './cc.js';
import { addCaption, setCaptions } from './ops.js';
import { seek } from './player.js';
import { toSrt, toVtt } from './srt.js';
import { $, esc, icon, fmt, toast, confirmDialog, downloadBlob, safeName, balanceSegs, setHtml } from './ui.js';

const COLORS = ['#ffffff', '#1a1d23', '#ffd43b', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#4F6BF4', '#0ea5e9', '#22c55e'];
const POS = [[0.06, 'Вгорі'], [0.5, 'По центру'], [0.93, 'Знизу']];
const open = new Set(); // розгорнуті розділи
let findQ = '';
let body = null;

const sorted = () => S.project.captions.slice().sort((a, b) => a.start - b.start);
// стиль для запису (старі проєкти отримують усі поля)
function W() { S.project.captionStyle = capStyle(S.project); return S.project.captionStyle; }
const speedLevel = v => v > 21 ? 'bad' : v > 16 ? 'warn' : 'ok';

// ── мініатюри шаблонів (перемальовуються, коли довантажиться шрифт) ──
const thumbs = new Map();
function thumb(k) {
  if (!thumbs.has(k)) thumbs.set(k, presetThumb({ ...capStyle({}), ...CC_PRESETS[k] }));
  return thumbs.get(k);
}
let thumbTimer = 0;
onCcFont(() => {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    thumbs.clear();
    if (body && body.isConnected) body.querySelectorAll('.cc-preset img').forEach(img => { img.src = thumb(img.dataset.k); });
    if (body && body.isConnected) body.querySelectorAll('.cc-fonts button').forEach(b => { b.style.fontFamily = b.style.fontFamily; });
  }, 120);
});

function swatches(cur, key) {
  return `<div class="swatches">${COLORS.map(c => `<button class="sw${String(cur).toLowerCase() === c.toLowerCase() ? ' on' : ''}" style="background:${c}" data-cc-sw="${key}" data-c="${c}" aria-label="${c}"></button>`).join('')}
    <label class="sw sw-custom" data-tip="Свій колір"><input type="color" value="${/^#[0-9a-f]{6}$/i.test(cur) ? cur : '#ffffff'}" data-cc-color="${key}"></label></div>`;
}
const seg = (f, opts, cur, cls = '') => `<div class="seg ${cls}">${opts.map(([v, n]) => `<button data-cc-set="${f}" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${n}</button>`).join('')}</div>`;
const range = (f, label, min, max, step, val, show) => `<div class="field"><label>${label}<span class="aux" data-cc-show="${f}">${show}</span></label><input type="range" data-cc-range="${f}" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;
const fold = (key, label, html) => `<details class="fold cc-fold" data-cc-fold="${key}" ${open.has(key) ? 'open' : ''}><summary><span>${label}</span></summary><div class="fold-body">${html}</div></details>`;
const pct = v => Math.round(v * 100) + '%';

function styleBody(st) {
  const nearPos = POS.reduce((a, b) => Math.abs(b[0] - st.y) < Math.abs(a[0] - st.y) ? b : a)[0];
  return `<div class="field"><label>Шрифт</label><div class="cc-fonts">${Object.entries(CC_FONTS).map(([k, f]) => `<button data-cc-set="font" data-v="${k}" class="${st.font === k ? 'on' : ''}" style="font-family:'${f.fam}',sans-serif;font-weight:${st.bold ? f.b : f.n}">${f.name}</button>`).join('')}</div></div>
    ${range('size', 'Розмір', 24, 120, 1, st.size, st.size)}
    <div class="chips">
      <button class="chip${st.bold ? ' on' : ''}" data-cc-toggle="bold">${icon(st.bold ? 'check' : 'text')}Жирний</button>
      <button class="chip${st.upper ? ' on' : ''}" data-cc-toggle="upper">${icon(st.upper ? 'check' : 'text')}ВЕЛИКІ ЛІТЕРИ</button>
    </div>
    <div class="field"><label>Колір тексту</label>${swatches(st.color, 'color')}</div>
    <div class="field"><label>Фон</label>${seg('bg', Object.entries(CC_BGS), st.bg)}</div>
    ${st.bg === 'box' || st.bg === 'block' ? `<div class="field"><label>Колір фону</label>${swatches(st.bgColor, 'bgColor')}</div>${range('bgAlpha', 'Непрозорість фону', 0.2, 1, 0.02, st.bgAlpha, pct(st.bgAlpha))}` : ''}
    <div class="field"><label>Анімація</label>${seg('anim', Object.entries(CC_ANIMS), st.anim, 'cc-grid3')}</div>
    ${st.anim === 'karaoke' || st.anim === 'chunk' ? `<div class="field"><label>Колір слова, що звучить</label>${swatches(st.hi, 'hi')}</div>` : ''}
    <div class="field"><label>Розташування</label>${seg('y', POS, nearPos)}<p class="hint">Або просто перетягніть субтитр на перегляді.</p></div>
    ${range('width', 'Ширина', 0.4, 0.96, 0.01, st.width, pct(st.width))}
    <div class="field"><label>Рядків в одному субтитрі</label>${seg('lines', [[1, 'Один'], [2, 'Два']], st.lines)}<p class="hint">Враховується в автосубтитрах і «Розбити довгі».</p></div>`;
}

function toolsBody() {
  return `<div class="field"><label>Знайти й замінити</label>
      <input class="input" data-cc-find placeholder="Знайти в тексті…" value="${esc(findQ)}">
      <div class="row2" style="margin-top:6px"><input class="input" data-cc-repl placeholder="Замінити на…"><button class="btn btn-sm btn-outline" data-cc="replace">Замінити всі</button></div>
      <p class="hint" data-cc-found></p></div>
    <div class="field"><label>Зсунути всі субтитри</label><div class="seg">${['-0.5', '-0.1', '+0.1', '+0.5'].map(v => `<button data-cc-shift="${v}">${v.replace('.', ',').replace('-', '−')} с</button>`).join('')}</div>
      <p class="hint">Якщо субтитри поспішають або запізнюються відносно голосу.</p></div>
    <div class="insp-actions">
      <button class="btn btn-outline btn-sm" data-cc="splitLong">${icon('split')}Розбити довгі</button>
      <button class="btn btn-outline btn-sm" data-cc="tidy">${icon('sparkle')}Виправити час</button>
    </div>
    <p class="hint">«Виправити час» прибирає накладання й мерехтіння між фразами.</p>
    <div class="field"><label>Зберегти файлом</label><div class="insp-actions" style="margin-top:0">
      <button class="btn btn-outline btn-sm" data-cc="srt">${icon('download')}.srt</button>
      <button class="btn btn-outline btn-sm" data-cc="vtt">${icon('download')}.vtt</button>
      <button class="btn btn-outline btn-sm" data-cc="txt">${icon('file')}Текст</button>
    </div></div>
    <button class="btn btn-sm btn-block btn-ghost-sm cc-danger" data-cc="clear">${icon('trash')}Видалити всі субтитри</button>`;
}

let capView = 'text'; // що показує вкладка «Субтитри»: список тексту чи налаштування вигляду
export function renderCapTab(el) {
  body = el;
  const p = S.project, st = capStyle(p);
  const caps = sorted();
  const has = caps.length > 0;
  Object.keys(CC_PRESETS).forEach(k => loadCcFont({ ...capStyle({}), ...CC_PRESETS[k] }));
  const view = has ? capView : 'style';
  const top = has ? `<div class="row2">
        <button class="btn btn-primary btn-grow" id="btnAddCap" data-cc="add">${icon('plus')} Субтитр тут</button>
        <button class="btn btn-outline btn-icon" id="btnAutoCap" data-cc="auto" data-tip="Розпізнати мову ще раз" ${p.clips.length ? '' : 'disabled'}>${icon('wand')}</button>
        <button class="btn btn-outline btn-icon" id="btnImpCap" data-cc="import" data-tip="Імпорт .srt / .vtt">${icon('upload')}</button>
        <button class="btn btn-outline btn-icon" id="btnExpCap" data-cc="srt" data-tip="Зберегти .srt">${icon('download')}</button>
      </div>
      <div class="seg lib-views" role="tablist"><button data-cc-view="text" role="tab" class="${view === 'text' ? 'on' : ''}">${icon('cc')}Текст<b>${caps.length}</b></button><button data-cc-view="style" role="tab" class="${view === 'style' ? 'on' : ''}">${icon('shapes')}Вигляд</button></div>` : `
      <button class="auto-cc" id="btnAutoCap" data-cc="auto" ${p.clips.length ? '' : 'disabled'}>${icon('wand')}<span><b>Створити субтитри автоматично</b><small>Розпізнавання мови прямо в браузері</small></span></button>
      <div class="row2">
        <button class="btn btn-outline btn-grow" id="btnAddCap" data-cc="add">${icon('plus')} Вручну</button>
        <button class="btn btn-outline btn-grow" id="btnImpCap" data-cc="import">${icon('upload')} Файл .srt</button>
      </div>`;
  const styleView = `
    <div class="lib-sub">Шаблон</div>
    <div class="cc-presets">${Object.entries(CC_PRESETS).map(([k, v]) => `<button class="cc-preset${st.preset === k ? ' on' : ''}" data-cc-preset="${k}" title="${v.name}"><img data-k="${k}" src="${thumb(k)}" alt=""><small>${v.name}</small></button>`).join('')}</div>
    <label class="cc-switch"><input type="checkbox" data-cc-burn ${st.show ? 'checked' : ''}><span><b>Вшити у відео</b><small>${st.show ? 'Субтитри буде видно в готовому відео' : 'Лише файл .srt — у відео їх не буде'}</small></span></label>
    ${fold('style', 'Налаштувати вигляд', styleBody(st))}`;
  const textView = `${fold('tools', 'Інструменти', toolsBody())}
    <div class="caps">${caps.map(c => { const v = cps(c), lv = speedLevel(v); return `<div class="cap${lv === 'bad' ? ' fast' : ''}" data-id="${c.id}">
        <button class="cap-t" data-seek="${c.start}" ${lv === 'bad' ? `title="Задовго читати: ${Math.round(v)} символів за секунду"` : ''}>${fmt(c.start, true)}</button>
        <textarea rows="2" data-cap="${c.id}" spellcheck="true">${esc(c.text)}</textarea>
        <button class="btn btn-sm btn-icon" data-cap-del="${c.id}" data-tip="Видалити">${icon('x')}</button>
      </div>`; }).join('')}</div>`;
  const html = top + (!has ? `${styleView}<p class="lib-hint">Поставте курсор на потрібне місце, натисніть «Вручну» і введіть текст. Enter у полі — наступний субтитр.</p>` : view === 'text' ? textView : styleView);
  if (setHtml(el, html)) balanceSegs(el);
  applyFind();
  lastKey = '';
  markActiveCaption();
}

// пошук: підсвічує й фільтрує список
function applyFind() {
  if (!body) return;
  const q = findQ.trim().toLowerCase();
  let n = 0;
  body.querySelectorAll('.cap').forEach(row => {
    const c = S.project.captions.find(x => x.id === row.dataset.id);
    const hit = !q || (c && c.text.toLowerCase().includes(q));
    if (hit && q) n++;
    row.hidden = !hit;
  });
  const f = body.querySelector('[data-cc-found]');
  if (f) f.textContent = q ? (n ? `Знайдено у ${n} субтитрах` : 'Нічого не знайдено') : '';
}

let lastKey = '';
export function markActiveCaption() {
  if (!body || !body.isConnected) return;
  const t = S.t;
  const cur = S.project.captions.find(c => t >= c.start && t < c.start + c.dur);
  const key = (cur ? cur.id : '') + '|' + (S.sel ? S.sel.id : '') + '|' + S.project.captions.length;
  if (key === lastKey) return;
  lastKey = key;
  body.querySelectorAll('.cap').forEach(el => {
    el.classList.toggle('now', !!cur && cur.id === el.dataset.id);
    el.classList.toggle('sel', !!S.sel && S.sel.id === el.dataset.id);
  });
}

function setStyle(f, v) {
  const st = W();
  st[f] = v;
  commit();
}

function download(kind) {
  const caps = sorted();
  const name = safeName(S.project.name);
  if (kind === 'srt') downloadBlob(new Blob([toSrt(caps)], { type: 'application/x-subrip' }), name + '.srt');
  else if (kind === 'vtt') downloadBlob(new Blob([toVtt(caps)], { type: 'text/vtt' }), name + '.vtt');
  else downloadBlob(new Blob([caps.map(c => c.text.replace(/\s*\n\s*/g, ' ')).join('\n')], { type: 'text/plain' }), name + '.txt');
}

export function splitLong(silent) {
  const { W: w, H: h } = outputSize();
  const max = capMaxChars(capStyle(S.project), w, h);
  const out = [];
  let n = 0;
  for (const c of sorted()) {
    const parts = splitCaption(c, max);
    if (parts.length > 1) n += parts.length - 1;
    out.push(...parts.map((x, i) => i ? { ...x } : { ...c, ...x }));
  }
  if (!n) { if (!silent) toast('Усі субтитри й так короткі'); return; }
  setCaptions(out, true);
  if (!silent) toast(`Розбито: +${n} субтитрів`, 'ok');
}

// повертає true, якщо клік оброблено
export async function capTabClick(b) {
  const p = S.project;
  const a = b.dataset.cc;
  if (b.dataset.ccView) { capView = b.dataset.ccView; emit('show-tab', 'captions'); return true; }
  if (b.dataset.ccPreset) {
    const st = W(), pr = CC_PRESETS[b.dataset.ccPreset];
    Object.assign(st, pr, { preset: b.dataset.ccPreset });
    delete st.name;
    if (b.dataset.ccPreset === 'reels' && st.y > 0.62) st.y = 0.72;
    commit();
    if (!p.captions.length) toast('Стиль вибрано — тепер додайте субтитри');
    return true;
  }
  if (b.dataset.ccSet) {
    let v = b.dataset.v;
    if (['y', 'lines'].includes(b.dataset.ccSet)) v = +v;
    setStyle(b.dataset.ccSet, v);
    return true;
  }
  if (b.dataset.ccToggle) { const st = W(); st[b.dataset.ccToggle] = !st[b.dataset.ccToggle]; commit(); return true; }
  if (b.dataset.ccSw) { setStyle(b.dataset.ccSw, b.dataset.c); return true; }
  if (b.dataset.ccShift) {
    const d = +b.dataset.ccShift;
    p.captions.forEach(c => { c.start = Math.max(0, c.start + d); });
    commit(); toast(`Субтитри зсунуто на ${b.dataset.ccShift.replace('.', ',')} с`);
    return true;
  }
  if (b.dataset.seek) {
    seek(+b.dataset.seek);
    const c = p.captions.find(x => Math.abs(x.start - +b.dataset.seek) < 1e-6);
    if (c) select('caption', c.id);
    return true;
  }
  if (b.dataset.capDel) {
    p.captions = p.captions.filter(c => c.id !== b.dataset.capDel);
    if (S.sel && S.sel.id === b.dataset.capDel) select(null);
    commit(); return true;
  }
  if (!a) return false;
  switch (a) {
    case 'add': {
      const c = addCaption('');
      const ta = body && body.querySelector(`textarea[data-cap="${c.id}"]`);
      if (ta) { ta.focus(); ta.select(); }
      break;
    }
    case 'auto': emit('open-asr'); break;
    case 'import': $('capInput').click(); break;
    case 'srt': case 'vtt': case 'txt': download(a); break;
    case 'replace': {
      const q = findQ, r = body.querySelector('[data-cc-repl]').value;
      if (!q) { toast('Введіть, що знайти'); break; }
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      let n = 0;
      p.captions.forEach(c => { const t = c.text.replace(re, () => { n++; return r; }); c.text = t; });
      if (!n) { toast('Нічого не знайдено'); break; }
      p.captions = p.captions.filter(c => c.text.trim());
      findQ = '';
      commit(); toast(`Замінено: ${n}`, 'ok');
      break;
    }
    case 'splitLong': splitLong(); break;
    case 'tidy': {
      const before = JSON.stringify(p.captions);
      tidyCaptions(p.captions);
      if (JSON.stringify(p.captions) === before) toast('Із часом усе гаразд');
      else { commit(); toast('Час субтитрів виправлено', 'ok'); }
      break;
    }
    case 'clear':
      if (await confirmDialog('Видалити всі субтитри?', `Буде видалено ${p.captions.length} субтитрів. Скасувати можна через Ctrl+Z.`, 'Видалити')) {
        p.captions = []; if (S.sel && S.sel.kind === 'caption') select(null); commit();
      }
      break;
    default: return false;
  }
  return true;
}

export function capTabInput(e) {
  const t = e.target;
  if (t.matches('[data-cc-range]')) {
    const f = t.dataset.ccRange, v = +t.value;
    W()[f] = v;
    const sh = body.querySelector(`[data-cc-show="${f}"]`);
    if (sh) sh.textContent = f === 'size' ? v : pct(v);
    emit('project', { live: true, from: 'lib' });
    return true;
  }
  if (t.matches('[data-cc-color]')) { W()[t.dataset.ccColor] = t.value; emit('project', { live: true, from: 'lib' }); return true; }
  if (t.matches('[data-cc-find]')) { findQ = t.value; applyFind(); return true; }
  return false;
}
export function capTabChange(e) {
  const t = e.target;
  if (t.matches('[data-cc-range], [data-cc-color]')) { commit(); return true; }
  if (t.matches('[data-cc-burn]')) { setStyle('show', t.checked); return true; }
  return false;
}
export function capTabToggle(e) {
  const d = e.target.closest && e.target.closest('details[data-cc-fold]');
  if (!d) return;
  if (d.open) open.add(d.dataset.ccFold); else open.delete(d.dataset.ccFold);
  if (d.open) balanceSegs(d);
}
export function openStyle() { open.add('style'); capView = 'style'; }

// ── властивості одного субтитру (права панель) ──
export function speedHtml(c) {
  const v = cps(c), lv = speedLevel(v);
  const msg = lv === 'ok' ? 'читати зручно' : lv === 'warn' ? 'швидко, але можна' : 'задовго читати — подовжте або розділіть';
  return `<span class="cc-dot ${lv}"></span>Швидкість читання: <b>${Math.round(v)}</b> симв/с — ${msg}`;
}
export function captionInspector(c, head, timeField, actions, act) {
  const list = sorted(), i = list.findIndex(x => x.id === c.id);
  return head('cc', `Субтитр ${i + 1} з ${list.length}`, `${fmt(c.start, true)} – ${fmt(c.start + c.dur, true)}`) +
    `<div class="field"><textarea class="input" rows="3" data-f="text" spellcheck="true" placeholder="Що говориться в цей момент">${esc(c.text)}</textarea></div>
    <p class="cc-speed" data-cc-speed>${speedHtml(c)}</p>
    <div class="insp-row">${timeField('start', 'Початок', c.start)}${timeField('dur', 'Тривалість', c.dur)}</div>
    <div class="row2 cc-nav">
      <button class="btn btn-sm btn-outline btn-grow" data-a="ccPrev" ${i > 0 ? '' : 'disabled'}>${icon('chevL')}Попередній</button>
      <button class="btn btn-sm btn-outline btn-grow" data-a="ccNext" ${i < list.length - 1 ? '' : 'disabled'}>Наступний${icon('chevR')}</button>
    </div>
    ${actions(act('ccSplit', 'split', 'Розділити'), i < list.length - 1 ? act('ccMerge', 'merge', 'Об’єднати з наступним') : '', act('del', 'trash', 'Видалити'))}
    <p class="hint">«Розділити» ріже в місці курсора (або навпіл). Перетягніть субтитр на перегляді, щоб змінити висоту.</p>
    <button class="btn btn-sm btn-block btn-ghost-sm" data-a="ccStyle">${icon('cc')}Вигляд усіх субтитрів</button>`;
}
export function ccAction(a, c) {
  if (!c || !a.startsWith('cc')) return false;
  const list = sorted(), i = list.findIndex(x => x.id === c.id);
  if (a === 'ccPrev' || a === 'ccNext') {
    const n = list[i + (a === 'ccNext' ? 1 : -1)];
    if (n) { seek(n.start); select('caption', n.id); }
  } else if (a === 'ccSplit') {
    let at = S.t > c.start + 0.2 && S.t < c.start + c.dur - 0.2 ? S.t - c.start : c.dur / 2;
    const words = c.text.split(/\s+/).filter(Boolean);
    if (words.length < 2) { toast('Тут лише одне слово'); return true; }
    // ділимо текст пропорційно до часу, по межі слова
    const k = Math.max(1, Math.min(words.length - 1, Math.round(words.length * at / c.dur)));
    const second = { ...c, id: uid('s'), start: c.start + at, dur: c.dur - at, text: words.slice(k).join(' ') };
    c.dur = at; c.text = words.slice(0, k).join(' ');
    S.project.captions.push(second);
    S.project.captions.sort((x, y) => x.start - y.start);
    commit(); toast('Розділено');
  } else if (a === 'ccMerge') {
    const n = list[i + 1]; if (!n) return true;
    c.text = (c.text.trim() + ' ' + n.text.trim()).trim();
    c.dur = n.start + n.dur - c.start;
    S.project.captions = S.project.captions.filter(x => x.id !== n.id);
    commit(); toast('Об’єднано');
  } else if (a === 'ccStyle') {
    openStyle();
    emit('show-tab', 'captions');
  } else return false;
  return true;
}
