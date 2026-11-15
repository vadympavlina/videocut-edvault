// Колірний граф: модель, ремонт, порядок обчислення й математика (еталон на CPU).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGraph, newNode, repairGraph, graphOrder, isIdentityGraph, curveTable, evalPixel, hslMask, wheelRGB, hsv2rgb, rgb2hsv, RECIPES, recipeGraph, DEFAULTS } from '../videocut-app/js/color.js';

const close = (a, b, e = 1e-3) => a.every((v, i) => Math.abs(v - b[i]) <= e);

test('новий граф: Вхід → Первинна → Вихід, нейтральний', () => {
  const g = newGraph();
  assert.deepEqual(graphOrder(g).map(n => n.type), ['in', 'prim', 'out']);
  assert.equal(isIdentityGraph(g), true);
  assert.deepEqual(evalPixel(g, [0.2, 0.5, 0.8]).map(v => +v.toFixed(3)), [0.2, 0.5, 0.8]);
});

test('repairGraph відкидає сміття, цикли, дублікати входів і зайві вузли', () => {
  assert.equal(repairGraph(null), undefined);
  assert.equal(repairGraph({ nodes: [] }), undefined);
  const g = newGraph(); g.nodes.push({ id: 'x', type: 'нема', x: 0, y: 0, p: {} }, { id: 'prim1', type: 'prim', p: {} });
  g.links.push({ from: 'out', to: 'prim1', port: 0 }, { from: 'prim1', to: 'prim1', port: 0 }, { from: 'in', to: 'prim1', port: 0 }, { from: 'in', to: 'out', port: 0 });
  const r = repairGraph(g);
  assert.equal(r.nodes.length, 3);
  assert.equal(r.links.length, 2, 'дублікати й петлі прибрано: ' + JSON.stringify(r.links));
  const cyc = newGraph(); const n2 = newNode('prim', 0, 0); cyc.nodes.push(n2);
  cyc.links = [{ from: 'in', to: 'prim1', port: 0 }, { from: 'prim1', to: n2.id, port: 0 }, { from: n2.id, to: 'prim1', port: 0 }, { from: n2.id, to: 'out', port: 0 }];
  const rc = repairGraph(cyc); assert.ok(!rc.links.some(l => l.from === n2.id && l.to === 'prim1'), 'зворотний зв’язок, що утворює цикл, відкинуто');
});

test('repairGraph обмежує параметри й виправляє криві', () => {
  const g = newGraph(); g.nodes[1].p = { exp: 99, sat: -5, lift: { x: 4, y: NaN, l: 'a' }, con: 'x' };
  const r = repairGraph(g).nodes[1].p;
  assert.equal(r.exp, 4); assert.equal(r.sat, 0); assert.equal(r.con, 1); assert.deepEqual(r.lift, { x: 1, y: 0, l: 0 });
  const c = newGraph(); c.nodes.splice(1, 0, { id: 'c', type: 'curves', x: 0, y: 0, p: { m: [[0.5, 0.2], [0.5, 0.9], [2, 5]], r: 'bad' } });
  c.links = [{ from: 'in', to: 'c', port: 0 }, { from: 'c', to: 'out', port: 0 }];
  const rc = repairGraph(c).nodes.find(n => n.id === 'c').p;
  assert.deepEqual(rc.r, [[0, 0], [1, 1]]); assert.ok(rc.m.length >= 2 && rc.m[0][0] === 0 && rc.m.at(-1)[0] === 1);
});

test('крива: тотожна лінія, S-крива й монотонність', () => {
  const t = curveTable([[0, 0], [1, 1]]); assert.ok(Math.abs(t[128] - 128 / 255) < 1e-3 && t[0] === 0 && Math.abs(t[255] - 1) < 1e-6);
  const s = curveTable([[0, 0], [0.25, 0.15], [0.75, 0.85], [1, 1]]);
  assert.ok(s[64] < 64 / 255 && s[192] > 192 / 255, 'тіні темнішають, світла світлішають');
  for (let i = 1; i < 256; i++) assert.ok(s[i] >= s[i - 1] - 1e-6, 'монотонна');
});

test('Первинна: експозиція, контраст, насиченість, колеса', () => {
  const g = newGraph(); const p = g.nodes[1].p;
  p.exp = 1; assert.ok(close(evalPixel(g, [0.2, 0.2, 0.2]), [0.4, 0.4, 0.4]));
  p.exp = 0; p.sat = 0; const gray = evalPixel(g, [0.9, 0.1, 0.1]); assert.ok(Math.abs(gray[0] - gray[1]) < 1e-6 && Math.abs(gray[1] - gray[2]) < 1e-6, 'насиченість 0 — сірий');
  p.sat = 1; p.con = 2; assert.ok(evalPixel(g, [0.7, 0.7, 0.7])[0] > 0.7 && evalPixel(g, [0.3, 0.3, 0.3])[0] < 0.3);
  p.con = 1; p.gain = { x: 1, y: 0, l: 0 }; const w = evalPixel(g, [0.5, 0.5, 0.5]); assert.ok(w[0] > w[1] && w[0] > w[2], 'колесо світел у бік червоного підсилює червоний');
  const sum = wheelRGB({ x: 0.7, y: 0.3, l: 0 }).reduce((a, b) => a + b, 0); assert.ok(Math.abs(sum) < 1e-9, 'зсув кольору не міняє яскравості');
});

test('HSL: маска вибирає потрібний колір і змінює лише його', () => {
  const p = { ...DEFAULTS.hsl(), hue: 210, width: 60, soft: 0.2 };
  const sky = [0.2, 0.5, 0.9], grass = [0.2, 0.8, 0.2];
  assert.ok(hslMask(sky, p) > 0.9 && hslMask(grass, p) < 0.05);
  const g = newGraph(); g.nodes.splice(1, 1, { id: 'h', type: 'hsl', x: 0, y: 0, p: { ...p, dh: 0.1, ds: 1.5 } }); g.links = [{ from: 'in', to: 'h', port: 0 }, { from: 'h', to: 'out', port: 0 }];
  const r = repairGraph(g);
  assert.ok(close(evalPixel(r, grass), grass, 0.02), 'трава не змінилась');
  assert.ok(!close(evalPixel(r, sky), sky, 0.02), 'небо змінилось');
  r.nodes.find(n => n.id === 'h').p.inv = true; assert.ok(!close(evalPixel(r, grass), grass, 0.02), 'інверсія маски');
});

test('Змішати: режими й сила; вимкнений вузол пропускається', () => {
  const g = newGraph();
  const a = newNode('prim', 0, 0); a.id = 'a'; a.p.exp = 1;
  const m = newNode('mix', 0, 0); m.id = 'm'; m.p = { mode: 'multiply', amount: 1 };
  g.nodes.splice(1, 1, a, m);
  g.links = [{ from: 'in', to: 'a', port: 0 }, { from: 'in', to: 'm', port: 0 }, { from: 'a', to: 'm', port: 1 }, { from: 'm', to: 'out', port: 0 }];
  const r = repairGraph(g); assert.ok(close(evalPixel(r, [0.4, 0.4, 0.4]), [0.4 * 0.8, 0.4 * 0.8, 0.4 * 0.8]));
  r.nodes.find(n => n.id === 'm').p.amount = 0; assert.ok(close(evalPixel(r, [0.4, 0.4, 0.4]), [0.4, 0.4, 0.4]));
  r.nodes.find(n => n.id === 'a').off = true; r.nodes.find(n => n.id === 'm').p.amount = 1; assert.ok(close(evalPixel(r, [0.4, 0.4, 0.4]), [0.16, 0.16, 0.16]));
});

test('рецепти: усі коректні, не нейтральні й змінюють кадр', () => {
  assert.ok(RECIPES.length >= 6);
  for (const r of RECIPES) {
    const g = recipeGraph(r.id); assert.ok(g, r.id); assert.equal(isIdentityGraph(g), false, r.id);
    const o = evalPixel(g, [0.55, 0.45, 0.35]); assert.ok(o.every(v => v >= 0 && v <= 1) && !close(o, [0.55, 0.45, 0.35], 0.005), r.id);
  }
});

test('hsv ↔ rgb перетворюється туди й назад', () => {
  for (const c of [[0.2, 0.5, 0.9], [0.9, 0.1, 0.1], [0.3, 0.3, 0.3], [0, 1, 0.5]]) { const [h, s, v] = rgb2hsv(...c); assert.ok(close(hsv2rgb(h, s, v), c, 1e-6)); }
});
