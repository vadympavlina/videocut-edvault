import test from 'node:test';
import assert from 'node:assert/strict';
import { denoise } from '../videocut-app/js/denoise.js';

const SR = 48000;
function make() {
  const n = SR * 3, L = new Float32Array(n), R = new Float32Array(n);
  let seed = 1; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5;
  for (let i = 0; i < n; i++) {
    const noise = rnd() * 0.04, voice = i >= SR && i < 2 * SR ? 0.5 * Math.sin(2 * Math.PI * 440 * i / SR) : 0;
    L[i] = R[i] = noise + voice;
  }
  return { L, R };
}
const rms = (a, s, e) => { let t = 0; for (let i = s; i < e; i++) t += a[i] * a[i]; return Math.sqrt(t / (e - s)); };

test('шум у паузах стихає, голос лишається', () => {
  const { L, R } = make();
  const n0 = rms(L, 0, SR * 0.8), v0 = rms(L, SR * 1.2, SR * 1.8);
  denoise(L, R, 0, L.length, 3, SR);
  const n1 = rms(L, 0, SR * 0.8), v1 = rms(L, SR * 1.2, SR * 1.8);
  assert.ok(n1 < n0 * 0.5, `шум ${n0.toFixed(4)} -> ${n1.toFixed(4)}`);
  assert.ok(v1 > v0 * 0.85, `голос ${v0.toFixed(3)} -> ${v1.toFixed(3)}`);
});

test('рівень 0 і дуже короткі шматки не змінюють звук', () => {
  const { L, R } = make(), copy = Float32Array.from(L);
  denoise(L, R, 0, L.length, 0, SR); assert.deepEqual(L, copy);
  denoise(L, R, 0, 100, 3, SR); assert.deepEqual(L, copy);
});

test('слабке очищення м’якше за сильне', () => {
  const a = make(), b = make();
  denoise(a.L, a.R, 0, a.L.length, 1, SR); denoise(b.L, b.R, 0, b.L.length, 3, SR);
  assert.ok(rms(b.L, 0, SR * 0.8) < rms(a.L, 0, SR * 0.8));
});
