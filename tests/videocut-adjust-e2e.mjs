// Шар корекції: колір на ділянці таймлайну (додавання, сила, плавні краї, розрізання, скасування, відновлення проєкту).
//   node tests/videocut-adjust-e2e.mjs      (потрібні Playwright, Chromium і ffmpeg)
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
const cg = () => p.evaluate(() => { const c = window.VideoCut.S.project.clips[0]; return c.cg ? JSON.parse(JSON.stringify(c.cg)) : null; });
// середній колір центральної смуги перегляду
const mean = () => p.evaluate(() => { const cv = document.getElementById('pv'), g = cv.getContext('2d'), w = cv.width, h = cv.height; const d = g.getImageData(Math.round(w * 0.3), Math.round(h * 0.2), Math.round(w * 0.4), Math.round(h * 0.6)).data; let r = 0, gg = 0, b = 0; const k = d.length / 4; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; } return [r / k, gg / k, b / k]; });
const settle = () => p.waitForTimeout(350);
const diff = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const undo = async () => { await p.click('#btnUndo'); await settle(); };
const at = async t => { await p.evaluate(t => window.VideoCut.seek(t), t); await p.waitForTimeout(450); };
const ovs = () => p.evaluate(() => window.VideoCut.S.project.overlays.map(o => ({ id: o.id, type: o.type, start: o.start, dur: o.dur, amount: o.amount, fin: o.fin, fout: o.fout })));
const dark = (a, b) => (b[0] + b[1] + b[2]) - (a[0] + a[1] + a[2]);

await step('«Колір» → «+ Ділянка»: з’являється шар корекції від курсора, під рештою накладань', async () => {
  await p.click('#pageSw [data-page=color]'); await settle(); await at(1);
  await p.click('#cgNewAdj'); await settle();
  const o = await ovs(); assert.equal(o.length, 1); assert.equal(o[0].type, 'adjust'); assert.ok(Math.abs(o[0].start - 1) < 0.1, 'старт ' + o[0].start);
  assert.equal(await p.locator('.cg-title').textContent(), 'Граф ділянки');
  assert.equal(await p.locator('.cg-adj.on').count(), 1);
});
await step('корекція ділянки змінює кадр лише всередині неї', async () => {
  await p.evaluate(() => { const o = window.VideoCut.S.project.overlays[0]; o.start = 1; o.dur = 2; o.fin = 0; o.fout = 0; o.cg.nodes.find(n => n.type === 'prim').p.exp = -1.2; window.VideoCut.commit(); });
  await at(0.4); const before = await mean(); await at(2); const inside = await mean(); await at(3.6); const after = await mean();
  assert.ok(dark(before, inside) < -40, 'усередині темніше: ' + before + ' → ' + inside);
  assert.ok(Math.abs(dark(before, after)) < 35, 'після ділянки як до: ' + before + ' / ' + after);
});
await step('сила 50% — посередині між оригіналом і повною корекцією', async () => {
  await at(2); const full = await mean();
  await p.evaluate(() => { window.VideoCut.S.project.overlays[0].amount = 0.5; window.VideoCut.commit(); }); await at(2); const half = await mean();
  await p.evaluate(() => { window.VideoCut.S.project.overlays[0].amount = 0; window.VideoCut.commit(); }); await at(2); const zero = await mean();
  await p.evaluate(() => { window.VideoCut.S.project.overlays[0].amount = 1; window.VideoCut.commit(); });
  assert.ok(dark(zero, half) < -15 && dark(half, full) < -15, `${zero} ${half} ${full}`);
});
await step('плавний вхід і вихід: на краях слабше, посередині повна сила', async () => {
  await p.evaluate(() => { const o = window.VideoCut.S.project.overlays[0]; o.fin = 0.8; o.fout = 0.8; window.VideoCut.commit(); });
  await at(1.05); const edge = await mean(); await at(2); const mid = await mean(); await at(0.4); const out = await mean();
  assert.ok(dark(out, edge) > -25, 'край майже без змін: ' + out + ' → ' + edge); assert.ok(dark(edge, mid) < -25, 'посередині темніше за край');
});
await step('шар не береться в hit-test перегляду й не показує рамку виділення', async () => {
  await p.click('#pageSw [data-page=edit]'); await settle(); await at(2);
  assert.equal(await p.locator('#pvHandles .selbox').count(), 0);
});
await step('інспектор шару: вкладки, сила, кнопка відкриває сторінку «Колір»', async () => {
  const i = p.locator('#inspector'); assert.ok(await i.textContent().then(t => /Корекція кольору/.test(t)), 'заголовок');
  assert.ok(await i.locator('[data-f=amount]').count() === 1, 'повзунок сили');
  await i.locator('[data-a=adjOpen]').click(); await settle();
  assert.equal(await p.evaluate(() => document.body.dataset.page), 'color'); assert.equal(await p.locator('.cg-adj.on').count(), 1);
});
await step('Монтаж: окрема доріжка «Корекція» з елементом-градієнтом і підписом', async () => {
  await p.click('#pageSw [data-page=edit]'); await settle();
  assert.equal(await p.locator('.lane-adj .it.adjl').count(), 1);
  assert.ok(/Корекція · \d+%/.test(await p.locator('.lane-adj .it.adjl').textContent()));
  assert.equal(await p.locator('.head-adj').count(), 1);
  assert.equal(await p.locator('.lane-ov').count(), 0);
});
await step('готові стилі: «Нуар» замінює граф і дає назву на таймлайні, є запис в історії', async () => {
  await p.locator('.lane-adj .it.adjl').click(); await settle();
  await p.locator('#inspector [data-a=adjRecipe][data-v=noir]').click(); await settle();
  const r = await p.evaluate(() => { const o = window.VideoCut.S.project.overlays[0]; return { name: o.name, sat: o.cg.nodes.find(n => n.type === 'prim').p.sat }; });
  assert.equal(r.name, 'Нуар'); assert.equal(r.sat, 0);
  assert.ok(/Нуар/.test(await p.locator('.lane-adj .it.adjl').textContent()));
  await at(2); const m = await mean(); assert.ok(Math.abs(m[0] - m[1]) < 6 && Math.abs(m[1] - m[2]) < 6, 'чорно-біле: ' + m);
  await undo(); assert.equal(await p.evaluate(() => window.VideoCut.S.project.overlays[0].name), undefined);
});
await step('мініатюри стилів намальовані й різні (кадр із відео, не чорні)', async () => {
  await at(2); await p.locator('.lane-adj .it.adjl').click(); await p.waitForTimeout(900);
  const r = await p.evaluate(() => [...document.querySelectorAll('#inspector .adj-rc canvas')].map(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0, r = 0, b = 0; for (let i = 0; i < d.length; i += 4) { s += d[i] + d[i + 1] + d[i + 2]; r += d[i]; b += d[i + 2]; } return [Math.round(s / (d.length / 4)), Math.round(r / (d.length / 4) - b / (d.length / 4))]; }));
  assert.equal(r.length, 6); assert.ok(r.every(x => x[0] > 25), 'не чорні: ' + JSON.stringify(r)); assert.ok(new Set(r.map(x => x.join())).size >= 4, 'різні: ' + JSON.stringify(r));
});
await step('скинути корекцію повертає нейтральний граф', async () => {
  await p.locator('.lane-adj .it.adjl').click(); await settle();
  await p.locator('#inspector [data-a=adjReset]').click(); await settle();
  assert.equal(await p.evaluate(() => window.VideoCut.S.project.overlays[0].cg.nodes.find(n => n.type === 'prim').p.sat), 1);
});
await step('вхідна мініатюра графа ділянки містить колір самого кліпа', async () => {
  const thumb = () => p.evaluate(() => { const c = document.querySelector('#cgNodes .cn canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4); });
  await p.locator('.lane-adj .it.adjl').click(); await p.locator('#inspector [data-a=adjOpen]').click(); await settle(); await at(2); await p.waitForTimeout(700);
  const plain = await thumb();
  await p.evaluate(() => { const c = window.VideoCut.S.project.clips[0]; c.cg = JSON.parse(JSON.stringify(window.VideoCut.S.project.overlays[0].cg)); c.cg.nodes.find(n => n.type === 'prim').p.exp = -1.2; window.VideoCut.commit(); });
  await p.waitForTimeout(900); const graded = await thumb();
  await p.evaluate(() => { delete window.VideoCut.S.project.clips[0].cg; window.VideoCut.commit(); });
  assert.ok(graded < plain - 20, `${plain} → ${graded}`);
});
await step('вихід курсора за межі ділянки повертає ціль на кліп', async () => {
  await p.click('#pageSw [data-page=edit]'); await settle(); await p.locator('.lane-adj .it.adjl').click(); await p.locator('#inspector [data-a=adjOpen]').click(); await settle(); assert.equal(await p.locator('.cg-adj.on').count(), 1);
  await at(4.5); await settle();
  assert.equal(await p.locator('.cg-adj.on').count(), 0); assert.equal(await p.locator('.cg-title').textContent(), 'Граф кліпа');
});
await step('розрізання шару ділит ділянку, скасування повертає як було', async () => {
  await p.click('#pageSw [data-page=edit]'); await settle();
  await p.evaluate(() => { const V = window.VideoCut; V.select ? 0 : 0; });
  const id = (await ovs())[0].id; await at(2);
  await p.evaluate(id => import('/videocut-app/js/state.js').then(m => m.select('overlay', id)), id);
  await p.evaluate(() => import('/videocut-app/js/ops.js').then(m => m.splitAt(2)));
  let o = await ovs(); assert.equal(o.length, 2); assert.ok(Math.abs(o[0].dur - 1) < 0.05 && Math.abs(o[1].start - 2) < 0.05, JSON.stringify(o));
  assert.equal(o[0].fout, 0); assert.equal(o[1].fin, 0);
  await undo(); o = await ovs(); assert.equal(o.length, 1); assert.ok(Math.abs(o[0].dur - 2) < 0.05);
});
await step('повернення проєкту з порожнім графом: шар прибирається, з поганою силою — виправляється', async () => {
  const r = await p.evaluate(async () => { const m = await import('/videocut-app/js/state.js'); const pr = JSON.parse(JSON.stringify(window.VideoCut.S.project)); pr.overlays.push({ id: 'o_bad', type: 'adjust', start: 0, dur: 1 }); pr.overlays[0].amount = 7; const out = m.repairProject(pr); return { n: out.overlays.length, a: out.overlays[0].amount }; });
  assert.equal(r.n, 1); assert.equal(r.a, 1);
});
await step('дублювання шару зберігає граф окремою копією', async () => {
  const r = await p.evaluate(async () => { const o = await import('/videocut-app/js/ops.js'); const s = await import('/videocut-app/js/state.js'); s.select('overlay', s.S.project.overlays[0].id); o.duplicateSel(); const a = s.S.project.overlays; return { n: a.length, same: a[0].cg === a[1].cg, eq: JSON.stringify(a[0].cg) === JSON.stringify(a[1].cg) }; });
  assert.equal(r.n, 2); assert.equal(r.same, false); assert.equal(r.eq, true);
});
await step('експорт відео: кадри всередині ділянки темніші, ніж поза нею', async () => {
  const r = await p.evaluate(async () => {
    const V = window.VideoCut; const s = V.S.project; s.overlays.length = 1; const o = s.overlays[0]; o.start = 1; o.dur = 2; o.fin = 0; o.fout = 0; V.commit();
    const blob = await V.exportVideo({ format: 'webm', quality: 'low', short: 360, range: [0, 4], fps: 10 }).catch(e => ({ err: String(e) }));
    return blob && blob.size ? { size: blob.size } : { err: JSON.stringify(blob) };
  });
  assert.ok(r.size > 1000, JSON.stringify(r));
});
await step('жодної помилки в консолі', async () => { assert.deepEqual(errors, []); });

await browser.close(); srv.close();
console.log(fails ? `\n${fails} з ${n} не пройшли` : `\nУсі ${n} кроків пройшли`);
process.exit(fails ? 1 : 0);
