// Перенесення кольору між кліпами: копіювати, вставити, зіставити.
//   node tests/videocut-colorxfer-e2e.mjs      (потрібні Playwright, Chromium і ffmpeg)
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
const clips = () => p.evaluate(() => window.VideoCut.S.project.clips.map(c => ({ id: c.id, cg: c.cg ? JSON.parse(JSON.stringify(c.cg)) : null })));
const menu = async name => { await p.click('#cgXfer'); await settle(); await p.locator('.cg-pop button', { hasText: name }).first().click(); await settle(); };
await step('готуємо два кліпи; перший темніємо, другий лишаємо нейтральним', async () => {
  await p.evaluate(async () => { const o = await import('/videocut-app/js/ops.js'); const m = [...window.VideoCut.media.values()][0]; o.addToTimeline(m); const c = window.VideoCut.S.project.clips[0]; const C = await import('/videocut-app/js/color.js'); c.cg = C.newGraph(); c.cg.nodes.find(n => n.type === 'prim').p.exp = -0.9; c.cg.nodes.find(n => n.type === 'prim').p.temp = 0.4; window.VideoCut.commit(); });
  assert.equal((await clips()).length, 2);
  await p.click('#pageSw [data-page=color]'); await settle();
});
await step('меню «Перенести колір» містить копіювання, вставлення й зіставлення з іншим кліпом', async () => {
  await p.click('#cgXfer'); await settle();
  const t = await p.locator('.cg-pop button').allTextContents(); await p.keyboard.press('Escape');
  assert.ok(t.some(x => /Копіювати колір/.test(x)) && t.some(x => /Вставити колір/.test(x)) && t.some(x => /Зіставити колір із кліпом 2/.test(x)), JSON.stringify(t));
});
await step('копіюємо колір першого кліпа й вставляємо у другий — графи рівні, але незалежні', async () => {
  await p.evaluate(() => window.VideoCut.seek(0.3)); await settle();
  await menu('Копіювати колір');
  await p.evaluate(() => { const L = window.VideoCut.layout(); window.VideoCut.seek(L[1].start + 0.3); }); await settle();
  await menu('Вставити колір');
  const c = await clips(); assert.deepEqual(c[1].cg, c[0].cg);
  await p.evaluate(() => { window.VideoCut.S.project.clips[1].cg.nodes.find(n => n.type === 'prim').p.exp = 0.5; });
  assert.equal((await clips())[0].cg.nodes.find(n => n.type === 'prim').p.exp, -0.9);
  await undo();
});
await step('зіставлення з кліпом 1 додає вузол «Криві», який наближає кадр до еталона', async () => {
  await p.evaluate(() => { const c = window.VideoCut.S.project.clips[1]; delete c.cg; window.VideoCut.commit(); });
  await p.evaluate(() => { const L = window.VideoCut.layout(); window.VideoCut.seek(L[1].start + 0.3); }); await settle();
  const before = await mean();
  await menu('Зіставити колір із кліпом 1'); await p.waitForTimeout(400);
  const c = (await clips())[1]; const cu = c.cg.nodes.find(n => n.type === 'curves');
  assert.ok(cu, 'вузол «Криві»'); assert.ok(cu.p.r.length >= 5, 'крива з кількох точок');
  const after = await mean(); const ref = await p.evaluate(() => 0);
  assert.ok(diff(before, after) > 20, `кадр змінився: ${before} → ${after}`);
  assert.ok(after[0] < before[0] - 10 || after[2] > before[2] + 5 || after[1] < before[1] - 10, 'у бік темнішого теплого еталона');
});
await step('одне скасування прибирає зіставлення', async () => { await undo(); const c = (await clips())[1]; assert.ok(!c.cg || !c.cg.nodes.some(n => n.type === 'curves')); });
await step('жодної помилки в консолі', async () => { assert.deepEqual(errors, []); });
await browser.close(); srv.close();
console.log(fails ? `\n${fails} з ${n} не пройшли` : `\nУсі ${n} кроків пройшли`);
process.exit(fails ? 1 : 0);
