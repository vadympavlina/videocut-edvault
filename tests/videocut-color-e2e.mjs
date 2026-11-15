// Колірний граф на GPU: результат шейдерів збігається з еталоном на CPU.
//   node tests/videocut-color-e2e.mjs      (потрібні Playwright і Chromium)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const srv = createServer(async (q, r) => { if (q.url === '/__blank') { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>t</title><body></body>'); return; } try { const f = join(ROOT, decodeURIComponent(q.url.split('?')[0])); r.setHeader('content-type', MIME[extname(f)] || 'application/octet-stream'); r.end(await readFile(f)); } catch { r.statusCode = 404; r.end(); } }).listen(0);
await new Promise(r => srv.on('listening', r));
const port = srv.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
let fails = 0, n = 0;
const step = async (name, fn) => { n++; try { await fn(); console.log('ok  ', String(n).padStart(2), name); } catch (e) { fails++; console.log('FAIL', String(n).padStart(2), name, '\n    ', String(e.message || e).split('\n')[0]); } };

const page = await browser.newPage({ bypassCSP: true });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${port}/__blank`);
await page.evaluate(`import('http://localhost:${port}/videocut-app/js/color.js').then(m => { window.C = m; window.ready = true; })`);
await page.waitForFunction(() => window.ready, null, { timeout: 15000 });

// Кадр-палітра: сітка кольорів по відтінку (стовпці) і яскравості (рядки)
const SET = `
  const W = 48, H = 32, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(W, H);
  const hsv = (h, s, v) => { const k = n => (n + h * 6) % 6; const f = n => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1)); return [f(5), f(3), f(1)]; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = y < 8 ? [x / (W - 1), x / (W - 1), x / (W - 1)] : hsv(x / W, 0.25 + 0.75 * ((y - 8) / (H - 9)), 0.35 + 0.6 * (1 - (y - 8) / (H - 9))); const i = (y * W + x) * 4; img.data[i] = Math.round(c[0] * 255); img.data[i + 1] = Math.round(c[1] * 255); img.data[i + 2] = Math.round(c[2] * 255); img.data[i + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  const src = ctx.getImageData(0, 0, W, H).data;`;
async function compare(name, make, tol = 6) {
  await step(name, async () => {
    const r = await page.evaluate(`(() => { ${SET}
      const cg = C.repairGraph((${make})(C)); const ok = C.applyGraph(ctx, W, H, cg, []);
      const out = ctx.getImageData(0, 0, W, H).data; let worst = 0, wi = 0, bad = 0;
      for (let i = 0; i < W * H; i++) { const e = C.evalPixel(cg, [src[i * 4] / 255, src[i * 4 + 1] / 255, src[i * 4 + 2] / 255]); for (let k = 0; k < 3; k++) { const d = Math.abs(out[i * 4 + k] - e[k] * 255); if (d > worst) { worst = d; wi = i; } if (d > ${tol}) bad++; } }
      return { ok, worst, wi, bad };
    })()`);
    assert.ok(r.ok, 'граф застосовано на GPU');
    assert.ok(r.bad === 0, `розбіжність GPU/CPU: найбільше ${r.worst.toFixed(1)} з 255 (піксель ${r.wi}), поганих каналів: ${r.bad}`);
  });
}
const prim = p => `C => { const g = C.newGraph(); Object.assign(g.nodes[1].p, ${JSON.stringify(p)}); return g; }`;
await compare('первинна: експозиція й контраст', prim({ exp: 0.5, con: 1.3 }));
await compare('первинна: колеса, температура й насиченість', prim({ lift: { x: -0.4, y: 0.3, l: 0.1 }, gain: { x: 0.5, y: 0.1, l: 0 }, gamma: { x: 0.2, y: -0.4, l: 0 }, temp: 0.4, tint: -0.2, sat: 1.4, hi: -0.3, sh: 0.3 }));
await compare('криві: S-крива і канали', `C => { const g = C.newGraph(); g.nodes[1].type = 'curves'; g.nodes[1].p = { m: [[0, 0], [0.3, 0.2], [0.7, 0.85], [1, 1]], r: [[0, 0.05], [1, 0.95]], g: [[0, 0], [1, 1]], b: [[0, 0.1], [0.5, 0.45], [1, 1]] }; return g; }`);
await compare('HSL: вибраний колір зсувається, інші ні', `C => { const g = C.newGraph(); g.nodes[1].type = 'hsl'; g.nodes[1].p = { ...C.DEFAULTS.hsl(), hue: 200, width: 90, dh: 0.1, ds: 1.4, dl: 0.1, soft: 0.3 }; return g; }`, 8);
await compare('змішати: множення двох гілок', `C => { const g = C.newGraph(); const a = C.newNode('prim'); a.id = 'a'; a.p.exp = 0.6; const m = C.newNode('mix'); m.id = 'm'; m.p = { mode: 'multiply', amount: 0.8 }; g.nodes.splice(1, 1, a, m); g.links = [{ from: 'in', to: 'a', port: 0 }, { from: 'in', to: 'm', port: 0 }, { from: 'a', to: 'm', port: 1 }, { from: 'm', to: 'out', port: 0 }]; return g; }`);
// ефекти (віньєтка, зерно) перевіряємо окремо, тут їх вимикаємо, бо еталон на CPU рахує лише колір
for (const id of ['golden', 'noir', 'fresh', 'teal', 'cinema', 'retro']) await compare('рецепт «' + id + '»', `C => { const g = C.recipeGraph('${id}'); for (const n of g.nodes) if (n.type === 'fx') n.p = { ...C.DEFAULTS.fx() }; return g; }`, 9);

await step('ефекти: віньєтка темнить кути, зерно міняється від кадру до кадру', async () => {
  const r = await page.evaluate(`(() => { ${SET}
    const g = C.newGraph(); g.nodes[1].type = 'fx'; g.nodes[1].p = { ...C.DEFAULTS.fx(), vig: 0.9, grain: 0.8 };
    const gg = C.repairGraph(g); const flat = () => { ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H); };
    flat(); C.applyGraph(ctx, W, H, gg, []); const a = Array.from(ctx.getImageData(0, 0, W, H).data);
    flat(); C.applyGraph(ctx, W, H, gg, []); const b = Array.from(ctx.getImageData(0, 0, W, H).data);
    const at = (d, x, y) => d[(y * W + x) * 4]; let diff = 0; for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    return { corner: at(a, 0, 0), centre: at(a, W / 2, H / 2), diff };
  })()`);
  assert.ok(r.corner < r.centre - 15, 'кути темніші за центр: ' + JSON.stringify(r)); assert.ok(r.diff > 500, 'зерно відрізняється між кадрами');
});
await step('нейтральний граф нічого не змінює й повертає false', async () => {
  const r = await page.evaluate(`(() => { ${SET} const before = Array.from(src); const ok = C.applyGraph(ctx, W, H, C.newGraph(), []); const out = ctx.getImageData(0, 0, W, H).data; return { ok, same: before.every((v, i) => v === out[i]) }; })()`);
  assert.equal(r.ok, false); assert.ok(r.same);
});
await step('вимкнений вузол пропускається', async () => {
  const r = await page.evaluate(`(() => { ${SET} const g = C.newGraph(); g.nodes[1].p.exp = 2; g.nodes[1].off = true; const ok = C.applyGraph(ctx, W, H, C.repairGraph(g), []); return ok; })()`);
  assert.equal(r, false);
});
await step('зображення не перевертається догори дриґом', async () => {
  const r = await page.evaluate(`(() => { ${SET} const g = C.newGraph(); g.nodes[1].p.exp = 0.01; C.applyGraph(ctx, W, H, C.repairGraph(g), []); const out = ctx.getImageData(0, 0, W, H).data; const px = (x, y) => out[(y * W + x) * 4]; return { topLeft: px(2, 2), topRight: px(W - 3, 2) }; })()`);
  assert.ok(r.topRight > r.topLeft + 100, 'верхній рядок — градієнт зліва направо: ' + JSON.stringify(r));
});
await step('мініатюри вузлів: для кожного вузла свій кадр', async () => {
  const r = await page.evaluate(`(() => { ${SET} const g = C.repairGraph(C.recipeGraph('cinema')); const m = C.renderThumbs(cv, g, [], 24, 16); return m ? { keys: [...m.keys()].length, w: [...m.values()].find(v => v)?.width } : null; })()`);
  assert.ok(r && r.keys >= 3 && r.w === 24, JSON.stringify(r));
});
await step('жодної помилки в консолі', async () => { assert.deepEqual(errors, []); });

await browser.close(); srv.close();
console.log(fails ? `\n${fails} з ${n} не пройшли` : `\nУсі ${n} кроків пройшли`);
process.exit(fails ? 1 : 0);
