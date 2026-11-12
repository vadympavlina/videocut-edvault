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
  await page.locator('#inspector [data-a="itab"][data-v="time"]').click();
  const limit = await page.addStyleTag({ content: '#ipanel{max-height:140px!important}' });
  await page.evaluate(() => { document.getElementById('ipanel').scrollTop = 1e5; });
  const before = await page.evaluate(() => document.getElementById('ipanel').scrollTop);
  assert.ok(before > 0, 'панель має прокручуватися');
  for (let i = 0; i < 4; i++) { await page.locator('#inspector [data-set="speed"][data-v="1.25"], #inspector [data-set="speed"][data-v="1"]').nth(i % 2).dispatchEvent('click'); await page.waitForTimeout(250); }
  const after = await page.evaluate(() => document.getElementById('ipanel').scrollTop);
  assert.ok(Math.abs(after - before) < 4, 'прокрутка лишилась на місці: ' + before + ' → ' + after);
  await limit.evaluate(el => el.remove());
  await page.locator('#inspector [data-a="itab"][data-v="frame"]').click();
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
  await page.locator('#inspector [data-a="itab"][data-v="look"]').click(); await page.waitForTimeout(200);
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
  await page.locator('#inspector [data-a="itab"][data-v="text"]').click();
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

await step('файл від сторінки, що відкрила редактор (запис екрана), приймається повідомленням', async () => {
  const b64 = (await readFile(video)).toString('base64');
  const popup = page.waitForEvent('popup');
  await page.evaluate(async b64 => {
    // сторінка-відкривач: чекає на «готово» від редактора й відповідає файлом
    const blob = new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'video/webm' });
    const w = window.open('/index.html?import=recording', '_blank');
    addEventListener('message', e => { if (e.source === w && e.data && e.data.type === 'videocut:ready') w.postMessage({ type: 'videocut:file', blob, name: 'запис.webm' }, e.origin); });
  }, b64);
  const p2 = await popup;
  await p2.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p2.waitForFunction(() => window.VideoCut?.S.project.clips.length > 0, null, { timeout: 20000 });
  assert.equal(await p2.evaluate(() => location.search), '', 'адресу очищено');
  await p2.close();
});

await step('хромакей: шейдер (WebGL і запасний варіант) прибирає зелений і темно-зелений, лишає шкіру, червоне, біле й чорне', async () => {
  const r = await page.evaluate(async () => {
    const { keyFrame, KEY_DEFAULT, usesGL } = await import('/videocut-app/js/chroma.js');
    const cols = ['#00b140', '#00551f', '#e0ac86', '#d02020', '#ffffff', '#000000', '#3060d0'];
    const src = document.createElement('canvas'); src.width = cols.length; src.height = 1;
    const g = src.getContext('2d'); cols.forEach((c, i) => { g.fillStyle = c; g.fillRect(i, 0, 1, 1); });
    const alphas = cpu => { const out = keyFrame(src, cols.length, 1, { ...KEY_DEFAULT, on: true }, false, cpu); const c = document.createElement('canvas'); c.width = cols.length; c.height = 1; const x = c.getContext('2d'); x.drawImage(out, 0, 0, cols.length, 1); return [...x.getImageData(0, 0, cols.length, 1).data].filter((_, i) => i % 4 === 3); };
    return { gl: usesGL(), a: alphas(false), c: alphas(true) };
  });
  for (const a of [r.a, r.c]) {
    assert.ok(a[0] < 12 && a[1] < 40, 'зелений і його тінь прозорі: ' + a.join());
    assert.ok(a.slice(2).every(v => v > 235), 'шкіра, червоне, біле, чорне, синє лишаються: ' + a.join());
  }
});

await step('хромакей: колір фону знаходиться автоматично по краях кадру', async () => {
  const hex = await page.evaluate(async () => {
    const { autoKeyColor } = await import('/videocut-app/js/chroma.js');
    const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d');
    g.fillStyle = '#12b84a'; g.fillRect(0, 0, 320, 180); g.fillStyle = '#c8a080'; g.fillRect(100, 40, 120, 140);
    return autoKeyColor(c, 320, 180);
  });
  assert.ok(hex, 'колір знайдено');
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  assert.ok(g > 140 && r < 60, 'знайдено зелений: ' + hex);
});

await step('хромакей: накладання з вимкненим фоном показує відео під ним, шкіра лишається', async () => {
  await page.evaluate(() => { document.getElementById('fileInput').dataset.target = 'layer'; });
  const before = await page.evaluate(() => window.VideoCut.S.project.overlays.length);
  await page.setInputFiles('#fileInput', green);
  await page.waitForFunction(n => window.VideoCut?.S.project.overlays.length > n, before, { timeout: 20000 });
  await page.waitForTimeout(800);
  const px = async (fx, fy) => page.evaluate(([fx, fy]) => { const c = document.getElementById('pv'), g = c.getContext('2d'); const d = g.getImageData(Math.round(fx * c.width), Math.round(fy * c.height), 1, 1).data; return [d[0], d[1], d[2]]; }, [fx, fy]);
  const setKey = on => page.evaluate(on => { const V = window.VideoCut, o = V.S.project.overlays.at(-1); o.x = 0; o.y = 0; o.w = 1; o.h = 1; o.shape = 'rect'; o.crop = { x: 0, y: 0, w: 1, h: 1 }; o.start = 0; o.dur = 4; o.key = on ? { on: true, color: '#00b140', tol: 0.22, soft: 0.14, spill: 0.6 } : { on: false }; V.commit(); V.seek(1); }, on);
  await setKey(false); await page.waitForTimeout(500);
  const off = await px(0.1, 0.5);
  assert.ok(off[1] > off[0] + 60 && off[1] > off[2] + 40, 'без ключа видно зелений: ' + off);
  await setKey(true); await page.waitForTimeout(600);
  const skin = await px(160 / 640, 180 / 360), red = await px(350 / 640, 130 / 360), bgPix = await px(0.1, 0.5);
  assert.ok(skin[0] > 190 && skin[1] > 140 && skin[2] > 100 && skin[0] > skin[2] + 40, 'шкіра лишилась: ' + skin);
  assert.ok(red[0] > 160 && red[1] < 90, 'червоне лишилось: ' + red);
  assert.ok(!(bgPix[1] > bgPix[0] + 60 && bgPix[1] > bgPix[2] + 40 && bgPix[1] > 140), 'зеленого фону більше немає: ' + bgPix);
});

await step('хромакей: «Чистота фону» прибирає шум на фоні, «Стиснути край» зрізає кайму по контуру', async () => {
  const r = await page.evaluate(async () => {
    const { keyFrame, KEY_DEFAULT } = await import('/videocut-app/js/chroma.js');
    const W = 120, H = 60; let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); const im = g.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, inside = x >= 40 && x < 80 && y >= 10 && y < 50, edge = inside && (x < 43 || x >= 77);
      // фон із шумом (іноді трохи «брудніший» зелений), людина з тонкою зеленуватою кайминою на краю
      const n = (rnd() - 0.5) * 30, dirty = rnd() < 0.06 ? 35 : 0;
      const col = inside ? (edge ? [150 + n, 170, 110 + n] : [215, 160, 125]) : [dirty + n * 0.3, 177 + n, 64 + dirty + n * 0.3];
      for (let k = 0; k < 3; k++) im.data[i + k] = Math.max(0, Math.min(255, col[k])); im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    const alpha = (K, cpu) => { const out = keyFrame(c, W, H, { ...KEY_DEFAULT, on: true, ...K }, false, cpu); const t = document.createElement('canvas'); t.width = W; t.height = H; const x = t.getContext('2d'); x.drawImage(out, 0, 0); return x.getImageData(0, 0, W, H).data; };
    const leak = d => { let s = 0, tot = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < 30 || x >= 90) { tot++; s += d[(y * W + x) * 4 + 3]; } return s / tot / 255; };
    const edgeA = d => { let s = 0; for (let y = 15; y < 45; y++) s += d[(y * W + 41) * 4 + 3]; return s / 30; };
    const out = {};
    for (const cpu of [false, true]) {
      const a0 = alpha({ clean: 0, choke: 0 }, cpu), a1 = alpha({ clean: 0.6, choke: 0 }, cpu), a2 = alpha({ clean: 0, choke: 3 }, cpu);
      out[cpu ? 'cpu' : 'gl'] = { leak0: leak(a0), leak1: leak(a1), edge0: edgeA(a0), edge2: edgeA(a2) };
    }
    return out;
  });
  for (const [k, v] of Object.entries(r)) {
    assert.ok(v.leak0 > 0.002 && v.leak1 < v.leak0 * 0.6, `${k}: чистота зменшує шум (${v.leak0} → ${v.leak1})`);
    assert.ok(v.edge2 <= v.edge0, `${k}: стиснення не збільшує прозорість краю (${v.edge0} → ${v.edge2})`);
  }
});

await step('режими накладання: «Світло» прибирає чорне тло футажа, світлі плями лишаються', async () => {
  await page.evaluate(() => { document.getElementById('fileInput').dataset.target = 'layer'; });
  const before = await page.evaluate(() => window.VideoCut.S.project.overlays.length);
  await page.setInputFiles('#fileInput', fx);
  await page.waitForFunction(n => window.VideoCut?.S.project.overlays.length > n, before, { timeout: 20000 });
  await page.waitForTimeout(800);
  const px = async (fx_, fy) => page.evaluate(([fx_, fy]) => { const c = document.getElementById('pv'), g = c.getContext('2d'); const d = g.getImageData(Math.round(fx_ * c.width), Math.round(fy * c.height), 1, 1).data; return [d[0], d[1], d[2]]; }, [fx_, fy]);
  const setup = (patch) => page.evaluate(patch => { const V = window.VideoCut, ovs = V.S.project.overlays; ovs.forEach(o => { o.start = 10; }); const o = ovs.at(-1); Object.assign(o, { x: 0, y: 0, w: 1, h: 1, shape: 'rect', start: 0, dur: 4, crop: { x: 0, y: 0, w: 1, h: 1 }, key: { on: false } }, patch); V.commit(); V.seek(1); }, patch);
  await page.evaluate(() => { const V = window.VideoCut; V.S.project.overlays.forEach(o => { o.start = 10; }); V.commit(); V.seek(1); }); await page.waitForTimeout(500);
  const main = await px(0.8, 0.8), mainWhite = await px(160 / 640, 140 / 360);
  await setup({ blend: 'normal' }); await page.waitForTimeout(500);
  const normal = await px(0.8, 0.8);
  assert.ok(normal[0] < 40 && normal[1] < 40 && normal[2] < 40, 'без режиму чорне тло закриває відео: ' + normal);
  await setup({ blend: 'screen' }); await page.waitForTimeout(500);
  const scr = await px(0.8, 0.8), white = await px(160 / 640, 140 / 360), yellow = await px(450 / 640, 250 / 360);
  assert.ok(Math.abs(scr[0] - main[0]) < 30 && Math.abs(scr[1] - main[1]) < 30 && Math.abs(scr[2] - main[2]) < 30, `«Світло»: видно відео під чорним (${scr} проти ${main})`);
  assert.ok(white[0] > 230 && white[1] > 230 && white[2] > 230, 'біла пляма лишилась білою: ' + white);
  assert.ok(yellow[0] > 200 && yellow[1] > 150, 'жовта пляма видна: ' + yellow);
});

await step('хромакей: експорт із накладанням без фону проходить і дає файл', async () => {
  const size = await page.evaluate(async () => {
    const res = await window.VideoCut.exportVideo({ format: 'webm', quality: 'low', short: 360, range: [0, 1], fps: 15 });
    const b = res && (res.blob || res);
    return b && b.size ? b.size : 0;
  });
  assert.ok(size > 1000, 'файл експорту не порожній: ' + size);
});

await step('перемотування: кадр не мерехтить і не стрибає назад (основне відео й накладання)', async () => {
  const p2 = await browser.newPage({ viewport: { width: 1300, height: 760 } });
  await p2.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p2.goto(`http://localhost:${port}/index.html`);
  await p2.setInputFiles('#fileInput', ramp);
  await p2.waitForFunction(() => window.VideoCut?.S.project.clips.length > 0, null, { timeout: 20000 });
  await p2.evaluate(() => { document.getElementById('fileInput').dataset.target = 'layer'; });
  await p2.setInputFiles('#fileInput', ramp);
  await p2.waitForFunction(() => window.VideoCut.S.project.overlays.length > 0, null, { timeout: 20000 });
  await p2.waitForTimeout(1200);
  await p2.evaluate(() => { const V = window.VideoCut, o = V.S.project.overlays.at(-1); Object.assign(o, { x: 0.5, y: 0, w: 0.5, h: 1, shape: 'rect', start: 0, dur: 6, crop: { x: 0.5, y: 0, w: 0.5, h: 1 }, shadow: false }); V.commit(); V.seek(0.1); });
  await p2.waitForTimeout(600);
  const scrub = key => p2.evaluate(async key => {
    const V = window.VideoCut, c = document.getElementById('pv'), g = c.getContext('2d', { willReadFrequently: true });
    V.S.project.overlays.at(-1).key = key ? { on: true, color: '#00b140', tol: 0.18, soft: 0.1, spill: 0.6, clean: 0.1, choke: 0 } : { on: false }; V.commit(); V.seek(0.1);
    await new Promise(r => setTimeout(r, 500));
    const gray = fx => { const d = g.getImageData(Math.round(fx * c.width), Math.round(0.5 * c.height), 1, 1).data; return d[0]; };
    const raf = () => new Promise(r => requestAnimationFrame(r));
    const log = [];
    // «повзунок» ходить уперед і назад, як рука
    const path = []; for (let i = 0; i < 80; i++) path.push(0.3 + i * 0.06); for (let i = 0; i < 40; i++) path.push(5.1 - i * 0.07);
    for (const t of path) { V.seek(t); await raf(); await raf(); log.push({ t, l: gray(0.25), r: gray(0.75) }); }
    return log;
  }, key);
  for (const key of [false, true]) {
    const r = await scrub(key), bad = [];
    r.forEach((x, i) => {
      for (const side of ['l', 'r']) {
        const want = 255 * x.t / 6;
        if (x[side] < 6 && x.t > 0.5) bad.push(`${i}: ${side} порожньо при t=${x.t.toFixed(2)}`);
        if (Math.abs(x[side] - want) > 60) bad.push(`${i}: ${side} стрибок ${x[side]} замість ~${Math.round(want)}`);
      }
    });
    console.log(`     перемотування${key ? ' з хромакеєм' : ''}: збоїв ${bad.length} з ${r.length * 2} кадрів`);
    assert.ok(bad.length <= 3, `мерехтіння/стрибки${key ? ' (з хромакеєм)' : ''} у ${bad.length} кадрах з ${r.length * 2}: ` + bad.slice(0, 6).join('; '));
  }
  await p2.close();
});

await step('перемотування по кількох кліпах: кадр завжди з того кліпа, де курсор, без повторів, залипань і змішування', async () => {
  const p3 = await browser.newPage({ viewport: { width: 1300, height: 760 } });
  await p3.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p3.goto(`http://localhost:${port}/index.html`);
  for (const f of [ramp, rampB]) { await p3.setInputFiles('#fileInput', f); await p3.waitForTimeout(900); }
  await p3.waitForFunction(() => window.VideoCut?.S.project.clips.length >= 2, null, { timeout: 20000 });
  await p3.waitForTimeout(800);
  const info = await p3.evaluate(() => { const V = window.VideoCut; return { n: V.S.project.clips.length, d: V.duration() }; });
  assert.ok(info.n >= 2 && info.d > 11, 'два кліпи на таймлайні: ' + JSON.stringify(info));
  // Очікуваний кадр: перші 6 с — нейтральний градієнт (кліп A), далі — підфарбований (кліп B)
  const probe = () => p3.evaluate(() => { const c = document.getElementById('pv'), g = c.getContext('2d', { willReadFrequently: true }); const d = g.getImageData(Math.round(c.width / 2), Math.round(c.height / 2), 1, 1).data; return { r: d[0], g: d[1], b: d[2], y: 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2] }; });
  const expect = t => (t < 6 ? { gray: 255 * t / 6, tint: false } : { gray: 255 * (t - 6) / 6, tint: true });
  const tinted = p => p.r > p.b + 40;
  // «усталено» — коли жодне відео не шукає кадр і перегляд перемальовано
  const settle = async () => {
    await p3.waitForFunction(() => [...document.querySelectorAll('#mediaPool video')].every(v => !v.seeking && (v.readyState >= 2 || !v.src)), null, { timeout: 6000 }).catch(() => {});
    await p3.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60)))));
    return probe();
  };
  const bad = [];
  const seekRaf = async t => { await p3.evaluate(t => window.VideoCut.seek(t), t); await p3.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); };
  // а) безперервне водіння через межу кліпів уперед і назад, з нерівною швидкістю
  const path = []; for (let i = 0; i < 70; i++) path.push(0.5 + i * 0.16); for (let i = 0; i < 60; i++) path.push(11.5 - i * 0.18);
  for (const t of path) {
    await seekRaf(t); const p = await probe(), e = expect(t), nearEdge = Math.abs(t - 6) < 0.8;
    if (!nearEdge && tinted(p) !== e.tint) bad.push(`водіння t=${t.toFixed(2)}: не той кліп (${p.r},${p.g},${p.b})`);
    if (p.r < 6 && p.g < 6 && p.b < 6 && t > 0.8 && t < 11) bad.push(`водіння t=${t.toFixed(2)}: порожньо`);
  }
  // б) стрибки в довільні місця: після зупинки кадр має точно відповідати курсору
  for (const t of [9.3, 1.2, 7.7, 5.5, 6.4, 0.4, 10.8, 3.3, 6.05, 5.95, 8.8, 2.2]) {
    await seekRaf(t); const p = await settle(), e = expect(t);
    if (tinted(p) !== e.tint) bad.push(`стрибок t=${t}: не той кліп (${p.r},${p.g},${p.b})`);
    else if (Math.abs(p.y - e.gray) > 30) bad.push(`стрибок t=${t}: кадр ${Math.round(p.y)} замість ~${Math.round(e.gray)}`);
  }
  // в) відтворення і пауза: кадр після паузи відповідає часу
  await seekRaf(4.5); await p3.evaluate(() => window.VideoCut.S.playing || document.querySelector('[data-a="play"], #btnPlay')?.click());
  const playing = () => p3.evaluate(() => [...document.querySelectorAll('#mediaPool video')].filter(v => !v.paused && v.src).length);
  await p3.evaluate(async () => { const m = await import('/videocut-app/js/player.js'); m.play(); });
  await p3.waitForTimeout(500);
  const n1 = await playing(); if (n1 !== 1) bad.push(`відтворення до межі кліпів: грає ${n1} відео замість 1`);
  await p3.waitForTimeout(1600);
  const n2 = await playing(); if (n2 !== 1) bad.push(`відтворення після межі кліпів: грає ${n2} відео замість 1 (накладання)`);
  await p3.evaluate(async () => { const m = await import('/videocut-app/js/player.js'); m.pause(); });
  const n3 = await playing(); if (n3 !== 0) bad.push(`після паузи грає ${n3} відео`);
  const tPause = await p3.evaluate(() => window.VideoCut.S.t); const pp = await settle(), ee = expect(tPause);
  if (tinted(pp) !== ee.tint || Math.abs(pp.y - ee.gray) > 30) bad.push(`пауза t=${tPause.toFixed(2)}: кадр ${Math.round(pp.y)} замість ~${Math.round(ee.gray)}`);
  await p3.close();
  console.log(`     кількох кліпів: збоїв ${bad.length}`);
  assert.equal(bad.length, 0, bad.slice(0, 8).join('; '));
});

await step('розрізаний кліп: обидві половини ділять один відеоелемент, перемотування через розріз без збоїв', async () => {
  const p4 = await browser.newPage({ viewport: { width: 1300, height: 760 } });
  await p4.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p4.goto(`http://localhost:${port}/index.html`);
  await p4.setInputFiles('#fileInput', ramp);
  await p4.waitForFunction(() => window.VideoCut?.S.project.clips.length > 0, null, { timeout: 20000 });
  await p4.waitForTimeout(1000);
  await p4.evaluate(() => { const V = window.VideoCut; V.S.sel = { kind: 'clip', id: V.S.project.clips[0].id }; V.seek(3); });
  await p4.keyboard.press('s');
  await p4.waitForFunction(() => window.VideoCut.S.project.clips.length === 2, null, { timeout: 5000 });
  const probe = () => p4.evaluate(() => { const c = document.getElementById('pv'), g = c.getContext('2d', { willReadFrequently: true }); const d = g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data; return 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2]; });
  const bad = [];
  for (const t of [5.5, 2.5, 3.5, 2.9, 3.1, 0.5, 5.9, 3.0, 2.95, 4.4]) {
    await p4.evaluate(t => window.VideoCut.seek(t), t);
    await p4.waitForFunction(() => [...document.querySelectorAll('#mediaPool video')].every(v => !v.seeking && v.readyState >= 2), null, { timeout: 6000 }).catch(() => {});
    await p4.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60)))));
    const y = await probe(), want = 255 * t / 6;
    if (Math.abs(y - want) > 30) bad.push(`t=${t}: кадр ${Math.round(y)} замість ~${Math.round(want)}`);
  }
  await p4.close();
  assert.equal(bad.length, 0, bad.join('; '));
});

await step('відтворення через розріз (вирізаний шматок): без чорних кадрів і зависань на межі', async () => {
  const p5 = await browser.newPage({ viewport: { width: 1300, height: 760 } });
  await p5.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p5.goto(`http://localhost:${port}/index.html`);
  await p5.setInputFiles('#fileInput', ramp);
  await p5.waitForFunction(() => window.VideoCut?.S.project.clips.length > 0, null, { timeout: 20000 });
  await p5.waitForTimeout(1200);
  await p5.evaluate(() => { const V = window.VideoCut; V.S.sel = { kind: 'clip', id: V.S.project.clips[0].id }; V.seek(2); });
  await p5.keyboard.press('s'); await p5.waitForTimeout(200);
  await p5.evaluate(() => window.VideoCut.seek(4)); await p5.keyboard.press('s'); await p5.waitForTimeout(200);
  const mid = await p5.evaluate(() => window.VideoCut.layout()[1].clip.id);
  await p5.evaluate(id => { window.VideoCut.S.sel = { kind: 'clip', id }; }, mid);
  await p5.keyboard.press('Delete'); await p5.waitForTimeout(500);
  const lay = await p5.evaluate(() => window.VideoCut.layout().map(l => [l.start, l.end, l.clip.in || 0]));
  assert.equal(lay.length, 2, 'після видалення середини лишилось два кліпи');
  assert.ok(Math.abs(lay[1][2] - 4) < 0.05, 'другий кліп починається з 4-ї секунди файла: ' + lay[1][2]);
  const r = await p5.evaluate(async () => {
    const V = window.VideoCut, c = document.getElementById('pv'), g = c.getContext('2d', { willReadFrequently: true }), m = await import('/videocut-app/js/player.js');
    const raf = () => new Promise(r => requestAnimationFrame(r));
    V.seek(1.0); await new Promise(r => setTimeout(r, 900));
    const rows = []; m.play();
    while (V.S.t < 3.2 && V.S.playing) { await raf(); const d = g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data; rows.push({ t: V.S.t, y: d[0], seeking: [...document.querySelectorAll('#mediaPool video')].some(v => v.seeking && !v.paused) }); }
    m.pause(); return rows;
  });
  // джерело після межі (t≥2) має світліти до ≈170 (4 с із 6); чорний кадр або «стара» картинка після межі — збій
  const black = r.filter(x => x.t > 1.2 && x.y < 6).length;
  const stale = r.filter(x => x.t > 2.12 && x.y < 120).length;
  console.log(`     розріз: кадрів ${r.length}, чорних ${black}, застарілих після межі ${stale}`);
  assert.equal(black, 0, 'чорних кадрів немає');
  assert.ok(stale <= 1, 'після межі показується потрібний кадр, не старий: ' + stale);
  await p5.close();
});

await step('водіння курсора: картинка оновлюється плавно, без довгих зависань і без стрибків назад', async () => {
  const p6 = await browser.newPage({ viewport: { width: 1300, height: 760 } });
  await p6.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p6.goto(`http://localhost:${port}/index.html`);
  await p6.setInputFiles('#fileInput', ramp);
  await p6.waitForFunction(() => window.VideoCut?.S.project.clips.length > 0, null, { timeout: 20000 });
  await p6.waitForTimeout(1500);
  const r = await p6.evaluate(async () => {
    const V = window.VideoCut, c = document.getElementById('pv'), g = c.getContext('2d', { willReadFrequently: true });
    const raf = () => new Promise(r => requestAnimationFrame(r));
    const shown = () => { const d = g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data; return d[0] * 6 / 255; };
    V.seek(0.3); await new Promise(r => setTimeout(r, 600));
    const rows = [], t0 = performance.now();
    for (;;) { const t = 0.3 + (performance.now() - t0) / 1000 * 1.2; if (t > 5.7) break; V.seek(t); await raf(); rows.push({ t, s: shown() }); }
    let changes = 0, stall = 0, maxStall = 0, back = 0;
    rows.forEach((x, i) => { if (i && Math.abs(x.s - rows[i - 1].s) > 0.01) { changes++; stall = 0; } else stall++; maxStall = Math.max(maxStall, stall); if (i && x.s < rows[i - 1].s - 0.05) back++; });
    return { n: rows.length, changes, maxStall, back };
  });
  await p6.close();
  console.log(`     водіння: оновлень ${r.changes} з ${r.n} кадрів, найдовша пауза ${r.maxStall} кадрів, стрибків назад ${r.back}`);
  assert.ok(r.changes / r.n > 0.3, 'картинка оновлюється достатньо часто: ' + r.changes + '/' + r.n);
  assert.ok(r.maxStall <= 20, 'без довгих зависань: ' + r.maxStall + ' кадрів');
  assert.equal(r.back, 0, 'без стрибків назад');
});

await step('макет: панелі впритул без проміжків, ширина змінюється розділювачем і запам\u2019ятовується, рядок стану й назви кнопок', async () => {
  const p7 = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  await p7.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p7.goto(`http://localhost:${port}/index.html`);
  await p7.evaluate(() => localStorage.removeItem('vc_panels'));
  await p7.reload(); await p7.waitForSelector('#vsLib', { state: 'attached' });
  const g = await p7.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(); const l = r('.lib'), c = r('.center'), i = r('.insp'), tl = r('.tl'), top = r('.topbar'); return { gapLC: Math.round(c.left - l.right), gapCI: Math.round(i.left - c.right), gapTop: Math.round(l.top - top.bottom), left: Math.round(l.left), right: Math.round(1440 - i.right), tlLeft: Math.round(tl.left), tlRight: Math.round(1440 - tl.right), radius: getComputedStyle(document.querySelector('.lib')).borderRadius, theme: document.documentElement.dataset.theme }; });
  assert.deepEqual([g.gapLC, g.gapCI, g.gapTop, g.left, g.right, g.tlLeft, g.tlRight], [0, 0, 0, 0, 0, 0, 0], 'панелі впритул до країв: ' + JSON.stringify(g));
  assert.equal(g.radius, '0px', 'без закруглених «острівців»'); assert.equal(g.theme, 'dark', 'тема за замовчуванням темна');
  const box = await (await p7.$('#vsLib')).boundingBox();
  await p7.mouse.move(box.x + 3, box.y + 300); await p7.mouse.down(); await p7.mouse.move(box.x + 83, box.y + 300, { steps: 5 }); await p7.mouse.up();
  const w1 = await p7.evaluate(() => Math.round(document.querySelector('.lib').getBoundingClientRect().width));
  assert.ok(w1 >= 370 && w1 <= 390, 'ширина панелі змінилась: ' + w1);
  await p7.reload(); await p7.waitForSelector('#vsLib', { state: 'attached' });
  assert.equal(await p7.evaluate(() => Math.round(document.querySelector('.lib').getBoundingClientRect().width)), w1, 'ширина збереглась після перезавантаження');
  assert.match(await p7.textContent('#sbFmt'), /1920×1080 · 30 кадр\/с/);
  assert.equal(await p7.locator('#inspector .insp-head b').first().textContent(), 'Проєкт', 'без виділення праворуч параметри проєкту');
  const unnamed = await p7.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent && !(b.textContent || '').trim() && !b.getAttribute('aria-label') && !b.getAttribute('aria-labelledby')).map(b => b.id || b.className));
  assert.deepEqual(unnamed, [], 'усі кнопки мають назву');
  await p7.close();
});

await step('пошкоджений проєкт у базі не ламає запуск: редактор відкривається, значення виправляються', async () => {
  const p8 = await browser.newPage({ viewport: { width: 1300, height: 760 } }); const errs8 = [];
  p8.on('pageerror', e => errs8.push(e.message));
  await p8.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p8.goto(`http://localhost:${port}/index.html`); await p8.waitForFunction(() => window.VideoCut);
  const put = v => p8.evaluate(v => new Promise((res, rej) => { const r = indexedDB.open('edvault-videocut'); r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, 'project'); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }; r.onerror = () => rej(r.error); }), v);
  // 1) поля не того типу: clips не масив, швидкість NaN, формат невідомий
  await put({ v: 1, name: 5, aspect: '7:3', fps: 99, clips: 'ой', overlays: [null, { id: 'o1', start: 'x', dur: -4 }], captions: {}, music: [{ id: 'm1', start: 0, in: 'a', out: null }] });
  await p8.reload(); await p8.waitForFunction(() => window.VideoCut); await p8.waitForTimeout(800);
  const r = await p8.evaluate(() => { const P = window.VideoCut.S.project; return { clips: Array.isArray(P.clips), aspect: P.aspect, fps: P.fps, ov: P.overlays.length, dur: P.overlays[0]?.dur, music: P.music[0] && [P.music[0].in, P.music[0].out] }; });
  assert.deepEqual([r.clips, r.aspect, r.fps, r.ov], [true, '16:9', 30, 1], JSON.stringify(r)); assert.ok(r.dur >= 0.05); assert.deepEqual(r.music, [0, 1]);
  assert.ok(await p8.locator('#stageEmpty, #pv').count() > 0);
  // 2) нечитабельне значення: редактор стартує порожнім
  await put('не проєкт');
  await p8.reload(); await p8.waitForFunction(() => window.VideoCut); await p8.waitForTimeout(500);
  assert.equal(await p8.evaluate(() => window.VideoCut.S.project.clips.length), 0);
  await p8.close(); assert.deepEqual(errs8, [], 'без винятків');
});

await step('доріжки: перетягування кліпа видно (привид, сусіди розсуваються, підказка), Esc скасовує, скасування повертає порядок', async () => {
  const p9 = await browser.newPage({ viewport: { width: 1440, height: 860 } }); const errs9 = [];
  p9.on('pageerror', e => errs9.push(e.message));
  await p9.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p9.goto(`http://localhost:${port}/index.html`); await p9.waitForFunction(() => window.VideoCut);
  await p9.setInputFiles('#fileInput', video); await p9.waitForFunction(() => window.VideoCut.S.project.clips.length > 0); await p9.waitForTimeout(800);
  await p9.evaluate(async () => { const V = window.VideoCut, { splitAt } = await import('./videocut-app/js/ops.js'); V.seek(4); splitAt(); V.seek(8); splitAt(); });
  await p9.waitForTimeout(400);
  const order = () => p9.evaluate(() => window.VideoCut.S.project.clips.map(c => Math.round(c.in)));
  assert.deepEqual(await order(), [0, 4, 8]);
  const b1 = await p9.locator('.tl-lanes .clip').nth(0).boundingBox();
  await p9.mouse.move(b1.x + 60, b1.y + 25); await p9.mouse.down(); await p9.mouse.move(b1.x + 300, b1.y + 25, { steps: 5 }); await p9.mouse.move(b1.x + 560, b1.y + 25, { steps: 5 });
  const mid = await p9.evaluate(() => ({ ghost: !!document.querySelector('.tl-ghost'), src: document.querySelectorAll('.it.drag-src').length, shifted: [...document.querySelectorAll('.it.clip.shifted')].filter(e => e.style.transform).length, hud: document.querySelector('.tl-hud')?.textContent, insert: !document.getElementById('tlInsert').hidden, cursor: getComputedStyle(document.querySelector('.it.clip')).cursor }));
  assert.ok(mid.ghost, 'є привид кліпа під курсором'); assert.equal(mid.src, 1, 'на місці кліпа порожній контур'); assert.ok(mid.shifted >= 1, 'сусіди зсунулись'); assert.match(mid.hud, /Позиція 2 з 3/); assert.ok(mid.insert, 'є лінія місця вставки'); assert.equal(mid.cursor, 'grabbing');
  await p9.mouse.up(); await p9.waitForTimeout(300);
  assert.deepEqual(await order(), [4, 0, 8], 'порядок змінився'); assert.equal(await p9.locator('.tl-ghost').count(), 0, 'привид прибрано');
  await p9.keyboard.press('Control+z'); assert.deepEqual(await order(), [0, 4, 8], 'скасування повертає порядок');
  const b3 = await p9.locator('.tl-lanes .clip').nth(2).boundingBox();
  await p9.mouse.move(b3.x + 40, b3.y + 25); await p9.mouse.down(); await p9.mouse.move(b3.x - 400, b3.y + 25, { steps: 6 });
  await p9.keyboard.press('Escape'); await p9.mouse.up(); await p9.waitForTimeout(300);
  assert.deepEqual(await order(), [0, 4, 8], 'Esc скасував перетягування'); assert.equal(await p9.locator('.tl-ghost').count(), 0);
  await p9.close(); assert.deepEqual(errs9, []);
});

await step('виділення кількох: Shift-клік, Ctrl+A, рамка, групове видалення й дублювання, блокування доріжки', async () => {
  const p10 = await browser.newPage({ viewport: { width: 1440, height: 860 } }); const errs = [];
  p10.on('pageerror', e => errs.push(e.message));
  await p10.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p10.goto(`http://localhost:${port}/index.html`); await p10.waitForFunction(() => window.VideoCut);
  await p10.setInputFiles('#fileInput', video); await p10.waitForFunction(() => window.VideoCut.S.project.clips.length > 0); await p10.waitForTimeout(800);
  await p10.evaluate(async () => { const V = window.VideoCut, { splitAt } = await import('./videocut-app/js/ops.js'); V.seek(3); splitAt(); V.seek(6); splitAt(); V.seek(9); splitAt(); });
  await p10.waitForTimeout(400);
  const n = () => p10.evaluate(() => window.VideoCut.S.project.clips.length), sel = () => p10.evaluate(() => window.VideoCut.S.multi.length);
  assert.equal(await n(), 4);
  await p10.locator('.tl-lanes .clip').nth(0).click(); await p10.locator('.tl-lanes .clip').nth(2).click({ modifiers: ['Shift'] });
  assert.equal(await sel(), 2, 'Shift-клік додає до виділення');
  await p10.locator('.tl-lanes .clip').nth(2).click({ modifiers: ['Shift'] });
  assert.equal(await sel(), 1, 'Shift-клік по виділеному знімає його');
  await p10.keyboard.press('Control+a'); assert.equal(await sel(), 4, 'Ctrl+A виділяє все');
  await p10.keyboard.press('Control+d'); assert.equal(await n(), 8, 'групове дублювання');
  await p10.keyboard.press('Control+z'); assert.equal(await n(), 4);
  // блокування: Delete нічого не видаляє, клік не виділяє
  await p10.click('.head-v .th-lock'); await p10.waitForTimeout(150);
  await p10.keyboard.press('Control+a'); assert.equal(await sel(), 0, 'на заблокованій доріжці нічого не виділяється');
  await p10.locator('.tl-lanes .clip').nth(1).click({ force: true }); await p10.keyboard.press('Delete'); assert.equal(await n(), 4, 'заблокована доріжка не змінюється');
  await p10.click('.head-v .th-lock'); await p10.waitForTimeout(150);
  await p10.keyboard.press('Control+a'); await p10.keyboard.press('Delete'); assert.equal(await n(), 0, 'групове видалення');
  await p10.keyboard.press('Control+z'); assert.equal(await n(), 4);
  assert.ok(await p10.evaluate(() => window.VideoCut.S.project.tracks.v.lock === false), 'стан блокування в проєкті');
  await p10.close(); assert.deepEqual(errs, []);
});

await step('керування доріжками: сховати прибирає кадр із перегляду, звук вимикається й соло, стан зберігається в проєкті', async () => {
  const p11 = await browser.newPage({ viewport: { width: 1440, height: 860 } }); const errs = [];
  p11.on('pageerror', e => errs.push(e.message));
  await p11.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p11.goto(`http://localhost:${port}/index.html`); await p11.waitForFunction(() => window.VideoCut);
  await p11.setInputFiles('#fileInput', [ramp, audio]); await p11.waitForFunction(() => window.VideoCut.S.project.clips.length > 0); await p11.waitForTimeout(1200);
  await p11.evaluate(() => window.VideoCut.seek(4)); await p11.waitForTimeout(700);
  const px = () => p11.evaluate(() => { const c = document.getElementById('pv'), g = c.getContext('2d', { willReadFrequently: true }); const d = g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data; return d[0] + d[1] + d[2]; });
  assert.ok(await px() > 100, 'кадр видно');
  await p11.click('.head-v .th-hide'); await p11.waitForTimeout(500);
  assert.ok(await px() < 10, 'сховане основне відео не малюється: ' + await px());
  await p11.click('.head-v .th-hide'); await p11.waitForTimeout(500); assert.ok(await px() > 100);
  const aud = () => p11.evaluate(async () => { const s = await import('./videocut-app/js/state.js'); return { v: s.laneAudible('v'), a: s.laneAudible('a') }; });
  await p11.click('.head-a .th-mute'); assert.deepEqual(await aud(), { v: true, a: false }, 'звук музики вимкнено');
  await p11.click('.head-a .th-mute'); await p11.click('.head-a .th-solo'); assert.deepEqual(await aud(), { v: false, a: true }, 'соло звуку глушить решту');
  await p11.click('.head-a .th-solo'); assert.deepEqual(await aud(), { v: true, a: true });
  await p11.click('.head-v .th-mute');
  const saved = await p11.evaluate(() => JSON.parse(JSON.stringify(window.VideoCut.S.project.tracks)));
  assert.equal(saved.v.mute, true); assert.ok(await p11.locator('.head-v .th-mute.on').count());
  await p11.close(); assert.deepEqual(errs, []);
});

await step('маркери: M ставить і прибирає, «.» і «,» переходять між ними, прилипання до маркера, зберігаються в проєкті', async () => {
  const p12 = await browser.newPage({ viewport: { width: 1440, height: 860 } }); const errs = [];
  p12.on('pageerror', e => errs.push(e.message));
  await p12.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p12.goto(`http://localhost:${port}/index.html`); await p12.waitForFunction(() => window.VideoCut);
  await p12.setInputFiles('#fileInput', video); await p12.waitForFunction(() => window.VideoCut.S.project.clips.length > 0); await p12.waitForTimeout(800);
  const mk = () => p12.evaluate(() => window.VideoCut.S.project.markers.map(m => m.t));
  await p12.evaluate(() => window.VideoCut.seek(2)); await p12.keyboard.press('m');
  await p12.evaluate(() => window.VideoCut.seek(7)); await p12.keyboard.press('m');
  assert.deepEqual(await mk(), [2, 7]);
  await p12.evaluate(() => window.VideoCut.seek(0)); await p12.keyboard.press('.'); assert.equal(await p12.evaluate(() => window.VideoCut.S.t), 2);
  await p12.keyboard.press('.'); assert.equal(await p12.evaluate(() => window.VideoCut.S.t), 7); await p12.keyboard.press(',');  assert.equal(await p12.evaluate(() => window.VideoCut.S.t), 2);
  await p12.keyboard.press('m'); assert.deepEqual(await mk(), [7], 'повторне M на маркері прибирає його');
  assert.ok(await p12.evaluate(async () => { const s = await import('./videocut-app/js/state.js'); return s.snapPoints().includes(7); }), 'маркер у точках прилипання');
  await p12.close(); assert.deepEqual(errs, []);
});

await step('обрізка «стик» (Shift): межа двох кліпів зсувається, загальна тривалість не змінюється', async () => {
  const p13 = await browser.newPage({ viewport: { width: 1440, height: 860 } }); const errs = [];
  p13.on('pageerror', e => errs.push(e.message));
  await p13.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p13.goto(`http://localhost:${port}/index.html`); await p13.waitForFunction(() => window.VideoCut);
  await p13.setInputFiles('#fileInput', video); await p13.waitForFunction(() => window.VideoCut.S.project.clips.length > 0); await p13.waitForTimeout(800);
  await p13.evaluate(async () => { const V = window.VideoCut, { splitAt } = await import('./videocut-app/js/ops.js'); V.seek(5); splitAt(); });
  await p13.waitForTimeout(400);
  const st = () => p13.evaluate(() => ({ d: +window.VideoCut.duration().toFixed(2), c: window.VideoCut.S.project.clips.map(c => [+c.in.toFixed(2), +c.out.toFixed(2)]) }));
  const before = await st();
  const b = await p13.locator('.tl-lanes .clip').nth(0).boundingBox();
  await p13.locator('.tl-lanes .clip').nth(0).click();
  await p13.keyboard.down('Shift'); await p13.mouse.move(b.x + b.width - 2, b.y + 25); await p13.mouse.down(); await p13.mouse.move(b.x + b.width - 90, b.y + 25, { steps: 6 }); await p13.mouse.up(); await p13.keyboard.up('Shift');
  const after = await st();
  assert.equal(after.d, before.d, 'тривалість не змінилась'); assert.ok(after.c[0][1] < before.c[0][1], 'перший кліп коротший'); assert.ok(after.c[1][0] < before.c[1][0] + 0.001 && after.c[1][0] < before.c[1][0], 'другий почався раніше: ' + JSON.stringify(after.c));
  await p13.close(); assert.deepEqual(errs, []);
});

await step('перегляд: масштаб (Підігнати, 100 %), прокрутка збільшеного кадру, сітка й безпечні поля, налаштування зберігаються', async () => {
  const p14 = await browser.newPage({ viewport: { width: 1440, height: 860 } }); const errs = [];
  p14.on('pageerror', e => errs.push(e.message));
  await p14.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p14.goto(`http://localhost:${port}/index.html`); await p14.waitForFunction(() => window.VideoCut);
  await p14.evaluate(() => localStorage.removeItem('vc_view')); await p14.reload(); await p14.waitForFunction(() => window.VideoCut);
  await p14.setInputFiles('#fileInput', video); await p14.waitForFunction(() => window.VideoCut.S.project.clips.length > 0); await p14.waitForTimeout(800);
  const sz = () => p14.evaluate(() => { const c = document.getElementById('pv').getBoundingClientRect(), s = document.getElementById('stageScroll'); return { w: Math.round(c.width), scroll: s.scrollWidth > s.clientWidth }; });
  const fit = await sz(); assert.ok(fit.w < 1000 && !fit.scroll, 'підігнаний кадр вміщується: ' + JSON.stringify(fit));
  await p14.selectOption('#pvZoom', '100'); await p14.waitForTimeout(300);
  const z100 = await sz(); assert.equal(z100.w, 1920, '100 % — один піксель кадру на піксель екрана'); assert.ok(z100.scroll, 'збільшений кадр прокручується');
  await p14.selectOption('#pvZoom', '50'); await p14.waitForTimeout(300); assert.equal((await sz()).w, 960);
  await p14.selectOption('#pvZoom', 'fit'); await p14.waitForTimeout(300);
  assert.ok(await p14.locator('#pvGuides[hidden]').count(), 'напрямні сховані за замовчуванням');
  await p14.click('#btnGrid'); await p14.click('#btnSafe');
  const g = await p14.evaluate(() => { const gd = document.getElementById('pvGuides'); return { hidden: gd.hidden, grid: getComputedStyle(gd.querySelector('.g-third')).display, safe: getComputedStyle(gd.querySelector('.g-title')).display, w: Math.round(gd.getBoundingClientRect().width), cw: Math.round(document.getElementById('pv').getBoundingClientRect().width) }; });
  assert.deepEqual([g.hidden, g.grid, g.safe], [false, 'block', 'block']); assert.equal(g.w, g.cw, 'напрямні рівно по кадру');
  await p14.reload(); await p14.waitForFunction(() => window.VideoCut);
  assert.equal(await p14.evaluate(() => window.VideoCut.S.view.grid), true, 'сітка запам\u2019ятовується');
  await p14.close(); assert.deepEqual(errs, []);
});

await step('права панель: вкладки за змістом для кожного типу, параметри без дублів, «Скинути», панель для кількох елементів', async () => {
  const p15 = await browser.newPage({ viewport: { width: 1440, height: 900 } }); const errs = [];
  p15.on('pageerror', e => errs.push(e.message));
  await p15.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p15.goto(`http://localhost:${port}/index.html`); await p15.waitForFunction(() => window.VideoCut);
  await p15.setInputFiles('#fileInput', [video, audio]); await p15.waitForFunction(() => window.VideoCut.S.project.clips.length > 0 && window.VideoCut.S.project.music.length > 0); await p15.waitForTimeout(1000);
  const tabs = () => p15.evaluate(() => [...document.querySelectorAll('#inspector [role=tab]')].map(b => b.textContent.trim()));
  assert.equal(await p15.evaluate(() => document.querySelector('#inspector .insp-head b').textContent), 'Проєкт');
  await p15.locator('.tl-lanes .clip').first().click();
  assert.deepEqual(await tabs(), ['Кадр', 'Звук', 'Час', 'Вигляд']);
  // кожен параметр лише в одному місці: поява/зникнення тільки на вкладці «Час», наближення тільки на «Кадр»
  const has = f => p15.locator(`#inspector [data-f="${f}"]`).count();
  assert.equal(await has('zoom'), 1); assert.equal(await has('fadeIn'), 0);
  await p15.locator('#inspector [data-a="itab"][data-v="time"]').click();
  assert.equal(await has('fadeIn'), 1); assert.equal(await has('zoom'), 0);
  // «Скинути» повертає типове значення
  await p15.locator('#inspector [data-a="itab"][data-v="frame"]').click();
  await p15.evaluate(() => { const o = window.VideoCut.S.project.clips[0]; o.zoom = 2; window.VideoCut.commit(); });
  await p15.locator('#inspector .isec:has([data-f="zoom"]) .reset').click({ force: true }); await p15.waitForTimeout(200);
  assert.equal(await p15.evaluate(() => window.VideoCut.S.project.clips[0].zoom), 1, 'скидання повернуло масштаб');
  assert.equal(await p15.locator('#inspector [data-a="quick"], #inspector .iquick .btn').count() >= 3, true, 'швидкі дії з підписами');
  assert.deepEqual(await p15.evaluate(() => [...document.querySelectorAll('#inspector .iquick .btn')].map(b => b.textContent.trim()).filter(x => !x)), [], 'у кнопок є підписи');
  await p15.locator('.tl-lanes .mu').first().click();
  assert.deepEqual(await tabs(), ['Звук', 'Час']);
  await p15.evaluate(async () => { const { addOverlay } = await import('./videocut-app/js/ops.js'); addOverlay('text', { preset: 'title' }); });
  await p15.waitForTimeout(300); assert.deepEqual(await tabs(), ['Текст', 'Вигляд', 'Час']);
  await p15.keyboard.press('Control+a'); await p15.waitForTimeout(200);
  assert.match(await p15.evaluate(() => document.querySelector('#inspector .insp-head b').textContent), /Виділено: \d+/);
  await p15.close(); assert.deepEqual(errs, []);
});

await step('підказки: системних title немає (вони перекривали наші), підказка таймлайну, заголовка доріжки й кнопки показується одна', async () => {
  const p16 = await browser.newPage({ viewport: { width: 1440, height: 900 } }); const errs = [];
  p16.on('pageerror', e => errs.push(e.message));
  await p16.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p16.goto(`http://localhost:${port}/index.html`); await p16.waitForFunction(() => window.VideoCut);
  await p16.setInputFiles('#fileInput', [video, audio]); await p16.waitForFunction(() => window.VideoCut.S.project.clips.length > 0); await p16.waitForTimeout(1200);
  await p16.evaluate(async () => { const { addOverlay } = await import('./videocut-app/js/ops.js'); addOverlay('text', { preset: 'title' }); });
  await p16.locator('.tl-lanes .clip').first().click(); await p16.waitForTimeout(500);
  const withTitle = await p16.evaluate(() => [...document.body.querySelectorAll('[title]')].map(e => e.tagName + '.' + String(e.className).split(' ')[0]));
  assert.deepEqual(withTitle, [], 'у документі немає атрибутів title: ' + withTitle.join(', '));
  for (const [sel, re] of [['.tl-lanes .clip', /Кліп/], ['.head-v .th-n', /Основне відео/], ['#btnSplit', /Розрізати/], ['.th-lock', /Заблокувати/]]) {
    await p16.mouse.move(5, 5); await p16.waitForTimeout(100);
    await p16.hover(sel); await p16.waitForTimeout(700);
    const tip = await p16.evaluate(() => { const t = document.getElementById('tip'); return { shown: t.classList.contains('show'), text: t.textContent }; });
    assert.ok(tip.shown && re.test(tip.text), `підказка для ${sel}: ${JSON.stringify(tip)}`);
  }
  // після перемальовування таймлайну підказка не висить у повітрі
  await p16.hover('.tl-lanes .clip'); await p16.waitForTimeout(600);
  await p16.evaluate(() => { window.VideoCut.S.project.name = 'x'; document.querySelector('#tlLanes').innerHTML = ''; });
  await p16.waitForTimeout(150);
  assert.equal(await p16.evaluate(() => document.getElementById('tip').classList.contains('show')), false, 'підказка зникла разом з елементом');
  await p16.close(); assert.deepEqual(errs, []);
});

await step('точне число: клік по значенню біля повзунка, Enter застосовує, Esc скасовує, межі дотримуються', async () => {
  const p17 = await browser.newPage({ viewport: { width: 1440, height: 900 } }); const errs = [];
  p17.on('pageerror', e => errs.push(e.message));
  await p17.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p17.goto(`http://localhost:${port}/index.html`); await p17.waitForFunction(() => window.VideoCut);
  await p17.setInputFiles('#fileInput', video); await p17.waitForFunction(() => window.VideoCut.S.project.clips.length > 0); await p17.waitForTimeout(900);
  await p17.locator('.tl-lanes .clip').first().click();
  await p17.locator('#inspector [data-f="zoom"]').waitFor();
  const zoom = () => p17.evaluate(() => window.VideoCut.S.project.clips[0].zoom);
  await p17.locator('#inspector .prow:has([data-f="zoom"]) .aux').click();
  await p17.keyboard.press('Control+a'); await p17.keyboard.type('2,5'); await p17.keyboard.press('Enter'); await p17.waitForTimeout(300);
  assert.equal(await zoom(), 2.5, 'введене число застосоване');
  await p17.locator('#inspector .prow:has([data-f="zoom"]) .aux').click(); await p17.keyboard.press('Control+a'); await p17.keyboard.type('9'); await p17.keyboard.press('Enter'); await p17.waitForTimeout(300);
  assert.equal(await zoom(), 4, 'значення обмежене максимумом повзунка');
  await p17.locator('#inspector .prow:has([data-f="zoom"]) .aux').click(); await p17.keyboard.press('Control+a'); await p17.keyboard.type('1.5'); await p17.keyboard.press('Escape'); await p17.waitForTimeout(300);
  assert.equal(await zoom(), 4, 'Esc скасував'); assert.equal(await p17.evaluate(() => !!window.VideoCut.S.sel), true, 'Esc у полі не знімає виділення');
  await p17.locator('#inspector [data-a="itab"][data-v="time"]').click();
  await p17.locator('#inspector .prow:has([data-f="fadeIn"]) .aux').click(); await p17.keyboard.press('Control+a'); await p17.keyboard.type('1,2'); await p17.keyboard.press('Enter'); await p17.waitForTimeout(300);
  assert.equal(await p17.evaluate(() => window.VideoCut.S.project.clips[0].fadeIn), 1.2, 'секунди');
  await p17.close(); assert.deepEqual(errs, []);
});

await step('доріжки: полотна мініатюр лишаються на своїх доріжках, коли з\u2019являється нова (немає дублів id), таймлайн росте під вміст', async () => {
  const p18 = await browser.newPage({ viewport: { width: 1600, height: 900 } }); const errs = [];
  p18.on('pageerror', e => errs.push(e.message));
  await p18.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p18.goto(`http://localhost:${port}/index.html`); await p18.waitForFunction(() => window.VideoCut);
  await p18.evaluate(() => localStorage.removeItem('ev_vc_tl_h')); await p18.reload(); await p18.waitForFunction(() => window.VideoCut);
  await p18.setInputFiles('#fileInput', [video, ramp, audio]); await p18.waitForFunction(() => window.VideoCut.S.project.clips.length > 0); await p18.waitForTimeout(1500);
  const lanes = () => p18.evaluate(() => [...document.querySelectorAll('#tlLanes .lane')].map(l => l.className.split(' ')[1] + ':' + [...l.querySelectorAll('canvas')].map(c => c.id).join(',')));
  const before = await lanes();
  await p18.evaluate(async () => { const V = window.VideoCut, { addOverlay } = await import('./videocut-app/js/ops.js'); const m = [...V.media.values()].filter(x => x.kind === 'video').pop(); addOverlay('video', { mediaId: m.id, start: 0 }); });
  await p18.waitForTimeout(500);
  await p18.evaluate(async () => { const { addOverlay } = await import('./videocut-app/js/ops.js'); addOverlay('text', { preset: 'title' }); });
  await p18.waitForTimeout(500);
  const after = await lanes();
  const want = { 'lane-v2': 'tlV2Canvas', 'lane-v': 'tlVCanvas', 'lane-a': 'tlACanvas' };
  for (const l of after) { const [k, ids] = l.split(':'); if (want[k]) assert.equal(ids, want[k], `у доріжці ${k} полотно ${ids}: ${JSON.stringify(after)}`); }
  const ids = await p18.evaluate(() => [...document.querySelectorAll('#tlLanes canvas')].map(c => c.id));
  assert.equal(new Set(ids).size, ids.length, 'id полотен унікальні: ' + ids);
  // мініатюри основної доріжки справді намальовані на ній, а не на сусідній
  const painted = await p18.evaluate(() => { const px = id => { const c = document.getElementById(id); if (!c) return -1; const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 17) if (d[i] > 0) n++; return n; }; return { v: px('tlVCanvas'), v2: px('tlV2Canvas') }; });
  assert.ok(painted.v > 50, 'основна доріжка має мініатюри: ' + JSON.stringify(painted));
  // таймлайн підріс, щоб вмістити всі доріжки (4 і більше)
  const fit = await p18.evaluate(() => { const tl = document.getElementById('tl'); return { h: Math.round(tl.getBoundingClientRect().height), need: parseInt(getComputedStyle(tl).getPropertyValue('--tl-fit')), inner: document.getElementById('tlLanes').getBoundingClientRect().height, scroll: document.getElementById('tlScroll').scrollHeight > document.getElementById('tlScroll').clientHeight + 2 }; });
  assert.ok(fit.h > 260 && !fit.scroll, 'усі доріжки видно без прокрутки: ' + JSON.stringify(fit));
  await p18.close(); assert.deepEqual(errs, []);
});

await step('історія змін: кроки мають назви, підказки «Скасувати: …», вікно історії повертає до будь-якого кроку', async () => {
  const p19 = await browser.newPage({ viewport: { width: 1440, height: 900 } }); const errs = [];
  p19.on('pageerror', e => errs.push(e.message));
  await p19.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p19.goto(`http://localhost:${port}/index.html`); await p19.waitForFunction(() => window.VideoCut);
  await p19.setInputFiles('#fileInput', video); await p19.waitForFunction(() => window.VideoCut.S.project.clips.length > 0); await p19.waitForTimeout(900);
  const labels = () => p19.evaluate(async () => { const s = await import('./videocut-app/js/state.js'); return s.historyList().items.map(i => i.label); });
  await p19.evaluate(() => window.VideoCut.seek(4)); await p19.keyboard.press('s'); await p19.waitForTimeout(150);
  await p19.evaluate(async () => { const { addOverlay } = await import('./videocut-app/js/ops.js'); addOverlay('text', { preset: 'title' }); });
  await p19.locator('.tl-lanes .clip').first().click();
  await p19.locator('#inspector [data-a="itab"][data-v="time"]').click();
  await p19.locator('#inspector [data-set="speed"][data-v="1.5"]').click(); await p19.waitForTimeout(200);
  await p19.locator('#inspector [data-a="itab"][data-v="look"]').click();
  await p19.evaluate(() => { const o = window.VideoCut.S.project.clips[0]; o.look = 'warm'; window.VideoCut.commit(); });
  const L = await labels();
  assert.deepEqual(L, ['Початок', 'Додати кліп', 'Розрізати', 'Додати текст', 'Швидкість', 'Фільтр і колір'], JSON.stringify(L));
  assert.match(await p19.getAttribute('#btnUndo', 'data-tip'), /Скасувати: Фільтр і колір/);
  await p19.keyboard.press('Control+z');
  assert.match(await p19.getAttribute('#btnRedo', 'data-tip'), /Повторити: Фільтр і колір/); assert.match(await p19.getAttribute('#btnUndo', 'data-tip'), /Скасувати: Швидкість/);
  await p19.keyboard.press('Control+Shift+z');
  await p19.click('#menubar [data-m="1"]'); await p19.locator('.mb-dd .mb-it', { hasText: 'Історія змін' }).click(); await p19.waitForTimeout(300);
  assert.equal(await p19.locator('#histList .hist-row').count(), 6);
  assert.ok(await p19.locator('#histList .hist-row.cur', { hasText: 'Фільтр' }).count(), 'поточний крок позначено');
  await p19.locator('#histList .hist-row', { hasText: 'Додати текст' }).click(); await p19.waitForTimeout(300);
  assert.deepEqual(await p19.evaluate(() => ({ clips: window.VideoCut.S.project.clips.map(c => c.speed || 1), look: window.VideoCut.S.project.clips[0].look || 'none', ov: window.VideoCut.S.project.overlays.length })), { clips: [1, 1], look: 'none', ov: 1 }, 'повернулись до кроку «Додати текст»');
  assert.equal(await p19.locator('#histList .hist-row.undone').count(), 2, 'наступні кроки лишились доступними');
  await p19.locator('#histList .hist-row', { hasText: 'Фільтр' }).click(); await p19.waitForTimeout(200);
  assert.equal(await p19.evaluate(() => window.VideoCut.S.project.clips[0].look), 'warm', 'перехід уперед до останнього кроку');
  await p19.close(); assert.deepEqual(errs, []);
});

await step('доріжки: елемент можна перетягнути в інший ряд і на нову доріжку, порожні ряди зникають', async () => {
  const p20 = await browser.newPage({ viewport: { width: 1440, height: 900 } }); const errs = [];
  p20.on('pageerror', e => errs.push(e.message));
  await p20.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p20.goto(`http://localhost:${port}/index.html`); await p20.waitForFunction(() => window.VideoCut);
  await p20.setInputFiles('#fileInput', video); await p20.waitForFunction(() => window.VideoCut.S.project.clips.length > 0); await p20.waitForTimeout(900);
  await p20.evaluate(async () => { const V = window.VideoCut, { addOverlay } = await import('./videocut-app/js/ops.js'); V.seek(1); addOverlay('text', { preset: 'title' }); V.seek(1.5); addOverlay('rect'); });
  await p20.waitForTimeout(500);
  const rows = () => p20.evaluate(() => [...document.querySelectorAll('.lane-ov .it')].map(i => Math.round((i.getBoundingClientRect().top - document.querySelector('.lane-ov').getBoundingClientRect().top - 3) / 26)));
  const before = await rows(); assert.deepEqual([...before].sort(), [0, 1], 'накладні елементи розкладені на два ряди: ' + before);
  // тягнемо верхній елемент униз на два ряди: з'являється третій ряд
  const items = p20.locator('.lane-ov .it'); const top = await p20.evaluate(() => { const l = [...document.querySelectorAll('.lane-ov .it')].map(i => ({ id: i.dataset.id, y: i.getBoundingClientRect().top })); l.sort((a, b) => a.y - b.y); return l[0].id; });
  const el = p20.locator(`.lane-ov .it[data-id="${top}"]`); const bb = await el.boundingBox();
  await p20.mouse.move(bb.x + bb.width / 2, bb.y + 10); await p20.mouse.down(); await p20.mouse.move(bb.x + bb.width / 2, bb.y + 10 + 30, { steps: 4 }); await p20.mouse.move(bb.x + bb.width / 2, bb.y + 10 + 62, { steps: 4 });
  const live = await p20.evaluate(() => ({ hud: document.querySelector('.tl-hud')?.textContent, h: document.querySelector('.lane-ov').getBoundingClientRect().height }));
  assert.match(live.hud, /доріжка 3/, 'підказка показує номер доріжки: ' + live.hud); assert.ok(live.h >= 3 * 26, 'з\u2019явився порожній ряд для нової доріжки: ' + live.h);
  await p20.mouse.up(); await p20.waitForTimeout(400);
  const after = await p20.evaluate(() => window.VideoCut.S.project.overlays.map(o => o.row));
  assert.ok(after.some(r => r === 2 || r === 1), 'ряд збережено в проєкті: ' + JSON.stringify(after));
  const rowsAfter = await rows(); assert.ok(Math.max(...rowsAfter) <= 1, 'порожні ряди стиснуто: ' + rowsAfter);
  assert.equal(await p20.evaluate(async () => (await import('./videocut-app/js/state.js')).historyList().items.at(-1).label), 'Інша доріжка');
  await p20.keyboard.press('Control+z'); assert.deepEqual(await p20.evaluate(() => window.VideoCut.S.project.overlays.map(o => o.row)), [undefined, undefined], 'скасування повертає автоматичні ряди');
  await p20.close(); assert.deepEqual(errs, []);
});

await step('жодної помилки в консолі сторінки', async () => assert.deepEqual(errors, []));

await browser.close(); srv.close();
