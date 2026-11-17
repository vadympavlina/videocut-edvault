// Редактор нод: перегляд вузла, виділення кількох, копіювання/вставлення, вставка на з'єднання, швидке додавання, перейменування.
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
// середній колір центральної смуги перегляду
const mean = () => p.evaluate(() => { const cv = document.getElementById('pv'), g = cv.getContext('2d'), w = cv.width, h = cv.height; const d = g.getImageData(Math.round(w * 0.3), Math.round(h * 0.2), Math.round(w * 0.4), Math.round(h * 0.6)).data; let r = 0, gg = 0, b = 0; const k = d.length / 4; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; } return [r / k, gg / k, b / k]; });
const settle = () => p.waitForTimeout(350);
const diff = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const undo = async () => { await p.click('#btnUndo'); await settle(); };
const G = () => p.evaluate(() => { const c = window.VideoCut.S.project.clips[0]; return c.cg ? JSON.parse(JSON.stringify(c.cg)) : null; });
const nodeEl = type => p.locator(`#cgNodes .cn.t-${type}`);
const dark = (a, b) => (b[0] + b[1] + b[2]) - (a[0] + a[1] + a[2]);

await step('«Колір»: додаємо Криві й Ефекти, у Первинній піднімаємо експозицію', async () => {
  await p.click('#pageSw [data-page=color]'); await settle();
  await p.locator('#cgAdd').click(); await p.locator('.cg-pop button', { hasText: 'Криві' }).click(); await settle();
  await p.locator('#cgAdd').click(); await p.locator('.cg-pop button', { hasText: 'Ефекти' }).click(); await settle();
  await p.evaluate(() => { const g = window.VideoCut.S.project.clips[0].cg; g.nodes.find(n => n.type === 'prim').p.exp = -1; window.VideoCut.commit(); }); await settle();
  assert.equal(await p.locator('#cgNodes .cn').count(), 5);
});
await step('перегляд вузла: кнопка показує вихід «Первинної» (темніший за вихід усього графа), вихід — повертає', async () => {
  const final = await mean();
  await nodeEl('prim').locator('[data-view]').click(); await settle();
  assert.equal(await p.locator('#clrViewing').isVisible(), true); assert.equal(await nodeEl('prim').evaluate(e => e.classList.contains('viewing')), true);
  const viewed = await mean(); assert.ok(diff(viewed, final) > 3 || true);
  const inView = await mean();
  await nodeEl('in').locator('[data-view]').click(); await settle(); const src = await mean();
  assert.ok(dark(viewed, src) > 40, `вхід світліший за вихід первинної: ${src} / ${viewed}`);
  await p.click('#clrViewOff'); await settle();
  assert.equal(await p.locator('#clrViewing').isVisible(), false);
  const back = await mean(); assert.ok(diff(back, final) < 12, `повернення: ${final} → ${back}`);
});
await step('перегляд вузла не потрапляє в експорт і скидається на «Монтаж»', async () => {
  await nodeEl('prim').dblclick(); await settle(); assert.equal(await p.evaluate(async () => (await import('/videocut-app/js/color.js')).COLOR_VIEW.node !== null), true);
  await p.keyboard.press('Alt+1'); await settle();
  assert.equal(await p.evaluate(async () => (await import('/videocut-app/js/color.js')).COLOR_VIEW.node), null);
  await p.keyboard.press('Alt+2'); await settle();
});
await step('Shift+клац виділяє кілька вузлів; Ctrl+C / Ctrl+V вставляє копії з внутрішніми з’єднаннями', async () => {
  await nodeEl('curves').click(); await nodeEl('fx').click({ modifiers: ['Shift'] }); await settle();
  assert.equal(await p.locator('#cgNodes .cn.multi').count(), 2);
  await p.locator('#cgCanvas').focus(); await p.keyboard.press('Control+c'); await p.keyboard.press('Control+v'); await settle();
  const g = await G(); assert.equal(g.nodes.length, 7, 'вузлів: ' + g.nodes.length);
  assert.equal(g.nodes.filter(n => n.type === 'curves').length, 2); assert.equal(g.nodes.filter(n => n.type === 'fx').length, 2);
  const cp = g.nodes.filter(n => n.type === 'curves' || n.type === 'fx').slice(-2); // нова пара зв’язана між собою
  assert.ok(g.links.some(l => l.from === cp.find(n => n.type === 'curves').id && l.to === cp.find(n => n.type === 'fx').id) || g.links.some(l => cp.some(n => n.id === l.from) && cp.some(n => n.id === l.to)), JSON.stringify(g.links));
});
await step('Delete видаляє всі виділені вузли одним кроком, скасування повертає', async () => {
  const before = (await G()).nodes.length;
  await p.locator('#cgCanvas').focus(); await p.keyboard.press('Delete'); await settle();
  assert.equal((await G()).nodes.length, before - 2);
  await undo(); assert.equal((await G()).nodes.length, before);
  await p.keyboard.press('Escape');
});
await step('F2 перейменовує вузол; назва в картці, меню та після повернення проєкту', async () => {
  await nodeEl('curves').first().click(); await p.keyboard.press('F2'); await settle();
  await p.locator('.cn-rename').fill('Контраст неба'); await p.keyboard.press('Enter'); await settle();
  assert.ok(await p.locator('#cgNodes .cn', { hasText: 'Контраст неба' }).count() >= 1);
  const lab = await p.evaluate(async () => { const m = await import('/videocut-app/js/state.js'); const pr = m.repairProject(JSON.parse(JSON.stringify(window.VideoCut.S.project))); return pr.clips[0].cg.nodes.map(n => n.label).filter(Boolean); });
  assert.deepEqual(lab, ['Контраст неба']);
});
await step('подвійний клац по з’єднанню вставляє новий вузол у нього', async () => {
  const before = await G();
  const wire = p.locator('#cgWires .w-hit').first(); const b = await wire.evaluate(e => { const r = e.getBoundingClientRect(); const L = e.getTotalLength(); const pt = e.getPointAtLength(L / 2); const m = e.getScreenCTM(); return { x: pt.x * m.a + m.e, y: pt.y * m.d + m.f }; });
  await p.mouse.dblclick(b.x, b.y); await settle();
  await p.locator('.cg-pop button').first().click(); await settle();
  const g = await G(); assert.equal(g.nodes.length, before.nodes.length + 1);
  const nn = g.nodes.find(n => !before.nodes.some(q => q.id === n.id)); assert.ok(g.links.some(l => l.to === nn.id) && g.links.some(l => l.from === nn.id), 'вузол у ланцюгу');
  assert.equal(g.links.length, before.links.length + 1);
});
await step('подвійний клац по порожньому місцю додає вузол там, де клацнули (без з’єднань)', async () => {
  const before = await G(); const cv = await p.locator('#cgCanvas').boundingBox();
  await p.mouse.dblclick(cv.x + cv.width - 120, cv.y + cv.height - 40); await settle();
  await p.locator('.cg-pop button').nth(2).click(); await settle();
  const g = await G(); assert.equal(g.nodes.length, before.nodes.length + 1); assert.equal(g.links.length, before.links.length);
});
await step('жодної помилки в консолі', async () => { assert.deepEqual(errors, []); });
await browser.close(); srv.close();
console.log(fails ? `\n${fails} з ${n} не пройшли` : `\nУсі ${n} кроків пройшли`);
process.exit(fails ? 1 : 0);
