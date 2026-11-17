// Ножі: розріз усіх доріжок, режим «Ніж», блокування доріжок.
//   node tests/videocut-cut-e2e.mjs      (потрібні Playwright, Chromium і ffmpeg)
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
const at = async t => { await p.evaluate(t => window.VideoCut.seek(t), t); await p.waitForTimeout(350); };
const P = () => p.evaluate(() => { const s = window.VideoCut.S.project; return { clips: s.clips.length, ov: s.overlays.map(o => [o.type, +o.start.toFixed(2), +o.dur.toFixed(2)]), cc: s.captions.map(c => [+c.start.toFixed(2), +c.dur.toFixed(2)]) }; });
await step('готуємо: текст 1–4 с і субтитр 1–4 с над кліпом 6 с', async () => {
  await p.evaluate(async () => { const o = await import('/videocut-app/js/ops.js'); window.VideoCut.seek(1); o.addOverlay('text', { preset: 'plain' }); const t = window.VideoCut.S.project.overlays[0]; t.start = 1; t.dur = 3; o.addCaption('Субтитр'); const c = window.VideoCut.S.project.captions[0]; c.start = 1; c.dur = 3; window.VideoCut.commit(); });
  const r = await P(); assert.equal(r.clips, 1); assert.equal(r.ov.length, 1); assert.equal(r.cc.length, 1);
});
await step('Shift+S розрізає кліп, текст і субтитр одним кроком; Ctrl+Z повертає все', async () => {
  await at(2); await p.keyboard.press('Shift+S'); await settle();
  let r = await P(); assert.equal(r.clips, 2); assert.equal(r.ov.length, 2); assert.equal(r.cc.length, 2); assert.ok(Math.abs(r.ov[0][2] - 1) < 0.06, JSON.stringify(r));
  await undo(); r = await P(); assert.equal(r.clips, 1); assert.equal(r.ov.length, 1); assert.equal(r.cc.length, 1);
});
await step('поза межами елементів розрізається лише те, що під курсором (кліп); порожнє місце — підказка', async () => {
  await at(5); await p.keyboard.press('Shift+S'); await settle();
  let r = await P(); assert.equal(r.clips, 2); assert.equal(r.ov.length, 1); assert.equal(r.cc.length, 1);
  await undo();
});
await step('заблокована доріжка графіки не розрізається', async () => {
  await p.evaluate(() => { const P_ = window.VideoCut.S.project; P_.tracks ||= {}; (P_.tracks.ov ||= { hide: false, mute: false, solo: false, lock: false }).lock = true; window.VideoCut.commit(); });
  await at(2); await p.keyboard.press('Shift+S'); await settle();
  const r = await P(); assert.equal(r.clips, 2); assert.equal(r.ov.length, 1); assert.equal(r.cc.length, 2);
  await undo(); await p.evaluate(() => { window.VideoCut.S.project.tracks.ov.lock = false; window.VideoCut.commit(); });
});
await step('кнопка й клавіша B вмикають режим «Ніж», Esc вимикає', async () => {
  await p.keyboard.press('b'); await settle();
  assert.equal(await p.evaluate(() => document.body.classList.contains('razor-on')), true); assert.equal(await p.locator('#btnRazor').getAttribute('aria-pressed'), 'true');
  await p.keyboard.press('Escape'); await settle();
  assert.equal(await p.evaluate(() => document.body.classList.contains('razor-on')), false);
  await p.click('#btnRazor'); await settle(); assert.equal(await p.evaluate(() => document.body.classList.contains('razor-on')), true);
});
const clipX = async frac => { const b = await p.locator('.lane-v .it.clip').first().boundingBox(); return [b.x + b.width * frac, b.y + b.height / 2]; };
await step('у режимі «Ніж» клацання по кліпу розрізає його саме там, без зміни виділення', async () => {
  const [x, y] = await clipX(0.5); await p.mouse.move(x, y); await settle();
  assert.equal(await p.locator('.razor-line').isVisible(), true);
  await p.mouse.click(x, y); await settle();
  const r = await P(); assert.equal(r.clips, 2);
  const cuts = await p.evaluate(() => window.VideoCut.layout().map(l => +l.start.toFixed(2))); assert.ok(Math.abs(cuts[1] - 3) < 0.4, JSON.stringify(cuts));
});
await step('у режимі «Ніж» Shift+клацання розрізає всі доріжки', async () => {
  const b = await p.locator('.lane-cc .it').first().boundingBox();
  await p.keyboard.down('Shift'); await p.mouse.click(b.x + b.width * 0.5, b.y + b.height / 2); await p.keyboard.up('Shift'); await settle();
  const r = await P(); assert.ok(r.cc.length >= 2 && r.ov.length >= 2, JSON.stringify(r));
});
await step('одне скасування прибирає розріз', async () => { const before = (await P()).clips; await undo(); assert.ok((await P()).clips <= before); });
await step('жодної помилки в консолі', async () => { assert.deepEqual(errors, []); });
await browser.close(); srv.close();
console.log(fails ? `\n${fails} з ${n} не пройшли` : `\nУсі ${n} кроків пройшли`);
process.exit(fails ? 1 : 0);
