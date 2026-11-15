// Колірний граф: модель, ремонт, порядок обчислення й математика (еталон на CPU).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scaleGraphKf, splitGraphKf, shiftGraphKf, freezeGraph, kfValue, kfSet, kfRemove, kfAt, kfTimes, animatedGraph, hasKf, getPath, setPath, maskValue, maskDefault, MASKABLE, newGraph, newNode, repairGraph, graphOrder, isIdentityGraph, curveTable, evalPixel, hslMask, wheelRGB, hsv2rgb, rgb2hsv, RECIPES, recipeGraph, DEFAULTS } from '../videocut-app/js/color.js';

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

test('маска: форми, м\u2019якість, інверсія й ремонт', () => {
  const m = { ...maskDefault(), type: 'ellipse', x: 0.5, y: 0.5, w: 0.4, h: 0.4, soft: 0.2 };
  assert.ok(maskValue(m, 0.5, 0.5) > 0.99 && maskValue(m, 0.02, 0.02) < 0.01);
  assert.ok(maskValue({ ...m, inv: true }, 0.5, 0.5) < 0.01);
  const lin = { ...maskDefault(), type: 'linear', y: 0.5, h: 0.4, soft: 0.3 };
  assert.ok(maskValue(lin, 0.5, 0.1) > 0.9 && maskValue(lin, 0.5, 0.9) < 0.1, 'градієнт: зверху повна дія, знизу немає');
  const rect = { ...maskDefault(), type: 'rect', w: 0.3, h: 0.3, soft: 0.1 };
  assert.ok(maskValue(rect, 0.5, 0.5) > 0.99 && maskValue(rect, 0.8, 0.5) < 0.01);
  const g = newGraph(); g.nodes[1].p.exp = 1; g.nodes[1].mask = { type: 'ellipse', x: 'a', w: 99, soft: -3 };
  const r = repairGraph(g).nodes[1].mask; assert.equal(r.type, 'ellipse'); assert.ok(r.w <= 2 && r.soft >= 0 && r.x === 0.5);
  g.nodes[1].mask = { type: 'нема' }; assert.equal(repairGraph(g).nodes[1].mask, undefined);
  const g2 = newGraph(); g2.nodes[0].mask = maskDefault(); assert.equal(repairGraph(g2).nodes[0].mask, undefined, 'на вході маски немає');
  assert.ok(MASKABLE.includes('prim') && !MASKABLE.includes('mix'));
});

test('evalPixel: маска обмежує дію вузла', () => {
  const g = newGraph(); g.nodes[1].p.exp = 1; g.nodes[1].mask = { ...maskDefault(), type: 'ellipse', x: 0.5, y: 0.5, w: 0.3, h: 0.3, soft: 0.1 };
  const r = repairGraph(g), pos = (u, v) => ({ u, v, aspect: 1.5 });
  assert.ok(evalPixel(r, [0.3, 0.3, 0.3], [], pos(0.5, 0.5))[0] > 0.55 && Math.abs(evalPixel(r, [0.3, 0.3, 0.3], [], pos(0.05, 0.05))[0] - 0.3) < 0.01);
});

test('ключові кадри: плавний перехід, утримання поза ключами, видалення', () => {
  const n = newNode('prim'); kfSet(n, 'p.exp', 0, 0); kfSet(n, 'p.exp', 4, 2);
  const k = n.kf['p.exp'];
  assert.equal(kfValue(k, -1), 0); assert.equal(kfValue(k, 9), 2); assert.ok(Math.abs(kfValue(k, 2) - 1) < 1e-9, 'посередині — половина');
  assert.ok(Math.abs(kfValue(k, 1) - 0.5) < 1e-9 && Math.abs(kfValue(k, 3) - 1.5) < 1e-9, 'лінійний перехід');
  kfSet(n, 'p.exp', 4.01, 3); assert.equal(n.kf['p.exp'].length, 2, 'ключ поруч замінюється, а не дублюється'); assert.equal(n.kf['p.exp'][1][1], 3);
  assert.ok(kfAt(n, 'p.exp', 0.02) && !kfAt(n, 'p.exp', 2)); assert.deepEqual(kfTimes(n), [0, 4]);
  kfRemove(n, 'p.exp', 0); kfRemove(n, 'p.exp', 4); assert.equal(n.kf, undefined, 'без ключів поле зникає');
});

test('animatedGraph підставляє значення на момент часу й не чіпає оригінал', () => {
  const g = newGraph(); const p = g.nodes[1]; kfSet(p, 'p.exp', 0, 0); kfSet(p, 'p.exp', 2, 1); kfSet(p, 'p.lift.x', 0, 0); kfSet(p, 'p.lift.x', 2, 0.8);
  const a = animatedGraph(g, 1);
  assert.ok(Math.abs(a.nodes[1].p.exp - 0.5) < 1e-9 && Math.abs(a.nodes[1].p.lift.x - 0.4) < 1e-9); assert.equal(g.nodes[1].p.exp, 0, 'оригінал не змінено');
  assert.equal(isIdentityGraph(g), false, 'вузол із ключами не вважається нейтральним');
  const before = evalPixel(animatedGraph(g, 0), [0.3, 0.3, 0.3]), after = evalPixel(animatedGraph(g, 2), [0.3, 0.3, 0.3]);
  assert.ok(after[0] > before[0] + 0.1);
  assert.equal(animatedGraph(newGraph(), 1).nodes.length, 3); assert.ok(!hasKf(newGraph().nodes[1]));
});

test('repairGraph чистить ключі й анімація маски працює', () => {
  const g = newGraph(); g.nodes[1].mask = { type: 'ellipse' }; g.nodes[1].kf = { 'p.exp': [[2, 1], [0, 0], ['x', 3]], 'bad path': [[0, 1]], 'p.con': 'нема', 'mask.x': [[0, 0.2], [3, 0.8]] };
  const r = repairGraph(g).nodes[1];
  assert.deepEqual(r.kf['p.exp'], [[0, 0], [2, 1]]); assert.deepEqual(Object.keys(r.kf).sort(), ['mask.x', 'p.exp']);
  const a = animatedGraph({ ...repairGraph(g) }, 1.5); assert.ok(a.nodes[1].mask.x > 0.4 && a.nodes[1].mask.x < 0.6);
  const gi = newGraph(); gi.nodes[0].kf = { 'p.exp': [[0, 1]] }; assert.equal(repairGraph(gi).nodes[0].kf, undefined, 'на вході ключів немає');
  assert.equal(getPath({ a: { b: 2 } }, 'a.b'), 2); const o = { a: { b: 1 } }; assert.ok(setPath(o, 'a.b', 5) && o.a.b === 5 && !setPath(o, 'a.z', 1));
});

test('розріз кліпа: ключі діляться, значення на межі однакове, безперервність у часі', () => {
  const a = newGraph(); kfSet(a.nodes[1], 'p.exp', 0, 0); kfSet(a.nodes[1], 'p.exp', 4, 1.5);
  const b = JSON.parse(JSON.stringify(a)); const mid = kfValue(a.nodes[1].kf['p.exp'], 2);
  const orig = animatedGraph(a, 3.1).nodes[1].p.exp, origEarly = animatedGraph(a, 1).nodes[1].p.exp;
  splitGraphKf(a, b, 2);
  assert.deepEqual(a.nodes[1].kf['p.exp'], [[0, 0], [2, mid]]); assert.deepEqual(b.nodes[1].kf['p.exp'], [[0, mid], [2, 1.5]]);
  assert.ok(Math.abs(animatedGraph(b, 3.1 - 2).nodes[1].p.exp - orig) < 1e-9, 'права половина: значення на 3,1 с точно таке саме');
  assert.ok(Math.abs(animatedGraph(a, 1).nodes[1].p.exp - origEarly) < 1e-9, 'ліва половина: на 1 с точно таке саме');
  assert.ok(Math.abs(animatedGraph(a, 2).nodes[1].p.exp - animatedGraph(b, 0).nodes[1].p.exp) < 1e-9, 'на межі значення збігається');
  const none = newGraph(); const copy = JSON.parse(JSON.stringify(none)); splitGraphKf(none, copy, 1); assert.equal(none.nodes[1].kf, undefined); splitGraphKf(undefined, copy, 1);
});

test('відрізаний початок: ключі зсуваються, стоп-кадр дає статичний граф', () => {
  const g = newGraph(); kfSet(g.nodes[1], 'p.exp', 0, 0); kfSet(g.nodes[1], 'p.exp', 4, 2);
  const before = animatedGraph(g, 3).nodes[1].p.exp; shiftGraphKf(g, 1);
  assert.equal(g.nodes[1].kf['p.exp'][0][0], 0); assert.ok(Math.abs(animatedGraph(g, 3 - 1).nodes[1].p.exp - before) < 1e-9, 'значення у ту саму мить збереглося');
  assert.equal(g.nodes[1].kf['p.exp'].at(-1)[0], 3);
  const f = freezeGraph(g, 1); assert.equal(f.nodes[1].kf, undefined); assert.ok(Math.abs(f.nodes[1].p.exp - animatedGraph(g, 1).nodes[1].p.exp) < 1e-9); assert.equal(freezeGraph(undefined, 1), undefined);
});

test('наростили початок (dt < 0) і змінили швидкість: ключі лишаються на тому самому вмісті', () => {
  const g = newGraph(); kfSet(g.nodes[1], 'p.exp', 1, 0.5); kfSet(g.nodes[1], 'p.exp', 3, 1.5);
  const at = animatedGraph(g, 2).nodes[1].p.exp; shiftGraphKf(g, -1);
  assert.deepEqual(g.nodes[1].kf['p.exp'], [[2, 0.5], [4, 1.5]], 'ключі посунулись пізніше'); assert.ok(Math.abs(animatedGraph(g, 3).nodes[1].p.exp - at) < 1e-9, 'у ту саму мить вмісту те саме значення');
  const h = newGraph(); kfSet(h.nodes[1], 'p.exp', 0, 0); kfSet(h.nodes[1], 'p.exp', 4, 2); const c0 = animatedGraph(h, 3).nodes[1].p.exp;
  scaleGraphKf(h, 0.5); assert.deepEqual(h.nodes[1].kf['p.exp'].map(k => k[0]), [0, 2], 'швидкість ×2: ключі вдвічі ближче');
  assert.ok(Math.abs(animatedGraph(h, 3 * 0.5).nodes[1].p.exp - c0) < 1e-9, 'значення на тому самому місці вмісту');
  scaleGraphKf(h, 1); scaleGraphKf(h, NaN); scaleGraphKf(undefined, 2); assert.deepEqual(h.nodes[1].kf['p.exp'].map(k => k[0]), [0, 2]);
});

test('ключі руху (kf.js): зсув і масштаб по часу при обрізанні та зміні швидкості', async () => {
  const { shiftKf, scaleKf, hasKf } = await import('../videocut-app/js/kf.js');
  const c = { id: 'c', kf: [{ t: 0, zoom: 1 }, { t: 4, zoom: 2 }] };
  shiftKf('clip', c, 1); assert.equal(c.kf[0].t, 0); assert.ok(c.kf[0].zoom > 1.1 && c.kf[0].zoom < 1.2, 'значення на новому початку (плавна крива руху) ' + c.kf[0].zoom); assert.equal(c.kf.at(-1).t, 3);
  shiftKf('clip', c, -2); assert.equal(c.kf.at(-1).t, 5);
  scaleKf(c, 0.5); assert.equal(c.kf.at(-1).t, 2.5); scaleKf({ id: 'x' }, 2); assert.ok(!hasKf({ id: 'x' }));
});
