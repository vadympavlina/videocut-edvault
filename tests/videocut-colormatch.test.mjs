// Зіставлення кольору: відповідність гістограм дає криві, які наближають кадр до еталона.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchCurves, curveTable } from '../videocut-app/js/color.js';

const frame = (f, n = 4096) => { const d = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) { const t = i / (n - 1), [r, g, b] = f(t); d[i * 4] = r * 255; d[i * 4 + 1] = g * 255; d[i * 4 + 2] = b * 255; d[i * 4 + 3] = 255; } return d; };
const at = (pts, x) => { for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return pts[pts.length - 1][1]; };

test('однакові кадри дають майже пряму криву', () => {
  const a = frame(t => [t, t, t]), m = matchCurves(a, a, 1);
  for (const ch of ['r', 'g', 'b']) for (const x of [0.2, 0.5, 0.8]) assert.ok(Math.abs(at(m[ch], x) - x) < 0.05, ch + x);
});
test('темний кадр, зіставлений зі світлим, світлішає', () => {
  const dark = frame(t => [t * 0.4, t * 0.4, t * 0.4]), bright = frame(t => [0.3 + t * 0.7, 0.3 + t * 0.7, 0.3 + t * 0.7]);
  const m = matchCurves(dark, bright, 1);
  assert.ok(at(m.r, 0.2) > 0.4 && at(m.g, 0.2) > 0.4, 'середні тони піднялись');
});
test('теплий еталон піднімає червоний і опускає синій', () => {
  const grey = frame(t => [t, t, t]), warm = frame(t => [Math.min(1, t * 1.15 + 0.05), t, Math.max(0, t * 0.8)]);
  const m = matchCurves(grey, warm, 1);
  assert.ok(at(m.r, 0.5) > at(m.b, 0.5) + 0.1, `${at(m.r, 0.5)} / ${at(m.b, 0.5)}`);
});
test('сила 0 — тотожна крива, криві монотонні й у межах 0…1', () => {
  const a = frame(t => [t * 0.3, t, 1 - t]), b = frame(t => [t, 1 - t, t * 0.5]);
  const z = matchCurves(a, b, 0); for (const ch of ['r', 'g', 'b']) for (const [x, y] of z[ch]) assert.ok(Math.abs(x - y) < 1e-3);
  const m = matchCurves(a, b, 0.85);
  for (const ch of ['r', 'g', 'b']) { for (let i = 1; i < m[ch].length; i++) { assert.ok(m[ch][i][1] >= m[ch][i - 1][1] - 1e-9 && m[ch][i][0] > m[ch][i - 1][0]); } assert.ok(m[ch][0][0] === 0 && m[ch][m[ch].length - 1][0] === 1); assert.ok(m[ch].every(q => q[1] >= 0 && q[1] <= 1)); }
  assert.equal(curveTable(m.r).length, 256);
});
