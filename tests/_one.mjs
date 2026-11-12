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

await step('запис екрана: меню «Додати», індикатор запису, зупинка додає відео в проєкт', async () => {
  const p30 = await browser.newPage({ bypassCSP: true, viewport: { width: 1440, height: 900 } }); const errs = [];
  p30.on('pageerror', e => errs.push(e.message));
  await p30.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p30.addInitScript(() => { // у тесті замість вибору вікна підставляємо рухоме полотно
    navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d'); let i = 0; setInterval(() => { x.fillStyle = `hsl(${(i += 7) % 360},70%,50%)`; x.fillRect(0, 0, 640, 360); x.fillStyle = '#fff'; x.fillRect(i % 600, 150, 40, 60); }, 33); return c.captureStream(30); };
  });
  await p30.goto(`http://localhost:${port}/index.html`); await p30.waitForFunction(() => window.VideoCut);
  await p30.click('#menubar >> text=Додати'); await p30.getByText('Записати екран…', { exact: true }).click();
  await p30.waitForSelector('#scrBar:not([hidden])'); await p30.waitForTimeout(2600);
  assert.match(await p30.textContent('#scrTime'), /00:0[1-9]|00:1/, 'таймер іде');
  await p30.click('#scrStop');
  await p30.waitForFunction(() => window.VideoCut.S.project.clips.length === 1, null, { timeout: 20000 });
  const r = await p30.evaluate(() => { const V = window.VideoCut, m = [...V.media.values()][0]; return { name: m.name, d: m.duration, bar: document.getElementById('scrBar').hidden }; });
  assert.match(r.name, /^Запис екрана/); assert.ok(r.d > 1, 'тривалість запису: ' + r.d); assert.equal(r.bar, true, 'індикатор сховано');
  await p30.close(); assert.deepEqual(errs, []);
});

await browser.close(); srv.close();
