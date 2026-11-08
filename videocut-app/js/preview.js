// Шар над переглядом: виділення, переміщення й зміна розміру елементів, точка фокусу для наближення.
import { S, media, on, emit, commit, select, findSel, layout, clipAt, outputSize } from './state.js';
import { textBoxes } from './render.js';
import { capBox, capStyle } from './cc.js';
import { isLayer, cropDrag } from './layer.js';
import { addLayerAt, addToTimeline } from './ops.js';
import { requestDraw } from './player.js';
import { $, clamp } from './ui.js';

let layer, canvas;

export function initPreviewLayer() {
  layer = $('pvLayer'); canvas = $('pv');
  ['select', 'project', 'aspect'].forEach(ev => on(ev, scheduleHandles));
  // під час відтворення рамку оновлюємо лише коли виділений елемент з'являється чи зникає
  on('time', () => { if (S.sel && S.sel.kind !== 'music') scheduleHandles(); });
  window.addEventListener('resize', scheduleHandles);
  canvas.addEventListener('pointerdown', onCanvasDown);
  // файл із бібліотеки на кадр — поверх основного відео, в місці падіння
  const stage = canvas.parentElement;
  stage.addEventListener('dragover', e => {
    if (![...e.dataTransfer.types].includes('application/x-vc-media')) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; stage.classList.add('drop-on');
  });
  stage.addEventListener('dragleave', e => { if (!stage.contains(e.relatedTarget)) stage.classList.remove('drop-on'); });
  stage.addEventListener('drop', e => {
    const id = e.dataTransfer.getData('application/x-vc-media'); if (!id) return;
    e.preventDefault(); stage.classList.remove('drop-on');
    const m = media.get(id); if (!m || m.kind === 'audio') return;
    const p = norm(e);
    if (!S.project.clips.length) { addToTimeline(m); return; }
    addLayerAt(m, { start: S.t, cx: clamp(p.x, 0, 1), cy: clamp(p.y, 0, 1) });
  });
  layer.addEventListener('pointerdown', onHandleDown);
  canvas.addEventListener('dblclick', e => {
    const hit = hitTest(e);
    if (hit && hit.type === 'text') { select('overlay', hit.id); emit('focus-inspector'); return; }
    const cap = capHit(e);
    if (cap) { select('caption', cap.id); emit('focus-inspector'); }
  });
}

const visible = o => S.t >= o.start && S.t < o.start + o.dur;
const boxOf = o => ({ x: o.x, y: o.y, w: o.w, h: o.type === 'text' ? (textBoxes.get(o) || 0.1) : o.h });

function norm(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, r };
}

function hitTest(e) {
  const { x, y } = norm(e);
  const list = S.project.overlays.filter(visible);
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i];
    if (o.type === 'arrow') {
      const { r } = norm(e);
      const ax = o.x * r.width, ay = o.y * r.height, bx = (o.x + o.w) * r.width, by = (o.y + o.h) * r.height;
      const px = x * r.width, py = y * r.height;
      const L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
      const tt = clamp(((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / L2, 0, 1);
      if (Math.hypot(px - (ax + tt * (bx - ax)), py - (ay + tt * (by - ay))) < 14) return o;
      continue;
    }
    if (o.type === 'spot') { // прожектор ловимо лише за рамку області
      const b = boxOf(o);
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return o;
      continue;
    }
    const b = boxOf(o);
    const x0 = Math.min(b.x, b.x + b.w), x1 = Math.max(b.x, b.x + b.w), y0 = Math.min(b.y, b.y + b.h), y1 = Math.max(b.y, b.y + b.h);
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return o;
  }
  return null;
}

// субтитр під курсором (рамку запам'ятовує малювання кадру)
function capHit(e) {
  if (!capBox.id) return null;
  const { x, y } = norm(e);
  if (x < capBox.x || x > capBox.x + capBox.w || y < capBox.y || y > capBox.y + capBox.h) return null;
  return S.project.captions.find(c => c.id === capBox.id && S.t >= c.start && S.t < c.start + c.dur) || null;
}

let handlesQueued = false, lastHtml = '', lastBox = '';
function scheduleHandles() {
  if (handlesQueued) return;
  handlesQueued = true;
  requestAnimationFrame(() => { handlesQueued = false; renderHandles(); });
}
function renderHandles() {
  if (!layer) return;
  const box = `${canvas.offsetLeft},${canvas.offsetTop},${canvas.offsetWidth},${canvas.offsetHeight}`;
  if (box !== lastBox) {
    lastBox = box;
    layer.style.left = canvas.offsetLeft + 'px'; layer.style.top = canvas.offsetTop + 'px';
    layer.style.width = canvas.offsetWidth + 'px'; layer.style.height = canvas.offsetHeight + 'px';
  }
  const o = findSel();
  let html = '';
  if (o && S.sel.kind === 'overlay' && visible(o)) {
    if (o.type === 'arrow') {
      html = `<i class="hd pt" data-h="p1" style="left:${o.x * 100}%;top:${o.y * 100}%"></i><i class="hd pt" data-h="p2" style="left:${(o.x + o.w) * 100}%;top:${(o.y + o.h) * 100}%"></i>`;
    } else {
      const b = boxOf(o);
      const x0 = Math.min(b.x, b.x + b.w), y0 = Math.min(b.y, b.y + b.h);
      html = `<div class="selbox" style="left:${x0 * 100}%;top:${y0 * 100}%;width:${Math.abs(b.w) * 100}%;height:${Math.abs(b.h) * 100}%">` +
        ['nw', 'ne', 'sw', 'se'].map(h => `<i class="hd ${h}" data-h="${h}"></i>`).join('') +
        (o.type === 'text' ? '<i class="hd e side" data-h="e"></i><i class="hd w side" data-h="w"></i>' : '') +
        (isLayer(o) ? ['n', 's', 'e', 'w'].map(h => `<i class="hd ${h} side crop" data-h="${h}" data-tip="Обрізати"></i>`).join('') : '') + '</div>';
    }
  } else if (o && S.sel.kind === 'caption' && capBox.id === o.id) {
    html = `<div class="selbox capsel" style="left:${capBox.x * 100}%;top:${capBox.y * 100}%;width:${capBox.w * 100}%;height:${capBox.h * 100}%"></div>`;
  } else if (o && S.sel.kind === 'clip' && (o.zoom || 1) > 1.001) {
    const l = layout().find(x => x.clip.id === o.id);
    if (l && S.t >= l.start && S.t < l.end) {
      const f = focusScreen(o);
      if (f) html = `<i class="hd focus" data-h="focus" style="left:${f.x * 100}%;top:${f.y * 100}%" data-tip="Точка наближення"></i>`;
    }
  }
  if (html === lastHtml && layer.firstChild && !drag) return; // нічого не змінилося — не чіпаємо DOM
  lastHtml = html;
  layer.innerHTML = html + '<i class="guide gv" hidden></i><i class="guide gh" hidden></i>';
}

// де на екрані знаходиться точка фокусу кліпу (без урахування наближення)
function frameBase(c) {
  const m = media.get(c.mediaId); if (!m) return null;
  const { W, H } = outputSize();
  const r = (c.fit === 'cover' ? Math.max : Math.min)(W / m.width, H / m.height);
  return { W, H, dw0: m.width * r, dh0: m.height * r };
}
function focusScreen(c) {
  const b = frameBase(c); if (!b) return null;
  return { x: (b.W / 2 + ((c.zx ?? 0.5) - 0.5) * b.dw0) / b.W, y: (b.H / 2 + ((c.zy ?? 0.5) - 0.5) * b.dh0) / b.H };
}

let drag = null;

function onCanvasDown(e) {
  if (e.button !== 0) return;
  const hit = hitTest(e);
  if (hit) {
    select('overlay', hit.id);
    startDrag(e, 'move', hit);
    return;
  }
  const cap = capHit(e);
  if (cap) {
    select('caption', cap.id);
    startDrag(e, 'cap', cap);
    return;
  }
  const l = clipAt(S.t);
  if (l) select('clip', l.clip.id); else select(null);
}
function onHandleDown(e) {
  const h = e.target.closest('[data-h]'); if (!h) return;
  e.preventDefault(); e.stopPropagation();
  const o = findSel(); if (!o) return;
  startDrag(e, h.dataset.h, o);
}

function startDrag(e, mode, o) {
  const p = norm(e);
  drag = { mode, id: o.id, kind: S.sel.kind, sx: p.x, sy: p.y, o0: structuredClone(o), cy0: capStyle(S.project).y, h0: o.type === 'text' ? (textBoxes.get(o) || 0.1) : o.h, moved: false };
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  const mv = ev => onMove(ev);
  const up = () => {
    el.removeEventListener('pointermove', mv);
    const d = drag; drag = null;
    layer.querySelectorAll('.guide').forEach(g => { g.hidden = true; });
    if (d && d.moved) commit();
  };
  el.addEventListener('pointermove', mv);
  el.addEventListener('pointerup', up, { once: true });
  el.addEventListener('pointercancel', up, { once: true });
}

function onMove(e) {
  if (!drag) return;
  const p = norm(e);
  const dx = p.x - drag.sx, dy = p.y - drag.sy;
  if (!drag.moved && Math.hypot(dx * p.r.width, dy * p.r.height) < 3) return;
  drag.moved = true;
  const o = findSel(); if (!o) return;
  const a = drag.o0;
  const gv = layer.querySelector('.gv'), gh = layer.querySelector('.gh');
  if (drag.mode === 'cap') {
    // висота субтитрів — спільна для всіх; прилипає до центру
    const st = S.project.captionStyle = capStyle(S.project);
    let y = clamp(drag.cy0 + dy, 0.03, 0.97);
    const snap = Math.abs(y - 0.5) < 0.015;
    if (snap) y = 0.5;
    st.y = y;
    gh.hidden = !snap;
  } else if (drag.mode === 'focus') {
    const b = frameBase(o); if (!b) return;
    o.zx = clamp(0.5 + (p.x * b.W - b.W / 2) / b.dw0, 0, 1);
    o.zy = clamp(0.5 + (p.y * b.H - b.H / 2) / b.dh0, 0, 1);
  } else if (drag.mode === 'move') {
    o.x = a.x + dx; o.y = a.y + dy;
    // прилипання до центру кадру
    if (o.type !== 'arrow') {
      const h = drag.h0, cx = o.x + o.w / 2, cy = o.y + h / 2;
      const snapX = Math.abs(cx - 0.5) < 0.012, snapY = Math.abs(cy - 0.5) < 0.012;
      if (snapX) o.x = 0.5 - o.w / 2;
      if (snapY) o.y = 0.5 - h / 2;
      gv.hidden = !snapX; gh.hidden = !snapY;
      if (isLayer(o)) { // прилипання до країв кадру
        const E = 0.012;
        if (!snapX) { if (Math.abs(o.x) < E) o.x = 0; else if (Math.abs(o.x + o.w - 1) < E) o.x = 1 - o.w; }
        if (!snapY) { if (Math.abs(o.y) < E) o.y = 0; else if (Math.abs(o.y + o.h - 1) < E) o.y = 1 - o.h; }
      }
    }
  } else if (drag.mode === 'p1') { o.x = p.x; o.y = p.y; o.w = a.x + a.w - p.x; o.h = a.y + a.h - p.y; }
  else if (drag.mode === 'p2') { o.w = p.x - a.x; o.h = p.y - a.y; }
  else resize(o, a, drag.mode, dx, dy);
  emit('project', { live: true });
  requestDraw();
}

function resize(o, a, mode, dx, dy) {
  if (isLayer(o) && mode.length === 1) { cropDrag(o, a, mode, dx, dy); return; } // бокові маркери — обрізка
  if (o.type === 'text') {
    const h0 = drag.h0;
    if (mode === 'e') { o.w = Math.max(0.05, a.w + dx); return; }
    if (mode === 'w') { o.w = Math.max(0.05, a.w - dx); o.x = a.x + a.w - o.w; return; }
    // кути — пропорційно масштабуємо шрифт і ширину
    const sgn = mode.includes('e') ? 1 : -1;
    const k = clamp((a.w + sgn * dx) / a.w, 0.15, 6);
    o.w = a.w * k; o.size = Math.round(a.size * k);
    if (mode.includes('w')) o.x = a.x + a.w - o.w;
    if (mode.includes('n')) o.y = a.y + h0 - h0 * k;
    return;
  }
  let x0 = a.x, y0 = a.y, x1 = a.x + a.w, y1 = a.y + a.h;
  if (mode.includes('w')) x0 += dx; if (mode.includes('e')) x1 += dx;
  if (mode.includes('n')) y0 += dy; if (mode.includes('s')) y1 += dy;
  if (o.type === 'image' || o.type === 'emoji' || o.type === 'video') { // зберігаємо пропорції картинки й емодзі
    const ratio = a.h / a.w;
    const w = Math.max(0.02, Math.abs(x1 - x0));
    const h = w * ratio;
    o.w = w; o.h = h;
    o.x = mode.includes('w') ? a.x + a.w - w : a.x;
    o.y = mode.includes('n') ? a.y + a.h - h : a.y;
    return;
  }
  o.x = Math.min(x0, x1); o.y = Math.min(y0, y1);
  o.w = Math.max(0.02, Math.abs(x1 - x0)); o.h = Math.max(0.02, Math.abs(y1 - y0));
}

export { renderHandles };
