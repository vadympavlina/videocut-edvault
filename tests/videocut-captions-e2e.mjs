// Субтитри в редакторі: шаблони, налаштування вигляду, безпечна зона, експорт.
//   node tests/videocut-captions-e2e.mjs      (потрібні Playwright, Chromium і ffmpeg)
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
const at = async t => { await p.evaluate(t => window.VideoCut.seek(t), t); await p.waitForTimeout(450); };
const st = () => p.evaluate(() => JSON.parse(JSON.stringify(window.VideoCut.S.project.captionStyle)));
const capBox = () => p.evaluate(async () => { const m = await import('/videocut-app/js/cc.js'); return { ...m.capBox }; });

await step('додаємо субтитр і відкриваємо вкладку «Субтитри» → «Вигляд»', async () => {
  await p.evaluate(async () => { const o = await import('/videocut-app/js/ops.js'); window.VideoCut.seek(1); o.addCaption('Сьогодні ми поговоримо про те, як зробити субтитри гарними'); });
  await p.click('.lib [data-tab=captions]').catch(() => {}); await p.waitForTimeout(300);
  await p.locator('[data-cc-view=style]').click(); await settle();
  assert.ok(await p.locator('.cc-preset').count() >= 16, 'шаблонів: ' + await p.locator('.cc-preset').count());
});
await step('мініатюри всіх шаблонів намальовані', async () => {
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => [...document.querySelectorAll('.cc-preset img')].map(i => i.src.length));
  assert.ok(r.every(n => n > 1500), JSON.stringify(r));
});
await step('шаблон «Динамічний» задає покадровий стиль, «Класика» повертає все до типового', async () => {
  await p.locator('[data-cc-preset=hormozi]').click(); await settle();
  let s = await st(); assert.equal(s.anim, 'chunk'); assert.equal(s.safe, true); assert.equal(s.bg, 'outline');
  await p.locator('[data-cc-preset=podcast]').click(); await settle();
  s = await st(); assert.equal(s.hiMode, 'pill');
  await p.locator('[data-cc-preset=classic]').click(); await settle();
  s = await st(); assert.equal(s.hiMode, 'color'); assert.equal(s.safe, false); assert.equal(s.strokeW, 0.2); assert.equal(s.bg, 'box');
});
await step('налаштування: обведення, підсвітка слова, інтервал, міжрядковий, безпечна зона', async () => {
  await p.locator('details[data-cc-fold=style] summary').click().catch(() => {}); await settle();
  await p.locator('[data-cc-set=bg][data-v=outline]').click(); await settle();
  assert.equal(await p.locator('[data-cc-range=strokeW]').count(), 1);
  await p.locator('[data-cc-set=anim][data-v=karaoke]').click(); await settle();
  await p.locator('[data-cc-set=hiMode][data-v=pill]').click(); await settle();
  await p.locator('[data-cc-range=spacing]').fill('0.1'); await p.locator('[data-cc-range=lineH]').fill('1.5'); await p.locator('[data-cc-range=strokeW]').fill('0.3'); await settle();
  await p.locator('[data-cc-toggle=safe]').click(); await settle();
  const s = await st(); assert.equal(s.bg, 'outline'); assert.equal(s.hiMode, 'pill'); assert.ok(Math.abs(s.spacing - 0.1) < 1e-6 && Math.abs(s.lineH - 1.5) < 1e-6 && Math.abs(s.strokeW - 0.3) < 1e-6); assert.equal(s.safe, true);
});
await step('субтитр малюється в перегляді й вміщається в кадр', async () => {
  await at(1.5); const b = await capBox();
  assert.ok(b.w > 0.2 && b.x >= 0 && b.x + b.w <= 1.001 && b.y >= 0 && b.y + b.h <= 1.001, JSON.stringify(b));
  const nonBg = await p.evaluate(({ x, y, w, h }) => { const cv = document.getElementById('pv'), g = cv.getContext('2d'); const d = g.getImageData(Math.round(x * cv.width), Math.round(y * cv.height), Math.round(w * cv.width), Math.round(h * cv.height)).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) n++; return n; }, b);
  assert.ok(nonBg > 40, 'білих пікселів тексту: ' + nonBg);
});
await step('безпечна зона у вертикальному відео: субтитр не нижче 78% висоти', async () => {
  await p.evaluate(() => { const S = window.VideoCut.S; S.project.aspect = '9:16'; S.project.captionStyle.y = 0.97; window.VideoCut.commit(); });
  await p.waitForTimeout(500); await at(1.5); const b = await capBox();
  assert.ok(b.y + b.h <= 0.785, JSON.stringify(b));
  await p.evaluate(() => { const S = window.VideoCut.S; S.project.captionStyle.safe = false; window.VideoCut.commit(); }); await at(1.6);
  const b2 = await capBox(); assert.ok(b2.y + b2.h > 0.9, JSON.stringify(b2));
  await p.evaluate(() => { const S = window.VideoCut.S; S.project.aspect = '16:9'; S.project.captionStyle.safe = true; window.VideoCut.commit(); });
});
await step('усі шаблони малюються без помилок і дають видимий текст', async () => {
  const r = await p.evaluate(async () => { const cc = await import('/videocut-app/js/cc.js'); const out = []; for (const [k, pr] of Object.entries(cc.CC_PRESETS)) { await cc.loadCcFont({ ...cc.capStyle({}), ...pr }); const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360; const g = cv.getContext('2d'); g.fillStyle = '#505a70'; g.fillRect(0, 0, 640, 360); const s = { ...cc.capStyle({}), ...pr, y: 0.55 }; cc.drawCaption(g, { id: 'q' + k, start: 0, dur: 3, text: 'Перевірка тексту субтитрів' }, 640, 360, 360 / 1080, s, 1.4, 1, false); const d = g.getImageData(0, 0, 640, 360).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 0x50) + Math.abs(d[i + 1] - 0x5a) + Math.abs(d[i + 2] - 0x70) > 40) n++; out.push([k, n]); } return out; });
  assert.ok(r.every(([, n]) => n > 200), JSON.stringify(r.filter(([, n]) => n <= 200)));
});
await step('експорт відео з субтитрами проходить', async () => {
  const r = await p.evaluate(async () => { const b = await window.VideoCut.exportVideo({ format: 'webm', quality: 'low', short: 360, range: [0, 3], fps: 10 }).catch(e => ({ err: String(e) })); return b && b.size ? { size: b.size } : { err: JSON.stringify(b) }; });
  assert.ok(r.size > 1000, JSON.stringify(r));
});
await step('жодної помилки в консолі', async () => { assert.deepEqual(errors, []); });

await browser.close(); srv.close();
console.log(fails ? `\n${fails} з ${n} не пройшли` : `\nУсі ${n} кроків пройшли`);
process.exit(fails ? 1 : 0);
