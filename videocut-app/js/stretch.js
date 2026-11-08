// Зміна швидкості звуку без зміни тону (WSOLA): кожне зерно підбирається так, щоб воно «зливалося»
// з попереднім за формою хвилі. Це прибирає «роботизований» дзвін простого накладання зерен.
export const SR = 48000;
export const GRAIN = Math.round(0.05 * SR);   // 50 мс
export const HOP = GRAIN / 2;                 // крок у виході
export const SEARCH = Math.round(0.01 * SR);  // пошук вирівнювання ±10 мс
export const CHAIN = 40;                      // зерен у «ланцюжку» (≈1 с): ланцюжки рахуються незалежно, тож блоки експорту збігаються
export const WIN = new Float32Array(GRAIN).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / GRAIN)); // сума двох вікон із кроком HOP = 1

/**
 * Для зерен ланцюжка повертає початки в джерелі (в абсолютних семплах).
 * mono — моно-запис, base — абсолютний індекс його першого семпла, noms — «ідеальні» початки без вирівнювання.
 */
export function alignGrains(mono, base, noms) {
  const n = mono.length;
  const at = i => { i -= base; return i >= 0 && i < n ? mono[i] : 0; };
  const out = [];
  let prev = null;
  for (const p of noms) {
    if (prev === null) { out.push(p); prev = p; continue; }
    const tpl = prev + HOP; // як продовжився б попередній шматок, якби його не чіпали
    let best = p, bs = -Infinity;
    for (let d = -SEARCH; d <= SEARCH; d += 2) {
      const c = p + d;
      let dot = 0, en = 1e-9;
      for (let i = 0; i < GRAIN; i += 3) { const a = at(c + i); dot += a * at(tpl + i); en += a * a; }
      const sc = dot / Math.sqrt(en);
      if (sc > bs) { bs = sc; best = c; }
    }
    out.push(best); prev = best;
  }
  return out;
}
