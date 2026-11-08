import test from 'node:test';
import assert from 'node:assert/strict';
import { SR, GRAIN, HOP, WIN, alignGrains } from '../videocut-app/js/stretch.js';

// Складає зерна у вихід; starts — початки зерен у джерелі
function ola(src, starts) {
  const out = new Float32Array(starts.length * HOP + GRAIN);
  starts.forEach((s, k) => { for (let i = 0; i < GRAIN; i++) out[k * HOP + i] += (src[s + i] || 0) * WIN[i]; });
  return out;
}
// розкид «гучності» у вікнах по 5 мс на серединній частині виходу (амплітудна модуляція від фазових биття)
function ripple(out) {
  const w = 240, rms = [];
  for (let a = GRAIN * 3; a + w < out.length - GRAIN * 3; a += w) { let e = 0; for (let i = 0; i < w; i++) e += out[a + i] ** 2; rms.push(Math.sqrt(e / w)); }
  return Math.max(...rms) / Math.min(...rms);
}

test('WSOLA тримає рівну гучність на тоні, а просте накладання — ні', () => {
  const n = SR * 4, src = new Float32Array(n);
  for (let i = 0; i < n; i++) src[i] = 0.5 * Math.sin(2 * Math.PI * 441.3 * i / SR) + 0.2 * Math.sin(2 * Math.PI * 1234.7 * i / SR);
  const speed = 1.37, K = 60;
  const noms = Array.from({ length: K }, (_, k) => Math.round(2000 + k * HOP * speed));
  const naive = ripple(ola(src, noms));
  const aligned = ripple(ola(src, alignGrains(src, 0, noms)));
  assert.ok(aligned < naive, `вирівняне ${aligned.toFixed(3)} має бути рівнішим за просте ${naive.toFixed(3)}`);
  assert.ok(aligned < 1.12, `розкид гучності ${aligned.toFixed(3)}`);
});

test('вирівнювання детерміноване (однакові результати для однакових даних)', () => {
  const src = Float32Array.from({ length: SR }, (_, i) => Math.sin(i * 0.05) * Math.cos(i * 0.0007));
  const noms = Array.from({ length: 10 }, (_, k) => 3000 + k * 1700);
  assert.deepEqual(alignGrains(src, 0, noms), alignGrains(src, 0, noms));
});
