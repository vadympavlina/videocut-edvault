// Очищення голосу: прибирає гул (фільтр низьких частот) і приглушує фоновий шум у паузах (м'який експандер).
// Працює по семплах, без залежностей, однаково для перегляду й експорту.
export const DENOISE_LEVELS = [['0', 'Вимк.'], ['1', 'Слабке'], ['2', 'Середнє'], ['3', 'Сильне']];
const PARAMS = { 1: { mult: 1.8, floor: 0.45 }, 2: { mult: 2.4, floor: 0.22 }, 3: { mult: 3.0, floor: 0.08 } };

// L, R — масиви семплів (змінюються на місці), i0..i1 — діапазон
export function denoise(L, R, i0, i1, level, sr = 48000) {
  const P = PARAMS[level], n = i1 - i0;
  if (!P || n < sr * 0.06) return;
  // 1) фільтр прибирає гул нижче ~80 Гц
  const a = Math.exp(-2 * Math.PI * 80 / sr);
  for (const ch of [L, R]) {
    let px = ch[i0], py = 0;
    for (let i = i0; i < i1; i++) { const x = ch[i]; const y = a * (py + x - px); px = x; py = y; ch[i] = y; }
  }
  // 2) рівень шуму: тиха частина записів (15-й процентиль середньоквадратичної гучності 20 мс)
  const F = Math.max(1, Math.round(sr * 0.02)), nf = Math.max(1, Math.floor(n / F));
  const rms = new Float32Array(nf);
  for (let f = 0; f < nf; f++) { let s = 0; for (let i = i0 + f * F, e = i + F; i < e; i++) s += (L[i] * L[i] + R[i] * R[i]) * 0.5; rms[f] = Math.sqrt(s / F); }
  const sorted = Array.from(rms).sort((x, y) => x - y);
  const floorRms = Math.max(sorted[Math.floor(sorted.length * 0.15)], 1e-5), thr = floorRms * P.mult;
  // 3) підсилення на кадр: м'яка «двері», з утриманням, щоб не різати кінці слів
  const g = new Float32Array(nf);
  for (let f = 0; f < nf; f++) g[f] = Math.min(1, Math.max(P.floor, Math.pow(rms[f] / thr, 1.5)));
  const hold = 4; // кадрів (80 мс)
  const gh = Float32Array.from(g);
  for (let f = 0; f < nf; f++) for (let k = Math.max(0, f - hold); k < f; k++) if (g[k] > gh[f]) gh[f] = Math.max(gh[f], g[k] - (f - k) * 0.12);
  // 4) плавно між центрами кадрів
  for (let i = 0; i < n; i++) {
    const pos = (i - F / 2) / F, k = Math.max(0, Math.min(nf - 1, Math.floor(pos))), k2 = Math.min(nf - 1, k + 1), w = Math.max(0, Math.min(1, pos - k));
    const gain = gh[k] + (gh[k2] - gh[k]) * w;
    L[i0 + i] *= gain; R[i0 + i] *= gain;
  }
}
