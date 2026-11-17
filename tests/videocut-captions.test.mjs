// Субтитри: розумні розриви рядків, час слів, перевірка стилю.
import test from 'node:test';
import assert from 'node:assert/strict';
import { breakLines, glueAfter, capWords, capStyle, CC_PRESETS, CC_DEFAULT, splitText } from '../videocut-app/js/cc.js';

const W = ws => ws.map(w => w.length * 10); // умовна ширина: 10 на літеру
const lines = (text, maxW) => { const ws = text.split(' '); return breakLines(ws, W(ws), 10, maxW).map(l => l.map(i => ws[i]).join(' ')); };

test('рядки вирівнюються, а не «жадібно» заповнюються', () => {
  const r = lines('Сьогодні ми поговоримо про те як зробити', 230);
  assert.equal(r.length, 2); assert.ok(Math.abs(r[0].length - r[1].length) < 12, r.join(' | '));
});
test('одинокого короткого слова в останньому рядку немає', () => {
  const r = lines('Це дуже довгий приклад субтитру який майже влазить у два рядки так', 240);
  assert.ok(r.every((l, i) => i < r.length - 1 || l.split(' ').length > 1 || l.length > 7), r.join(' | '));
});
test('прийменник не лишається в кінці рядка, коли можна інакше', () => {
  const r = lines('Ми їдемо у велике красиве місто на березі моря', 150);
  assert.ok(r.slice(0, -1).every(l => !/ (у|на|в|з)$/.test(l)), r.join(' | '));
});
test('число тримається з одиницею, тире — зі словом', () => {
  assert.equal(glueAfter('Чекайте 5 хвилин будь ласка'.split(' '), 1), true);
  assert.equal(glueAfter('так — і далі'.split(' '), 0), true);
  assert.equal(glueAfter('Кінець. Початок'.split(' '), 0), false);
});
test('одне слово ширше за рядок не ламає розбиття', () => {
  const r = lines('Надзвичайнонескінченноширокеслово і ще', 120);
  assert.equal(r.flat().join(' ').replace(/ /g, ''), 'Надзвичайнонескінченноширокесловоіще'.replace(/ /g, ''));
});
test('порожній текст і один рядок', () => {
  assert.deepEqual(breakLines([], [], 10, 100), []);
  assert.deepEqual(lines('Привіт світ', 400), ['Привіт світ']);
});
test('час слів: монотонний, покриває всю тривалість, довші слова довше', () => {
  const c = { text: 'Я розповім про надзвичайно цікаву річ.', dur: 4, start: 0 };
  const w = capWords(c);
  assert.equal(w.length, 6); assert.ok(Math.abs(w[w.length - 1].e - 4) < 1e-9);
  for (let i = 1; i < w.length; i++) assert.ok(w[i].s >= w[i - 1].s - 1e-9 && Math.abs(w[i].s - w[i - 1].e) < 1e-9);
  assert.ok(w[3].e - w[3].s > (w[0].e - w[0].s) * 2);
});
test('стиль: старі проєкти й некоректні значення виправляються', () => {
  const st = capStyle({ captionStyle: { strokeW: 9, spacing: 'x', hiMode: 'nope', strokeColor: 'red', lineH: 0, bg: 'glow' } });
  assert.equal(st.strokeW, 0.45); assert.equal(st.spacing, 0); assert.equal(st.hiMode, 'color'); assert.equal(st.strokeColor, '#000000'); assert.equal(st.lineH, 0.9); assert.equal(st.bg, 'glow');
  assert.equal(capStyle({}).hiMode, CC_DEFAULT.hiMode);
});
test('усі шаблони мають коректні поля', () => {
  for (const [k, p] of Object.entries(CC_PRESETS)) { const st = capStyle({ captionStyle: { ...p } }); assert.ok(st.size >= 24 && st.size <= 120, k); assert.ok(p.name, k); }
  assert.ok(Object.keys(CC_PRESETS).length >= 16);
});
test('splitText не губить слів', () => {
  const t = 'Один два три чотири п’ять шість сім вісім дев’ять десять одинадцять дванадцять';
  assert.equal(splitText(t, 30).join(' '), t);
});
