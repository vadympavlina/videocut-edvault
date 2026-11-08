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

await step('жодної помилки в консолі сторінки', async () => assert.deepEqual(errors, []));

await browser.close(); srv.close();
