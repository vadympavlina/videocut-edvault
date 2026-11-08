// Приглушення музики, коли звучить голос (з кліпу, озвучення чи відео поверх).
// Рахується за хвилями звуку (peaks), однаково для перегляду й експорту.
import { S, media, layout, on } from './state.js';
import { PEAKS_RATE } from './media.js';

export const DUCK_LEVEL = 0.3;   // гучність музики під голосом
const THRESH = 0.05;             // що вважати голосом (амплітуда)
const STEP = 0.05;               // сітка, с

function srcPeak(m, from, to) {
  if (!m || !m.peaks) return 0;
  let p = 0;
  for (let i = Math.max(0, Math.floor(from * PEAKS_RATE)), e = Math.min(m.peaks.length, Math.ceil(to * PEAKS_RATE)); i < e; i++) if (m.peaks[i] > p) p = m.peaks[i];
  return p;
}
// чи звучить голос у вікні [a, b) таймлайну
function voiceAt(a, b, L) {
  for (const l of L) {
    if (l.end <= a || l.start >= b) continue;
    const c = l.clip, m = media.get(c.mediaId);
    if (!m || c.muted || (c.volume ?? 1) <= 0.02) continue;
    const sp = c.speed || 1;
    const sa = c.in + (Math.max(a, l.start) - l.start) * sp, sb = c.in + (Math.min(b, l.end) - l.start) * sp;
    if (srcPeak(m, sa, sb) * (c.volume ?? 1) > THRESH) return true;
  }
  const p = S.project;
  for (const mu of p.music) {
    if (!mu.voice) continue;
    const d = mu.out - mu.in;
    if (mu.start + d <= a || mu.start >= b) continue;
    const m = media.get(mu.mediaId);
    if (srcPeak(m, mu.in + Math.max(0, a - mu.start), mu.in + Math.min(d, b - mu.start)) * (mu.volume ?? 1) > THRESH) return true;
  }
  for (const o of p.overlays) {
    if (o.type !== 'video' || o.muted || o.start + o.dur <= a || o.start >= b) continue;
    const m = media.get(o.mediaId);
    const i0 = o.in || 0;
    if (srcPeak(m, i0 + Math.max(0, a - o.start), i0 + Math.min(o.dur, b - o.start)) * (o.volume ?? 1) > THRESH) return true;
  }
  return false;
}
// гучність музики (0.3…1) у момент t: м'яко опускається трохи раніше голосу й повільно повертається
// Кеш: під час відтворення значення просять на кожному кадрі, а рахунок обходить усі доріжки.
// Скидається за будь-якої зміни проєкту чи хвиль звуку.
const cache = new Map();
['project', 'peaks', 'media'].forEach(ev => on(ev, () => cache.clear()));
export function duckGain(t, L) {
  if (L) return duckGainRaw(t, L); // з готовим layout (експорт) — без кешу
  const k = Math.round(t / 0.04);
  let v = cache.get(k);
  if (v === undefined) { v = duckGainRaw(k * 0.04, layout()); if (cache.size > 4000) cache.clear(); cache.set(k, v); }
  return v;
}
function duckGainRaw(t, L) {
  // утримання: голос у [t-0.45, t+0.15] → приглушено
  let held = 0, n = 0;
  for (let x = t - 0.2; x <= t + 0.2 + 1e-9; x += 0.1) {
    held += voiceAt(x - 0.45, x + 0.15, L) ? 1 : 0; n++;
  }
  const k = held / n;
  return 1 - (1 - DUCK_LEVEL) * k;
}
// огинаюча для блоку експорту: значення на сітці STEP, далі — лінійна інтерполяція
export function duckEnvelope(t0, t1) {
  const L = layout();
  const n = Math.ceil((t1 - t0) / STEP) + 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = duckGainRaw(t0 + i * STEP, L);
  return { at: t => { const f = (t - t0) / STEP, i = Math.max(0, Math.min(n - 2, Math.floor(f))), r = Math.min(1, Math.max(0, f - i)); return out[i] + (out[i + 1] - out[i]) * r; } };
}
