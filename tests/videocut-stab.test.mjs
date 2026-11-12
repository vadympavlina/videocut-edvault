import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateShift, smoothCorrection, stabAt } from '../videocut-app/js/stab.js';

const W = 96, H = 54;
function scene(ox, oy) { // гладка «картинка» зі зсувом
  const g = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const u = x - ox, v = y - oy; g[y * W + x] = 128 + 60 * Math.sin(u / 5) * Math.cos(v / 7) + 40 * Math.sin((u + v) / 11); }
  return g;
}

test('зсув між кадрами знаходиться з точністю до піксель', () => {
  const a = scene(0, 0), b = scene(3, -2);
  // вміст у b зсунутий на (+3,-2); шукаємо s, при якому a(x) ≈ b(x+s)
  const s = estimateShift(a, b, W, H, 6);
  assert.ok(Math.abs(s.x - 3) < 0.6 && Math.abs(s.y + 2) < 0.6, JSON.stringify(s));
});

test('нерухомі кадри дають нульовий зсув', () => {
  const s = estimateShift(scene(0, 0), scene(0, 0), W, H, 6);
  assert.ok(Math.abs(s.x) < 0.2 && Math.abs(s.y) < 0.2);
});

test('тремтіння згладжується, плавний рух лишається', () => {
  const shake = Array.from({ length: 60 }, (_, i) => ({ x: i % 2 ? 2 : -2, y: 0 })); // дрижання туди-сюди
  const c = smoothCorrection(shake, 7);
  const pos = []; let p = 0; for (const s of shake) { p += s.x; pos.push(p); }
  const after = pos.map((v, i) => v + c.cx[i + 1]);
  const spread = a => Math.max(...a) - Math.min(...a);
  assert.ok(spread(after) < spread(pos) * 0.5, 'розмах після ' + spread(after) + ' до ' + spread(pos));
  const pan = Array.from({ length: 60 }, () => ({ x: 1, y: 0 })); // навмисний рух камери
  const cp = smoothCorrection(pan, 7);
  assert.ok(Math.max(...cp.cx.slice(10, 50).map(Math.abs)) < 0.05, 'рух камери не гаситься');
});

test('поправка інтерполюється за часом джерела', () => {
  const st = { fps: 10, t0: 5, dx: [0, 1], dy: [0, -1] };
  const mid = stabAt(st, 5.05); assert.ok(Math.abs(mid.x - 0.5) < 1e-9 && Math.abs(mid.y + 0.5) < 1e-9);
  assert.equal(stabAt(null, 1), null);
  assert.deepEqual(stabAt(st, 99), { x: 1, y: -1 });
});
