import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCube, lutStrip } from '../videocut-app/js/lut.js';

// LUT 2x2x2, що інвертує кольори
const inv = ['TITLE "Інверсія"', 'LUT_3D_SIZE 2'];
for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) inv.push(`${1 - r} ${1 - g} ${1 - b}`);

test('розбір .cube: розмір, назва, значення', () => {
  const l = parseCube(inv.join('\n'));
  assert.equal(l.size, 2); assert.equal(l.name, 'Інверсія');
  const s = lutStrip({ id: 'x', ...l });
  // піксель (r=0,g=0,b=0) -> білий; (1,1,1) -> чорний
  assert.deepEqual([...s.rgba.slice(0, 3)], [255, 255, 255]);
  const last = (1 * 4 + 1 * 2 + 1) ; // g=1, b=1, r=1 у смузі: y*s*s + b*s + r
  const i = (1 * 4 + 1 * 2 + 1) * 4; assert.deepEqual([...s.rgba.slice(i, i + 3)], [0, 0, 0]); assert.ok(last);
});

test('розбір .cube: погані файли дають зрозумілу помилку', () => {
  assert.throws(() => parseCube('LUT_1D_SIZE 4\n0 0 0'), /тривимірні/);
  assert.throws(() => parseCube('hello'), /LUT_3D_SIZE/);
  assert.throws(() => parseCube('LUT_3D_SIZE 2\n0 0 0'), /Очікувалось/);
});

test('великий LUT зменшується до 33', () => {
  const n = 65, rows = ['LUT_3D_SIZE ' + n];
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) rows.push(`${r / (n - 1)} ${g / (n - 1)} ${b / (n - 1)}`);
  const l = parseCube(rows.join('\n'));
  assert.ok(l.size <= 33 && l.size >= 2);
});
