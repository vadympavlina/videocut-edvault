// Стабілізація: оцінюємо зсув між сусідніми кадрами, згладжуємо траєкторію камери й повертаємо кадр на різницю.
// Дані зберігаються в кліпі за часом ДЖЕРЕЛА, тому розрізи й підрізання не ламають стабілізацію.
export const STAB_FPS = 15;

// Зсув вмісту між двома сірими кадрами w×h (мінімум середньої різниці), у пікселях, із підпіксельним уточненням
export function estimateShift(a, b, w, h, R = 6) {
  const m = R + 1; // не чіпаємо край, щоб порівнювати лише спільну частину
  let best = Infinity, bx = 0, by = 0;
  const cost = new Map();
  for (let sy = -R; sy <= R; sy++) for (let sx = -R; sx <= R; sx++) {
    let s = 0, n = 0;
    for (let y = m; y < h - m; y += 1) { const ra = y * w, rb = (y + sy) * w + sx; for (let x = m; x < w - m; x += 1) { s += Math.abs(a[ra + x] - b[rb + x]); n++; } }
    const c = s / Math.max(1, n); cost.set(sy * 100 + sx, c);
    if (c < best) { best = c; bx = sx; by = sy; }
  }
  const par = (l, c, r) => { const d = l - 2 * c + r; return d > 1e-9 ? 0.5 * (l - r) / d : 0; };
  const g = (x, y) => cost.get(y * 100 + x);
  const fx = bx > -R && bx < R ? par(g(bx - 1, by), best, g(bx + 1, by)) : 0;
  const fy = by > -R && by < R ? par(g(bx, by - 1), best, g(bx, by + 1)) : 0;
  return { x: bx + Math.max(-0.5, Math.min(0.5, fx)), y: by + Math.max(-0.5, Math.min(0.5, fy)), err: best };
}

// траєкторія з накопичених зсувів, згладжена ковзним середнім; результат — поправка (згладжена мінус справжня)
export function smoothCorrection(steps, win = 7) {
  const n = steps.length + 1, px = new Float64Array(n), py = new Float64Array(n);
  for (let i = 1; i < n; i++) { px[i] = px[i - 1] + steps[i - 1].x; py[i] = py[i - 1] + steps[i - 1].y; }
  const cx = [], cy = [];
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0, k = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) { sx += px[j]; sy += py[j]; k++; }
    cx.push(sx / k - px[i]); cy.push(sy / k - py[i]);
  }
  return { cx, cy };
}

// значення поправки (частка ширини/висоти кадру) на момент джерела ts
export function stabAt(st, ts) {
  if (!st || !st.dx || !st.dx.length) return null;
  const f = (ts - st.t0) * st.fps, i = Math.max(0, Math.min(st.dx.length - 1, Math.floor(f))), j = Math.min(st.dx.length - 1, i + 1), w = Math.max(0, Math.min(1, f - i));
  return { x: st.dx[i] + (st.dx[j] - st.dx[i]) * w, y: st.dy[i] + (st.dy[j] - st.dy[i]) * w };
}

// аналіз відрізка джерела [from, to]; повертає { fps, t0, dx, dy, zoom }
export async function analyze(m, from, to, onProgress = () => {}, isAlive = () => true) {
  const { CanvasSink } = await import('../vendor/mediabunny.min.mjs');
  const W = 96, H = Math.max(24, Math.round(96 * m.height / m.width));
  const sink = new CanvasSink(m.vt, { width: W, height: H, fit: 'fill', poolSize: 0 });
  const n = Math.max(3, Math.floor((to - from) * STAB_FPS)), times = Array.from({ length: n }, (_, i) => Math.min(m.duration - 0.02, from + i / STAB_FPS));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const cx = cv.getContext('2d', { willReadFrequently: true });
  let prev = null, i = 0; const steps = [];
  for await (const w of sink.canvasesAtTimestamps(times)) {
    if (!isAlive()) throw new Error('Скасовано');
    if (!w) { if (prev) steps.push({ x: 0, y: 0 }); i++; continue; }
    cx.clearRect(0, 0, W, H); cx.drawImage(w.canvas, 0, 0, W, H);
    const d = cx.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
    for (let p = 0; p < g.length; p++) g[p] = d[p * 4] * 0.3 + d[p * 4 + 1] * 0.59 + d[p * 4 + 2] * 0.11;
    if (prev) { const s = estimateShift(prev, g, W, H, 6); steps.push({ x: s.x, y: s.y }); }
    prev = g; i++;
    if (i % 8 === 0) { onProgress(i / n); await new Promise(r => setTimeout(r)); }
  }
  while (steps.length < n - 1) steps.push({ x: 0, y: 0 });
  const { cx: sx, cy: sy } = smoothCorrection(steps, 7);
  const dx = sx.map(v => Math.round(v / W * 10000) / 10000), dy = sy.map(v => Math.round(v / H * 10000) / 10000);
  const worst = Math.max(...dx.map(Math.abs), ...dy.map(Math.abs));
  return { fps: STAB_FPS, t0: from, dx, dy, zoom: Math.min(1.25, 1 + 2 * worst + 0.02) };
}
