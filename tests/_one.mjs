// Браузерна перевірка відеоредактора (потрібен Playwright і Chromium).
//   node tests/videocut-e2e.mjs            — сервер піднімається сам
// Змінні: PLAYWRIGHT_MODULE (шлях до playwright), CHROME (шлях до chromium), FFMPEG (за замовчуванням ffmpeg)
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const tmp = await mkdtemp(join(tmpdir(), 'vc-'));
const video = join(tmp, 'v.webm'), audio = join(tmp, 'a.webm');
const ff = (...a) => execFileSync(process.env.FFMPEG || 'ffmpeg', ['-y', '-loglevel', 'error', ...a]);
ff('-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-c:v', 'libvpx', '-b:v', '800k', '-c:a', 'libopus', '-shortest', video);
const green = join(tmp, 'g.webm'), fx = join(tmp, 'fx.webm'), ramp = join(tmp, 'r.webm'), rampB = join(tmp, 'rb.webm');
ff('-f', 'lavfi', '-i', "color=c=gray:s=640x360:r=30:d=6,geq=lum='clip(255*T/6,0,255)':cb=60:cr=200", '-c:v', 'libvpx', '-g', '30', '-b:v', '900k', rampB);
ff('-f', 'lavfi', '-i', "color=c=gray:s=640x360:r=30:d=6,geq=lum='clip(255*T/6,0,255)':cb=128:cr=128", '-c:v', 'libvpx', '-g', '30', '-b:v', '900k', ramp);
ff('-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=30:d=4,drawbox=x=100:y=80:w=120:h=120:color=white:t=fill,drawbox=x=400:y=200:w=100:h=100:color=0xffd000:t=fill', '-c:v', 'libvpx', '-b:v', '600k', fx);
ff('-f', 'lavfi', '-i', 'color=c=0x00b140:s=640x360:r=30:d=4,drawbox=x=100:y=80:w=120:h=200:color=0xe0ac86:t=fill,drawbox=x=300:y=80:w=100:h=100:color=0xd02020:t=fill,drawbox=x=450:y=0:w=100:h=360:color=0x00551f:t=fill', '-c:v', 'libvpx', '-b:v', '600k', green);
ff('-f', 'lavfi', '-i', 'sine=frequency=300:duration=6', '-c:a', 'libopus', audio);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const srv = createServer(async (q, r) => {
  try { const f = join(ROOT, decodeURIComponent(q.url.split('?')[0])); r.setHeader('content-type', MIME[extname(f)] || 'application/octet-stream'); r.end(await readFile(f)); } catch { r.statusCode = 404; r.end(); }
}).listen(0);
const port = srv.address().port;

const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage({ bypassCSP: true, viewport: { width: 1300, height: 760 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
await page.goto(`http://localhost:${port}/index.html`);
const VC = fn => page.evaluate(fn);
let n = 0;
const step = async (name, fn) => { try { await fn(); console.log('ok  ', ++n, name); } catch (e) { console.log('FAIL', ++n, name, '\n   ', e.message); process.exitCode = 1; } };

await page.setInputFiles('#fileInput', video);
await page.waitForFunction(() => window.VideoCut?.S.project.clips.length > 0, null, { timeout: 20000 });
await page.waitForTimeout(1500);

await step('кольорова схема (LUT): імпорт .cube, інверсія кольорів на кадрі, збереження в проєкті, нечитабельний файл дає повідомлення', async () => {
  const p26 = await browser.newPage({ bypassCSP: true, viewport: { width: 1440, height: 900 } }); const errs = [];
  p26.on('pageerror', e => errs.push(e.message));
  await p26.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p26.goto(`http://localhost:${port}/index.html`); await p26.waitForFunction(() => window.VideoCut);
  await p26.setInputFiles('#fileInput', video); await p26.waitForFunction(() => window.VideoCut.S.project.clips.length > 0); await p26.waitForTimeout(1000);
  await p26.evaluate(() => window.VideoCut.seek(1)); await p26.waitForTimeout(500);
  const px = () => p26.evaluate(() => { const c = document.getElementById('pv'); const d = c.getContext('2d').getImageData(c.width / 2, c.height * 0.9, 1, 1).data; return [d[0], d[1], d[2]]; });
  await p26.locator('.tl-lanes .clip').first().click();
  await p26.click('#inspector [data-a="itab"][data-v="look"]');
  const before = await px();
  const rows = ['TITLE "Інверсія"', 'LUT_3D_SIZE 2']; for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(`${1 - r} ${1 - g} ${1 - b}`);
  await p26.setInputFiles('#lutInput', { name: 'inv.cube', mimeType: 'text/plain', buffer: Buffer.from(rows.join('\n')) });
  await p26.waitForFunction(() => window.VideoCut.S.project.luts && window.VideoCut.S.project.luts.length === 1); await p26.waitForTimeout(700);
  const after = await px();
  const diff = before.reduce((s, v, i) => s + Math.abs(v - after[i]), 0);
  assert.ok(diff > 150, 'кольори змінилися: ' + JSON.stringify(before) + ' -> ' + JSON.stringify(after));
  assert.equal(await p26.evaluate(() => !!window.VideoCut.S.project.clips[0].lut), true);
  await p26.click('#inspector [data-a="lutPick"][data-v=""]'); await p26.waitForTimeout(500);
  const back = await px(); assert.ok(before.reduce((s, v, i) => s + Math.abs(v - back[i]), 0) < 60, 'без схеми кадр повернувся: ' + JSON.stringify(back));
  await p26.click('#inspector [data-a="lutAdd"]').catch(() => {});
  await p26.setInputFiles('#lutInput', { name: 'bad.cube', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await p26.waitForSelector('.toast, [role="status"]', { timeout: 4000 }).catch(() => {});
  assert.equal(await p26.evaluate(() => window.VideoCut.S.project.luts.length), 1, 'погана схема не додалась');
  await p26.close(); assert.deepEqual(errs, []);
});

await browser.close(); srv.close();
