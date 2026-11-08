// Спільне для браузерних тестів: статичний сервер репозиторію, запуск Chromium, кроки з підсумком.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';

export const ROOT = resolve(new URL('..', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.webp': 'image/webp' };

export async function startServer(port = 0) {
  // як GitHub Pages: /tools/ → tools/index.html, /tools/vote → tools/vote.html, решта — 404.html зі статусом 404
  const srv = createServer(async (q, r) => {
    const p = decodeURIComponent(q.url.split('?')[0]);
    const tries = p.endsWith('/') ? [p + 'index.html'] : extname(p) ? [p] : [p + '.html', p + '/index.html'];
    for (const t of tries) {
      try { const f = join(ROOT, t); const body = await readFile(f); r.setHeader('content-type', MIME[extname(f)] || 'application/octet-stream'); r.end(body); return; } catch { /* далі */ }
    }
    r.statusCode = 404;
    try { r.setHeader('content-type', 'text/html'); r.end(await readFile(join(ROOT, '404.html'))); } catch { r.end(); }
  }).listen(port);
  await new Promise(r => srv.once('listening', r));
  return { url: `http://localhost:${srv.address().port}`, close: () => srv.close() };
}

export async function launch() {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  return chromium.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox'] });
}

// Сторінка з перехопленням помилок і без зовнішніх шрифтів (тести не залежать від мережі)
export async function newPage(ctx, errors) {
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  return p;
}

let n = 0;
export async function step(name, fn) {
  try { await fn(); console.log('ok  ', ++n, name); }
  catch (e) { console.log('FAIL', ++n, name, '\n   ', (e && e.message || String(e)).split('\n').slice(0, 4).join('\n    ')); process.exitCode = 1; }
}

// Вхід у Windows-емулятор (екран блокування: admin / admin)
export async function signIn(p) {
  await p.locator('#lock .lk-face').waitFor();
  await p.locator('#lock').click();
  await p.fill('#lock .lk-user', 'admin');
  await p.fill('#lock .lk-pass', 'admin');
  await p.press('#lock .lk-pass', 'Enter');
  await p.waitForSelector('#lock', { state: 'hidden' });
}
