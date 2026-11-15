// Сторінка «Колір»: перегляд До/Після, осцилографи, інспектор вузла (колеса, криві, HSL…), редактор вузлів і рецепти.
import { S, on, commit, clipAt, layout, clipDur, media } from './state.js';
import { requestDraw, renderRaw, seek, previewCanvas } from './player.js';
import { $, icon, toast, paintRanges } from './ui.js';
import { parseCube } from './lut.js';
import {
  COLOR_VIEW, NODE_TYPES, ADDABLE, MIX_MODES, DEFAULTS, RECIPES, newGraph, newNode, repairGraph, recipeGraph, graphOrder, isIdentityGraph,
  nodeNeutral, renderThumbs, curveTable, rgb2hsv, gpuAvailable, MASKABLE, MASK_SHAPES, maskDefault,
  animatedGraph, kfSet, kfRemove, kfAt, kfTimes, kfValue, getPath, setPath, hasKf,
} from './color.js';
import { drawWaveform, drawVector, drawHist, histogram } from './scopes.js';

const st = { page: 'edit', sel: null, selLink: null, view: { x: 24, y: 18, k: 1 }, scope: 'luma', ch: 'm', pick: false, userRecipes: [] };
try { st.userRecipes = JSON.parse(localStorage.getItem('videocut-recipes') || '[]').filter(r => r && r.id && r.name && repairGraph(r.cg)).slice(0, 12); } catch { st.userRecipes = []; }
const root = {};
const NW = 156, NH = 76; // розмір картки вузла в координатах полотна
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r2 = v => Math.round(v * 100) / 100;
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(r2(v));

/* ═════════ поточний кліп і граф ═════════ */
const curLayout = () => clipAt(S.t, layout());
export const curClip = () => curLayout()?.clip || null;
const luts = () => S.project.luts || [];
const curGraph = () => curClip()?.cg || null;
function editGraph(fn) {
  const c = curClip(); if (!c) return false;
  if (!c.cg) c.cg = newGraph();
  fn(c.cg, c);
  return true;
}
const curT = () => { const l = curLayout(); return l ? Math.max(0, S.t - l.start) : 0; };
// значення параметра зараз (з урахуванням ключових кадрів)
function valAt(id, path) { const n = nodeOf(id); if (!n) return 0; const k = n.kf?.[path]; return k ? kfValue(k, curT()) : getPath(n, path); }
// запис параметра: якщо він анімований, пишемо ключ у поточний момент
function writeParam(id, path, v) {
  editGraph(() => { const m = nodeOf(id); if (!m) return; if (m.kf?.[path]) kfSet(m, path, curT(), v); setPath(m, path, v); });
  renderKfStrip();
}
let selId = null; // вузол, чий інспектор показано
const nodeOf = id => (curGraph() || (curClip() ? newGraph() : null))?.nodes.find(n => n.id === id) || null;
const touch = (structure = false) => { requestDraw(); queueThumbs(); queueScopes(); if (structure) { renderGraph(); } };
const done = label => { commit('Колір: ' + label); };

/* ═════════ перемикання сторінки ═════════ */
export const isColorPage = () => st.page === 'color';
export function setPage(p) {
  if (p === st.page) return;
  if (p === 'color' && !S.project.clips.length) { toast('Спершу додайте відео на таймлайн', 'warn'); return; }
  if (p === 'color' && !gpuAvailable()) toast('Ваш браузер не підтримує WebGL2: колірні вузли не застосовуватимуться. Оновіть браузер або відкрийте редактор у Chrome.', 'warn');
  st.page = p; document.body.dataset.page = p;
  COLOR_VIEW.on = p === 'color'; COLOR_VIEW.split = 0; COLOR_VIEW.mask = null; COLOR_VIEW.bypass = false; st.pick = false;
  for (const b of document.querySelectorAll('#pageSw [data-page]')) { const on_ = b.dataset.page === p; b.classList.toggle('on', on_); b.setAttribute('aria-selected', on_); }
  root.insp.hidden = p !== 'color'; root.panel.hidden = p !== 'color'; root.scopes.hidden = p !== 'color'; root.view.hidden = p !== 'color';
  $('inspector').hidden = p === 'color';
  if (p === 'color') { if (!curClip()) seek(0); if (!nodeOf(st.sel)) st.sel = (curGraph() || newGraph()).nodes.find(n => n.type === 'prim')?.id || 'in'; renderAll(); }
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  requestDraw(); queueScopes(); updateMaskOverlay();
}

/* ═════════ каркас ═════════ */
export function initColorUi() {
  root.insp = $('clrInsp'); root.panel = $('cgPanel'); root.scopes = $('scopes'); root.view = $('clrView');
  if (!root.insp || !root.panel) return;
  for (const b of document.querySelectorAll('#pageSw [data-page]')) b.addEventListener('click', () => setPage(b.dataset.page));
  document.addEventListener('keydown', e => { if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === '2' || e.key === '1')) { e.preventDefault(); setPage(e.key === '2' ? 'color' : 'edit'); } });
  root.panel.innerHTML = `
    <div class="cg-head"><b class="cg-title">Граф кліпа</b><div class="cg-clips" id="cgClips" role="tablist" aria-label="Кліпи"></div>
      <span class="grow"></span>
      <button class="btn btn-sm" id="cgAdd" aria-haspopup="menu">${icon('plus')}Вузол</button>
 <button class="btn btn-sm" id="cgAll" data-tip="Застосувати граф цього кліпа до всіх кліпів проєкту">До всіх кліпів</button>
      <button class="btn btn-sm btn-icon" id="cgFit" data-tip="Показати весь граф" aria-label="Показати весь граф">${icon('fit')}</button>
      <button class="btn btn-sm" id="cgReset" data-tip="Скинути граф кліпа">Скинути</button></div>
    <div class="cg-body"><div class="cg-canvas" id="cgCanvas" tabindex="0" aria-label="Граф вузлів. Стрілки рухають вибраний вузол, Delete видаляє"><div class="cg-world" id="cgWorld"><svg class="cg-wires" id="cgWires" width="4000" height="2400"></svg><div id="cgNodes"></div></div>
      <div class="cg-hint" id="cgHint">Перетягніть від кружечка праворуч до кружечка ліворуч іншого вузла, щоб з’єднати. Колесо миші масштабує.</div></div>
      <aside class="cg-rec" id="cgRec" aria-label="Рецепти"></aside></div>`;
  root.view.innerHTML = `<div class="clr-bar"><button class="btn btn-sm" id="clrBA" aria-pressed="false" data-tip="Порівняти до і після">До / Після</button>
    <button class="btn btn-sm" id="clrHold" data-tip="Утримуйте, щоб побачити оригінал">Оригінал</button>
    <button class="btn btn-sm" id="clrPick" aria-pressed="false" data-tip="Піпетка: виберіть колір на кадрі для вузла HSL">${icon('dropper')}Піпетка</button></div>`;
  root.scopes.innerHTML = `<div class="sc-tabs" role="tablist" aria-label="Вид осцилографа"><button role="tab" aria-selected="true" class="on" data-sc="luma">Яскравість</button><button role="tab" aria-selected="false" data-sc="rgb">RGB</button><button role="tab" aria-selected="false" data-sc="hist">Гістограма</button></div>
    <canvas id="scWave" width="248" height="130" aria-label="Осцилограф"></canvas><div class="sc-l">Векторскоп</div><canvas id="scVec" width="130" height="130" aria-label="Векторскоп"></canvas>`;
  wireGraphCanvas(); wireViewControls(); wireKfStrip();
  $('cgAdd').addEventListener('click', e => addMenu(e.currentTarget));
  $('cgFit').addEventListener('click', fitView);
  $('cgAll').addEventListener('click', () => {
    const c = curClip(); if (!c || !c.cg || isIdentityGraph(c.cg)) { toast('Спершу налаштуйте колір цього кліпа', 'warn'); return; }
    let n = 0; for (const o of S.project.clips) if (o !== c) { o.cg = JSON.parse(JSON.stringify(c.cg)); n++; }
    if (!n) { toast('Інших кліпів немає'); return; } renderStrip(); requestDraw(); done('граф застосовано до всіх кліпів'); toast(`Колір застосовано до ${n} ${n === 1 ? 'кліпа' : 'кліпів'}`, 'ok');
  });
  $('cgReset').addEventListener('click', () => { if (!curClip()) return; editGraph((g, c) => { c.cg = newGraph(); }); st.sel = 'prim1'; touch(true); renderInspector(); done('граф скинуто'); });
  root.scopes.addEventListener('click', e => { const b = e.target.closest('[data-sc]'); if (!b) return; st.scope = b.dataset.sc; for (const x of root.scopes.querySelectorAll('[data-sc]')) { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); } queueScopes(); });
  on('time', () => { if (st.page === 'color') { onClipMaybeChanged(); queueScopes(); queueRecipeThumbs(); updateKfHead(); if (curGraph()?.nodes.some(hasKf)) { queueThumbs(); const nn = nodeOf(selId); if (nn && hasKf(nn)) for (const e of root.insp.querySelectorAll('.crow, .wheel')) e._refresh?.(); updateMaskOverlay(); } } });
  on('project', () => { if (st.page === 'color') { if (!S.project.clips.length) { setPage('edit'); return; } onClipMaybeChanged(true); queueThumbs(); queueScopes(); queueRecipeThumbs(); } });
  on('select', () => { });
}
let lastClipId = null;
function onClipMaybeChanged(force) {
  const c = curClip(), id = c?.id || null;
  if (!force && id === lastClipId) return;
  lastClipId = id;
  if (!nodeOf(st.sel) && !(c && !c.cg && st.sel === 'prim1')) st.sel = c ? (c.cg || newGraph()).nodes.find(n => n.type === 'prim')?.id || 'in' : null;
  renderAll();
}
function renderAll() { renderStrip(); renderGraph(); renderInspector(); renderRecipes(); queueThumbs(); renderKfStrip(); }

/* ═════════ смуга кліпів ═════════ */
function renderStrip() {
  const box = $('cgClips'); if (!box) return;
  const L = layout(), cur = curClip();
  box.innerHTML = L.map((l, i) => { const m = media.get(l.clip.mediaId), has = l.clip.cg && !isIdentityGraph(l.clip.cg); return `<button role="tab" class="cg-clip${l.clip === cur ? ' on' : ''}" data-i="${i}" aria-selected="${l.clip === cur}" title="${esc(m?.name || 'Кліп ' + (i + 1))}">${i + 1}${has ? '<i class="dot"></i>' : ''}</button>`; }).join('');
  box.onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; const l = L[+b.dataset.i]; if (l) { st.sel = null; seek(l.start + Math.min(0.05, (l.end - l.start) / 3)); } };
}

/* ═════════ полотно вузлів ═════════ */
const sub = n => {
  const p = n.p;
  switch (n.type) {
    case 'in': return ['Кадр', 'джерело'];
    case 'out': return ['Результат', 'у перегляд і експорт'];
    case 'prim': { const a = []; if (p.exp) a.push('експ. ' + sgn(p.exp)); if (p.con !== 1) a.push('контраст'); if (p.sat !== 1) a.push('насич.'); if (p.temp) a.push('тепло'); return ['Колеса', a.slice(0, 2).join(', ') || 'без змін']; }
    case 'curves': { const k = ['m', 'r', 'g', 'b'].filter(c => p[c].length > 2 || JSON.stringify(p[c]) !== '[[0,0],[1,1]]'); return ['Криві', k.length ? k.map(c => c.toUpperCase()).join(' ') : 'пряма лінія']; }
    case 'hsl': return ['Колір ' + Math.round(p.hue) + '°', p.inv ? 'усе, крім вибраного' : 'вибраний колір'];
    case 'lut': { const l = luts().find(x => x.id === p.lut); return ['LUT', l ? l.name : 'не вибрано']; }
    case 'fx': { const a = []; if (p.vig) a.push('віньєтка'); if (p.grain) a.push('зерно'); if (p.glow) a.push('сяйво'); if (p.fade) a.push('вицвітання'); return ['Ефекти', a.join(', ') || 'без змін']; }
    case 'mix': return [MIX_MODES[p.mode], Math.round(p.amount * 100) + '%'];
    default: return ['', ''];
  }
};
const portY = (n, port) => (n.type === 'mix' ? (port === 1 ? NH * 0.72 : NH * 0.4) : NH / 2 + 8);
function renderGraph() {
  const nodesBox = $('cgNodes'), wires = $('cgWires'), canvas = $('cgCanvas'); if (!nodesBox) return;
  const c = curClip(); let g = c?.cg;
  $('cgHint').hidden = !!c && !!g && g.nodes.length > 3;
  if (!c) { nodesBox.innerHTML = '<div class="cg-empty">Немає кліпа під курсором. Перемістіть курсор на кліп.</div>'; wires.innerHTML = ''; return; }
  const virt = !g; if (!g) g = newGraph();
  nodesBox.innerHTML = '';
  for (const n of g.nodes) {
    const T = NODE_TYPES[n.type], [t1, t2] = sub(n), neutral = nodeNeutral(n) && n.type !== 'in' && n.type !== 'out';
    const d = h('div', `cn t-${n.type}${st.sel === n.id ? ' sel' : ''}${n.off ? ' off' : ''}${neutral && !n.off ? ' idle' : ''}`);
    d.dataset.id = n.id; d.tabIndex = 0; d.setAttribute('role', 'group'); d.setAttribute('aria-label', `Вузол «${T.name}»: ${t1}, ${t2}`);
    d.style.cssText = `left:${n.x}px;top:${n.y}px;width:${NW}px;height:${NH}px;--nc:${T.color}`;
    d.innerHTML = `<div class="cn-h"><b>${esc(T.name)}</b>${n.type === 'in' || n.type === 'out' ? '' : `<button class="cn-off" data-off aria-label="${n.off ? 'Увімкнути' : 'Вимкнути'} вузол" title="${n.off ? 'Увімкнути' : 'Вимкнути'}">${icon('eye')}</button>`}</div>
      <div class="cn-b"><canvas class="cn-th" width="48" height="30"></canvas><div class="cn-t"><span>${esc(t1)}</span><small>${esc(t2)}</small></div></div>
      ${n.type !== 'in' ? `<i class="cn-port in" data-port="0" style="top:${portY(n, 0)}px"></i>` : ''}${n.type === 'mix' ? `<i class="cn-port in" data-port="1" style="top:${portY(n, 1)}px"></i>` : ''}${n.type !== 'out' ? `<i class="cn-port out" style="top:${portY(n, 0)}px"></i>` : ''}`;
    nodesBox.appendChild(d);
  }
  drawWires(g);
  applyView(); paintThumbs();
  canvas.classList.toggle('virt', virt);
}
function drawWires(g = curGraph() || newGraph(), temp) {
  const w = $('cgWires'); if (!w) return;
  const by = new Map(g.nodes.map(n => [n.id, n]));
  const path = (x1, y1, x2, y2) => { const dx = Math.max(40, Math.abs(x2 - x1) * 0.5); return `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`; };
  let s = '';
  for (const l of g.links) {
    const a = by.get(l.from), b = by.get(l.to); if (!a || !b) continue;
    const d = path(a.x + NW, a.y + portY(a, 0), b.x, b.y + portY(b, l.port));
    const sel = st.selLink && st.selLink.from === l.from && st.selLink.to === l.to && st.selLink.port === l.port;
    s += `<path class="w-hit" d="${d}" data-from="${l.from}" data-to="${l.to}" data-port="${l.port}"/><path class="w${sel ? ' sel' : ''}${a.off || b.off ? ' dim' : ''}" d="${d}"/>`;
  }
  if (temp) s += `<path class="w tmp" d="${path(temp.x1, temp.y1, temp.x2, temp.y2)}"/>`;
  w.innerHTML = s;
}
const applyView = () => { const v = st.view; $('cgWorld').style.transform = `translate(${v.x}px,${v.y}px) scale(${v.k})`; $('cgCanvas').style.backgroundPosition = `${v.x}px ${v.y}px`; $('cgCanvas').style.backgroundSize = `${18 * v.k}px ${18 * v.k}px`; };
function fitView() {
  const g = curGraph() || newGraph(), cv = $('cgCanvas').getBoundingClientRect(); if (!cv.width) return;
  const xs = g.nodes.map(n => n.x), ys = g.nodes.map(n => n.y), x0 = Math.min(...xs), x1 = Math.max(...xs) + NW, y0 = Math.min(...ys), y1 = Math.max(...ys) + NH;
  const k = Math.max(0.4, Math.min(1.2, Math.min((cv.width - 60) / (x1 - x0), (cv.height - 50) / (y1 - y0))));
  st.view = { k, x: (cv.width - (x1 - x0) * k) / 2 - x0 * k, y: (cv.height - (y1 - y0) * k) / 2 - y0 * k }; applyView();
}
function selectNode(id) { st.sel = id; st.selLink = null; setTimeout(() => { updateMaskOverlay(); renderKfStrip(); }, 0); for (const d of $('cgNodes').children) d.classList?.toggle('sel', d.dataset?.id === id); drawWires(); renderInspector(); if (nodeOf(id)?.type !== 'hsl') { COLOR_VIEW.mask = null; $('clrView')?.classList.remove('mask-on'); requestDraw(); } }

function wireGraphCanvas() {
  const cv = $('cgCanvas');
  const toWorld = e => { const r = cv.getBoundingClientRect(), v = st.view; return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k }; };
  let drag = null;
  cv.addEventListener('pointerdown', e => {
    if (e.button === 2) return;
    const port = e.target.closest('.cn-port'), node = e.target.closest('.cn'), wire = e.target.closest('.w-hit');
    cv.focus({ preventScroll: true });
    if (e.target.closest('[data-off]')) return;
    const c = curClip(); if (!c) return;
    if (port && node) {
      const id = node.dataset.id, g = c.cg || newGraph();
      if (port.classList.contains('out')) { drag = { type: 'link', from: id }; }
      else { const pn = +port.dataset.port, ex = g.links.find(l => l.to === id && l.port === pn); if (ex) { drag = { type: 'link', from: ex.from, reuse: { to: id, port: pn } }; } else { drag = { type: 'inport', to: id, port: pn }; } }
    } else if (node) {
      const id = node.dataset.id; if (st.sel !== id) selectNode(id);
      const n = (c.cg || newGraph()).nodes.find(x => x.id === id), p = toWorld(e); drag = { type: 'node', id, dx: p.x - n.x, dy: p.y - n.y, moved: false };
    } else if (wire) { st.selLink = { from: wire.dataset.from, to: wire.dataset.to, port: +wire.dataset.port }; drawWires(); drag = null; return; }
    else { st.selLink = null; drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: st.view.x, vy: st.view.y }; cv.classList.add('panning'); drawWires(); }
    cv.setPointerCapture(e.pointerId); e.preventDefault();
  });
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    const c = curClip(); const g = c?.cg || newGraph();
    if (drag.type === 'pan') { st.view.x = drag.vx + e.clientX - drag.sx; st.view.y = drag.vy + e.clientY - drag.sy; applyView(); return; }
    if (drag.type === 'node') {
      const p = toWorld(e), n = g.nodes.find(x => x.id === drag.id); if (!n) return;
      if (!drag.moved) { if (!c.cg) { c.cg = newGraph(); } drag.moved = true; }
      const nn = c.cg.nodes.find(x => x.id === drag.id); nn.x = Math.round(p.x - drag.dx); nn.y = Math.round(p.y - drag.dy);
      const d = $('cgNodes').querySelector(`[data-id="${drag.id}"]`); d.style.left = nn.x + 'px'; d.style.top = nn.y + 'px'; drawWires(c.cg); return;
    }
    if (drag.type === 'link') {
      const a = g.nodes.find(x => x.id === drag.from), p = toWorld(e); if (!a) return;
      drawWires(g, { x1: a.x + NW, y1: a.y + portY(a, 0), x2: p.x, y2: p.y });
      for (const q of $('cgNodes').querySelectorAll('.cn-port.in')) q.classList.toggle('hot', q === document.elementFromPoint(e.clientX, e.clientY));
    }
  });
  const end = e => {
    if (!drag) return; const d = drag; drag = null; cv.classList.remove('panning');
    for (const q of $('cgNodes').querySelectorAll('.cn-port.hot')) q.classList.remove('hot');
    if (d.type === 'node' && d.moved) { done('вузол переміщено'); renderGraph(); }
    if (d.type === 'link') {
      const t = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.cn-port.in'), tn = t?.closest('.cn');
      const keep = d.reuse; let changed = false;
      if (t && tn) {
        const to = tn.dataset.id, port = +t.dataset.port;
        editGraph(g => {
          if (keep) g.links = g.links.filter(l => !(l.to === keep.to && l.port === keep.port));
          g.links = g.links.filter(l => !(l.to === to && l.port === port)); g.links.push({ from: d.from, to, port });
          const r = repairGraph(g); if (!r || !r.links.some(l => l.from === d.from && l.to === to && l.port === port)) { toast('Так з’єднати не можна: вийшла б петля', 'warn'); if (keep) g.links.push({ from: d.from, to: keep.to, port: keep.port }); g.links = g.links.filter(l => !(l.from === d.from && l.to === to && l.port === port && !(keep && keep.to === to && keep.port === port))); return; }
          Object.assign(g, r); changed = true;
        });
      } else if (keep) { editGraph(g => { g.links = g.links.filter(l => !(l.to === keep.to && l.port === keep.port)); }); changed = true; }
      renderGraph(); if (changed) { touch(); done('з’єднання'); }
    }
  };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', e => {
    e.preventDefault(); const r = cv.getBoundingClientRect(), v = st.view, k = Math.max(0.35, Math.min(1.8, v.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    const mx = e.clientX - r.left, my = e.clientY - r.top; v.x = mx - (mx - v.x) * k / v.k; v.y = my - (my - v.y) * k / v.k; v.k = k; applyView();
  }, { passive: false });
  cv.addEventListener('click', e => {
    const off = e.target.closest('[data-off]'); if (off) { const id = off.closest('.cn').dataset.id; editGraph(g => { const n = g.nodes.find(x => x.id === id); n.off = !n.off; if (!n.off) delete n.off; }); renderGraph(); touch(); done('вузол вимкнено/увімкнено'); }
  });
  cv.addEventListener('contextmenu', e => { const node = e.target.closest('.cn'); e.preventDefault(); if (node) nodeMenu(node.dataset.id, e.clientX, e.clientY); });
  cv.addEventListener('keydown', e => {
    const id = st.sel, g = curGraph(); if (!g) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.target.closest('input')) {
      e.preventDefault();
      if (st.selLink) { const l = st.selLink; editGraph(gr => { gr.links = gr.links.filter(x => !(x.from === l.from && x.to === l.to && x.port === l.port)); }); st.selLink = null; renderGraph(); touch(); done('з’єднання видалено'); }
      else if (id) removeNode(id);
    } else if (e.key.startsWith('Arrow') && id && nodeOf(id)) {
      e.preventDefault(); const dx = { ArrowLeft: -10, ArrowRight: 10 }[e.key] || 0, dy = { ArrowUp: -10, ArrowDown: 10 }[e.key] || 0;
      editGraph(gr => { const n = gr.nodes.find(x => x.id === id); n.x += dx; n.y += dy; }); renderGraph(); done('вузол переміщено');
    } else if (e.key === 'Enter' && e.target.closest('.cn')) selectNode(e.target.closest('.cn').dataset.id);
  });
}

/* ═════════ дії над вузлами ═════════ */
function removeNode(id) {
  const n = nodeOf(id); if (!n || n.type === 'in' || n.type === 'out') { toast('Вхід і вихід видаляти не можна'); return; }
  editGraph(g => {
    const src = g.links.find(l => l.to === id && l.port === 0)?.from, outs = g.links.filter(l => l.from === id);
    g.nodes = g.nodes.filter(x => x.id !== id); g.links = g.links.filter(l => l.from !== id && l.to !== id);
    if (src) for (const o of outs) if (!g.links.some(l => l.to === o.to && l.port === o.port)) g.links.push({ from: src, to: o.to, port: o.port });
    Object.assign(g, repairGraph(g) || g);
  });
  st.sel = 'in'; renderGraph(); renderInspector(); touch(); done('вузол видалено');
}
function addNode(type) {
  let nid;
  editGraph(g => {
    const sel = g.nodes.find(n => n.id === st.sel), outN = g.nodes.find(n => n.type === 'out');
    const after = sel && sel.type !== 'out' ? sel : g.nodes.find(n => n.id === (g.links.find(l => l.to === outN.id)?.from)) || g.nodes.find(n => n.type === 'in');
    const n = newNode(type, after.x + NW + 40, after.y + (type === 'mix' ? 20 : 0));
    // вставляємо після вибраного: вибраний → новий → усе, що йшло далі
    const outs = g.links.filter(l => l.from === after.id);
    g.links = g.links.filter(l => l.from !== after.id); g.nodes.push(n); g.links.push({ from: after.id, to: n.id, port: 0 });
    for (const o of outs) g.links.push({ from: n.id, to: o.to, port: o.port });
    // зсуваємо вузли праворуч, щоб не накладались
    for (const m of g.nodes) if (m !== n && m.id !== after.id && m.x > after.x) m.x += NW + 40;
    nid = n.id; Object.assign(g, repairGraph(g) || g);
  });
  st.sel = nid; renderGraph(); renderInspector(); fitView(); touch(); done('вузол «' + NODE_TYPES[type].name + '»');
}
function dupNode(id) {
  const n = nodeOf(id); if (!n || n.type === 'in' || n.type === 'out') return; let nid;
  editGraph(g => { const m = { ...JSON.parse(JSON.stringify(n)), id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), x: n.x + 30, y: n.y + NH + 20 }; g.nodes.push(m); nid = m.id; });
  st.sel = nid; renderGraph(); renderInspector(); touch(); done('вузол продубльовано');
}
function popup(x, y, items) {
  document.querySelector('.cg-pop')?.remove();
  const m = h('div', 'cg-pop'); m.setAttribute('role', 'menu');
  m.innerHTML = items.map((it, i) => `<button role="menuitem" data-i="${i}"${it.danger ? ' class="danger"' : ''}>${it.dot ? `<i style="background:${it.dot}"></i>` : ''}${esc(it.t)}</button>`).join('');
  m.style.left = Math.min(x, innerWidth - 190) + 'px'; m.style.top = Math.min(y, innerHeight - items.length * 34 - 16) + 'px'; document.body.appendChild(m);
  const close = () => { m.remove(); document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc_, true); };
  const away = e => { if (!m.contains(e.target)) close(); }, esc_ = e => { if (e.key === 'Escape') close(); };
  m.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) { close(); items[+b.dataset.i].on(); } });
  setTimeout(() => { document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', esc_, true); }, 0); m.querySelector('button')?.focus();
}
function addMenu(btn) { const r = btn.getBoundingClientRect(); popup(r.left, r.top - ADDABLE.length * 34 - 10, ADDABLE.map(t => ({ t: NODE_TYPES[t].name, dot: NODE_TYPES[t].color, on: () => addNode(t) }))); }
function nodeMenu(id, x, y) {
  const n = nodeOf(id); if (!n) return; selectNode(id);
  const items = [];
  if (n.type !== 'in' && n.type !== 'out') items.push({ t: n.off ? 'Увімкнути' : 'Вимкнути', on: () => { editGraph(g => { const m = g.nodes.find(q => q.id === id); m.off = !m.off; if (!m.off) delete m.off; }); renderGraph(); touch(); done('вузол вимкнено/увімкнено'); } }, { t: 'Дублювати', on: () => dupNode(id) }, { t: 'Скинути параметри', on: () => { editGraph(g => { const m = g.nodes.find(q => q.id === id); m.p = DEFAULTS[m.type](); delete m.kf; }); renderGraph(); renderInspector(); touch(); done('вузол скинуто'); } }, { t: 'Видалити', danger: true, on: () => removeNode(id) });
  else items.push({ t: 'Цей вузол видаляти не можна', on: () => { } });
  popup(x, y, items);
}

/* ═════════ мініатюри вузлів і рецептів ═════════ */
let thT = 0, scT = 0, rcT = 0, rawCache = null;
function queueThumbs() { clearTimeout(thT); thT = setTimeout(() => { rawCache = null; paintThumbs(); }, 90); }
function raw(w) { if (!rawCache || rawCache.w !== w) rawCache = { w, c: renderRaw(w) }; return rawCache.c; }
function paintThumbs() {
  const c = curClip(); const box = $('cgNodes'); if (!c || !box || st.page !== 'color') return;
  const g = animatedGraph(c.cg || newGraph(), curT()), src = raw(120); let m = null;
  // кадр після перемотування може ще не декодуватися: чекаємо й пробуємо знову
  const px = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, src.width, src.height).data; let lit = false; for (let i = 0; i < px.length; i += 64) if (px[i] + px[i + 1] + px[i + 2] > 12) { lit = true; break; }
  if (!lit && (st.retry = (st.retry || 0) + 1) <= 8) { rawCache = null; clearTimeout(thT); thT = setTimeout(paintThumbs, 220); } else if (lit) st.retry = 0;
  try { m = renderThumbs(src, g, luts(), 48, 30); } catch (e) { console.warn(e); }
  if (!m) return;
  const imgOf = id => { let n = g.nodes.find(x => x.id === id), guard = 0; while (n && guard++ < 40) { const im = m.get(n.id); if (im) return im; const f = g.links.find(l => l.to === n.id && l.port === 0)?.from; n = g.nodes.find(x => x.id === f); } return m.get(g.nodes.find(x => x.type === 'in').id); };
  for (const d of box.querySelectorAll('.cn')) { const cv = d.querySelector('.cn-th'); if (!cv) continue; const n = g.nodes.find(x => x.id === d.dataset.id); const im = n.type === 'out' ? imgOf(g.links.find(l => l.to === n.id)?.from) : imgOf(n.id); if (im) cv.getContext('2d').putImageData(im, 0, 0); }
}
function queueScopes() {
  if (scT || st.page !== 'color') return;
  scT = setTimeout(() => { scT = 0; paintScopes(); }, S.playing ? 120 : 60);
}
let tmpC = null;
function paintScopes() {
  const pv = previewCanvas(); if (!pv || !pv.width || st.page !== 'color') return;
  if (!tmpC) { tmpC = document.createElement('canvas'); tmpC.width = 248; tmpC.height = 140; }
  const g = tmpC.getContext('2d', { willReadFrequently: true }); g.drawImage(pv, 0, 0, 248, 140);
  const d = g.getImageData(0, 0, 248, 140).data, wave = $('scWave'), vec = $('scVec'); if (!wave || !vec) return;
  if (st.scope === 'hist') drawHist(wave, histogram(d), 'rgb'); else drawWaveform(wave, d, 248, 140, st.scope === 'rgb' ? 'rgb' : 'luma');
  drawVector(vec, d, 248, 140);
  lastHist = histogram(d); if (st.ch && root.curveCv) drawCurves();
}
let lastHist = null;

/* ═════════ перегляд: До/Після, оригінал, піпетка ═════════ */
function wireViewControls() {
  const ba = $('clrBA'), sp = $('clrSplit'), hold = $('clrHold'), pk = $('clrPick'), wrap = $('pvWrap');
  const setSplit = v => { COLOR_VIEW.split = v; sp.hidden = !v || st.page !== 'color'; sp.style.left = (v * 100) + '%'; ba.setAttribute('aria-pressed', !!v); requestDraw(); };
  ba.addEventListener('click', () => setSplit(COLOR_VIEW.split ? 0 : 0.5));
  let sd = false;
  sp.addEventListener('pointerdown', e => { sd = true; sp.setPointerCapture(e.pointerId); e.preventDefault(); });
  sp.addEventListener('pointermove', e => { if (!sd) return; const r = wrap.getBoundingClientRect(); setSplit(Math.max(0.03, Math.min(0.97, (e.clientX - r.left) / r.width))); });
  sp.addEventListener('pointerup', () => { sd = false; });
  const bypass = v => { COLOR_VIEW.bypass = v; requestDraw(); queueScopes(); };
  hold.addEventListener('pointerdown', () => bypass(true)); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) hold.addEventListener(ev, () => { if (COLOR_VIEW.bypass) bypass(false); });
  hold.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') bypass(true); }); hold.addEventListener('keyup', () => bypass(false));
  pk.addEventListener('click', () => { st.pick = !st.pick; pk.setAttribute('aria-pressed', st.pick); wrap.classList.toggle('picking', st.pick); if (st.pick && nodeOf(st.sel)?.type !== 'hsl') { addNode('hsl'); } });
  wrap.addEventListener('click', e => {
    if (!st.pick || st.page !== 'color') return;
    const r = previewCanvas().getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height; if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
    const src = raw(240), g = src.getContext('2d', { willReadFrequently: true }), x = Math.floor(fx * src.width), y = Math.floor(fy * src.height);
    const px = g.getImageData(Math.max(0, x - 2), Math.max(0, y - 2), 5, 5).data; let rr = 0, gg = 0, bb = 0; for (let i = 0; i < px.length; i += 4) { rr += px[i]; gg += px[i + 1]; bb += px[i + 2]; } const k = px.length / 4;
    const [hh, ss, vv] = rgb2hsv(rr / k / 255, gg / k / 255, bb / k / 255); const n = nodeOf(st.sel); if (!n || n.type !== 'hsl') return;
    editGraph(() => { Object.assign(n.p, { hue: Math.round(hh * 360), smin: Math.max(0, r2(ss - 0.35)), smax: Math.min(1, r2(ss + 0.35)), lmin: Math.max(0, r2(vv - 0.4)), lmax: Math.min(1, r2(vv + 0.4)), width: 50 }); });
    st.pick = false; pk.setAttribute('aria-pressed', false); wrap.classList.remove('picking'); renderInspector(); renderGraph(); touch(); done('піпетка');
  });
}

/* ═════════ інспектор вузла ═════════ */
function renderInspector() {
  const box = root.insp; if (!box) return; box.innerHTML = '';
  const c = curClip(); const g = c?.cg || (c ? newGraph() : null);
  if (!c) { box.innerHTML = '<p class="hint">Додайте відео на таймлайн і поставте курсор на кліп.</p>'; return; }
  const n = g.nodes.find(x => x.id === st.sel) || g.nodes.find(x => x.type === 'prim') || g.nodes[0];
  const T = NODE_TYPES[n.type];
  const head = h('div', 'ci-head', `<i class="ci-dot" style="background:${T.color}"></i><div><b>Вузол «${esc(T.name)}»</b><small>${esc(sub(n).join(' · '))}</small></div>${n.type === 'in' || n.type === 'out' ? '' : '<button class="btn btn-sm" data-reset>Скинути</button>'}`);
  box.appendChild(head);
  head.querySelector('[data-reset]')?.addEventListener('click', () => { editGraph((gr, cl) => { const m = gr.nodes.find(q => q.id === n.id); m.p = DEFAULTS[m.type](); delete m.kf; }); renderInspector(); renderGraph(); touch(); done('вузол скинуто'); });
  const P = () => nodeOf(n.id)?.p || n.p;
  selId = n.id;
  const set = path => v => { writeParam(n.id, path, v); touch(); renderGraphLight(n.id); };
  if (n.type === 'in') box.appendChild(h('p', 'hint', 'Вхід — це кадр кліпа до будь-яких змін. Від його кружечка тягніть лінію до першого вузла корекції.'));
  else if (n.type === 'out') box.appendChild(h('p', 'hint', 'Вихід — це те, що побачить глядач і що потрапить в експорт. Усе, що не з’єднано з виходом, на кадр не впливає.'));
  else if (n.type === 'prim') primInsp(box, n, P, set);
  else if (n.type === 'curves') curvesInsp(box, n, P);
  else if (n.type === 'hsl') hslInsp(box, n, P, set);
  else if (n.type === 'lut') lutInsp(box, n, P, set);
  else if (n.type === 'fx') fxInsp(box, n, set);
  else if (n.type === 'mix') mixInsp(box, n, P, set);
  if (MASKABLE.includes(n.type)) maskInsp(box, n);
  paintRanges(box); updateMaskOverlay();
}
// оновлюємо лише підпис вузла (без повної перебудови, щоб не збивати перетягування)
function renderGraphLight(id) { const n = nodeOf(id), d = $('cgNodes')?.querySelector(`[data-id="${id}"]`); if (!n || !d) return; const [a, b] = sub(n); d.querySelector('.cn-t span').textContent = a; d.querySelector('.cn-t small').textContent = b; d.classList.toggle('idle', nodeNeutral(n) && !n.off); }

function kfButton(paths, labelText) {
  const b = h('button', 'kfb'); b.type = 'button'; b.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 11 6 6 11 1 6Z"/></svg>';
  const state = () => { const n = nodeOf(selId); const t = curT(); const any = paths.some(q => n?.kf?.[q]), on_ = paths.some(q => n && kfAt(n, q, t)); b.classList.toggle('anim', any && !on_); b.classList.toggle('on', on_); b.setAttribute('aria-pressed', on_); b.title = on_ ? 'Видалити ключовий кадр тут' : 'Додати ключовий кадр у цьому місці'; b.setAttribute('aria-label', `${labelText}: ${on_ ? 'видалити ключовий кадр' : 'додати ключовий кадр'}`); };
  b.addEventListener('click', () => {
    const t = curT(); editGraph(() => { const m = nodeOf(selId); const on_ = paths.some(q => kfAt(m, q, t)); for (const q of paths) { if (on_) kfRemove(m, q, t); else kfSet(m, q, t, getPath(m, q)); } });
    state(); renderKfStrip(); touch(); done(`ключовий кадр: ${labelText}`);
  });
  b._state = state; state(); return b;
}
function slider(label, v, min, max, step, fmt, onInput, def = null, path = null) {
  const row = h('div', 'crow' + (path ? ' kf' : '')), id = 'cs' + Math.random().toString(36).slice(2, 7);
  row.innerHTML = `<label for="${id}">${esc(label)}</label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}"><output>${fmt(v)}</output>`;
  const inp = row.querySelector('input'), out = row.querySelector('output'); paintRanges(row);
  let kb = null; if (path) { kb = kfButton([path], label); row.appendChild(kb); inp.dataset.path = path; }
  inp.addEventListener('input', () => { const x = +inp.value; out.textContent = fmt(x); onInput(x); kb?._state(); });
  inp.addEventListener('change', () => done(label));
  const reset = () => { if (def == null) return; inp.value = def; out.textContent = fmt(def); inp.dispatchEvent(new Event('input')); paintRanges(row); done(label); };
  row.querySelector('label').addEventListener('dblclick', reset); inp.addEventListener('dblclick', reset);
  row._refresh = () => { if (!path) return; const x = valAt(selId, path); inp.value = x; out.textContent = fmt(x); paintRanges(row); kb._state(); };
  return row;
}
const pct = v => Math.round(v * 100) + '%';

// колесо кольору: кружечок на колі задає відтінок і силу, повзунок знизу — рівень
function wheel(title, key, tip) {
  const el = h('div', 'wheel'), P_ = k => `p.${key}.${k}`, get = () => ({ x: valAt(selId, P_('x')), y: valAt(selId, P_('y')), l: valAt(selId, P_('l')) }), w = get();
  el.innerHTML = `<div class="wh-ring" role="group" aria-label="${esc(title)}: колір (стрілки рухають точку, подвійний клік скидає)" tabindex="0" data-tip="${esc(tip)}"><i class="wh-puck"></i></div><div class="wh-t"><b>${esc(title)}</b></div><input type="range" min="-1" max="1" step="0.01" value="${w.l}" aria-label="${esc(title)}: рівень"><small>${sgn(w.l)}</small>`;
  const ring = el.querySelector('.wh-ring'), puck = el.querySelector('.wh-puck'), lv = el.querySelector('input'), sm = el.querySelector('small');
  const kb = kfButton([P_('x'), P_('y'), P_('l')], title); el.querySelector('.wh-t').appendChild(kb);
  const setW = o => { for (const [k, v] of Object.entries(o)) writeParam(selId, P_(k), v); touch(); renderGraphLight(selId); kb._state(); };
  const place = () => { const q = get(); puck.style.left = (50 + q.x * 46) + '%'; puck.style.top = (50 - q.y * 46) + '%'; el.classList.toggle('on', !!(q.x || q.y || q.l)); lv.value = q.l; sm.textContent = sgn(q.l); };
  place(); paintRanges(el);
  let dragging = false;
  const move = e => { const r = ring.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2 * 0.92; let x = (e.clientX - cx) / R, y = -(e.clientY - cy) / R; const L = Math.hypot(x, y); if (L > 1) { x /= L; y /= L; } setW({ x: r2(x), y: r2(y) }); place(); };
  ring.addEventListener('pointerdown', e => { dragging = true; ring.setPointerCapture(e.pointerId); move(e); e.preventDefault(); });
  ring.addEventListener('pointermove', e => { if (dragging) move(e); });
  ring.addEventListener('pointerup', () => { if (dragging) { dragging = false; done(title); } });
  ring.addEventListener('dblclick', () => { setW({ x: 0, y: 0 }); place(); done(title); });
  ring.addEventListener('keydown', e => { const d = { ArrowLeft: [-0.05, 0], ArrowRight: [0.05, 0], ArrowUp: [0, 0.05], ArrowDown: [0, -0.05] }[e.key]; if (!d) return; e.preventDefault(); const q = get(); setW({ x: r2(Math.max(-1, Math.min(1, q.x + d[0]))), y: r2(Math.max(-1, Math.min(1, q.y + d[1]))) }); place(); done(title); });
  lv.addEventListener('input', () => { setW({ l: +lv.value }); place(); }); lv.addEventListener('change', () => done(title)); lv.addEventListener('dblclick', () => { lv.value = 0; lv.dispatchEvent(new Event('input')); done(title); });
  el._refresh = () => { place(); kb._state(); };
  return el;
}
function primInsp(box, n, P, set) {
  const auto = h('div', 'crow auto'); auto.innerHTML = `<button class="btn btn-sm btn-block" data-tip="Підбирає яскравість, контраст і баланс білого за поточним кадром">${icon('wand')}Авто-корекція кадру</button>`; auto.querySelector('button').addEventListener('click', () => autoFix(n)); box.appendChild(auto);
  const ws = h('div', 'wheels');
  const defs = [['lift', 'Тіні', 'Колір і яскравість найтемніших ділянок'], ['gamma', 'Півтони', 'Середні тони: більшість кадру'], ['gain', 'Світла', 'Найяскравіші ділянки'], ['offset', 'Зсув', 'Підсвічує увесь кадр одним кольором']];
  for (const [k, t, tip] of defs) ws.appendChild(wheel(t, k, tip));
  box.appendChild(ws);
  const sec = h('div', 'csec', '<div class="csh">Тон</div>'); box.appendChild(sec);
  const S_ = (l, k, a, b, st_, f, d) => sec.appendChild(slider(l, valAt(n.id, 'p.' + k), a, b, st_, f, set('p.' + k), d, 'p.' + k));
  S_('Експозиція', 'exp', -3, 3, 0.05, sgn, 0); S_('Контраст', 'con', 0, 2, 0.01, v => pct(v), 1); S_('Світла (ділянки)', 'hi', -1, 1, 0.01, v => sgn(v * 100), 0); S_('Тіні (ділянки)', 'sh', -1, 1, 0.01, v => sgn(v * 100), 0);
  const c2 = h('div', 'csec', '<div class="csh">Колір</div>'); box.appendChild(c2);
  const C_ = (l, k, a, b, st_, f, d) => c2.appendChild(slider(l, valAt(n.id, 'p.' + k), a, b, st_, f, set('p.' + k), d, 'p.' + k));
  C_('Температура', 'temp', -1, 1, 0.01, v => sgn(v * 100), 0); C_('Відтінок', 'tint', -1, 1, 0.01, v => sgn(v * 100), 0); C_('Насиченість', 'sat', 0, 2, 0.01, v => pct(v), 1);
}
function fxInsp(box, n, set) {
  const sec = h('div', 'csec', '<div class="csh">Ефекти</div>'); box.appendChild(sec);
  const F_ = (l, k, a, b, st_, f, d) => sec.appendChild(slider(l, valAt(n.id, 'p.' + k), a, b, st_, f, set('p.' + k), d, 'p.' + k));
  F_('Віньєтка', 'vig', 0, 1, 0.01, pct, 0); F_('Розмір світлої зони', 'vigSize', 0.1, 1, 0.01, pct, 0.55); F_('Зерно плівки', 'grain', 0, 1, 0.01, pct, 0); F_('Сяйво світлих ділянок', 'glow', 0, 1, 0.01, pct, 0); F_('Вицвілі чорні', 'fade', 0, 1, 0.01, pct, 0);
  box.appendChild(h('p', 'hint', 'Зерно й віньєтка рахуються так само в експорті. Зерно трохи «ворушиться» на кожному кадрі, як справжня плівка.'));
}
function mixInsp(box, n, P, set) {
  const sec = h('div', 'csec', '<div class="csh">Змішування двох гілок</div>'); box.appendChild(sec);
  const sel = h('div', 'crow sel'); sel.innerHTML = `<label>Режим</label><select class="input" aria-label="Режим змішування">${Object.entries(MIX_MODES).map(([k, v]) => `<option value="${k}"${P().mode === k ? ' selected' : ''}>${v}</option>`).join('')}</select>`;
  sel.querySelector('select').addEventListener('change', e => { editGraph(() => { (nodeOf(n.id) || n).p.mode = e.target.value; }); touch(); renderGraph(); done('режим змішування'); }); sec.appendChild(sel);
  sec.appendChild(slider('Сила', valAt(n.id, 'p.amount'), 0, 1, 0.01, pct, set('p.amount'), 0.5, 'p.amount'));
  box.appendChild(h('p', 'hint', 'Верхній вхід — основа, нижній — шар, який накладається. Зʼєднайте дві гілки з цим вузлом і оберіть режим, наприклад «Екран» для світіння.'));
}
function lutInsp(box, n, P, set) {
  const sec = h('div', 'csec', '<div class="csh">Кольорова схема (LUT)</div>'); box.appendChild(sec);
  const list = luts(), r = h('div', 'crow sel'); r.innerHTML = `<label>Схема</label><select class="input" aria-label="Кольорова схема LUT"><option value="">Не вибрано</option>${list.map(l => `<option value="${esc(l.id)}"${P().lut === l.id ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select>`;
  r.querySelector('select').addEventListener('change', e => { editGraph(() => { (nodeOf(n.id) || n).p.lut = e.target.value || null; }); touch(); renderGraphLight(n.id); done('LUT'); }); sec.appendChild(r);
  sec.appendChild(slider('Сила', valAt(n.id, 'p.mix'), 0, 1, 0.01, pct, set('p.mix'), 1, 'p.mix'));
  const up = h('div', 'crow'); up.innerHTML = `<button class="btn btn-sm btn-block">${icon('upload')}Додати файл .cube</button><input type="file" accept=".cube" hidden>`; const fi = up.querySelector('input');
  up.querySelector('button').addEventListener('click', () => fi.click());
  fi.addEventListener('change', async () => {
    const f = fi.files[0]; fi.value = ''; if (!f) return;
    try { const l = parseCube(await f.text()), lut = { id: 'l' + Date.now().toString(36), name: (l.name || f.name.replace(/\.cube$/i, '')).slice(0, 40), size: l.size, b64: l.b64 }; S.project.luts = [...luts(), lut].slice(-24); editGraph(() => { (nodeOf(n.id) || n).p.lut = lut.id; }); renderInspector(); renderGraphLight(n.id); touch(); done('LUT додано'); toast('Кольорову схему додано', 'ok'); }
    catch (e) { toast(e.message || 'Не вдалося прочитати файл', 'error'); }
  });
  sec.appendChild(up);
}
function hslInsp(box, n, P, set) {
  const sel = h('div', 'csec', '<div class="csh">Що виділити</div>'); box.appendChild(sel);
  const hr = slider('Колір (відтінок)', valAt(n.id, 'p.hue'), 0, 360, 1, v => v + '°', set('p.hue'), 30, 'p.hue'); hr.classList.add('hue'); sel.appendChild(hr);
  const S_ = (l, k, a, b, st_, f, d) => sel.appendChild(slider(l, valAt(n.id, 'p.' + k), a, b, st_, f, set('p.' + k), d, 'p.' + k));
  S_('Ширина кольору', 'width', 5, 360, 1, v => v + '°', 60); S_('Насиченість від', 'smin', 0, 1, 0.01, pct, 0.15); S_('Насиченість до', 'smax', 0, 1, 0.01, pct, 1); S_('Яскравість від', 'lmin', 0, 1, 0.01, pct, 0); S_('Яскравість до', 'lmax', 0, 1, 0.01, pct, 1); S_('М’якість країв', 'soft', 0, 1, 0.01, pct, 0.4);
  const tg = h('div', 'ctog'); tg.innerHTML = `<label><input type="checkbox" data-inv${P().inv ? ' checked' : ''}> Усе, крім вибраного</label><label><input type="checkbox" data-mask${COLOR_VIEW.mask === n.id ? ' checked' : ''}> Показати маску</label>`;
  tg.querySelector('[data-inv]').addEventListener('change', e => { editGraph(() => { (nodeOf(n.id) || n).p.inv = e.target.checked; }); touch(); renderGraphLight(n.id); done('інверсія маски'); });
  tg.querySelector('[data-mask]').addEventListener('change', e => { COLOR_VIEW.mask = e.target.checked ? n.id : null; requestDraw(); }); sel.appendChild(tg);
  const ad = h('div', 'csec', '<div class="csh">Що змінити у вибраному</div>'); box.appendChild(ad);
  const A_ = (l, k, a, b, st_, f, d) => ad.appendChild(slider(l, valAt(n.id, 'p.' + k), a, b, st_, f, set('p.' + k), d, 'p.' + k));
  A_('Зсув відтінку', 'dh', -180, 180, 1, sgn, 0); A_('Насиченість', 'ds', 0, 3, 0.01, pct, 1); A_('Яскравість', 'dl', -1, 1, 0.01, v => sgn(v * 100), 0); A_('Сила дії', 'amount', 0, 1, 0.01, pct, 1);
  box.appendChild(h('p', 'hint', `Піпетка над кадром (кнопка ${'«Піпетка»'}) сама заповнить виділення за кольором, на який ви натиснете.`));
}

/* ═════════ смужка ключових кадрів під кадром ═════════ */
const fmtT = t => { const m = Math.floor(t / 60), x = t - m * 60; return String(m).padStart(2, '0') + ':' + x.toFixed(1).padStart(4, '0'); };
function wireKfStrip() {
  const strip = $('kfStrip'); if (!strip) return;
  strip.innerHTML = `<button class="btn btn-sm btn-icon" id="kfPrev" aria-label="Попередній ключовий кадр" data-tip="Попередній ключовий кадр">${icon('chevL')}</button><div class="kf-track" id="kfTrack" role="slider" tabindex="0" aria-label="Позиція в кліпі: клікніть або тягніть"><i class="kf-head"></i></div><button class="btn btn-sm btn-icon" id="kfNext" aria-label="Наступний ключовий кадр" data-tip="Наступний ключовий кадр">${icon('chevR')}</button><span class="kf-info" id="kfInfo"></span>`;
  const track = $('kfTrack'); let drag = false;
  const seekTo = e => { const l = curLayout(); if (!l) return; const r = track.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); seek(l.start + f * (l.end - l.start - 0.001)); };
  track.addEventListener('pointerdown', e => { const mk = e.target.closest('.kf-mark'); if (mk) { const l = curLayout(); if (l) seek(l.start + +mk.dataset.t); e.preventDefault(); return; } drag = true; track.setPointerCapture(e.pointerId); seekTo(e); });
  track.addEventListener('pointermove', e => { if (drag) seekTo(e); }); track.addEventListener('pointerup', () => { drag = false; });
  track.addEventListener('keydown', e => { const l = curLayout(); if (!l) return; const d = { ArrowLeft: -1 / 30, ArrowRight: 1 / 30 }[e.key]; if (d) { e.preventDefault(); seek(S.t + d * (e.shiftKey ? 10 : 1)); } });
  const jump = dir => { const l = curLayout(), n = nodeOf(st.sel); if (!l || !n) return; const t = curT(), ts = kfTimes(n), q = dir < 0 ? [...ts].reverse().find(x => x < t - 0.02) : ts.find(x => x > t + 0.02); if (q !== undefined) seek(l.start + q); };
  $('kfPrev').addEventListener('click', () => jump(-1)); $('kfNext').addEventListener('click', () => jump(1));
}
function renderKfStrip() {
  const strip = $('kfStrip'); if (!strip) return; strip.hidden = st.page !== 'color'; if (st.page !== 'color') return;
  const l = curLayout(), track = $('kfTrack'), n = nodeOf(st.sel); if (!track) return;
  for (const m of [...track.querySelectorAll('.kf-mark')]) m.remove();
  const dur = l ? Math.max(0.01, l.end - l.start) : 1, ts = n && l ? kfTimes(n) : [];
  for (const t of ts) { const b = h('b', 'kf-mark'); b.dataset.t = t; b.style.left = Math.min(100, t / dur * 100) + '%'; b.title = 'Ключовий кадр ' + fmtT(t); track.appendChild(b); }
  $('kfPrev').disabled = !ts.some(x => x < curT() - 0.02); $('kfNext').disabled = !ts.some(x => x > curT() + 0.02);
  strip.classList.toggle('has', ts.length > 0); updateKfHead();
}
function updateKfHead() {
  const l = curLayout(), head = document.querySelector('#kfTrack .kf-head'), info = $('kfInfo'); if (!head) return;
  const dur = l ? Math.max(0.01, l.end - l.start) : 1, t = curT(); head.style.left = Math.min(100, t / dur * 100) + '%';
  if (info) info.textContent = `${fmtT(t)} / ${fmtT(dur)}`;
  const tr = $('kfTrack'); tr.setAttribute('aria-valuemin', '0'); tr.setAttribute('aria-valuemax', dur.toFixed(1)); tr.setAttribute('aria-valuenow', t.toFixed(1)); tr.setAttribute('aria-valuetext', `${fmtT(t)} з ${fmtT(dur)}`);
  const n = nodeOf(st.sel), ts = n ? kfTimes(n) : []; if ($('kfPrev')) { $('kfPrev').disabled = !ts.some(x => x < t - 0.02); $('kfNext').disabled = !ts.some(x => x > t + 0.02); }
}

/* ═════════ авто-корекція ═════════ */
function autoFix(n) {
  const src = raw(160), g = src.getContext('2d', { willReadFrequently: true }), d = g.getImageData(0, 0, src.width, src.height).data, N = d.length / 4;
  const ys = new Float32Array(N); let mr = 0, mg = 0, mb = 0, sat = 0;
  for (let i = 0; i < N; i++) { const r = d[i * 4] / 255, gg = d[i * 4 + 1] / 255, b = d[i * 4 + 2] / 255; mr += r; mg += gg; mb += b; ys[i] = 0.2126 * r + 0.7152 * gg + 0.0722 * b; sat += rgb2hsv(r, gg, b)[1]; }
  mr /= N; mg /= N; mb /= N; sat /= N; const sorted = Float32Array.from(ys).sort(), lo = sorted[Math.floor(N * 0.03)], hi = sorted[Math.floor(N * 0.97)], mean = ys.reduce((a, b) => a + b, 0) / N;
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  const patch = { exp: r2(clampN(Math.log2(0.42 / Math.max(0.04, mean)) * 0.8, -1.5, 1.5)), con: r2(clampN(0.88 / Math.max(0.2, hi - lo), 0.9, 1.35)), temp: r2(clampN((mb - mr) / Math.max(0.05, mb + mr) * 2.2, -0.5, 0.5)), sat: r2(sat < 0.3 ? 1.12 : 1) };
  for (const [k, v] of Object.entries(patch)) writeParam(n.id, 'p.' + k, v); renderInspector(); renderGraphLight(n.id); touch(); done('авто-корекція');
  toast('Кадр вирівняно. Підправте повзунками за смаком', 'ok');
}

/* ═════════ маски ═════════ */
function maskInsp(box, n) {
  const sec = h('div', 'csec', '<div class="csh">Маска: де діє вузол</div>'); box.appendChild(sec);
  const cur = () => (nodeOf(n.id) || n).mask || null;
  const sel = h('div', 'crow sel'); sel.innerHTML = `<label>Форма</label><select class="input" aria-label="Форма маски">${Object.entries(MASK_SHAPES).map(([k, v]) => `<option value="${k}"${(cur()?.type || 'none') === k ? ' selected' : ''}>${v}</option>`).join('')}</select>`;
  sel.querySelector('select').addEventListener('change', e => { editGraph(() => { const m = nodeOf(n.id) || n; if (e.target.value === 'none') delete m.mask; else m.mask = { ...(m.mask || maskDefault()), type: e.target.value }; }); renderInspector(); touch(); done('маска'); });
  sec.appendChild(sel);
  const m = cur(); if (!m) { sec.appendChild(h('p', 'hint', 'Маска обмежує дію вузла колом, прямокутником або градієнтом. Наприклад, підсвітити обличчя чи затемнити небо.')); return; }
  const set = k => v => { writeParam(n.id, 'mask.' + k, v); touch(); updateMaskOverlay(); };
  const S_ = (l, k, a, b, st_, f, d) => sec.appendChild(slider(l, valAt(n.id, 'mask.' + k), a, b, st_, f, set(k), d, 'mask.' + k));
  S_('Центр по горизонталі', 'x', 0, 1, 0.01, pct, 0.5); S_('Центр по вертикалі', 'y', 0, 1, 0.01, pct, 0.5);
  if (m.type !== 'linear') S_('Ширина', 'w', 0.05, 1.5, 0.01, pct, 0.5);
  S_(m.type === 'linear' ? 'Довжина переходу' : 'Висота', 'h', 0.05, 1.5, 0.01, pct, 0.5); S_('Поворот', 'rot', -180, 180, 1, v => v + '°', 0); S_('М\u2019якість краю', 'soft', 0, 1, 0.01, pct, 0.35);
  const tg = h('div', 'ctog'); tg.innerHTML = `<label><input type="checkbox"${m.inv ? ' checked' : ''}> Навпаки: діє поза маскою</label>`;
  tg.querySelector('input').addEventListener('change', e => { editGraph(() => { (nodeOf(n.id) || n).mask.inv = e.target.checked; }); touch(); done('інверсія маски'); }); sec.appendChild(tg);
}
// рамка маски над кадром: тягніть, щоб перемістити, кутовий маркер змінює розмір
function updateMaskOverlay() {
  let el = $('clrMask'); const wrap = $('pvWrap'), cv = previewCanvas(), n = st.page === 'color' ? nodeOf(st.sel) : null, m = n && MASKABLE.includes(n.type) ? n.mask : null;
  if (!m || !wrap || !cv) { if (el) el.hidden = true; return; }
  if (!el) {
    el = h('div', 'clr-mask', '<div class="mk" tabindex="0" aria-label="Маска: перетягніть, щоб перемістити"><b class="mk-h" aria-label="Змінити розмір маски"></b></div>'); el.id = 'clrMask'; wrap.appendChild(el);
    const mk = el.querySelector('.mk'), hd = el.querySelector('.mk-h'); let mode = null, start = null;
    const rect = () => { const r = previewCanvas().getBoundingClientRect(); return r; };
    mk.addEventListener('pointerdown', e => { if (e.target === hd) return; const r = rect(), mm = (nodeOf(st.sel) || {}).mask; if (!mm) return; mode = 'move'; start = { dx: (e.clientX - r.left) / r.width - mm.x, dy: (e.clientY - r.top) / r.height - mm.y }; mk.setPointerCapture(e.pointerId); e.preventDefault(); });
    hd.addEventListener('pointerdown', e => { mode = 'size'; hd.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation(); });
    const move = e => {
      if (!mode) return; const r = rect(), n2 = nodeOf(st.sel); if (!n2?.mask) return; const mm = n2.mask;
      if (mode === 'move') { writeParam(st.sel, 'mask.x', r2(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width - start.dx)))); writeParam(st.sel, 'mask.y', r2(Math.max(0, Math.min(1, (e.clientY - r.top) / r.height - start.dy)))); }
      else { const cx = r.left + mm.x * r.width, cy = r.top + mm.y * r.height, a = -mm.rot * Math.PI / 180, vx = e.clientX - cx, vy = e.clientY - cy, lx = vx * Math.cos(a) - vy * Math.sin(a), ly = vx * Math.sin(a) + vy * Math.cos(a); writeParam(st.sel, 'mask.w', r2(Math.max(0.05, Math.min(1.5, Math.abs(lx) * 2 / r.width)))); writeParam(st.sel, 'mask.h', r2(Math.max(0.05, Math.min(1.5, Math.abs(ly) * 2 / r.height)))); }
      touch(); updateMaskOverlay();
    };
    const end = () => { if (mode) { mode = null; renderInspector(); done('маска'); } };
    mk.addEventListener('pointermove', move); hd.addEventListener('pointermove', move); mk.addEventListener('pointerup', end); hd.addEventListener('pointerup', end);
    mk.addEventListener('keydown', e => { const d = { ArrowLeft: [-0.01, 0], ArrowRight: [0.01, 0], ArrowUp: [0, -0.01], ArrowDown: [0, 0.01] }[e.key]; if (!d) return; e.preventDefault(); writeParam(st.sel, 'mask.x', r2(Math.max(0, Math.min(1, valAt(st.sel, 'mask.x') + d[0])))); writeParam(st.sel, 'mask.y', r2(Math.max(0, Math.min(1, valAt(st.sel, 'mask.y') + d[1])))); touch(); updateMaskOverlay(); done('маска'); });
  }
  el.hidden = false;
  const cr = cv.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
  Object.assign(el.style, { left: cr.left - wr.left + 'px', top: cr.top - wr.top + 'px', width: cr.width + 'px', height: cr.height + 'px' });
  const am = { ...m, ...Object.fromEntries(['x', 'y', 'w', 'h', 'rot'].map(k => ['' + k, valAt(st.sel, 'mask.' + k)])) }, mk = el.querySelector('.mk'), lin = m.type === 'linear';
  mk.className = 'mk ' + m.type; mk.style.left = (am.x * 100) + '%'; mk.style.top = (am.y * 100) + '%';
  mk.style.width = (lin ? 1.2 : am.w) * 100 + '%'; mk.style.height = am.h * 100 + '%'; mk.style.transform = `translate(-50%,-50%) rotate(${am.rot}deg)`;
}
window.addEventListener('resize', () => { if (st.page === 'color') requestAnimationFrame(updateMaskOverlay); });

/* ═════════ криві ═════════ */
function curvesInsp(box, n, P) {
  const sec = h('div', 'csec', '<div class="csh">Криві</div>'); box.appendChild(sec);
  const tabs = h('div', 'ctabs'); tabs.innerHTML = [['m', 'Яскравість'], ['r', 'R'], ['g', 'G'], ['b', 'B']].map(([k, t]) => `<button data-ch="${k}" class="${st.ch === k ? 'on' : ''}" style="--cc:${{ m: '#ededed', r: '#ff6a5f', g: '#5fd39b', b: '#7a9bff' }[k]}">${t}</button>`).join(''); sec.appendChild(tabs);
  const cv = h('canvas', 'ccurve'); cv.width = 520; cv.height = 400; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Редактор кривих'); sec.appendChild(cv); root.curveCv = cv; root.curveNode = n.id;
  sec.appendChild(h('p', 'hint', 'Натисніть на лінію, щоб додати точку. Тягніть точку. Подвійний клік по точці видаляє її. S-подібна крива додає контрасту.'));
  tabs.addEventListener('click', e => { const b = e.target.closest('[data-ch]'); if (!b) return; st.ch = b.dataset.ch; for (const x of tabs.children) x.classList.toggle('on', x === b); drawCurves(); });
  const pts = () => (nodeOf(root.curveNode)?.p || n.p)[st.ch];
  const pos = e => { const r = cv.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))]; };
  let drag = -1;
  const near = (x, y) => { const p = pts(); let best = -1, bd = 0.045; p.forEach((q, i) => { const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = i; } }); return best; };
  cv.addEventListener('pointerdown', e => {
    const [x, y] = pos(e); let i = near(x, y);
    editGraph(() => { const p = pts(); if (i < 0) { p.push([x, y]); p.sort((a, b) => a[0] - b[0]); i = p.findIndex(q => q[0] === x && q[1] === y); } });
    drag = i; cv.setPointerCapture(e.pointerId); drawCurves(); touch(); e.preventDefault();
  });
  cv.addEventListener('pointermove', e => {
    if (drag < 0) return; const [x, y] = pos(e); const p = pts();
    const lo = drag === 0 ? 0 : p[drag - 1][0] + 0.02, hi = drag === p.length - 1 ? 1 : p[drag + 1][0] - 0.02;
    p[drag] = [drag === 0 ? 0 : drag === p.length - 1 ? 1 : Math.max(lo, Math.min(hi, x)), y]; drawCurves(); touch(); renderGraphLight(root.curveNode);
  });
  cv.addEventListener('pointerup', () => { if (drag >= 0) { drag = -1; done('криві'); } });
  cv.addEventListener('dblclick', e => { const [x, y] = pos(e), i = near(x, y), p = pts(); if (i > 0 && i < p.length - 1) { p.splice(i, 1); drawCurves(); touch(); renderGraphLight(root.curveNode); done('точку видалено'); } });
  drawCurves();
}
function drawCurves() {
  const cv = root.curveCv, n = nodeOf(root.curveNode); if (!cv || !n || !cv.isConnected) return; const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.fillStyle = '#141414'; g.fillRect(0, 0, W, H);
  if (lastHist) { const arr = st.ch === 'm' ? lastHist.l : lastHist[st.ch], max = Math.max(1, ...arr.slice(1, 255)); g.fillStyle = 'rgba(200,200,200,.14)'; for (let x = 0; x < W; x++) { const v = arr[Math.round(x / (W - 1) * 255)]; const hh = Math.min(1, v / max) * H * 0.9; g.fillRect(x, H - hh, 1, hh); } }
  g.strokeStyle = '#2e2e2e'; g.lineWidth = 1; g.beginPath(); for (let i = 1; i < 4; i++) { g.moveTo(W * i / 4 + 0.5, 0); g.lineTo(W * i / 4 + 0.5, H); g.moveTo(0, H * i / 4 + 0.5); g.lineTo(W, H * i / 4 + 0.5); } g.stroke();
  g.strokeStyle = '#444'; g.beginPath(); g.moveTo(0, H); g.lineTo(W, 0); g.stroke();
  const col = { m: '#ededed', r: '#ff6a5f', g: '#5fd39b', b: '#7a9bff' }[st.ch], pts = n.p[st.ch], t = curveTable(pts, 256);
  g.strokeStyle = col; g.lineWidth = 2.5; g.beginPath(); for (let x = 0; x < 256; x++) { const px = x / 255 * W, py = H - t[x] * H; x ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke();
  g.fillStyle = col; for (const q of pts) { g.beginPath(); g.arc(q[0] * W, H - q[1] * H, 7, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#141414'; g.lineWidth = 2; g.stroke(); }
}

/* ═════════ рецепти ═════════ */
function allRecipes() { return [...RECIPES.map(r => ({ id: r.id, name: r.name, note: r.note, graph: () => recipeGraph(r.id) })), ...st.userRecipes.map(r => ({ id: r.id, name: r.name, note: 'мій', user: true, graph: () => repairGraph(JSON.parse(JSON.stringify(r.cg))) }))]; }
function renderRecipes() {
  const box = $('cgRec'); if (!box) return;
  box.innerHTML = `<div class="rc-h"><b>Рецепти</b><button class="btn btn-sm" id="rcSave" data-tip="Зберегти поточний граф як рецепт">${icon('plus')}Мій</button></div><div class="rc-list" id="rcList"></div>`;
  const list = $('rcList');
  for (const r of allRecipes()) {
    const w = h('div', 'rcw'), b = h('button', 'rc'); b.type = 'button'; b.dataset.id = r.id; b.setAttribute('aria-label', `Рецепт «${r.name}»: ${r.note}`);
    b.innerHTML = `<canvas width="112" height="63" aria-hidden="true"></canvas><span>${esc(r.name)}</span>`; w.appendChild(b); list.appendChild(w);
    if (r.user) { const d = h('button', 'rc-del', '×'); d.type = 'button'; d.setAttribute('aria-label', `Видалити рецепт «${r.name}»`); d.title = 'Видалити'; w.appendChild(d); d.addEventListener('click', () => { st.userRecipes = st.userRecipes.filter(q => q.id !== r.id); saveRecipes(); renderRecipes(); }); }
    const apply = () => { const g = r.graph(); if (!g || !editGraph((gr, c) => { c.cg = g; })) return; st.sel = g.nodes.find(q => q.type === 'prim')?.id || 'in'; renderAll(); fitView(); touch(); done('рецепт «' + r.name + '»'); };
    b.addEventListener('click', apply);
  }
  $('rcSave').addEventListener('click', () => { const g = curGraph(); if (!g || isIdentityGraph(g)) { toast('Спершу щось змініть у кольорі', 'warn'); return; } const name = (prompt('Назва рецепта', 'Мій рецепт') || '').trim().slice(0, 30); if (!name) return; st.userRecipes = [...st.userRecipes, { id: 'u' + Date.now().toString(36), name, cg: JSON.parse(JSON.stringify(g)) }].slice(-12); saveRecipes(); renderRecipes(); toast('Рецепт збережено', 'ok'); });
  queueRecipeThumbs(0);
}
const saveRecipes = () => { try { localStorage.setItem('videocut-recipes', JSON.stringify(st.userRecipes)); } catch { /* сховище недоступне */ } };
function queueRecipeThumbs(delay = 450) {
  clearTimeout(rcT); rcT = setTimeout(() => {
    if (st.page !== 'color' || !curClip()) return; const src = raw(160), list = allRecipes();
    for (const r of list) {
      const cvs = $('rcList')?.querySelector(`[data-id="${r.id}"] canvas`); if (!cvs) continue;
      try { const g = r.graph(), m = renderThumbs(src, g, luts(), 112, 63); const order = graphOrder(g), last = [...order].reverse().find(q => m.get(q.id)); const im = last ? m.get(last.id) : m.get(g.nodes.find(q => q.type === 'in').id); if (im) cvs.getContext('2d').putImageData(im, 0, 0); } catch (e) { console.warn(e); }
    }
  }, delay);
}

export const colorState = st;
