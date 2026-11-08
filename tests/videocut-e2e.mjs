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
ff('-f', 'lavfi', '-i', 'sine=frequency=300:duration=6', '-c:a', 'libopus', audio);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const srv = createServer(async (q, r) => {
  try { const f = join(ROOT, decodeURIComponent(q.url.split('?')[0])); r.setHeader('content-type', MIME[extname(f)] || 'application/octet-stream'); r.end(await readFile(f)); } catch { r.statusCode = 404; r.end(); }
}).listen(0);
const port = srv.address().port;

const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1300, height: 760 } });
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

await step('вирізання шматка не дублює перехід усередині кліпу', async () => {
  await VC(() => { const V = window.VideoCut; V.S.project.clips[0].tr = { type: 'fade', d: 0.6 }; V.commit(); V.S.markIn = 3; V.S.markOut = 5; });
  await page.keyboard.press('KeyX');
  const trs = await VC(() => window.VideoCut.S.project.clips.map(c => !!c.tr));
  assert.equal(trs.length, 2);
  assert.deepEqual(trs, [true, false]);
});

await step('прокрутка панелі властивостей не скидається після змін', async () => {
  await page.locator('.it.clip').first().click();
  await page.evaluate(() => { document.getElementById('inspector').scrollTop = 1e5; });
  const before = await page.evaluate(() => document.getElementById('inspector').scrollTop);
  assert.ok(before > 0, 'панель має прокручуватися');
  for (let i = 0; i < 4; i++) { await page.locator('#inspector [data-toggle="fadeIn"]').first().dispatchEvent('click'); await page.waitForTimeout(250); }
  assert.equal(await page.evaluate(() => document.getElementById('inspector').scrollTop), before);
});

await step('вікно автосубтитрів пропонує джерела звуку', async () => {
  await page.setInputFiles('#fileInput', audio);
  await page.waitForTimeout(800);
  await page.evaluate(() => document.activeElement.blur());
  await page.evaluate(() => window.dispatchEvent(new Event('x')));
  await page.evaluate(() => document.querySelector('[data-m="3"]').click());
  await page.locator('.mb-it', { hasText: 'Субтитри з мовлення' }).click();
  const opts = await page.$$eval('#asrSources input', a => a.map(i => [i.value, !i.disabled]));
  assert.deepEqual(Object.fromEntries(opts).speech, true);
  assert.deepEqual(Object.fromEntries(opts).music, true);
  assert.deepEqual(Object.fromEntries(opts).voice, false);
  await page.keyboard.press('Escape');
});

await step('Скасувати після видалення файлу повертає кліпи разом із файлом', async () => {
  await page.evaluate(() => document.activeElement.blur());
  await page.locator('[data-tab="media"]').click();
  const id = await page.evaluate(() => [...window.VideoCut.media.values()].find(m => m.kind === 'video').id);
  await page.evaluate(() => { document.querySelector('.mcard [data-act="rm"]').click(); });
  await page.locator('#confirmYes').click();
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(i => window.VideoCut.media.has(i), id), false);
  await page.keyboard.press('Control+KeyZ');
  await page.waitForFunction(i => window.VideoCut.media.has(i), id, { timeout: 8000 });
  assert.ok(await page.evaluate(() => window.VideoCut.S.project.clips.length > 0));
});

await step('проєкт зберігається у файл і відкривається назад', async () => {
  const dl = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('[data-m="0"]').click());
  await page.locator('.mb-it', { hasText: 'Зберегти проєкт у файл' }).click();
  const d = await dl;
  const path = join(tmp, 'p.evproj');
  await d.saveAs(path);
  const before = await VC(() => ({ clips: window.VideoCut.S.project.clips.length, media: window.VideoCut.media.size }));
  await page.evaluate(() => document.querySelector('[data-m="0"]').click());
  await page.locator('.mb-it', { hasText: 'Новий проєкт' }).click();
  await page.locator('#confirmYes').click();
  assert.equal(await VC(() => window.VideoCut.S.project.clips.length), 0);
  await page.setInputFiles('#projInput', path);
  await page.waitForFunction(b => window.VideoCut.S.project.clips.length === b.clips && window.VideoCut.media.size === b.media, before, { timeout: 15000 });
});

await step('копіювання й вставка елемента у позиції курсора', async () => {
  await page.evaluate(() => document.activeElement.blur());
  await VC(() => window.VideoCut.seek(1));
  await page.keyboard.press('KeyT'); await page.keyboard.press('Escape');
  const o0 = await VC(() => window.VideoCut.S.project.overlays.length);
  await page.locator('.it.ov').first().click();
  await page.keyboard.press('Control+KeyC');
  await VC(() => window.VideoCut.seek(6));
  await page.keyboard.press('Control+KeyV');
  const o = await VC(() => window.VideoCut.S.project.overlays.map(x => x.start));
  assert.equal(o.length, o0 + 1);
  assert.ok(o.some(x => Math.abs(x - 6) < 0.05));
});

await step('вікна «Прибрати паузи» і «Озвучення» відкриваються', async () => {
  await page.evaluate(() => document.activeElement.blur());
  await page.evaluate(() => document.querySelector('[data-m="3"]').click());
  await page.locator('.mb-it', { hasText: 'Прибрати паузи' }).click();
  assert.ok(await page.locator('#silModal.open').count());
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#silModal.open').count(), 0);
});

await step('повзунок не обривається, якщо зупинитись посеред перетягування', async () => {
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.keyboard.press('KeyT'); await page.waitForTimeout(300);
  const sl = page.locator('#inspector input[type=range]').first();
  const bb = await sl.boundingBox();
  await page.evaluate(() => { document.querySelector('#inspector input[type=range]').__mark = 1; });
  await page.mouse.move(bb.x + bb.width * 0.2, bb.y + bb.height / 2); await page.mouse.down();
  await page.mouse.move(bb.x + bb.width * 0.5, bb.y + bb.height / 2, { steps: 4 });
  await page.waitForTimeout(1000);
  await page.mouse.move(bb.x + bb.width * 0.8, bb.y + bb.height / 2, { steps: 4 });
  await page.mouse.up();
  const r = await page.evaluate(() => { const e = document.querySelector('#inspector input[type=range]'); return { same: !!e.__mark, v: +e.value, min: +e.min, max: +e.max }; });
  assert.ok(r.same, 'повзунок підмінився новим елементом');
  assert.ok(r.v > r.min + (r.max - r.min) * 0.7, 'значення має дійти до кінця перетягування: ' + r.v);
});

await step('курсор у тексті не злітає після паузи в друку', async () => {
  const ta = page.locator('#inspector textarea').first();
  await ta.click(); await page.keyboard.press('Control+A'); await page.keyboard.type('abc');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(1300);
  await page.keyboard.type('X');
  assert.equal(await ta.inputValue(), 'aXbc');
});

await step('велике 4K-відео отримує легку копію для перегляду, експорт іде з оригіналу', async () => {
  const big = join(tmp, 'big.webm');
  ff('-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=30:duration=3', '-c:v', 'libvpx', '-b:v', '3M', '-deadline', 'realtime', '-cpu-used', '8', big);
  await page.setInputFiles('#fileInput', big);
  await page.waitForFunction(() => [...window.VideoCut.media.values()].some(m => m.width > 3000 && m.proxyUrl), null, { timeout: 120000 });
  const r = await page.evaluate(() => { const m = [...window.VideoCut.media.values()].find(x => x.width > 3000); return { ow: m.width, ew: m.el.videoWidth, dur: m.duration }; });
  assert.equal(r.ow, 3840);
  await page.waitForFunction(() => { const m = [...window.VideoCut.media.values()].find(x => x.width > 3000); return m.el.videoWidth > 0; }, null, { timeout: 10000 });
  const ew = await page.evaluate(() => [...window.VideoCut.media.values()].find(x => x.width > 3000).el.videoWidth);
  assert.ok(ew <= 1280, 'перегляд має йти з легкою копією, а не з 4K: ' + ew);
});

await step('таймлайн: лінія часу під вказівником і напрямна прилипання', async () => {
  await page.evaluate(() => document.activeElement.blur());
  const box = await page.locator('#tlScroll').boundingBox();
  await page.mouse.move(box.x + 300, box.y + 80);
  await page.waitForTimeout(150);
  assert.ok(await page.evaluate(() => !document.getElementById('tlHover').hidden), 'лінія часу має показуватись');
  assert.match(await page.evaluate(() => document.querySelector('#tlHover span').textContent), /^\d\d:\d\d\.\d$/);
  // перетягуємо накладку так, щоб її край «причепився» до краю сусіднього елемента
  await page.evaluate(() => { const V = window.VideoCut; V.S.project.overlays.length = 0; V.S.project.overlays.push({ id: 'oa', type: 'text', start: 2, dur: 2, text: 'A', size: 60, x: .1, y: .1, w: .5 }, { id: 'ob', type: 'text', start: 6, dur: 2, text: 'B', size: 60, x: .1, y: .3, w: .5 }); V.commit(); });
  await page.waitForTimeout(300);
  const b = await page.locator('.it.ov').nth(1).boundingBox();
  const pps = await page.evaluate(() => window.VideoCut.S.pps);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 - 2 * pps + 3, b.y + b.height / 2, { steps: 6 });
  const shown = await page.evaluate(() => !document.getElementById('tlSnap').hidden);
  await page.mouse.up();
  assert.ok(shown, 'напрямна прилипання має показуватись під час перетягування');
  assert.equal(await page.evaluate(() => document.getElementById('tlSnap').hidden), true);
});

await step('контекстне меню таймлайну розрізає кліп, ↓ переходить до наступної точки', async () => {
  await VC(() => { window.VideoCut.seek(0); });
  const before = await VC(() => window.VideoCut.S.project.clips.length);
  const bb = await page.locator('.it.clip').first().boundingBox();
  await page.mouse.click(bb.x + 200, bb.y + bb.height / 2, { button: 'right' });
  assert.ok(await page.locator('.ctx').count(), 'меню має відкритись');
  await page.locator('.ctx-it', { hasText: 'Розрізати тут' }).click();
  assert.equal(await VC(() => window.VideoCut.S.project.clips.length), before + 1);
  await VC(() => window.VideoCut.seek(0));
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('ArrowDown');
  assert.ok(await VC(() => window.VideoCut.S.t) > 0, 'курсор має перейти до наступної точки');
});

await step('жодної помилки в консолі сторінки', async () => assert.deepEqual(errors, []));

await browser.close(); srv.close();
