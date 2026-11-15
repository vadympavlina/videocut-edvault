// Сторінка «Колір» у редакторі: колеса, повзунки, вузли, з'єднання, криві, HSL, рецепти, До/Після, скасування.
//   node tests/videocut-color-ui-e2e.mjs      (потрібні Playwright, Chromium і ffmpeg)
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const tmp = await mkdtemp(join(tmpdir(), 'vcc-'));
const VID = join(tmp, 'sky.webm');
execFileSync(process.env.FFMPEG || 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'gradients=s=640x360:c0=0x1d2a5f:c1=0xf5a65b:c2=0x2a3a2f:x0=0:y0=0:x1=0:y1=360:nb_colors=3:d=6:r=30,format=yuv420p', '-c:v', 'libvpx', '-auto-alt-ref', '0', '-b:v', '800k', VID]);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm' };
const srv = createServer(async (q, r) => { try { const f = join(ROOT, decodeURIComponent(q.url.split('?')[0])); r.setHeader('content-type', MIME[extname(f)] || 'application/octet-stream'); r.end(await readFile(f)); } catch { r.statusCode = 404; r.end(); } }).listen(0);
await new Promise(r => srv.on('listening', r));
const port = srv.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await browser.newPage({ bypassCSP: true, viewport: { width: 1440, height: 900 } });
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
await p.goto(`http://localhost:${port}/index.html`); await p.waitForFunction(() => window.VideoCut);
await p.setInputFiles('#fileInput', [VID]); await p.waitForFunction(() => window.VideoCut.S.project.clips.length === 1, null, { timeout: 15000 }); await p.waitForTimeout(1200);

let fails = 0, n = 0;
const step = async (name, fn) => { n++; try { await fn(); console.log('ok  ', String(n).padStart(2), name); } catch (e) { fails++; console.log('FAIL', String(n).padStart(2), name, '\n    ', String(e.message || e).split('\n')[0]); } };
const cg = () => p.evaluate(() => { const c = window.VideoCut.S.project.clips[0]; return c.cg ? JSON.parse(JSON.stringify(c.cg)) : null; });
// середній колір центральної смуги перегляду
const mean = () => p.evaluate(() => { const cv = document.getElementById('pv'), g = cv.getContext('2d'), w = cv.width, h = cv.height; const d = g.getImageData(Math.round(w * 0.3), Math.round(h * 0.2), Math.round(w * 0.4), Math.round(h * 0.6)).data; let r = 0, gg = 0, b = 0; const k = d.length / 4; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; } return [r / k, gg / k, b / k]; });
const settle = () => p.waitForTimeout(350);
const diff = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const undo = async () => { await p.click('#btnUndo'); await settle(); };
const pxAt = (fx, fy) => p.evaluate(([fx, fy]) => { const cv = document.getElementById('pv'), d = cv.getContext('2d').getImageData(Math.round(cv.width * fx), Math.round(cv.height * fy), 1, 1).data; return [d[0], d[1], d[2]]; }, [fx, fy]);
const dragRing = async (idx, dx, dy) => { const b = await p.locator('.wh-ring').nth(idx).boundingBox(); const cx = b.x + b.width / 2, cy = b.y + b.height / 2; await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx + dx / 2, cy + dy / 2); await p.mouse.move(cx + dx, cy + dy); await p.mouse.up(); await settle(); };

await step('перемикач сторінок: «Колір» ховає бібліотеку й таймлайн, показує граф і осцилографи', async () => {
  await p.click('#pageSw [data-page=color]'); await settle();
  assert.equal(await p.evaluate(() => document.body.dataset.page), 'color');
  assert.equal(await p.locator('#cgNodes .cn').count(), 3);
  for (const sel of ['.lib', '#tl', '#inspector']) assert.equal(await p.locator(sel).isVisible(), false, sel + ' сховано');
  for (const sel of ['#cgPanel', '#clrInsp', '#scopes']) assert.equal(await p.locator(sel).isVisible(), true, sel + ' видно');
});
await step('мініатюри вузлів і осцилографи намальовані', async () => {
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => { const nz = c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) return true; return false; }; return { th: [...document.querySelectorAll('.cn-th')].map(nz), wave: nz(document.getElementById('scWave')), vec: nz(document.getElementById('scVec')), rc: [...document.querySelectorAll('.rc canvas')].filter(nz).length }; });
  assert.ok(r.th.every(Boolean), 'мініатюри всіх вузлів: ' + r.th); assert.ok(r.wave && r.vec, 'осцилографи'); assert.ok(r.rc >= 5, 'мініатюри рецептів: ' + r.rc);
});
let base;
await step('колесо «Світла»: тягнемо до червоного — кадр теплішає, є запис в історії', async () => {
  base = await mean();
  await dragRing(2, 40, 0);
  const g = await cg(); assert.ok(g, 'граф створено'); const prim = g.nodes.find(q => q.type === 'prim');
  assert.ok(prim.p.gain.x > 0.3, 'колесо зсунулось: ' + JSON.stringify(prim.p.gain));
  const now = await mean(); assert.ok(now[0] - base[0] > 3 && now[0] - now[2] > base[0] - base[2], `червоного побільшало: ${base} → ${now}`);
  assert.equal(await p.locator('#btnUndo').isDisabled(), false);
});
await step('скасувати повертає кадр і прибирає граф', async () => {
  await undo(); const now = await mean(); assert.ok(diff(now, base) < 4, `кадр як був: ${base} → ${now}`);
  const g = await cg(); assert.ok(!g || JSON.stringify(g.nodes.find(q => q.type === 'prim').p.gain) === JSON.stringify({ x: 0, y: 0, l: 0 }));
});
await step('повзунок експозиції змінює яскравість, подвійний клік по підпису скидає', async () => {
  const b0 = await mean();
  await p.evaluate(() => { const r = [...document.querySelectorAll('#clrInsp .crow')].find(x => /Експозиція/.test(x.textContent)).querySelector('input'); r.value = 1; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle(); const b1 = await mean(); assert.ok(b1[0] + b1[1] > b0[0] + b0[1] + 20, `яскравіше: ${b0} → ${b1}`);
  await p.locator('#clrInsp .crow label', { hasText: 'Експозиція' }).dblclick(); await settle();
  const b2 = await mean(); assert.ok(diff(b2, b0) < 4, 'скинуто');
});
await step('рецепт застосовується одним кліком і скидається кнопкою «Скинути»', async () => {
  const b0 = await mean(); await p.locator('#rcList .rc').first().click(); await settle();
  const g = await cg(); assert.ok(g.nodes.length >= 4, 'граф із рецепта: ' + g.nodes.length); assert.ok(diff(await mean(), b0) > 6, 'кадр змінився');
  assert.equal(await p.locator('#cgNodes .cn').count(), g.nodes.length);
  await p.click('#cgReset'); await settle(); assert.equal((await cg()).nodes.length, 3); assert.ok(diff(await mean(), b0) < 4, 'повернулось');
});
await step('«Вузол ▸ Криві»: додається після вибраного, S-крива міняє контраст', async () => {
  await p.locator('#cgNodes .cn', { hasText: 'Колеса' }).click(); await p.click('#cgAdd'); await p.getByRole('menuitem', { name: 'Криві' }).click(); await settle();
  const g = await cg(); assert.deepEqual(g.nodes.map(q => q.type).sort(), ['curves', 'in', 'out', 'prim']);
  assert.equal(await p.locator('.ccurve').count(), 1);
  const order = await p.evaluate(() => { const g = window.VideoCut.S.project.clips[0].cg; const by = Object.fromEntries(g.nodes.map(n => [n.id, n.type])); const next = id => g.links.find(l => l.from === id)?.to; const out = []; let id = g.nodes.find(n => n.type === 'in').id; while (id) { out.push(by[id]); id = next(id); } return out; });
  assert.deepEqual(order, ['in', 'prim', 'curves', 'out'], 'ланцюжок збережено');
  const b0 = await mean(); const cv = await p.locator('.ccurve').boundingBox();
  await p.mouse.move(cv.x + cv.width * 0.5, cv.y + cv.height * 0.5); await p.mouse.down(); await p.mouse.move(cv.x + cv.width * 0.5, cv.y + cv.height * 0.15, { steps: 4 }); await p.mouse.up(); await settle();
  const g2 = await cg(); assert.ok(g2.nodes.find(q => q.type === 'curves').p.m.length >= 3, 'додано точку'); assert.ok(diff(await mean(), b0) > 8, 'крива змінила кадр');
});
await step('видалення вузла замикає ланцюжок, а з’єднання можна перетягнути', async () => {
  await p.locator('#cgNodes .cn', { hasText: 'Криві' }).click(); await p.locator('#cgCanvas').focus(); await p.keyboard.press('Delete'); await settle();
  let g = await cg(); assert.deepEqual(g.nodes.map(q => q.type).sort(), ['in', 'out', 'prim']); assert.equal(g.links.length, 2, 'вузли знову з’єднані: ' + JSON.stringify(g.links));
  // розриваємо лінію «Первинна → Вихід»: виділяємо й видаляємо
  const pt = await p.evaluate(() => { const w = [...document.querySelectorAll('#cgWires .w-hit')][1]; const L = w.getTotalLength(), q = w.getPointAtLength(L / 2), m = w.getScreenCTM(); return { x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f }; });
  await p.mouse.click(pt.x, pt.y); await p.locator('#cgCanvas').focus(); await p.keyboard.press('Delete'); await settle();
  g = await cg(); assert.equal(g.links.length, 1, 'лінію прибрано');
  // з’єднуємо назад перетягуванням від виходу «Первинної» до входу «Виходу»
  const a = await p.locator('#cgNodes .cn', { hasText: 'Колеса' }).locator('.cn-port.out').boundingBox(), z = await p.locator('#cgNodes .cn.t-out .cn-port.in').boundingBox();
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await p.mouse.down(); await p.mouse.move(z.x - 40, z.y + 5, { steps: 6 }); await p.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 4 }); await p.mouse.up(); await settle();
  g = await cg(); assert.equal(g.links.length, 2, 'з’єднано знову');
});
await step('вузол можна вимкнути (око), кадр повертається до оригіналу', async () => {
  await p.locator('#cgNodes .cn', { hasText: 'Колеса' }).click(); await dragRing(2, 40, 0); const b1 = await mean();
  await p.locator('#cgNodes .cn', { hasText: 'Колеса' }).locator('[data-off]').click(); await settle(); const b2 = await mean(); assert.ok(diff(b2, b1) > 4, 'вимкнений вузол не діє');
  await p.locator('#cgNodes .cn', { hasText: 'Колеса' }).locator('[data-off]').click(); await settle(); assert.ok(diff(await mean(), b1) < 3, 'увімкнений діє знову');
});
await step('До / Після: ліва половина — оригінал, права — з корекцією; кнопка «Оригінал» показує все без змін', async () => {
  await p.click('#clrBA'); await settle();
  const left = await pxAt(0.1, 0.5), right = await pxAt(0.9, 0.5);
  await p.locator('#clrHold').dispatchEvent('pointerdown'); await settle(); const orig = await pxAt(0.9, 0.5), origL = await pxAt(0.1, 0.5);
  await p.locator('#clrHold').dispatchEvent('pointerup'); await settle();
  assert.ok(diff(left, origL) < 4, `ліворуч оригінал: ${left} ~ ${origL}`); assert.ok(diff(right, orig) > 6, `праворуч корекція: ${right} ≠ ${orig}`);
  await p.click('#clrBA'); await settle(); assert.ok(diff(await pxAt(0.1, 0.5), origL) > 4, 'після вимкнення порівняння ліворуч теж корекція');
});
await step('вузол HSL: маска показується чорно-білою, піпетка заповнює виділення', async () => {
  await p.click('#cgAdd'); await p.getByRole('menuitem', { name: 'HSL' }).click(); await settle();
  assert.equal(await p.locator('#clrInsp [data-mask]').count(), 1);
  await p.locator('#clrInsp [data-mask]').check(); await settle(); const m = await pxAt(0.5, 0.5); assert.ok(Math.abs(m[0] - m[1]) < 3 && Math.abs(m[1] - m[2]) < 3, 'маска сіра: ' + m);
  await p.locator('#clrInsp [data-mask]').uncheck(); await settle();
  await p.click('#clrPick'); const cb = await p.locator('#pv').boundingBox(); await p.mouse.click(cb.x + cb.width * 0.5, cb.y + cb.height * 0.03); await settle();
  const hsl = (await cg()).nodes.find(q => q.type === 'hsl'); assert.ok(hsl.p.width === 50 && (hsl.p.smin !== 0.15 || hsl.p.lmin !== 0 || hsl.p.lmax !== 1 || hsl.p.hue !== 30) && hsl.p.smax - hsl.p.smin <= 0.71, 'піпетка заповнила виділення за кольором кадру: ' + JSON.stringify(hsl.p));
});
await step('маска-коло: діє лише в колі, рамку можна перетягнути, а «Навпаки» міняє область', async () => {
  await p.click('#cgReset'); await settle(); await p.locator('#cgNodes .cn', { hasText: 'Колеса' }).click();
  await p.evaluate(() => { const r = [...document.querySelectorAll('#clrInsp .crow')].find(x => /Експозиція/.test(x.textContent)).querySelector('input'); r.value = 1.5; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle(); const whole = await pxAt(0.9, 0.5);
  await p.locator('#clrInsp select').last().selectOption('ellipse'); await settle();
  assert.equal(await p.locator('#clrMask').isVisible(), true, 'рамка маски видна');
  await p.evaluate(() => { const g = window.VideoCut.S.project.clips[0].cg; const m = g.nodes.find(n => n.type === 'prim').mask; m.x = 0.25; m.y = 0.5; m.w = 0.3; m.h = 0.5; m.soft = 0.1; });
  await p.evaluate(async () => { const m = await import('/videocut-app/js/player.js'); m.requestDraw(); }); await settle();
  const inside = await pxAt(0.25, 0.5), outside = await pxAt(0.9, 0.5);
  await p.locator('#clrHold').dispatchEvent('pointerdown'); await settle(); const o1 = await pxAt(0.25, 0.5), o2 = await pxAt(0.9, 0.5); await p.locator('#clrHold').dispatchEvent('pointerup'); await settle();
  assert.ok(diff(outside, o2) < 4, `поза маскою кадр як в оригіналі: ${outside} ~ ${o2}`); assert.ok(diff(inside, o1) > 10, `у масці є корекція: ${inside} ≠ ${o1}`); assert.ok(diff(whole, o2) > 10, 'без маски корекція була всюди');
  const orig = await p.evaluate(() => { const r = window.VideoCut.S.project.clips[0].cg.nodes.find(n => n.type === 'prim'); return r.mask.type; }); assert.equal(orig, 'ellipse');
  // перетягуємо рамку вправо
  const mk = await p.locator('#clrMask .mk').boundingBox(); await p.mouse.move(mk.x + mk.width / 2, mk.y + mk.height / 2); await p.mouse.down(); await p.mouse.move(mk.x + mk.width / 2 + 120, mk.y + mk.height / 2, { steps: 5 }); await p.mouse.up(); await settle();
  const moved = (await cg()).nodes.find(n => n.type === 'prim').mask; assert.ok(moved.x > 0.3, 'рамка зсунулась: ' + moved.x);
  await p.locator('#clrInsp select').last().selectOption('none'); await settle(); assert.equal(await p.locator('#clrMask').isVisible(), false, 'без маски рамки немає');
  assert.equal((await cg()).nodes.find(n => n.type === 'prim').mask, undefined);
});
await step('«Авто-корекція» вирівнює темний кадр, «До всіх кліпів» копіює граф', async () => {
  await p.click('#cgReset'); await settle(); await p.locator('#cgNodes .cn', { hasText: 'Колеса' }).click();
  await p.getByRole('button', { name: /Авто-корекція/ }).click(); await settle();
  const g = (await cg()).nodes.find(n => n.type === 'prim').p; assert.ok(g.exp !== 0 || g.con !== 1 || g.temp !== 0, 'параметри змінились: ' + JSON.stringify({ e: g.exp, c: g.con, t: g.temp }));
  await p.click('#cgAll'); await settle(); // один кліп: нічого копіювати
  assert.equal(await p.evaluate(() => window.VideoCut.S.project.clips.length), 1);
});
await step('ключові кадри: ромбик додає ключ, зміна в іншому місці дописує другий, яскравість змінюється з часом', async () => {
  await p.evaluate(() => window.VideoCut.seek(0)); await p.click('#cgReset'); await settle(); await p.locator('#cgNodes .cn', { hasText: 'Колеса' }).click();
  const row = p.locator('#clrInsp .crow', { hasText: 'Експозиція' });
  await row.locator('.kfb').click(); await settle();
  let g = await cg(); assert.equal(g.nodes.find(n => n.type === 'prim').kf['p.exp'].length, 1, 'перший ключ');
  assert.equal(await p.locator('#kfTrack .kf-mark').count(), 1);
  await p.evaluate(() => window.VideoCut.seek(3)); await settle(); await settle();
  await p.evaluate(() => { const r = [...document.querySelectorAll('#clrInsp .crow')].find(x => /Експозиція/.test(x.textContent)).querySelector('input'); r.value = 1.5; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle(); g = await cg(); const keys = g.nodes.find(n => n.type === 'prim').kf['p.exp']; assert.equal(keys.length, 2, 'другий ключ записано автоматично: ' + JSON.stringify(keys)); assert.ok(Math.abs(keys[1][0] - 3) < 0.1 && keys[1][1] === 1.5 && keys[0][1] === 0);
  assert.equal(await p.locator('#kfTrack .kf-mark').count(), 2);
  const at3 = await mean(); await p.evaluate(() => window.VideoCut.seek(0)); await settle(); await settle(); const at0 = await mean(); await p.evaluate(() => window.VideoCut.seek(1.5)); await settle(); await settle(); const at15 = await mean();
  const lum = a => a[0] + a[1] + a[2]; assert.ok(lum(at3) > lum(at15) + 5 && lum(at15) > lum(at0) + 5, `яскравість росте з часом: ${lum(at0)} < ${lum(at15)} < ${lum(at3)}`);
  assert.equal(await row.locator('input').evaluate(e => +e.value) > 0.3, true, 'повзунок показує проміжне значення');
  await p.evaluate(() => window.VideoCut.seek(0)); await settle(); await p.click('#kfNext'); await settle(); assert.ok(Math.abs(await p.evaluate(() => window.VideoCut.S.t) - 3) < 0.1, 'наступний ключовий кадр');
  await p.click('#kfPrev'); await settle(); assert.ok(Math.abs(await p.evaluate(() => window.VideoCut.S.t)) < 0.1, 'попередній ключовий кадр');
  await row.locator('.kfb').click(); await settle(); g = await cg(); assert.equal(g.nodes.find(n => n.type === 'prim').kf['p.exp'].length, 1, 'ромбик на ключі видаляє його');
  await undo(); await undo(); await settle();
});
await step('анімація потрапляє в експорт: перший і останній кадри мають різну яскравість', async () => {
  await p.evaluate(() => window.VideoCut.seek(0)); await p.click('#cgReset'); await settle(); await p.locator('#cgNodes .cn', { hasText: 'Колеса' }).click();
  await p.evaluate(() => { const g = window.VideoCut.S.project.clips[0].cg, n = g.nodes.find(q => q.type === 'prim'); n.kf = { 'p.exp': [[0, -1.5], [5, 1.5]] }; });
  const b64 = await p.evaluate(async () => { const blob = await window.VideoCut.exportVideo({ format: 'webm', quality: 'low', short: 360 }); const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode(...buf.subarray(i, i + 32768)); return btoa(s); });
  const f = join(tmp, 'anim.webm'); await writeFile(f, Buffer.from(b64, 'base64'));
  const lumAt = t => { const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', 'scale=8:8', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { encoding: 'buffer', maxBuffer: 1e6 }); const d = r.stdout; return d && d.length ? d.reduce((a, b) => a + b, 0) / d.length : NaN; };
  const a = lumAt(0.2), z = lumAt(4.6); assert.ok(z > a + 25, `у файлі яскравість росте: ${a} → ${z}`);
});
const lumAtT = async t => { await p.evaluate(tt => window.VideoCut.seek(tt), t); await p.waitForTimeout(500); const m = await mean(); return m[0] + m[1] + m[2]; };
const setAnim = () => p.evaluate(() => { const g = window.VideoCut.S.project.clips[0].cg; const n = g.nodes.find(q => q.type === 'prim'); n.kf = { 'p.exp': [[0, -1], [5, 1.2]] }; window.VideoCut.commit('тест'); });
await step('розріз кліпа з анімацією кольору: до і після розрізу кадр у кожну мить однаковий, скасування повертає один кліп', async () => {
  await p.click('#cgReset'); await settle(); await setAnim(); await settle();
  const times = [0.6, 1.8, 2.7, 4.2], before = []; for (const t of times) before.push(await lumAtT(t));
  await p.evaluate(async () => { (await import('/videocut-app/js/ops.js')).splitAt(2.2); }); await settle();
  assert.equal(await p.evaluate(() => window.VideoCut.S.project.clips.length), 2, 'два кліпи');
  for (let i = 0; i < times.length; i++) { const now = await lumAtT(times[i]); assert.ok(Math.abs(now - before[i]) < 14, `t=${times[i]}: ${before[i].toFixed(1)} → ${now.toFixed(1)}`); }
  const k = await p.evaluate(() => window.VideoCut.S.project.clips.map(c => c.cg.nodes.find(q => q.type === 'prim').kf['p.exp'].map(x => x.map(v => +v.toFixed(2)))));
  assert.equal(k[0].at(-1)[0] > 2 && k[0].at(-1)[0] < 2.4, true, 'ліва половина закінчується в точці розрізу: ' + JSON.stringify(k)); assert.equal(k[1][0][0], 0, 'права починається з нуля');
  await undo(); await settle(); assert.equal(await p.evaluate(() => window.VideoCut.S.project.clips.length), 1, 'скасування склеїло кліп');
  const kk = await p.evaluate(() => window.VideoCut.S.project.clips[0].cg.nodes.find(q => q.type === 'prim').kf['p.exp']); assert.equal(kk.length, 2, 'ключі відновлено');
});
await step('вирізання діапазону: кадр після вирізаного шматка має той самий колір, що й був у цей момент', async () => {
  const at = await lumAtT(4.2);
  await p.evaluate(async () => { (await import('/videocut-app/js/ops.js')).cutRanges([[1, 3]]); }); await settle();
  assert.equal(await p.evaluate(() => window.VideoCut.S.project.clips.length), 2);
  const now = await lumAtT(4.2 - 2); assert.ok(Math.abs(now - at) < 14, `після вирізання: ${at.toFixed(1)} → ${now.toFixed(1)}`);
  await undo(); await settle(); assert.equal(await p.evaluate(() => window.VideoCut.S.project.clips.length), 1);
});
await step('дублювання, копіювання й вставка кліпа переносять граф разом з ключами; стоп-кадр бере значення на цю мить', async () => {
  const r = await p.evaluate(async () => {
    const ops = await import('/videocut-app/js/ops.js'), st = await import('/videocut-app/js/state.js');
    const c0 = st.S.project.clips[0]; st.select('clip', c0.id); ops.duplicateSel();
    const dup = st.S.project.clips; const ok1 = dup.length === 2 && JSON.stringify(dup[1].cg.nodes.find(q => q.type === 'prim').kf) === JSON.stringify(dup[0].cg.nodes.find(q => q.type === 'prim').kf) && dup[1].id !== dup[0].id;
    st.select('clip', dup[1].id); ops.copySel(false); ops.pasteClip(); const ok2 = st.S.project.clips.length === 3 && !!st.S.project.clips[2].cg?.nodes.find(q => q.type === 'prim').kf;
    return { ok1, ok2, n: st.S.project.clips.length };
  });
  assert.ok(r.ok1 && r.ok2, JSON.stringify(r)); await undo(); await undo(); await settle();
  const n = await p.evaluate(() => window.VideoCut.S.project.clips.length); assert.equal(n, 1, 'скасування прибрало копії: ' + n);
});
await step('стоп-кадр: нове фото отримує статичний колір на цю мить, обидві половини розрізаного кліпа зберігають анімацію', async () => {
  await p.click('#cgReset'); await settle(); await setAnim(); await settle(); await p.evaluate(() => window.VideoCut.seek(2.5)); await settle();
  const ok = await p.evaluate(async () => { const ops = await import('/videocut-app/js/ops.js'); return await ops.freezeFrame(2); });
  assert.ok(ok, 'стоп-кадр створено'); await settle();
  const r = await p.evaluate(async () => { const { kfValue } = await import('/videocut-app/js/color.js'); const cl = window.VideoCut.S.project.clips; const photo = cl.find(c => !c.cg?.nodes.some(n => n.kf)); const parts = cl.filter(c => c.cg?.nodes.some(n => n.kf));
    return { n: cl.length, photoExp: photo?.cg?.nodes.find(q => q.type === 'prim').p.exp, parts: parts.length, expected: kfValue([[0, -1], [5, 1.2]], 2.5) }; });
  assert.equal(r.n, 3, 'три кліпи: початок, стоп-кадр, кінець: ' + JSON.stringify(r)); assert.ok(Math.abs(r.photoExp - r.expected) < 0.02, `статичне значення ${r.photoExp} ≈ ${r.expected}`); assert.equal(r.parts, 2, 'обидві половини зберегли анімацію');
  await undo(); await settle(); assert.equal(await p.evaluate(() => window.VideoCut.S.project.clips.length), 1, 'скасування повернуло один кліп');
});
await step('файл проєкту (.evproj) і відновлення зберігають граф з ключами й масками', async () => {
  const ok = await p.evaluate(async () => {
    const st = await import('/videocut-app/js/state.js'), pf = await import('/videocut-app/js/projfile.js');
    const g = st.S.project.clips[0].cg, n = g.nodes.find(q => q.type === 'prim'); n.mask = { type: 'ellipse', x: 0.3, y: 0.4, w: 0.5, h: 0.4, rot: 10, soft: 0.3, inv: false }; n.kf['mask.x'] = [[0, 0.2], [4, 0.8]];
    const blob = pf.packProject(), back = await pf.unpackProject(new File([blob], 'a.evproj')), fixed = st.repairProject(back.project);
    const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
    return canon(fixed.clips[0].cg) === canon(st.repairProject(JSON.parse(JSON.stringify(st.S.project))).clips[0].cg) && !!fixed.clips[0].cg.nodes.find(q => q.type === 'prim').kf['mask.x'];
  });
  assert.ok(ok, 'граф збігається після запакування й розпакування');
});
await step('граф переживає ремонт проєкту (збереження й відкриття)', async () => {
  const r = await p.evaluate(async () => { const { repairProject } = await import('/videocut-app/js/state.js'); const a = window.VideoCut.S.project, b = repairProject(JSON.parse(JSON.stringify(a))); const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x)); return { same: canon(repairProject(JSON.parse(JSON.stringify(a))).clips[0].cg) === canon(b.clips[0].cg), n: b.clips[0].cg.nodes.length, kf: !!b.clips[0].cg.nodes.find(q => q.kf) }; });
  assert.ok(r.same && r.n >= 3 && r.kf, JSON.stringify(r));
});
await step('експорт містить корекцію й не містить «До / Після»: чорно-біле всюди, навіть під роздільником', async () => {
  await p.click('#clrBA'); await p.locator('#rcList .rc', { hasText: 'Нуар' }).click(); await settle();
  const b64 = await p.evaluate(async () => { const blob = await window.VideoCut.exportVideo({ format: 'webm', quality: 'low', short: 360 }); const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode(...buf.subarray(i, i + 32768)); return btoa(s); });
  const f = join(tmp, 'out.webm'); await writeFile(f, Buffer.from(b64, 'base64'));
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', '1', '-i', f, '-frames:v', '1', '-vf', 'scale=16:16', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 1e6 });
  const px = r.stdout; assert.ok(px && px.length >= 16 * 16 * 3, 'кадр з експорту прочитано');
  let spread = 0, left = 0, right = 0; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const i = (y * 16 + x) * 3, d = Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]); spread = Math.max(spread, d); (x < 8 ? (left += d) : (right += d)); }
  assert.ok(spread < 14, 'кадр чорно-білий (різниця між каналами ≤ 14): ' + spread); assert.ok(Math.abs(left - right) < 64, 'ліва половина така сама, як права: ' + left + ' / ' + right);
  await p.click('#clrBA');
});
await step('«Впорядкувати» розкладає вузли, «Сила корекції» на виході послаблює результат', async () => {
  await p.click('#pageSw [data-page=color]'); await settle(); await p.click('#cgReset'); await settle();
  await p.locator('#rcList .rc', { hasText: 'Золота' }).click(); await settle(); const full = await mean();
  await p.evaluate(() => { const g = window.VideoCut.S.project.clips[0].cg; g.nodes.forEach((n, i) => { n.x = 30 + (i % 2) * 20; n.y = 30 + i * 8; }); });
  await p.click('#cgTidy'); await settle();
  const xs = await p.evaluate(() => window.VideoCut.S.project.clips[0].cg.nodes.map(n => n.x)); assert.ok(new Set(xs).size === xs.length, 'різні стовпці: ' + xs);
  const rects = await p.locator('#cgNodes .cn').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [r.left, r.right]; }));
  for (let i = 1; i < rects.length; i++) assert.ok(rects[i][0] >= rects[i - 1][1] - 2, 'вузли не накладаються по горизонталі');
  await p.locator('#cgNodes .cn.t-out').click(); await settle();
  await p.evaluate(() => { const r = [...document.querySelectorAll('#clrInsp .crow')].find(x => /Сила корекції/.test(x.textContent)).querySelector('input'); r.value = 0; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle(); await p.locator('#clrHold').dispatchEvent('pointerdown'); await settle(); const orig = await mean(); await p.locator('#clrHold').dispatchEvent('pointerup'); await settle();
  const none = await mean(); assert.ok(diff(none, orig) < 4, `сила 0% = оригінал: ${none} ~ ${orig}`); assert.ok(diff(full, orig) > 6, 'а при 100% рецепт діє');
  await p.click('#cgReset'); await settle();
});
await step('відтворення з важким графом (ретро: зерно, віньєтка, сяйво) не зависає й не дає помилок', async () => {
  await p.evaluate(() => window.VideoCut.seek(0)); await p.locator('#rcList .rc', { hasText: 'Ретро' }).click(); await settle();
  await p.evaluate(() => { const g = window.VideoCut.S.project.clips[0].cg; const f = g.nodes.find(n => n.type === 'fx'); if (f) f.p.glow = 0.6; });
  await p.click('#btnPlay'); await p.waitForTimeout(1800); const t1 = await p.evaluate(() => window.VideoCut.S.t); await p.click('#btnPlay'); await settle();
  assert.ok(t1 > 1.0, 'час іде під час відтворення: ' + t1);
  assert.equal(await p.locator('#cgNodes .cn').count() >= 4, true, 'граф на місці'); await p.click('#cgReset'); await settle();
});
await step('обрізання лівого краю кліпа на таймлайні зсуває ключі: анімація лишається на тому самому місці вмісту', async () => {
  await p.click('#pageSw [data-page=edit]'); await settle(); await p.click('#cgReset').catch(() => {});
  await p.evaluate(() => { const c = window.VideoCut.S.project.clips[0]; c.cg = { v: 1, nodes: [{ id: 'in', type: 'in', x: 0, y: 0, p: {} }, { id: 'prim1', type: 'prim', x: 200, y: 0, p: { lift: { x: 0, y: 0, l: 0 }, gamma: { x: 0, y: 0, l: 0 }, gain: { x: 0, y: 0, l: 0 }, offset: { x: 0, y: 0, l: 0 }, exp: 0, con: 1, sat: 1, temp: 0, tint: 0, hi: 0, sh: 0 }, kf: { 'p.exp': [[0, -1], [5, 1.2]] } }, { id: 'out', type: 'out', x: 400, y: 0, p: {} }], links: [{ from: 'in', to: 'prim1', port: 0 }, { from: 'prim1', to: 'out', port: 0 }] }; window.VideoCut.commit('тест'); });
  await settle(); const h = await p.locator('.it.clip .h-l').first().boundingBox();
  await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await p.mouse.down(); await p.mouse.move(h.x + 60, h.y + h.height / 2, { steps: 6 }); await p.mouse.move(h.x + 120, h.y + h.height / 2, { steps: 6 }); await p.mouse.up(); await settle();
  const r = await p.evaluate(() => { const c = window.VideoCut.S.project.clips[0]; return { in: c.in, keys: c.cg.nodes.find(n => n.type === 'prim').kf['p.exp'] }; });
  assert.ok(r.in > 0.3, 'кліп обрізано зліва: ' + r.in); const k = r.keys;
  assert.ok(Math.abs(k[0][1] - (-1 + 2.2 * r.in / 5)) < 0.02, `нове значення на початку ${k[0][1]} відповідає місцю обрізання ${r.in}`);
  assert.ok(Math.abs(k.at(-1)[0] - (5 - r.in)) < 0.02, 'останній ключ зсунувся на ту саму величину: ' + JSON.stringify(k));
  await undo(); await settle(); const back = await p.evaluate(() => window.VideoCut.S.project.clips[0].cg.nodes.find(n => n.type === 'prim').kf['p.exp']); assert.deepEqual(back, [[0, -1], [5, 1.2]], 'скасування повертає ключі');
});
await step('зміна швидкості кліпа масштабує ключі в часі', async () => {
  await p.locator('.it.clip').first().click(); await settle();
  await p.locator('#inspector').getByText('Час', { exact: true }).first().click(); await settle();
  await p.locator('#inspector').getByRole('button', { name: '2×', exact: true }).first().click(); await settle();
  const r = await p.evaluate(() => { const c = window.VideoCut.S.project.clips[0]; return { sp: c.speed, keys: c.cg.nodes.find(n => n.type === 'prim').kf['p.exp'] }; });
  assert.equal(r.sp, 2); assert.ok(Math.abs(r.keys.at(-1)[0] - 2.5) < 0.02 && r.keys[0][0] === 0, 'ключі вдвічі ближче: ' + JSON.stringify(r.keys));
  await undo(); await settle();
});
// ── окрема сторінка: кілька кліпів, перехід, фото й вертикальний формат ──
const p2 = await browser.newPage({ bypassCSP: true, viewport: { width: 1440, height: 900 } });
p2.on('pageerror', e => errors.push('p2 ' + e.message)); p2.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('p2 ' + m.text()); });
await p2.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
await p2.goto(`http://localhost:${port}/index.html`); await p2.waitForFunction(() => window.VideoCut);
const PNG = join(tmp, 'photo.png'); execFileSync(process.env.FFMPEG || 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'gradients=s=800x600:c0=0x203a6a:c1=0xe8a060:x0=0:y0=0:x1=800:y1=0:nb_colors=2:d=1:r=1', '-frames:v', '1', PNG]);
const mean2 = () => p2.evaluate(() => { const cv = document.getElementById('pv'), g = cv.getContext('2d'), w = cv.width, h = cv.height; const d = g.getImageData(Math.round(w * 0.3), Math.round(h * 0.3), Math.round(w * 0.4), Math.round(h * 0.4)).data; let r = 0, gg = 0, b = 0; const k = d.length / 4; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; } return [r / k, gg / k, b / k]; });
const lum2 = async t => { await p2.evaluate(tt => window.VideoCut.seek(tt), t); await p2.waitForTimeout(650); const m = await mean2(); return m[0] + m[1] + m[2]; };
await step('перехід між кліпами з різним кольором: на межі немає стрибка, посередині — плавне змішування', async () => {
  await p2.setInputFiles('#fileInput', [VID]); await p2.waitForFunction(() => window.VideoCut.S.project.clips.length === 1, null, { timeout: 15000 });
  await p2.setInputFiles('#fileInput', [VID]); await p2.waitForFunction(() => window.VideoCut.S.project.clips.length === 2, null, { timeout: 15000 }); await p2.waitForTimeout(1500);
  const info = await p2.evaluate(() => { const P = window.VideoCut.S.project, L = window.VideoCut.layout(); const g = n => ({ v: 1, nodes: [{ id: 'in', type: 'in', x: 0, y: 0, p: {} }, { id: 'prim1', type: 'prim', x: 200, y: 0, p: { lift: { x: 0, y: 0, l: 0 }, gamma: { x: 0, y: 0, l: 0 }, gain: { x: 0, y: 0, l: 0 }, offset: { x: 0, y: 0, l: 0 }, exp: n, con: 1, sat: 1, temp: 0, tint: 0, hi: 0, sh: 0 } }, { id: 'out', type: 'out', x: 400, y: 0, p: { amount: 1 } }], links: [{ from: 'in', to: 'prim1', port: 0 }, { from: 'prim1', to: 'out', port: 0 }] });
    P.clips[0].cg = g(1.3); P.clips[1].tr = { type: 'fade', d: 1 }; window.VideoCut.commit('тест'); return { start: L[1].start }; });
  const T = info.start, before = await lum2(T - 0.08), atStart = await lum2(T + 0.03), mid = await lum2(T + 0.5), late = await lum2(T + 0.97), after = await lum2(T + 1.6);
  assert.ok(before > after + 30, `перший кліп яскравіший за другий: ${before.toFixed(0)} / ${after.toFixed(0)}`);
  assert.ok(Math.abs(atStart - before) < 40, `на початку переходу кадр ще як у першого кліпа (без стрибка): ${before.toFixed(0)} → ${atStart.toFixed(0)}`);
  assert.ok(mid < atStart - 8 && mid > late - 8, `посередині проміжне значення: ${atStart.toFixed(0)} > ${mid.toFixed(0)} > ${late.toFixed(0)}`);
  assert.ok(Math.abs(late - after) < 45, `наприкінці переходу кадр як у другого кліпа: ${late.toFixed(0)} → ${after.toFixed(0)}`);
});
await step('фото й вертикальний формат: граф діє на картинку, маска враховує пропорції кадру', async () => {
  const p3 = await browser.newPage({ bypassCSP: true, viewport: { width: 1440, height: 900 } }); p3.on('pageerror', e => errors.push('p3 ' + e.message));
  await p3.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort()); await p3.goto(`http://localhost:${port}/index.html`); await p3.waitForFunction(() => window.VideoCut);
  await p3.setInputFiles('#fileInput', [PNG]); await p3.waitForFunction(() => window.VideoCut.S.project.clips.length === 1, null, { timeout: 15000 }); await p3.waitForTimeout(1200);
  await p3.evaluate(() => { const P = window.VideoCut.S.project; P.aspect = '9:16'; window.VideoCut.commit('формат'); });
  await p3.click('#pageSw [data-page=color]'); await p3.waitForTimeout(900);
  const px = async (fx, fy) => p3.evaluate(([fx, fy]) => { const cv = document.getElementById('pv'), d = cv.getContext('2d').getImageData(Math.round(cv.width * fx), Math.round(cv.height * fy), 1, 1).data; return [d[0], d[1], d[2]]; }, [fx, fy]);
  const base = await px(0.5, 0.5), baseEdge = await px(0.5, 0.95);
  await p3.evaluate(() => { const c = window.VideoCut.S.project.clips[0]; c.cg = { v: 1, nodes: [{ id: 'in', type: 'in', x: 0, y: 0, p: {} }, { id: 'prim1', type: 'prim', x: 200, y: 0, p: { lift: { x: 0, y: 0, l: 0 }, gamma: { x: 0, y: 0, l: 0 }, gain: { x: 0, y: 0, l: 0 }, offset: { x: 0, y: 0, l: 0 }, exp: 1.2, con: 1, sat: 1, temp: 0, tint: 0, hi: 0, sh: 0 }, mask: { type: 'ellipse', x: 0.5, y: 0.5, w: 0.5, h: 0.3, rot: 0, soft: 0.1, inv: false } }, { id: 'out', type: 'out', x: 400, y: 0, p: { amount: 1 } }], links: [{ from: 'in', to: 'prim1', port: 0 }, { from: 'prim1', to: 'out', port: 0 }] }; window.VideoCut.commit('тест'); });
  await p3.waitForTimeout(700); const inM = await px(0.5, 0.5), outM = await px(0.5, 0.95);
  assert.ok(inM[0] + inM[1] + inM[2] > base[0] + base[1] + base[2] + 40, `у масці фото світлішає: ${base} → ${inM}`); assert.ok(Math.abs(outM[0] - baseEdge[0]) + Math.abs(outM[1] - baseEdge[1]) < 6, `поза маскою без змін: ${baseEdge} → ${outM}`);
  const ratio = await p3.evaluate(() => { const cv = document.getElementById('pv'); return cv.height / cv.width; }); assert.ok(ratio > 1.6, 'формат 9:16: ' + ratio);
  await p3.close();
});
await p2.close();
await step('Alt+1 повертає на «Монтаж»: бібліотека й таймлайн на місці, експорт не зачеплено', async () => {
  await p.keyboard.press('Alt+1'); await settle();
  assert.equal(await p.evaluate(() => document.body.dataset.page), 'edit');
  for (const sel of ['.lib', '#tl', '#inspector']) assert.equal(await p.locator(sel).isVisible(), true, sel);
  assert.equal(await p.evaluate(async () => { const m = await import('/videocut-app/js/color.js'); return m.COLOR_VIEW.on; }), false);
});
await step('жодної помилки в консолі', async () => { assert.deepEqual(errors, []); });

await browser.close(); srv.close();
console.log(fails ? `\n${fails} з ${n} не пройшли` : `\nУсі ${n} кроків пройшли`);
process.exit(fails ? 1 : 0);
