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

await step('готові набори: меню «Файл» додає вступ, кроки, фінал і вертикальний формат; кожен набір скасовується одним кроком', async () => {
  const p29 = await browser.newPage({ bypassCSP: true, viewport: { width: 1440, height: 900 } }); const errs = [];
  p29.on('pageerror', e => errs.push(e.message));
  await p29.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p29.goto(`http://localhost:${port}/index.html`); await p29.waitForFunction(() => window.VideoCut);
  await p29.setInputFiles('#fileInput', video); await p29.waitForFunction(() => window.VideoCut.S.project.clips.length > 0); await p29.waitForTimeout(900);
  const run = async name => { await p29.click('#menubar >> text=Файл'); await p29.click('text=Готові набори'); await p29.click(`.menu-pop >> text=${name}, [role="menu"] >> text=${name}`.split(',')[0]).catch(async () => { await p29.getByText(name, { exact: true }).click(); }); await p29.waitForTimeout(300); };
  await run('Вступ: заголовок і підпис'); assert.equal(await p29.evaluate(() => window.VideoCut.S.project.overlays.length), 2, 'вступ: 2 написи');
  await run('Урок: кроки 1-3'); assert.equal(await p29.evaluate(() => window.VideoCut.S.project.overlays.length), 5, 'кроки: ще 3');
  await run('Вертикальне відео (9:16)'); assert.equal(await p29.evaluate(() => window.VideoCut.S.project.aspect), '9:16');
  assert.equal(await p29.evaluate(() => window.VideoCut.S.project.captionStyle.preset), 'reels');
  await p29.keyboard.press('Control+z'); await p29.waitForTimeout(200);
  assert.equal(await p29.evaluate(() => window.VideoCut.S.project.aspect), '16:9', 'скасування формату одним кроком');
  await p29.close(); assert.deepEqual(errs, []);
});

await browser.close(); srv.close();
