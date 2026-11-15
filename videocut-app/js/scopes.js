// Осцилографи кольору: гістограма, форма хвилі (яскравість і RGB-парад) і векторскоп.
// Рахуються з невеликого кадру (ImageData), малюються на canvas із темним тлом у будь-якій темі.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// гістограми яскравості й каналів (256 комірок)
export function histogram(d) {
  const h = { l: new Uint32Array(256), r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256) };
  for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; h.r[r]++; h.g[g]++; h.b[b]++; h.l[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)]++; }
  return h;
}
// Cb/Cr кольору в діапазоні −0.5…0.5
export const chroma = (r, g, b) => [(-0.1687 * r - 0.3313 * g + 0.5 * b) / 255, (0.5 * r - 0.4187 * g - 0.0813 * b) / 255];

const BG = '#141414', GRID = '#2e2e2e', TXT = '#8c8c8c';
function base(cv) { const g = cv.getContext('2d'); g.fillStyle = BG; g.fillRect(0, 0, cv.width, cv.height); return g; }
function grid(g, W, H, lines = 4) { g.strokeStyle = GRID; g.lineWidth = 1; g.beginPath(); for (let i = 1; i < lines; i++) { const y = Math.round(H * i / lines) + 0.5; g.moveTo(0, y); g.lineTo(W, y); } g.stroke(); }

// Форма хвилі: по горизонталі позиція в кадрі, по вертикалі значення. mode: 'luma' | 'rgb'
export function drawWaveform(cv, data, w, h, mode = 'luma') {
  const W = cv.width, H = cv.height, g = base(cv); grid(g, W, H, 4);
  const parade = mode === 'rgb', cols = parade ? 3 : 1, pw = Math.floor(W / cols);
  const acc = new Float32Array(W * H * 3);
  const step = Math.max(1, Math.floor(h / 90));
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, px = Math.floor(x / w * pw);
    if (parade) for (let c = 0; c < 3; c++) { const yy = H - 1 - Math.round(data[i + c] / 255 * (H - 1)); acc[((yy * W + c * pw + px) * 3) + c] += 1; }
    else { const v = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2], yy = H - 1 - Math.round(v / 255 * (H - 1)), o = (yy * W + px) * 3; acc[o] += 1; acc[o + 1] += 1; acc[o + 2] += 1; }
  }
  const out = g.getImageData(0, 0, W, H), od = out.data, gain = 40 / Math.max(10, h / step);
  for (let p = 0; p < W * H; p++) {
    const r = acc[p * 3], gg = acc[p * 3 + 1], b = acc[p * 3 + 2]; if (!r && !gg && !b) continue;
    if (parade) { od[p * 4] = clamp(od[p * 4] + r * 255 * gain * 0.4, 0, 255); od[p * 4 + 1] = clamp(od[p * 4 + 1] + gg * 255 * gain * 0.4, 0, 255); od[p * 4 + 2] = clamp(od[p * 4 + 2] + b * 255 * gain * 0.4, 0, 255); }
    else { const v = clamp(60 + r * 255 * gain * 0.45, 0, 255); od[p * 4] = clamp(od[p * 4] + v * 0.55, 0, 255); od[p * 4 + 1] = clamp(od[p * 4 + 1] + v, 0, 255); od[p * 4 + 2] = clamp(od[p * 4 + 2] + v * 0.7, 0, 255); }
  }
  g.putImageData(out, 0, 0);
  if (parade) { g.strokeStyle = GRID; g.beginPath(); for (let c = 1; c < 3; c++) { g.moveTo(c * pw + 0.5, 0); g.lineTo(c * pw + 0.5, H); } g.stroke(); }
  g.fillStyle = TXT; g.font = '10px system-ui, sans-serif'; g.fillText('255', 3, 11); g.fillText('0', 3, H - 3);
}

// Векторскоп: розподіл відтінку (кут) і насиченості (відстань від центру)
export const TARGETS = [['R', 255, 0, 0], ['Y', 255, 255, 0], ['G', 0, 255, 0], ['C', 0, 255, 255], ['B', 0, 0, 255], ['M', 255, 0, 255]];
export function drawVector(cv, data, w, h) {
  const S = cv.width, g = base(cv), R = S / 2 - 8, cx = S / 2, cy = S / 2;
  g.strokeStyle = GRID; g.lineWidth = 1; for (const k of [1, 0.5]) { g.beginPath(); g.arc(cx, cy, R * k, 0, Math.PI * 2); g.stroke(); }
  g.beginPath(); g.moveTo(cx - R, cy + 0.5); g.lineTo(cx + R, cy + 0.5); g.moveTo(cx + 0.5, cy - R); g.lineTo(cx + 0.5, cy + R); g.stroke();
  // лінія шкіри (~123°)
  g.strokeStyle = '#6b5a2a'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(2.15) * R, cy - Math.sin(2.15) * R * -1); g.stroke();
  const acc = new Float32Array(S * S), step = Math.max(1, Math.floor(w * h / 9000));
  for (let i = 0; i < w * h; i += step) {
    const o = i * 4, [u, v] = chroma(data[o], data[o + 1], data[o + 2]);
    const x = Math.round(cx + u * 2 * R * 1.0), y = Math.round(cy - v * 2 * R * 1.0); if (x >= 0 && y >= 0 && x < S && y < S) acc[y * S + x] += 1;
  }
  const img = g.getImageData(0, 0, S, S), d = img.data;
  for (let p = 0; p < S * S; p++) { const a = acc[p]; if (!a) continue; const v = clamp(70 + a * 70, 0, 255); d[p * 4] = clamp(d[p * 4] + v * 0.6, 0, 255); d[p * 4 + 1] = clamp(d[p * 4 + 1] + v, 0, 255); d[p * 4 + 2] = clamp(d[p * 4 + 2] + v * 0.75, 0, 255); }
  g.putImageData(img, 0, 0);
  g.font = '10px system-ui, sans-serif';
  for (const [n, r, gg, b] of TARGETS) { const [u, v] = chroma(r, gg, b); g.fillStyle = `rgb(${r},${gg},${b})`; g.fillText(n, cx + u * 2 * R - 3, cy - v * 2 * R + 3); }
}

export function drawHist(cv, hist, mode = 'rgb') {
  const W = cv.width, H = cv.height, g = base(cv); grid(g, W, H, 4);
  const max = Math.max(1, ...hist.l.slice(1, 255), ...hist.r.slice(1, 255), ...hist.g.slice(1, 255), ...hist.b.slice(1, 255));
  const line = (arr, col) => { g.beginPath(); g.moveTo(0, H); for (let x = 0; x < W; x++) { const v = arr[Math.round(x / (W - 1) * 255)]; g.lineTo(x, H - Math.min(1, v / max) * (H - 4)); } g.lineTo(W, H); g.closePath(); g.fillStyle = col; g.fill(); };
  g.globalCompositeOperation = 'lighter';
  if (mode === 'rgb') { line(hist.r, 'rgba(255,70,70,.55)'); line(hist.g, 'rgba(70,255,90,.5)'); line(hist.b, 'rgba(80,120,255,.6)'); } else line(hist.l, 'rgba(230,230,230,.7)');
  g.globalCompositeOperation = 'source-over';
}
