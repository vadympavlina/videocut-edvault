// Перегляд: відтворення через <video>/<audio> з синхронізацією за таймлайном.
import { S, media, emit, on, layout, clipAt, srcTime, duration, musicDur, outputSize, laneAudible } from './state.js';
import { capStyle, loadCcFont, onCcFont } from './cc.js';
import { renderScene, fadeAlpha } from './render.js';
import { duckGain } from './duck.js';
import { previewUrl } from './media.js';

let canvas, ctx;
let actx = null;
const gains = new Map(); // HTMLMediaElement → GainNode
let raf = 0, startPerf = 0, startT = 0;
let seekPending = new Set();

export function initPlayer(cv) {
  canvas = cv;
  ctx = canvas.getContext('2d');
  on('tracks', () => { if (S.playing) syncElements(false); requestDraw(); });
  on('project', () => { if (S.project.captions.length) loadCcFont(capStyle(S.project)); if (!S.playing) requestDraw(); });
  onCcFont(() => { if (!S.playing) requestDraw(); });
  on('media', () => { if (!S.playing) requestDraw(); });
  on('tails', () => { if (!S.playing) requestDraw(); });
  on('proxy', () => { if (!S.playing) requestDraw(); });
}

export function resizeCanvas(maxW, maxH) {
  const { W, H } = outputSize();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const z = S.view.zoom === 'fit' ? null : +S.view.zoom / 100;
  const r = z == null ? Math.min(maxW / W, maxH / H) : z;
  const cssW = Math.max(40, Math.floor(W * r)), cssH = Math.max(40, Math.floor(H * r));
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  S.view.fitted = z == null;
  const scale = Math.min(1, (cssW * dpr) / W);
  const pw = Math.round(W * scale), ph = Math.round(H * scale);
  if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
  requestDraw();
  return { cssW, cssH };
}

function audioCtx() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) actx = new AC();
  }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
function gainFor(el) {
  if (gains.has(el)) return gains.get(el);
  const a = audioCtx();
  if (!a) return null;
  try {
    const src = a.createMediaElementSource(el);
    const g = a.createGain();
    src.connect(g).connect(a.destination);
    gains.set(el, g);
    return g;
  } catch (e) { gains.set(el, null); return null; }
}
function setVolume(el, v) {
  if (S.recMute) v = 0; // під час запису голосу — тиша, щоб звук не потрапив у мікрофон
  const g = gains.get(el) ?? (S.playing ? gainFor(el) : null);
  if (g) { g.gain.value = v; el.volume = 1; }
  else el.volume = Math.max(0, Math.min(1, v));
}

// ── перемотування без мерехтіння ──
// Поки відеоелемент шукає кадр, він віддає порожнє місце або застарілий кадр. Тому в паузі ми НЕ перемальовуємо перегляд,
// доки всі потрібні відео не готові: на екрані лишається останній цілий кадр. Малюємо одразу, коли пошук закінчено.
// Запити на перемотку не скасовують один одного: поки йде пошук, запам'ятовуємо лише останню ціль.
const wantTime = new WeakMap(), seekHooked = new WeakSet(), lastTarget = new WeakMap();
function seekEl(v, t) {
  if (!seekHooked.has(v)) {
    seekHooked.add(v);
    // страховка при навантаженні: коли відео «дозріло» після пошуку, а кадр не перемальовано, перемальовуємо
    v.addEventListener('canplay', () => { if (!S.playing) requestDraw(); });
    v.addEventListener('seeked', () => {
      if (S.playing) { wantTime.delete(v); return; }
      draw(); // спершу завжди малюємо щойно знайдений кадр (навіть якщо курсор уже пішов далі), інакше при водінні картинка стоїть
      const w = wantTime.get(v);
      if (w != null) { wantTime.delete(v); if (Math.abs(v.currentTime - w) > 0.02) { lastTarget.set(v, w); v.currentTime = w; return; } }
      syncPaused();
    });
  }
  if (v.seeking) { wantTime.set(v, t); return; }
  wantTime.delete(v);
  // браузер може округлити час до кадру: якщо ми вже шукали цю саму ціль і відео стоїть поруч, не шукаємо знову (інакше цикл)
  const last = lastTarget.get(v);
  if (last != null && Math.abs(last - t) < 1e-3 && Math.abs(v.currentTime - t) < 0.06 && v.readyState >= 2) return;
  lastTarget.set(v, t);
  v.currentTime = t;
}
// ── подвійна буферизація: наступний кліп готується заздалегідь ──
// Місце розрізу, де файл «перестрибує» (вирізаний шматок), без підготовки змушує відео шукати кадр посеред відтворення:
// картинка чорніє, звук рветься. Тому за ~1,5 с до межі наступний кліп ставиться на свій початок на вільному елементі
// (власний або запасний, якщо наступний кліп із того самого файла), і на межі лише вмикається.
const clipBind = new Map(), spareEls = new Map(); // кліп → елемент, що його зараз показує; файл → запасний елемент
let prep = null;                                    // { clipId, el }: підготовлений наступний кліп
const elFor = l => { const m = media.get(l.clip.mediaId); return m ? (clipBind.get(l.clip.id) || m.el || null) : null; };
function spareFor(m) {
  const url = previewUrl(m);
  let v = spareEls.get(m.id);
  if (v && v.dataset.src !== url) { v.removeAttribute('src'); v.load(); v.remove(); v = null; }
  if (!v) {
    v = document.createElement('video');
    v.preload = 'auto'; v.playsInline = true; v.src = url; v.dataset.src = url;
    document.getElementById('mediaPool').appendChild(v);
    spareEls.set(m.id, v);
  }
  return v;
}
function resetBinding() { clipBind.clear(); prep = null; }
function prepNext(t, L) {
  const l = clipAt(t, L); if (!l) return;
  const n = L[L.indexOf(l) + 1];
  if (!n || n.start - t > 1.5) return;
  if (prep && prep.clipId === n.clip.id) return;
  const m2 = media.get(n.clip.mediaId); if (!m2 || m2.kind !== 'video' || !m2.el) return;
  const cur = elFor(l), tgt = srcTime(n, n.start);
  if (m2.el === cur && Math.abs(tgt - srcTime(l, l.end)) < 0.05 && (n.clip.speed || 1) === (l.clip.speed || 1)) { prep = { clipId: n.clip.id, el: cur }; return; } // шов без стрибка
  const el = m2.el === cur ? spareFor(m2) : m2.el;
  prep = { clipId: n.clip.id, el };
  if (Math.abs(el.currentTime - tgt) > 0.04) el.currentTime = tgt;
  el.playbackRate = n.clip.speed || 1;
  if (!el.paused) el.pause();
  setVolume(el, 0);
}

// відео, без яких кадр у паузі був би хибним: основне на курсорі й активні накладання
function neededVideos() {
  const els = [], l = clipAt(S.t);
  if (l) { const m = media.get(l.clip.mediaId), e = elFor(l); if (m && m.kind === 'video' && e) els.push(e); }
  for (const o of activeOv(S.t)) { const v = ovEls.get(o.id); if (v) els.push(v); }
  return els;
}
const framesReady = () => neededVideos().every(v => v.error || (v.readyState >= 2 && !v.seeking));
let waitSince = 0, retryT = 0;

// джерело кадру для перегляду — відеоелемент або зображення
function previewProvider(l) {
  const m = media.get(l.clip.mediaId);
  if (!m || !m.el) return null;
  if (m.kind === 'image') return { src: m.el, w: m.width, h: m.height };
  const v = elFor(l) || m.el;
  if (v.readyState < 2) return null;
  return { src: v, w: v.videoWidth || m.width, h: v.videoHeight || m.height };
}

let drawQueued = false;
export function requestDraw() {
  if (drawQueued || !ctx) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}
// ── відео поверх відео: окремий елемент для кожної накладки ──
const ovEls = new Map(); // overlay.id → HTMLVideoElement
function ovEl(o) {
  let v = ovEls.get(o.id);
  const m = media.get(o.mediaId);
  if (!m) return null;
  if (v && (v.dataset.media !== m.id || v.dataset.src !== previewUrl(m))) { v.removeAttribute('src'); v.load(); v.remove(); v = null; }
  if (!v) {
    v = document.createElement('video');
    v.preload = 'auto'; v.playsInline = true; v.src = previewUrl(m); v.dataset.media = m.id; v.dataset.src = previewUrl(m);
    v.addEventListener('loadeddata', () => { if (!S.playing) requestDraw(); });
    document.getElementById('mediaPool').appendChild(v);
    ovEls.set(o.id, v);
  }
  return v;
}
function cleanupOvEls() {
  const ids = new Set(S.project.overlays.filter(o => o.type === 'video').map(o => o.id));
  for (const [id, v] of ovEls) if (!ids.has(id)) { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); ovEls.delete(id); }
}
function ovProvider(o, st) {
  const v = ovEl(o);
  if (!v || v.readyState < 2) return null;
  return { src: v, w: v.videoWidth, h: v.videoHeight };
}
// кадр накладання зараз (для піпетки й автоматичного пошуку кольору фону)
export function ovFrameNow(o) {
  if (o.type === 'video') return ovProvider(o);
  const m = media.get(o.mediaId);
  return m && m.el ? { src: m.el, w: m.width || m.el.naturalWidth, h: m.height || m.el.naturalHeight } : null;
}
const activeOv = t => S.project.overlays.filter(o => o.type === 'video' && t >= o.start && t < o.start + o.dur);

function draw() {
  if (!ctx) return;
  if (!framesReady()) {
    // чекаємо кадр; якщо він так і не з'явиться (зламаний файл) — через 0,8 с малюємо те, що є
    const now = performance.now();
    if (!waitSince) waitSince = now;
    if (now - waitSince < (S.playing ? 500 : 800)) { if (!S.playing) { clearTimeout(retryT); retryT = setTimeout(requestDraw, 120); } return; }
  }
  waitSince = 0;
  renderScene(ctx, canvas.width, canvas.height, S.t, previewProvider, undefined, { editing: !S.playing, ovFrame: ovProvider });
}

// ── перемотування ──
export function seek(t) {
  const d = duration();
  S.t = Math.max(0, Math.min(t, d));
  if (S.playing) { startPerf = performance.now(); startT = S.t; resetBinding(); syncElements(true); }
  else syncPaused();
  requestDraw();
  emit('time');
}

function syncPausedOv() {
  for (const o of activeOv(S.t)) {
    const v = ovEl(o); if (!v) continue;
    const st = (o.in || 0) + (S.t - o.start);
    if (Math.abs(v.currentTime - st) > 0.03) seekEl(v, st);
  }
}
function syncPaused() {
  cleanupOvEls();
  syncPausedOv();
  const l = clipAt(S.t);
  if (!l) return;
  const m = media.get(l.clip.mediaId);
  if (!m || m.kind !== 'video') return;
  const v = elFor(l) || m.el, st = srcTime(l, S.t);
  if (Math.abs(v.currentTime - st) > 0.02 || v.readyState < 2) seekEl(v, st);
}

// ── відтворення ──
export function play() {
  if (S.playing) return;
  const d = duration();
  if (d <= 0) return;
  if (S.t >= d - 0.02) S.t = 0;
  audioCtx();
  S.playing = true;
  resetBinding();
  startPerf = performance.now(); startT = S.t;
  syncElements(true);
  emit('play');
  raf = requestAnimationFrame(tick);
}
export function pause() {
  if (!S.playing) return;
  S.playing = false;
  cancelAnimationFrame(raf);
  media.forEach(m => { if (m.el && m.el.pause) m.el.pause(); });
  spareEls.forEach(v => v.pause()); resetBinding();
  ovEls.forEach(v => v.pause());
  emit('play');
  syncPaused();
  requestDraw();
}
export const toggle = () => (S.playing ? pause() : play());

function tick(now) {
  if (!S.playing) return;
  const d = duration();
  let t = startT + (now - startPerf) / 1000;
  const L = layout();
  // якщо активне відео підвисло (буферизація) — тримаємо годинник за ним
  const l = clipAt(t, L);
  if (l) {
    const m = media.get(l.clip.mediaId), e = elFor(l);
    if (m && m.kind === 'video' && e && !e.paused && e.readyState < 3) { startPerf = now; startT = S.t; t = S.t; }
  }
  // відео поверх основного теж може «підвисати» — тоді час не біжить уперед за ним
  if (t > S.t) for (const o of activeOv(S.t)) { const v = ovEls.get(o.id); if (v && !v.paused && v.readyState < 3 && v.readyState > 0) { startPerf = now; startT = S.t; t = S.t; break; } }
  if (t >= d) {
    if (S.loop && !S.recMute && d > 0.2) { S.t = 0; startPerf = now; startT = 0; syncElements(true); draw(); emit('time'); raf = requestAnimationFrame(tick); return; }
    S.t = d; pause(); emit('time'); return;
  }
  S.t = t;
  syncElements(false, L);
  prepNext(S.t, L);
  draw();
  emit('time');
  raf = requestAnimationFrame(tick);
}

function syncElements(hard, L = layout()) {
  const t = S.t;
  const active = new Set();
  const l = clipAt(t, L);
  if (l) {
    const c = l.clip, m = media.get(c.mediaId);
    if (m && m.kind === 'video') {
      if (prep && prep.clipId === c.id) clipBind.set(c.id, prep.el);   // кліп, підготовлений заздалегідь
      for (const id of [...clipBind.keys()]) if (id !== c.id) clipBind.delete(id);
      const v = clipBind.get(c.id) || m.el, st = srcTime(l, t);
      active.add(v);
      const rate = c.speed || 1;
      if (v.playbackRate !== rate) v.playbackRate = rate;
      v.preservesPitch = true;
      const drift = Math.abs(v.currentTime - st);
      if (hard || drift > 0.25 || v.paused && drift > 0.05) v.currentTime = st;
      const vol = c.muted || !laneAudible('v') ? 0 : (c.volume ?? 1) * fadeAlpha(t, l.start, l.end - l.start, c.fadeIn || 0, c.fadeOut || 0);
      setVolume(v, vol);
      if (v.paused) v.play().catch(() => {});
    }
  }
  for (const o of activeOv(t)) {
    const v = ovEl(o); if (!v) continue;
    const st = (o.in || 0) + (t - o.start);
    active.add(v);
    if (hard || Math.abs(v.currentTime - st) > 0.25) v.currentTime = st;
    setVolume(v, o.muted || !laneAudible('v2') ? 0 : (o.volume ?? 1));
    if (v.paused) v.play().catch(() => {});
  }
  for (const mu of S.project.music) {
    const m = media.get(mu.mediaId);
    if (!m || !m.el) continue;
    const md = musicDur(mu);
    if (t < mu.start || t >= mu.start + md) continue;
    const a = m.el, st = mu.in + (t - mu.start);
    active.add(a);
    if (hard || Math.abs(a.currentTime - st) > 0.3) a.currentTime = st;
    setVolume(a, !laneAudible('a') ? 0 : (mu.volume ?? 1) * fadeAlpha(t, mu.start, md, mu.fadeIn || 0, mu.fadeOut || 0) * (mu.duck ? duckGain(t) : 1));
    if (a.paused) a.play().catch(() => {});
  }
  media.forEach(m => { if (m.el && m.el.pause && !active.has(m.el) && !m.el.paused && !(prep && prep.el === m.el)) m.el.pause(); });
  spareEls.forEach(v => { if (!active.has(v) && !v.paused && !(prep && prep.el === v)) v.pause(); });
  ovEls.forEach(v => { if (!active.has(v) && !v.paused) v.pause(); });
}

// знімок поточного кадру в PNG у повній роздільності
export async function snapshot() {
  const { W, H } = outputSize();
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  renderScene(c.getContext('2d'), W, H, S.t, previewProvider, undefined, { ovFrame: ovProvider });
  return new Promise(r => c.toBlob(r, 'image/png'));
}

export const previewCanvas = () => canvas;
