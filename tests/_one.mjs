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

await step('стабілізація: аналіз знаходить тремтіння, зі стабілізацією кадр коливається помітно менше', async () => {
  const shaky = join(tmp, 'shaky.webm');
  ff('-f', 'lavfi', '-i', 'testsrc2=size=800x450:rate=30:duration=6', '-vf', "crop=640:360:80+22*sin(2*PI*2.5*t)+9*sin(2*PI*5.1*t):45+14*sin(2*PI*1.9*t)", '-c:v', 'libvpx', '-b:v', '1500k', shaky);
  const p27 = await browser.newPage({ bypassCSP: true, viewport: { width: 1440, height: 900 } }); const errs = [];
  p27.on('pageerror', e => errs.push(e.message));
  await p27.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p27.goto(`http://localhost:${port}/index.html`); await p27.waitForFunction(() => window.VideoCut);
  await p27.setInputFiles('#fileInput', shaky); await p27.waitForFunction(() => window.VideoCut.S.project.clips.length > 0); await p27.waitForTimeout(1200);
  const jitter = () => p27.evaluate(async () => {
    const V = window.VideoCut, { estimateShift } = await import('./videocut-app/js/stab.js');
    const cv = document.getElementById('pv'), c2 = document.createElement('canvas'); c2.width = 96; c2.height = 54; const x2 = c2.getContext('2d', { willReadFrequently: true });
    const gray = () => { x2.drawImage(cv, 0, 0, 96, 54); const d = x2.getImageData(0, 0, 96, 54).data, g = new Float32Array(96 * 54); for (let i = 0; i < g.length; i++) g[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11; return g; };
    let prev = null, sum = 0, n = 0;
    for (let i = 0; i < 40; i++) { V.seek(0.4 + i / 15); await new Promise(r => setTimeout(r, 140)); const g = gray(); if (prev) { const s = estimateShift(prev, g, 96, 54, 6); sum += Math.abs(s.x) + Math.abs(s.y); n++; } prev = g; }
    return sum / n;
  });
  await p27.locator('.tl-lanes .clip').first().click();
  const raw = await jitter();
  await p27.locator('.tl-lanes .clip').first().click();
  await p27.click('[data-a="stabRun"]');
  await p27.waitForFunction(() => window.VideoCut.S.project.clips[0].stab, null, { timeout: 60000 });
  const st = await p27.evaluate(() => { const c = window.VideoCut.S.project.clips[0]; return { on: c.stabOn, n: c.stab.dx.length, z: c.stab.zoom, mx: Math.max(...c.stab.dx.map(Math.abs)) }; });
  assert.ok(st.on && st.n >= 60 && st.z > 1.02 && st.mx > 0.01, 'дані стабілізації: ' + JSON.stringify(st));
  const fixed = await jitter();
  assert.ok(fixed < raw * 0.75, `коливання кадру ${raw.toFixed(2)} -> ${fixed.toFixed(2)}`);
  await p27.close(); assert.deepEqual(errs, []);
});

await browser.close(); srv.close();
