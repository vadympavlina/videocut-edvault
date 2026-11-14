// Сценарії відеоредактора: додавання файлів, перетягування на таймлайні, накладання, музика, збереження.
// Після кожної дії перевіряємо інваріанти проєкту (audit): жодного NaN, кліпи без проміжків, медіа існують, скасування повертає стан.
//   node tests/videocut-scenarios-e2e.mjs      (потрібні Playwright, Chromium і ffmpeg)
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const tmp = await mkdtemp(join(tmpdir(), 'vcs-'));
const F = n => join(tmp, n);
const ff = (...a) => execFileSync(process.env.FFMPEG || 'ffmpeg', ['-y', '-loglevel', 'error', ...a]);
ff('-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-c:v', 'libvpx', '-b:v', '800k', '-c:a', 'libopus', '-shortest', F('v1.webm'));
ff('-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30:duration=6', '-c:v', 'libvpx', '-b:v', '600k', F('v2.webm'));                       // вертикальне, без звуку
ff('-f', 'lavfi', '-i', 'smptebars=size=1280x720:rate=1', '-frames:v', '1', F('photo.png'));
ff('-f', 'lavfi', '-i', 'mandelbrot=size=800x600:rate=1', '-frames:v', '1', F('photo.jpg'));
ff('-f', 'lavfi', '-i', 'sine=frequency=300:duration=8', '-c:a', 'libopus', F('a1.webm'));
ff('-f', 'lavfi', '-i', 'sine=frequency=520:duration=5', F('a2.wav'));
await writeFile(F('note.txt'), 'не медіа'); await writeFile(F('broken.mp4'), Buffer.from('це не відео '.repeat(50)));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const srv = createServer(async (q, r) => { try { const f = join(ROOT, decodeURIComponent(q.url.split('?')[0])); r.setHeader('content-type', MIME[extname(f)] || 'application/octet-stream'); r.end(await readFile(f)); } catch { r.statusCode = 404; r.end(); } }).listen(0);
const port = srv.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox'] });

// Нова сторінка з перехопленням помилок
async function open(w = 1440, h = 900) {
  const page = await browser.newPage({ bypassCSP: true, viewport: { width: w, height: h } }); page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.goto(`http://localhost:${port}/index.html`); await page.waitForFunction(() => window.VideoCut);
  return page;
}
const addFiles = async (p, files, wait = 1200) => { const before = await p.evaluate(() => window.VideoCut.S.project.clips.length + window.VideoCut.S.project.music.length + window.VideoCut.S.project.overlays.length); await p.setInputFiles('#fileInput', files.map(F)); await p.waitForTimeout(wait); return before; };

// Інваріанти проєкту: повертає список проблем (порожній — усе гаразд)
const AUDIT = async opt => {
  const { S, media } = window.VideoCut, st = await import('./videocut-app/js/state.js');
  const P = S.project, out = [];
  const walk = (v, path) => { if (typeof v === 'number' && !Number.isFinite(v)) out.push('не число: ' + path); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (path.length < 80) walk(x, path + '.' + k); };
  walk(P, 'project');
  const ids = new Set();
  for (const [kind, list] of [['clip', P.clips], ['overlay', P.overlays], ['caption', P.captions], ['music', P.music]]) for (const o of list) { if (ids.has(o.id)) out.push('повторний id ' + o.id); ids.add(o.id); if (kind !== 'caption' && o.mediaId && !media.has(o.mediaId) && o.type !== 'text') out.push(`${kind} ${o.id}: немає медіа ${o.mediaId}`); }
  for (const c of P.clips) { if (!(c.out > c.in)) out.push('кліп з нульовою довжиною ' + c.id); if (!(c.speed >= 0.1 && c.speed <= 8)) out.push('швидкість поза межами ' + c.speed); if (c.volume < 0 || c.volume > 2) out.push('гучність кліпа ' + c.volume); }
  for (const x of P.music) { if (!(x.out > x.in)) out.push('аудіо без довжини ' + x.id); if (x.start < 0) out.push('аудіо зі стартом < 0'); if (x.volume < 0 || x.volume > 2) out.push('гучність аудіо ' + x.volume); }
  for (const o of [...P.overlays, ...P.captions]) { if (o.start < 0) out.push('старт < 0 ' + o.id); if (!(o.dur > 0)) out.push('тривалість ≤ 0 ' + o.id); }
  const L = st.layout(); let t = 0; for (const l of L) { if (Math.abs(l.start - t) > 1e-6) out.push('проміжок на основній доріжці'); t = l.end; }
  const d = st.duration(); if (!Number.isFinite(d) || d < 0) out.push('тривалість ' + d);
  const end = Math.max(0, ...P.music.map(x => x.start + (x.out - x.in)), ...P.overlays.map(o => o.start + o.dur), ...P.captions.map(c => c.start + c.dur), t);
  if (Math.abs(d - end) > 0.02 && d < end) out.push(`тривалість ${d} менша за кінець елементів ${end}`);
  for (const m of S.multi) if (!st.findSel || !([P.clips, P.overlays, P.captions, P.music].some(l => l.some(o => o.id === m.id)))) out.push('виділено неіснуючий ' + m.id);
  // на екрані елементи однієї доріжки й ряду не налазять один на одного, а їхній розмір збігається з тривалістю
  const pps = S.pps; const groups = new Map();
  for (const el of document.querySelectorAll('.tl-lanes .it')) { if (el.classList.contains('tl-ghost')) continue; const lane = el.closest('.lane'); if (!lane) continue; const r = el.getBoundingClientRect(); if (!r.width) continue; const key = lane.className + '|' + Math.round(r.top); (groups.get(key) || groups.set(key, []).get(key)).push({ id: el.dataset.id, l: r.left, r: r.right, w: r.width }); }
  for (const [key, list] of groups) { list.sort((a, b) => a.l - b.l); for (let i = 1; i < list.length; i++) if (list[i].l < list[i - 1].r - 1.5 && list[i].w > 16.5 && list[i - 1].w > 16.5) out.push(`на таймлайні елементи налазять один на одного (${key.split('|')[0].split(' ').pop()}): ${list[i - 1].id} / ${list[i].id}`); }
  // відновлення проєкту не повинно нічого міняти
  const rep = JSON.stringify(st.repairProject(structuredClone(P))), cur = JSON.stringify(P);
  if (rep !== cur) { const a = JSON.parse(rep); for (const k of Object.keys(P)) if (!['tracks', 'luts'].includes(k) && JSON.stringify(a[k]) !== JSON.stringify(P[k])) out.push('repairProject змінює поле ' + k); }
  // скасування й повтор повертають той самий стан
  const before = JSON.stringify(P), m0 = S.multi.slice(), s0 = S.sel;
  if (!(opt && opt.fast) && st.canUndo()) { st.undo(); st.redo(); if (JSON.stringify(S.project) !== before) out.push('скасувати+повторити не повертає стан'); S.multi = m0; S.sel = s0; } // перевірка не повинна змінювати виділення
  return out;
};
const audit = async (p, label = '') => { const bad = await p.evaluate(AUDIT); assert.deepEqual(bad, [], `${label}: ${bad.join('; ')}`); const errs = p.errors.filter(e => !(p.allow || []).some(r => r.test(e))); assert.deepEqual(errs, [], `${label}: помилки сторінки`); };
const proj = p => p.evaluate(() => JSON.parse(JSON.stringify(window.VideoCut.S.project)));
const info = p => p.evaluate(() => { const { S, media } = window.VideoCut; return { clips: S.project.clips.map(c => ({ id: c.id, kind: media.get(c.mediaId)?.kind, d: +(c.out - c.in).toFixed(2) })), music: S.project.music.length, ov: S.project.overlays.map(o => o.type), aspect: S.project.aspect, dur: +window.VideoCut.duration().toFixed(2), media: [...media.values()].map(m => m.kind) }; });

let n = 0, failed = 0;
const step = async (name, fn) => { try { await fn(); console.log('ok  ', ++n, name); } catch (e) { failed++; console.log('FAIL', ++n, name, '\n   ', (e.message || String(e)).split('\n').slice(0, 6).join('\n    ')); process.exitCode = 1; } };
const only = process.env.VC_ONLY;
const skip = (process.env.VC_SKIP || '').split('|').filter(Boolean); // VC_SKIP="кожна кнопка|мавпа" — пропустити довгі сценарії
const run = (name, fn) => ((only && !name.includes(only)) || skip.some(k => name.includes(k)) ? null : step(name, fn));

// ═════ 1. Додавання файлів ═════
await run('додавання: відео, вертикальне відео, фото й аудіо по одному, кожне додається один раз, формат кадру береться з першого', async () => {
  const p = await open();
  await addFiles(p, ['v1.webm']); await audit(p, 'відео');
  let i = await info(p); assert.equal(i.clips.length, 1); assert.equal(i.clips[0].kind, 'video'); assert.equal(i.aspect, '16:9'); assert.ok(i.dur > 11 && i.dur < 13, 'тривалість ' + i.dur);
  await addFiles(p, ['v2.webm']); await audit(p, 'друге відео');
  i = await info(p); assert.equal(i.clips.length, 2); assert.equal(i.aspect, '16:9', 'формат не міняється від другого відео');
  await addFiles(p, ['photo.png']); await audit(p, 'фото');
  i = await info(p); assert.equal(i.clips.length, 3, 'після фото: ' + JSON.stringify(i)); assert.equal(i.clips[2].kind, 'image'); assert.equal(i.clips[2].d, 5, 'фото за замовчуванням 5 секунд');
  await addFiles(p, ['a1.webm']); await audit(p, 'аудіо');
  i = await info(p); assert.equal(i.music, 1); assert.equal(i.clips.length, 3, 'аудіо не додається в кліпи');
  await addFiles(p, ['a2.wav']); await audit(p, 'друге аудіо (wav)'); assert.equal((await info(p)).music, 2);
  await addFiles(p, ['photo.jpg']); await audit(p, 'jpg'); assert.equal((await info(p)).clips.length, 4);
  await p.close();
});

await run('додавання: вертикальне відео першим змінює формат на 9:16, фото першим — на формат фото', async () => {
  let p = await open(); await addFiles(p, ['v2.webm']); await audit(p, 'вертикальне'); assert.equal((await info(p)).aspect, '9:16'); await p.close();
  p = await open(); await addFiles(p, ['photo.jpg']); await audit(p, 'фото першим'); assert.equal((await info(p)).clips[0].kind, 'image'); assert.equal((await info(p)).aspect, '4:3'); await p.close();
});

await run('додавання: кілька файлів за раз (відео + фото + аудіо), порядок збережено, нічого не губиться', async () => {
  const p = await open(); await addFiles(p, ['v1.webm', 'photo.png', 'a1.webm', 'v2.webm', 'photo.jpg', 'a2.wav'], 3500); await audit(p, 'пакет');
  const i = await info(p); assert.equal(i.clips.length, 4, JSON.stringify(i)); assert.equal(i.music, 2); assert.equal(i.media.length, 6);
  assert.deepEqual(i.clips.map(c => c.kind), ['video', 'image', 'video', 'image'], 'порядок кліпів збігається з порядком файлів');
  await p.close();
});

await run('додавання: той самий файл двічі дає два незалежні кліпи, видалення одного не ламає другий', async () => {
  const p = await open(); await addFiles(p, ['v1.webm']); await addFiles(p, ['v1.webm']); await audit(p, 'дубль');
  let i = await info(p); assert.equal(i.clips.length, 2);
  await p.evaluate(async () => { const { selectMany } = await import('./videocut-app/js/state.js'); const { deleteSel } = await import('./videocut-app/js/ops.js'); const { select } = await import('./videocut-app/js/state.js'); select('clip', window.VideoCut.S.project.clips[0].id); deleteSel(); });
  await p.waitForTimeout(300); await audit(p, 'після видалення'); i = await info(p); assert.equal(i.clips.length, 1); assert.ok(i.dur > 11);
  await p.keyboard.press('Control+z'); await p.waitForTimeout(300); await audit(p, 'скасування'); assert.equal((await info(p)).clips.length, 2);
  await p.close();
});

await run('додавання: не медіа й пошкоджений файл не ламають редактор і не потрапляють на таймлайн', async () => {
  const p = await open(); p.allow = [/Непідтримуваний тип|Не вдалося відкрити|не вміє|Failed to execute|decode|Error:/]; await addFiles(p, ['v1.webm']);
  await addFiles(p, ['note.txt'], 1500); await audit(p, 'txt'); assert.equal((await info(p)).clips.length, 1);
  await addFiles(p, ['broken.mp4'], 2500); await audit(p, 'пошкоджений');
  const i = await info(p); assert.equal(i.clips.length, 1, 'пошкоджений файл не додається: ' + JSON.stringify(i));
  await addFiles(p, ['photo.png']); await audit(p, 'після помилок усе працює'); assert.equal((await info(p)).clips.length, 2);
  await p.close();
});


// ═════ 2. Таймлайн: групове перетягування ═════
// Проєкт для перевірки: відео 12 с, дві музики й «голос», текст, прямокутник, субтитр
async function richProject() {
  const p = await open(1500, 900);
  await addFiles(p, ['v1.webm', 'a1.webm', 'a2.wav'], 2500);
  await p.evaluate(async () => {
    const V = window.VideoCut, ops = await import('./videocut-app/js/ops.js'), st = await import('./videocut-app/js/state.js');
    st.S.snap = false;
    const ms = [...V.media.values()], a1 = ms.find(m => m.name === 'a1.webm'), a2 = ms.find(m => m.name === 'a2.wav');
    V.S.project.music.length = 0; // додаємо вручну з відомими позиціями
    ops.addMusic(a1, true, 1); ops.addMusic(a2, true, 3); ops.addVoice(a2, 6, 0);
    V.seek(2); ops.addOverlay('text', { preset: 'title' }); V.seek(4); ops.addOverlay('rect'); V.seek(5); ops.addCaption('Привіт');
    V.seek(0);
  });
  await p.waitForTimeout(600);
  return p;
}
const items = (p, kind) => p.evaluate(k => { const P = window.VideoCut.S.project; return (k === 'music' ? P.music : k === 'overlay' ? P.overlays : k === 'caption' ? P.captions : P.clips).map(o => ({ id: o.id, start: +(o.start ?? 0).toFixed(3), dur: +((o.dur ?? (o.out - o.in)) ).toFixed(3) })); }, kind);
const rectOf = (p, id) => p.locator(`.it[data-id="${id}"]`).boundingBox();
async function dragBy(p, id, dx, dy = 0, steps = 6) { const b = await rectOf(p, id); const x = b.x + b.width / 2, y = b.y + b.height / 2; await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx / 2, y + dy / 2, { steps }); await p.mouse.move(x + dx, y + dy, { steps }); await p.mouse.up(); await p.waitForTimeout(250); }
const pickMany = (p, list) => p.evaluate(async list => { const st = await import('./videocut-app/js/state.js'); st.selectMany(list); }, list);

await run('групове перетягування: дві музики й голос зсуваються разом із однаковим кроком, скасування повертає все', async () => {
  const p = await richProject(); await audit(p, 'старт');
  const mu = await items(p, 'music'); assert.equal(mu.length, 3);
  await pickMany(p, mu.map(m => ({ kind: 'music', id: m.id }))); await p.waitForTimeout(200);
  const pps = await p.evaluate(() => window.VideoCut.S.pps);
  await dragBy(p, mu[1].id, 60);
  const after = await items(p, 'music'); const d = after[0].start - mu[0].start;
  assert.ok(d > 0.3, 'зсув вправо ' + d);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(after[i].start - mu[i].start - d) < 0.02, `елемент ${i} зсунувся на ${after[i].start - mu[i].start}, очікувалось ${d}`);
  await audit(p, 'після зсуву');
  await p.keyboard.press('Control+z'); await p.waitForTimeout(200);
  assert.deepEqual((await items(p, 'music')).map(m => m.start), mu.map(m => m.start), 'скасування повертає позиції');
  await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(200);
  assert.ok(Math.abs((await items(p, 'music'))[0].start - after[0].start) < 0.001, 'повтор повертає зсув');
  await p.close();
});

await run('групове перетягування: музика + текст + прямокутник + субтитр різних доріжок рухаються разом', async () => {
  const p = await richProject();
  const mu = await items(p, 'music'), ov = await items(p, 'overlay'), cc = await items(p, 'caption');
  await pickMany(p, [{ kind: 'music', id: mu[0].id }, { kind: 'overlay', id: ov[0].id }, { kind: 'overlay', id: ov[1].id }, { kind: 'caption', id: cc[0].id }]); await p.waitForTimeout(200);
  await dragBy(p, ov[0].id, 90);
  const a = { mu: await items(p, 'music'), ov: await items(p, 'overlay'), cc: await items(p, 'caption') };
  const d = a.ov[0].start - ov[0].start; assert.ok(d > 0.4, 'текст зсунувся ' + d);
  assert.ok(Math.abs(a.ov[1].start - ov[1].start - d) < 0.02, 'прямокутник: ' + (a.ov[1].start - ov[1].start));
  assert.ok(Math.abs(a.cc[0].start - cc[0].start - d) < 0.02, 'субтитр: ' + (a.cc[0].start - cc[0].start));
  assert.ok(Math.abs(a.mu[0].start - mu[0].start - d) < 0.02, 'музика: ' + (a.mu[0].start - mu[0].start));
  assert.ok(Math.abs(a.mu[1].start - mu[1].start) < 0.001 && Math.abs(a.mu[2].start - mu[2].start) < 0.001, 'невиділені музики стоять на місці');
  await audit(p, 'після зсуву'); await p.close();
});

await run('групове перетягування: у лівий край упираються разом, відстані між елементами не змінюються', async () => {
  const p = await richProject(); const mu = await items(p, 'music');
  await pickMany(p, mu.map(m => ({ kind: 'music', id: m.id }))); await p.waitForTimeout(200);
  await dragBy(p, mu[2].id, -900);
  const a = await items(p, 'music'); assert.ok(Math.min(...a.map(x => x.start)) >= -0.0001, 'нічого лівіше нуля: ' + JSON.stringify(a.map(x => x.start)));
  assert.ok(Math.abs((a[1].start - a[0].start) - (mu[1].start - mu[0].start)) < 0.02 && Math.abs((a[2].start - a[1].start) - (mu[2].start - mu[1].start)) < 0.02, 'відстані між елементами збережено: ' + JSON.stringify(a.map(x => x.start)));
  await audit(p, 'упор у нуль'); await p.close();
});

await run('групове перетягування: виділене відео + музика — переносяться обидва, а не лише один тип', async () => {
  const p = await richProject(); const mu = await items(p, 'music'), cl = await items(p, 'clip');
  await p.evaluate(async () => { const st = await import('./videocut-app/js/ops.js'); const V = window.VideoCut; st.splitAt; }); // лише імпорт
  await pickMany(p, [{ kind: 'clip', id: cl[0].id }, { kind: 'music', id: mu[0].id }]); await p.waitForTimeout(200);
  const before = JSON.stringify(await proj(p)); await dragBy(p, mu[0].id, 80);
  const a = await items(p, 'music'); assert.ok(a[0].start > mu[0].start + 0.3, 'музика зсунулась (виділена разом із кліпом): ' + a[0].start);
  await audit(p, 'змішане виділення'); await p.close();
});

await run('групове перетягування: заблокована доріжка не рухається, решта виділених — рухається', async () => {
  const p = await richProject(); const mu = await items(p, 'music'), ov = await items(p, 'overlay');
  await p.evaluate(async () => { const st = await import('./videocut-app/js/state.js'); st.S.project.tracks.ov = { ...(st.S.project.tracks.ov || {}), lock: true }; st.commit('Блокування'); });
  await pickMany(p, [{ kind: 'music', id: mu[0].id }, { kind: 'overlay', id: ov[0].id }]); await p.waitForTimeout(200);
  await dragBy(p, mu[0].id, 70); const a = await items(p, 'music'), o = await items(p, 'overlay');
  assert.ok(a[0].start > mu[0].start + 0.3, 'музика рухається'); assert.ok(Math.abs(o[0].start - ov[0].start) < 0.001, 'заблокована графіка стоїть');
  await audit(p, 'блокування'); await p.close();
});


// ═════ 3. Права панель: усі контролі кожного типу елемента ═════
const NUMERIC_KEYS = { clip: ['in', 'out', 'speed', 'volume', 'fadeIn', 'fadeOut', 'zoom', 'zx', 'zy'], music: ['start', 'in', 'out', 'volume', 'fadeIn', 'fadeOut'], overlay: ['start', 'dur', 'x', 'y', 'w', 'h', 'size', 'weight', 'stroke', 'radius', 'strength', 'dim', 'volume', 'bgAlpha', 'fade', 'opacity', 'rot', 'rotate'], caption: ['start', 'dur'] };
const typeAudit = async (p, kind, id, before) => {
  const bad = await p.evaluate(({ kind, id, before, keys }) => {
    const P = window.VideoCut.S.project, o = [...P.clips, ...P.music, ...P.overlays, ...P.captions].find(x => x.id === id); if (!o) return ['елемент зник'];
    const out = []; for (const k of keys) if (k in before && typeof before[k] === 'number' && typeof o[k] !== 'number') out.push(`${k}: було число, стало ${typeof o[k]} (${JSON.stringify(o[k])})`);
    return out;
  }, { kind, id, before, keys: NUMERIC_KEYS[kind] || [] });
  assert.deepEqual(bad, [], `${kind}: поля втратили числовий тип: ${bad.join('; ')}`);
};
async function fuzzPanel(p, kind, id, label) {
  const raw = await p.evaluate(({ id }) => { const P = window.VideoCut.S.project; return structuredClone([...P.clips, ...P.music, ...P.overlays, ...P.captions].find(x => x.id === id)); }, { id });
  await p.evaluate(async ({ kind, id }) => { (await import('./videocut-app/js/state.js')).select(kind, id); }, { kind, id }); await p.waitForTimeout(250);
  const tabs = await p.locator('#inspector [role=tab]').count();
  const dead = [];
  for (let ti = -1; ti < tabs; ti++) {
    if (ti >= 0) { await p.locator('#inspector [role=tab]').nth(ti).click(); await p.waitForTimeout(120); }
    const ctl = await p.evaluate(() => [...document.querySelectorAll('#inspector [data-f],#inspector [data-l],#inspector [data-color],#inspector [data-pf]')].filter(e => e.offsetParent && !e.disabled).map((e, i) => ({ i, f: e.dataset.f || e.dataset.l || e.dataset.color || e.dataset.pf, type: e.type || e.tagName.toLowerCase(), min: e.min, max: e.max, opts: e.tagName === 'SELECT' ? [...e.options].map(o => o.value) : null })));
    for (const c of ctl) {
      const values = c.opts ? c.opts : c.type === 'checkbox' ? [true, false, true] : c.type === 'range' ? [c.min, c.max, String((+c.min + +c.max) / 2)] : c.type === 'number' ? ['-5', '0', '0.0001', '99999999', '', '12.5'] : c.type === 'color' ? ['#ff00aa', '#000000'] : ['', 'Привіт', 'x'.repeat(3000), '<img src=x onerror=alert(1)>', '😀 емодзі\nдругий рядок'];
      for (const v of values) {
        const before = JSON.stringify(await proj(p));
        const ok = await p.evaluate(({ f, i, v }) => {
          const els = [...document.querySelectorAll('#inspector [data-f],#inspector [data-l],#inspector [data-color],#inspector [data-pf]')].filter(e => e.offsetParent && !e.disabled); const el = els[i]; if (!el) return false;
          if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true;
        }, { f: c.f, i: c.i, v });
        await p.waitForTimeout(40);
        if (ok) { const bad = await p.evaluate(AUDIT); assert.deepEqual(bad, [], `${label} · ${c.f} = ${JSON.stringify(v).slice(0, 40)}: ${bad.join('; ')}`); await typeAudit(p, kind, id, raw); }
      }
      // чи є контрол «мертвим» — жодне значення не змінило проєкт
    }
    if (ti >= 0) { /* залишаємо вкладку */ }
  }
  assert.deepEqual(p.errors.filter(e => !(p.allow || []).some(r => r.test(e))), [], `${label}: помилки сторінки`);
}
const lastOf = (p, kind) => p.evaluate(k => { const P = window.VideoCut.S.project; const l = { clip: P.clips, music: P.music, overlay: P.overlays, caption: P.captions }[k]; return l.at(-1).id; }, kind);

await run('права панель: усі контролі кліпа (відео) й кліпа-фото витримують крайні значення, проєкт лишається коректним', async () => {
  const p = await open(1500, 900); await addFiles(p, ['v1.webm', 'photo.png'], 2500);
  const ids = await p.evaluate(() => window.VideoCut.S.project.clips.map(c => c.id));
  await fuzzPanel(p, 'clip', ids[0], 'відеокліп'); await fuzzPanel(p, 'clip', ids[1], 'фото-кліп'); await p.close();
});

await run('права панель: усі контролі музики, голосу й субтитру витримують крайні значення', async () => {
  const p = await richProject(); const mu = await items(p, 'music'), cc = await items(p, 'caption');
  await fuzzPanel(p, 'music', mu[0].id, 'музика'); await fuzzPanel(p, 'music', mu[2].id, 'голос'); await fuzzPanel(p, 'caption', cc[0].id, 'субтитр'); await p.close();
});

await run('права панель: усі контролі текстових шаблонів і фігур (текст, емодзі, прямокутник, стрілка, розмиття, прожектор, прогрес)', async () => {
  const p = await open(1500, 900); await addFiles(p, ['v1.webm'], 1500);
  for (const [type, extra] of [['text', { preset: 'title' }], ['text', { preset: 'lower' }], ['emoji', {}], ['rect', {}], ['arrow', {}], ['blur', {}], ['spot', {}], ['progress', {}]]) {
    await p.evaluate(async ({ type, extra }) => { const ops = await import('./videocut-app/js/ops.js'); window.VideoCut.seek(1); ops.addOverlay(type, extra); }, { type, extra }); await p.waitForTimeout(200);
    const id = await lastOf(p, 'overlay'); await fuzzPanel(p, 'overlay', id, `накладання ${type}${extra.preset ? ':' + extra.preset : ''}`);
  }
  await p.close();
});

await run('права панель: відео й фото поверх основного (Відео 2): усі контролі, форми, обрізка, розмір', async () => {
  const p = await open(1500, 900); await addFiles(p, ['v1.webm', 'v2.webm', 'photo.jpg'], 3000);
  await p.evaluate(async () => { const ops = await import('./videocut-app/js/ops.js'), V = window.VideoCut; const ms = [...V.media.values()]; V.seek(1); ops.addLayerAt(ms.find(m => m.name === 'v2.webm'), { start: 1 }); ops.addLayerAt(ms.find(m => m.name === 'photo.jpg'), { start: 2 }); });
  await p.waitForTimeout(400); const ov = await items(p, 'overlay');
  for (const o of ov) await fuzzPanel(p, 'overlay', o.id, 'шар поверх відео'); await p.close();
});


// ═════ 4. «Мавпа»: випадкові дії з перевіркою інваріантів після кожної ═════
const rngOf = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
async function monkey(seed, steps) {
  const p = await open(1500, 900); p.allow = [/Поставте|Не вдалося/];
  await addFiles(p, ['v1.webm', 'v2.webm', 'photo.png', 'photo.jpg', 'a1.webm', 'a2.wav'], 4500);
  const R = rngOf(seed), log = [];
  const pick = a => a[Math.floor(R() * a.length)];
  const OPS = ['addText', 'addShape', 'addLayerV', 'addLayerImg', 'addMusic', 'addVoice', 'addClip', 'split', 'splitMusic', 'delete', 'dup', 'copyPaste', 'cut', 'speed', 'trim', 'gain', 'fades', 'aspect', 'marker', 'undo', 'undo', 'redo', 'transition', 'moveZ', 'track', 'caption', 'multiMove', 'seek', 'cutMarks', 'rippleDelete'];
  for (let i = 0; i < steps; i++) {
    const op = pick(OPS), a = R(), b = R(), c = R(), d = R(); log.push(`${i}:${op}(${a.toFixed(2)},${b.toFixed(2)},${c.toFixed(2)})`);
    let err = null;
    try {
      await p.evaluate(async ({ op, a, b, c, d }) => {
        const V = window.VideoCut, ops = await import('./videocut-app/js/ops.js'), st = await import('./videocut-app/js/state.js'), tl = await import('./videocut-app/js/timeline.js');
        const P = () => V.S.project, ms = [...V.media.values()], byName = n => ms.find(m => m.name === n);
        const dur = Math.max(1, V.duration()), at = () => a * dur;
        const all = () => [...P().clips.map(o => ({ kind: 'clip', id: o.id })), ...P().overlays.map(o => ({ kind: 'overlay', id: o.id })), ...P().captions.map(o => ({ kind: 'caption', id: o.id })), ...P().music.map(o => ({ kind: 'music', id: o.id }))];
        const some = () => { const l = all(); if (!l.length) return []; const n = 1 + Math.floor(b * Math.min(3, l.length)); const out = []; for (let k = 0; k < n; k++) out.push(l[Math.floor(((c + k * 0.37) % 1) * l.length)]); return [...new Map(out.map(x => [x.id, x])).values()]; };
        const itemOf = x => ({ clip: P().clips, overlay: P().overlays, caption: P().captions, music: P().music })[x.kind].find(o => o.id === x.id);
        switch (op) {
          case 'addText': V.seek(at()); ops.addOverlay('text', { preset: ['title', 'subtitle', 'lower', 'step', 'note', 'plain'][Math.floor(b * 6)] }); break;
          case 'addShape': V.seek(at()); ops.addOverlay(['rect', 'arrow', 'blur', 'spot', 'emoji', 'progress'][Math.floor(b * 6)]); break;
          case 'addLayerV': V.seek(at()); ops.addLayerAt(byName(b < .5 ? 'v1.webm' : 'v2.webm'), { start: at() }); break;
          case 'addLayerImg': V.seek(at()); ops.addLayerAt(byName(b < .5 ? 'photo.png' : 'photo.jpg'), { start: at() }); break;
          case 'addMusic': V.seek(at()); ops.addMusic(byName(b < .5 ? 'a1.webm' : 'a2.wav'), false, b < .3 ? null : at()); break;
          case 'addVoice': ops.addVoice(byName('a2.wav'), at(), b * 0.3); break;
          case 'addClip': ops.addToTimeline(byName(['v1.webm', 'v2.webm', 'photo.png', 'photo.jpg'][Math.floor(b * 4)]), { at: P().clips.length ? Math.floor(c * (P().clips.length + 1)) : null }); break;
          case 'split': V.seek(at()); { const l = all().filter(x => x.kind !== 'music'); if (l.length && b < .5) st.select(l[Math.floor(c * l.length)].kind, l[Math.floor(c * l.length)].id); ops.splitAt(); } break;
          case 'splitMusic': { const m = P().music; if (m.length) { const x = m[Math.floor(c * m.length)]; st.select('music', x.id); V.seek(x.start + (x.out - x.in) * b); ops.splitAt(); } } break;
          case 'delete': st.selectMany(some()); ops.deleteSel(); break;
          case 'dup': st.selectMany(some()); ops.duplicateSel(); break;
          case 'copyPaste': st.selectMany(some()); if (ops.copySel(b < .2)) { V.seek(at()); ops.pasteClip(); } break;
          case 'cut': { const x = at(), y = x + b * 3; ops.cutRange(x, y); } break;
          case 'cutMarks': { st.S.markIn = at(); st.S.markOut = at() + c * 2; ops.cutRange(st.S.markIn, st.S.markOut); } break;
          case 'rippleDelete': { const cl = P().clips; if (cl.length) { st.select('clip', cl[Math.floor(c * cl.length)].id); ops.deleteSel(); } } break;
          case 'speed': { const cl = P().clips; if (cl.length) { const x = cl[Math.floor(c * cl.length)]; x.speed = [0.1, 0.25, 0.5, 1, 2, 4, 8][Math.floor(b * 7)]; st.commit('Швидкість'); } } break;
          case 'trim': { const cl = P().clips; if (cl.length) { const x = cl[Math.floor(c * cl.length)], m = V.media.get(x.mediaId); if (m) { x.in = Math.min(m.duration - 0.2, a * m.duration); x.out = Math.max(x.in + 0.1, Math.min(m.duration, x.in + b * m.duration)); st.commit('Обрізка'); } } } break;
          case 'gain': { const l = some().map(itemOf).filter(Boolean); for (const o of l) if ('volume' in o) o.volume = Math.round(b * 4) / 2; st.commit('Гучність'); } break;
          case 'fades': { const l = some().map(itemOf).filter(Boolean); for (const o of l) if ('fadeIn' in o) { o.fadeIn = b * 5; o.fadeOut = c * 8; } st.commit('Фейди'); } break;
          case 'aspect': P().aspect = ['16:9', '9:16', '1:1', '4:3'][Math.floor(b * 4)]; st.commit('Формат'); st.emit('aspect'); break;
          case 'marker': V.seek(at()); ops.addMarker(); break;
          case 'undo': for (let k = 0; k < 1 + Math.floor(b * 3); k++) st.undo(); break;
          case 'redo': for (let k = 0; k < 1 + Math.floor(b * 3); k++) st.redo(); break;
          case 'transition': ops.transitionsAll(['fade', 'dissolve', 'slide'][Math.floor(b * 3)] || 'fade'); break;
          case 'moveZ': st.selectMany(some().filter(x => x.kind === 'overlay')); ops.moveZ(b < .5 ? 1 : -1); break;
          case 'track': tl.toggleTrack(['v', 'v2', 'a', 'cc', 'ov'][Math.floor(b * 5)], ['hide', 'mute', 'solo', 'lock'][Math.floor(c * 4)]); break;
          case 'caption': V.seek(at()); ops.addCaption('Текст ' + Math.floor(b * 100)); break;
          case 'multiMove': { const l = some().map(x => ({ x, o: itemOf(x) })).filter(z => z.o && z.x.kind !== 'clip'); const dt = (b - .5) * 6; for (const { o } of l) o.start = Math.max(0, o.start + dt); st.commit('Зсув'); } break;
          case 'seek': V.seek(at()); break;
        }
      }, { op, a, b, c, d });
      await p.waitForTimeout(70);
    } catch (e) { err = e; }
    const bad = err ? ['виняток: ' + err.message.split('\n')[0]] : await p.evaluate(AUDIT);
    const errs = p.errors.filter(e => !(p.allow || []).some(r => r.test(e)));
    if (bad.some(b => /налазять/.test(b))) { const g = await p.evaluate(async () => { const st = await import('./videocut-app/js/state.js'); return { pps: window.VideoCut.S.pps, dom: [...document.querySelectorAll('.lane-v .it')].map(e => [e.dataset.id.slice(-4), Math.round(e.getBoundingClientRect().left * 10) / 10, Math.round(e.getBoundingClientRect().width * 10) / 10, e.style.left, e.style.width]), lay: st.layout().map(l => [l.clip.id.slice(-4), +l.start.toFixed(3), +l.end.toFixed(3), l.clip.speed]) }; }); console.log('   геометрія:', JSON.stringify(g)); }
    if (bad.length || errs.length) { await p.close(); throw new Error(`крок ${i} ${log[i]}: ${[...bad, ...errs].join('; ')}\n  ланцюжок: ${log.slice(Math.max(0, i - 12), i + 1).join(' → ')}`); }
  }
  await p.close();
}
for (const seed of (process.env.VC_SEEDS ? process.env.VC_SEEDS.split(",").map(Number) : [1, 2, 3, 4])) await run(`мавпа (seed ${seed}): 150 випадкових дій, після кожної проєкт коректний`, () => monkey(seed, 150));


// ═════ 5. Експорт змішаного проєкту: відео + фото + вертикальне відео + музика + накладання ═════
const probe = f => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]).toString());
// середня гучність (дБ) відрізка [t, t+d) у файлі; null — звуку немає зовсім
const rmsOf = (f, t, d) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-ss', String(t), '-t', String(d), '-i', f, '-af', 'astats', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = [...((r.stderr || '') + (r.stdout || '')).matchAll(/RMS level dB: (-?inf|-?[\d.]+)/g)].pop();
  return m ? (m[1].includes('inf') ? -Infinity : parseFloat(m[1])) : null;
};
const frameRGB = (f, t) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', 'scale=16:16', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 1e6 }); const b = r.stdout; if (!b || b.length < 768) return null; let R = 0, G = 0, B = 0, mx = 0, mn = 255; for (let i = 0; i < 768; i += 3) { R += b[i]; G += b[i + 1]; B += b[i + 2]; mx = Math.max(mx, b[i], b[i + 1], b[i + 2]); mn = Math.min(mn, b[i], b[i + 1], b[i + 2]); } return { r: R / 256, g: G / 256, b: B / 256, range: mx - mn }; };

async function exportBlob(p, opts) {
  const b64 = await p.evaluate(async opts => { const blob = await window.VideoCut.exportVideo(opts); const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode(...buf.subarray(i, i + 32768)); return btoa(s); }, opts);
  const f = join(tmp, 'out-' + Math.random().toString(36).slice(2) + '.webm'); await writeFile(f, Buffer.from(b64, 'base64')); return f;
}

await run('експорт: відео + фото + вертикальне відео + музика + накладання — тривалість, звук по відрізках, кадри не чорні', async () => {
  const p = await open(1500, 900); p.allow = [/Поставте/];
  await addFiles(p, ['v1.webm', 'photo.png', 'v2.webm', 'a2.wav'], 3500);
  await p.evaluate(async () => {
    const V = window.VideoCut, ops = await import('./videocut-app/js/ops.js'), st = await import('./videocut-app/js/state.js');
    const P = V.S.project; P.clips[0].out = 4; P.clips[1].out = 3; P.clips[2].out = 3; P.music.length = 0; st.commit('Склад');
    const m = ops.addMusic([...V.media.values()].find(x => x.name === 'a2.wav'), true, 2); m.out = 5; m.volume = 0.5; m.duck = false; m.fadeIn = 0; m.fadeOut = 0; st.commit('Музика');
    V.seek(1); ops.addOverlay('text', { preset: 'title' }); V.seek(5); ops.addOverlay('blur');
  });
  await p.waitForTimeout(500); await audit(p, 'перед експортом');
  const dur = await p.evaluate(() => window.VideoCut.duration()); assert.ok(Math.abs(dur - 10) < 0.1, 'тривалість проєкту ' + dur);
  const f = await exportBlob(p, { format: 'webm', quality: 'low', short: 360, fps: 15 });
  const info = probe(f), vs = info.streams.find(s => s.codec_type === 'video'), as = info.streams.find(s => s.codec_type === 'audio');
  assert.ok(vs && as, 'є і відео, і звук'); assert.ok(Math.abs(parseFloat(info.format.duration) - 10) < 0.35, 'тривалість файлу ' + info.format.duration);
  assert.equal(vs.height, 360); assert.equal(vs.width, 640);
  const r = (t, d) => rmsOf(f, t, d);
  const a1 = r(0.2, 1.4), a2 = r(2.3, 1.4), a3 = r(4.5, 2), a4 = r(7.5, 2);
  assert.ok(a1 > -35, `0–2 с: звучить відео (${a1} дБ)`); assert.ok(a2 > a1 - 3 && a2 > -35, `2–4 с: відео й музика разом (${a2} дБ)`);
  assert.ok(a3 > -45 && a3 < a1, `4–7 с: лише тиха музика (${a3} дБ)`); assert.ok(a4 === null || a4 < -60, `7–10 с: тиша (${a4} дБ)`);
  for (const [t, name] of [[1, 'відео'], [5.5, 'фото'], [8.5, 'вертикальне відео']]) { const c = frameRGB(f, t); assert.ok(c && c.range > 40, `${name} на ${t} с не чорний і не однотонний: ${JSON.stringify(c)}`); }
  await audit(p, 'після експорту'); await p.close();
});

await run('експорт: усі формати кадру (9:16, 1:1, 4:3) дають правильні розміри й тривалість', async () => {
  const p = await open(1500, 900); await addFiles(p, ['v1.webm', 'photo.png'], 2500);
  await p.evaluate(() => { const P = window.VideoCut.S.project; P.clips[0].out = 3; P.clips[1].out = 2; });
  for (const [asp, w, h] of [['9:16', 360, 640], ['1:1', 360, 360], ['4:3', 480, 360]]) {
    await p.evaluate(async asp => { const st = await import('./videocut-app/js/state.js'); window.VideoCut.S.project.aspect = asp; st.commit('Формат'); st.emit('aspect'); }, asp);
    const f = await exportBlob(p, { format: 'webm', quality: 'low', short: 360, fps: 15 }); const info = probe(f), vs = info.streams.find(s => s.codec_type === 'video');
    assert.equal(vs.width + 'x' + vs.height, `${w}x${h}`, asp); assert.ok(Math.abs(parseFloat(info.format.duration) - 5) < 0.35, asp + ' тривалість ' + info.format.duration);
  }
  await p.close();
});

await run('експорт: діапазон, вимкнена доріжка звуку й порожній проєкт', async () => {
  const p = await open(1500, 900); await addFiles(p, ['v1.webm', 'a2.wav'], 2500);
  const f = await exportBlob(p, { format: 'webm', quality: 'low', short: 360, fps: 15, range: [2, 4] }); assert.ok(Math.abs(parseFloat(probe(f).format.duration) - 2) < 0.3, 'діапазон 2 с');
  await p.evaluate(async () => { const st = await import('./videocut-app/js/state.js'); st.S.project.tracks.a = { mute: true }; st.S.project.tracks.v = { mute: true }; st.commit('Без звуку'); });
  const f2 = await exportBlob(p, { format: 'webm', quality: 'low', short: 360, fps: 15, range: [0, 3] }); const a = rmsOf(f2, 0.5, 2); assert.ok(a === null || a < -60, 'звук вимкнено в експорті: ' + a);
  const p2 = await open(); const err = await p2.evaluate(async () => { try { await window.VideoCut.exportVideo({ format: 'webm', quality: 'low', short: 360 }); return ''; } catch (e) { return e.message; } }); assert.match(err, /порожній|Немає що/);
  await p.close(); await p2.close();
});


// ═════ 6. Збереження: файл проєкту й автозбереження ═════
async function fingerprint(p) { return p.evaluate(() => { const { S, media } = window.VideoCut; const P = JSON.parse(JSON.stringify(S.project)); const mm = [...media.values()].map(m => ({ id: m.id, name: m.name, kind: m.kind, d: +m.duration.toFixed(2), size: m.blob?.size })).sort((a, b) => a.id.localeCompare(b.id)); return { P, mm, dur: +window.VideoCut.duration().toFixed(3) }; }); }
const menuClick = async (p, i, text) => { await p.evaluate(i => document.querySelector(`[data-m="${i}"]`).click(), i); await p.locator('.mb-it', { hasText: text }).click(); };

await run('збереження у файл і відкриття: усі типи елементів, налаштування й медіа збігаються до байта, проєкт відтворюється', async () => {
  const p = await richProject();
  await p.evaluate(async () => {
    const V = window.VideoCut, ops = await import('./videocut-app/js/ops.js'), st = await import('./videocut-app/js/state.js'); const P = V.S.project;
    const ms = [...V.media.values()]; ops.addLayerAt(ms.find(m => m.name === 'a1.webm') ? ms[0] : ms[0], { start: 1 });
    P.clips[0].speed = 1.5; P.clips[0].volume = 0.7; P.clips[0].fadeIn = 0.5; P.clips[0].filter = 'warm'; P.music[0].volume = 0.3; P.music[0].fadeOut = 2; P.markers = [{ id: 'm1', t: 3, name: 'Мітка' }]; P.name = 'Урок №1 «Тест»'; P.aspect = '4:3'; st.commit('Налаштування');
  });
  await p.waitForTimeout(500); const before = await fingerprint(p);
  const dl = p.waitForEvent('download'); await menuClick(p, 0, 'Зберегти проєкт у файл'); const d = await dl; const path = join(tmp, 'rich.evproj'); await d.saveAs(path);
  await menuClick(p, 0, 'Новий проєкт'); await p.locator('#confirmYes').click(); assert.equal(await p.evaluate(() => window.VideoCut.S.project.clips.length), 0);
  await p.setInputFiles('#projInput', path); await p.waitForFunction(n => window.VideoCut.S.project.clips.length === n, before.P.clips.length, { timeout: 20000 }); await p.waitForTimeout(1200);
  const after = await fingerprint(p);
  { const diff = []; const cmp = (a, b, path) => { if (JSON.stringify(a) === JSON.stringify(b)) return; if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) cmp(a[k], b[k], path + '.' + k); } else if (!(b === undefined && /\.(tracks|luts)/.test(path))) diff.push(`${path}: було ${JSON.stringify(b)?.slice(0, 60)}, стало ${JSON.stringify(a)?.slice(0, 60)}`); }; cmp(after.P, before.P, 'project'); assert.deepEqual(diff, [], 'проєкт збігається: ' + diff.slice(0, 8).join(' | ')); }
  assert.deepEqual(after.mm.map(m => [m.name, m.kind, m.d, m.size]), before.mm.map(m => [m.name, m.kind, m.d, m.size]), 'медіафайли збігаються'); assert.equal(after.dur, before.dur);
  await audit(p, 'після відкриття');
  await p.evaluate(() => window.VideoCut.seek(2.5)); await p.waitForTimeout(500); await audit(p, 'після перемотування');
  await p.close();
});

await run('автозбереження: перезавантаження сторінки повертає проєкт зі всіма файлами; Скасувати працює далі', async () => {
  const p = await richProject(); await p.waitForTimeout(1800);
  const before = await fingerprint(p);
  await p.reload(); await p.waitForFunction(() => window.VideoCut); await p.waitForFunction(n => window.VideoCut.S.project.clips.length === n && window.VideoCut.media.size >= 3, before.P.clips.length, { timeout: 20000 }); await p.waitForTimeout(1200);
  const after = await fingerprint(p);
  assert.deepEqual(after.P.clips.map(c => [c.in, c.out, c.speed]), before.P.clips.map(c => [c.in, c.out, c.speed])); assert.equal(after.P.music.length, before.P.music.length); assert.equal(after.P.overlays.length, before.P.overlays.length); assert.equal(after.P.captions.length, before.P.captions.length);
  assert.deepEqual(after.mm.map(m => m.name).sort(), before.mm.map(m => m.name).sort(), 'усі файли повернулися');
  await audit(p, 'після перезавантаження');
  await p.close();
});

await run('автозбереження: правка за мить до закриття вкладки не губиться (pagehide)', async () => {
  const p = await open(); await addFiles(p, ['v1.webm'], 1500);
  await p.evaluate(async () => { const st = await import('./videocut-app/js/state.js'); window.VideoCut.S.project.name = 'Остання правка'; st.commit('Назва'); });
  await p.waitForTimeout(150); await p.reload(); await p.waitForFunction(() => window.VideoCut); await p.waitForTimeout(1500);
  assert.equal(await p.evaluate(() => window.VideoCut.S.project.name), 'Остання правка'); await p.close();
});

await run('відкриття: чужий і обірваний файли проєкту дають зрозумілу помилку, редактор не ламається', async () => {
  const p = await richProject(); p.allow = [/проєкт|Файл|пошкоджено|не файл|обірваний|Error/];
  const before = await fingerprint(p);
  await writeFile(F('bad.evproj'), Buffer.from('NOTEVPRO' + 'x'.repeat(100))); await p.setInputFiles('#projInput', F('bad.evproj')); await p.waitForTimeout(800);
  const dl = p.waitForEvent('download'); await menuClick(p, 0, 'Зберегти проєкт у файл'); const d = await dl; await d.saveAs(F('good.evproj'));
  const buf = await readFile(F('good.evproj')); await writeFile(F('cut.evproj'), buf.subarray(0, Math.floor(buf.length * 0.6)));
  await p.setInputFiles('#projInput', F('cut.evproj')); await p.waitForTimeout(1200);
  const after = await fingerprint(p); assert.deepEqual(after.P.clips.map(c => c.id), before.P.clips.map(c => c.id), 'поточний проєкт не зіпсовано'); await audit(p, 'після помилок відкриття'); await p.close();
});


// ═════ 7. Обрізка країв мишею: крайні положення для кожного типу ═════
async function dragHandle(p, id, side, dx) { const b = await rectOf(p, id); const x = side === 'l' ? b.x + 2 : b.x + b.width - 2, y = b.y + b.height / 2; await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx / 2, y, { steps: 6 }); await p.mouse.move(x + dx, y, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(250); }
await run('обрізка країв: відеокліп, фото, музика, голос, текст, відео поверх, субтитр — на всю довжину й до нуля в обидва боки', async () => {
  const p = await richProject();
  await p.evaluate(async () => { const V = window.VideoCut, ops = await import('./videocut-app/js/ops.js'), st = await import('./videocut-app/js/state.js'); const ms = [...V.media.values()]; st.S.snap = false;
    ops.addToTimeline(ms.find(m => m.name === 'v1.webm'), { silent: true }); V.seek(1); ops.addLayerAt(ms.find(m => m.name === 'v1.webm'), { start: 1 }); });
  await p.waitForTimeout(500); await audit(p, 'старт');
  const targets = await p.evaluate(() => { const P = window.VideoCut.S.project; return [['clip', P.clips[0].id], ['music', P.music[0].id], ['music', P.music[2].id], ['overlay', P.overlays[0].id], ['overlay', P.overlays.find(o => o.type === 'video').id], ['caption', P.captions[0].id]]; });
  for (const [kind, id] of targets) for (const [side, dx] of [['l', 4000], ['l', -4000], ['r', 4000], ['r', -4000], ['l', 60], ['r', -60]]) {
    await p.evaluate(async ({ kind, id }) => { (await import('./videocut-app/js/state.js')).select(kind, id); }, { kind, id });
    if (!await p.locator(`.it[data-id="${id}"]`).count()) continue;
    await p.locator(`.it[data-id="${id}"]`).scrollIntoViewIfNeeded().catch(() => {});
    const vis = await rectOf(p, id); if (!vis || vis.width < 6) continue;
    await dragHandle(p, id, side, dx).catch(() => {});
    await audit(p, `${kind} ${side} ${dx}`);
  }
  await p.close();
});

await run('обрізка: фото розтягується, а відео не довше за файл; обидва краї кліпа не виходять за межі файла', async () => {
  const p = await open(1500, 900); await addFiles(p, ['v1.webm', 'photo.png'], 2500); await p.evaluate(async () => { (await import('./videocut-app/js/state.js')).S.snap = false; });
  const ids = await p.evaluate(() => window.VideoCut.S.project.clips.map(c => c.id));
  await dragHandle(p, ids[0], 'r', 5000); let c = await p.evaluate(() => { const P = window.VideoCut.S.project, m = window.VideoCut.media.get(P.clips[0].mediaId); return { out: P.clips[0].out, max: m.duration, inn: P.clips[0].in }; });
  assert.ok(c.out <= c.max + 1e-6, `out ${c.out} не більше за файл ${c.max}`);
  await dragHandle(p, ids[0], 'l', -5000); c = await p.evaluate(() => window.VideoCut.S.project.clips[0].in); assert.ok(c >= 0, 'початок не від’ємний ' + c);
  const w0 = (await rectOf(p, ids[1])).width; await dragHandle(p, ids[1], 'r', 300); const w1 = (await rectOf(p, ids[1])).width; assert.ok(w1 > w0 + 100, 'фото розтягується ' + w0 + ' → ' + w1);
  await audit(p, 'межі'); await p.close();
});

// ═════ 8. Бібліотека: перетягування файлів на доріжки ═════
async function dropFromLibrary(p, mediaName, laneSel, dxFrac = 0.5) {
  const id = await p.evaluate(n => [...window.VideoCut.media.values()].find(m => m.name === n).id, mediaName);
  const lane = p.locator(laneSel).first(); const b = await lane.boundingBox(); assert.ok(b, 'доріжка ' + laneSel);
  await p.evaluate(async ({ id, x, y, sel }) => {
    const dt = new DataTransfer(); dt.setData('application/x-vc-media', id);
    const card = document.querySelector(`.mcard[data-id="${id}"]`); card?.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 30));
    const tgt = document.querySelector(sel) || document.elementFromPoint(x, y);
    for (const type of ['dragenter', 'dragover', 'drop']) tgt.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    card?.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  }, { id, x: b.x + b.width * dxFrac, y: b.y + b.height / 2, sel: laneSel });
  await p.waitForTimeout(400);
}
await run('перетягування з бібліотеки: відео — у кінець/між кліпами, фото — поверх відео, аудіо — на музичну доріжку, у порожній таймлайн', async () => {
  const p = await open(1500, 900); await addFiles(p, ['v1.webm', 'v2.webm', 'photo.png', 'a1.webm'], 3500);
  await p.evaluate(async () => { const st = await import('./videocut-app/js/state.js'); window.VideoCut.S.project.clips.length = 0; window.VideoCut.S.project.music.length = 0; st.commit('Очищено'); });
  await p.waitForTimeout(300); await p.locator('[data-tab="media"]').click().catch(() => {});
  await dropFromLibrary(p, 'v1.webm', '.tl-lanes, .lane-v, .lane'); await audit(p, 'у порожній таймлайн'); assert.equal((await info(p)).clips.length, 1);
  await dropFromLibrary(p, 'v2.webm', '.lane-v', 0.2); await audit(p, 'між кліпами'); let i = await info(p); assert.equal(i.clips.length, 2);
  const order = await p.evaluate(() => window.VideoCut.S.project.clips.map(c => window.VideoCut.media.get(c.mediaId).name)); assert.deepEqual(order, ['v2.webm', 'v1.webm'], 'вставлено ліворуч від першого: ' + order);
  await dropFromLibrary(p, 'photo.png', '.lane-v', 0.99); await audit(p, 'фото в кінець'); assert.equal((await info(p)).clips.length, 3);
  await dropFromLibrary(p, 'a1.webm', '.lane-a, .lane-v'); await audit(p, 'аудіо'); i = await info(p); assert.equal(i.music, 1, 'аудіо стало музикою: ' + JSON.stringify(i));
  await p.close();
});


// ═════ 9. Ліва панель: кожна кнопка кожної вкладки ═════
await run('ліва панель: усі кнопки вкладок «Медіа», «Текст», «Елементи», «Субтитри» працюють без помилок, проєкт лишається коректним', async () => {
  const p = await open(1500, 900); p.allow = [/Поставте/]; await addFiles(p, ['v1.webm', 'photo.png', 'a1.webm'], 3000);
  const SKIP = '#btnImport2, #btnAutoCap, #btnImpCap, [data-act="rm"]';
  for (const tab of ['media', 'text', 'elements', 'captions']) {
    await p.locator(`#libTabs [data-tab="${tab}"]`).click(); await p.waitForTimeout(250);
    const n = await p.locator(`#libBody button:not(${SKIP.replace(/, /g, '):not(')})`).count();
    assert.ok(n > 0, 'вкладка ' + tab + ' має кнопки');
    for (let i = 0; i < n; i++) {
      const btn = p.locator(`#libBody button:not(${SKIP.replace(/, /g, '):not(')})`).nth(i);
      if (!await btn.isVisible().catch(() => false)) continue;
      const label = await btn.evaluate(e => (e.id || '') + JSON.stringify(e.dataset) + e.innerText.trim().slice(0, 20));
      await btn.click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(90);
      if (await p.locator('.modal.open, .modal[open], .overlay.open').count()) await p.keyboard.press('Escape');
      const bad = await p.evaluate(AUDIT); assert.deepEqual(bad, [], `${tab} · ${label}: ${bad.join('; ')}`);
    }
  }
  assert.deepEqual(p.errors.filter(e => !(p.allow || []).some(r => r.test(e))), [], 'помилки сторінки'); await p.close();
});


// ═════ 10. Відтворення ═════
await run('відтворення: відео → фото → вертикальне відео з музикою й накладаннями грає без зупинок, доходить до кінця й зупиняється', async () => {
  const p = await open(1500, 900); p.allow = [/Поставте|NotAllowed|play\(\)/];
  await addFiles(p, ['v1.webm', 'photo.png', 'v2.webm', 'a2.wav'], 3500);
  await p.evaluate(async () => { const V = window.VideoCut, ops = await import('./videocut-app/js/ops.js'), st = await import('./videocut-app/js/state.js'); const P = V.S.project; P.clips[0].out = 3; P.clips[1].out = 2; P.clips[2].out = 2; st.commit('Склад'); V.seek(0.5); ops.addOverlay('text', { preset: 'title' }); ops.addLayerAt([...V.media.values()].find(m => m.name === 'v2.webm'), { start: 1 }); V.seek(0); });
  await p.waitForTimeout(500); const dur = await p.evaluate(() => window.VideoCut.duration());
  await p.keyboard.press('Space'); const samples = [];
  for (let k = 0; k < Math.ceil((dur + 1.5) * 5); k++) { await p.waitForTimeout(200); samples.push(await p.evaluate(() => ({ t: window.VideoCut.S.t, playing: window.VideoCut.S.playing }))); if (!samples.at(-1).playing) break; }
  const last = samples.at(-1); assert.ok(!last.playing, 'відтворення зупинилось наприкінці'); assert.ok(last.t >= dur - 0.3, `дійшли до кінця ${last.t} з ${dur}`);
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i].t >= samples[i - 1].t - 0.001 && samples[i].t - samples[i - 1].t < 0.9, `без стрибків і зупинок: ${samples[i - 1].t} → ${samples[i].t}`);
  await audit(p, 'після відтворення'); await p.close();
});

await run('відтворення: швидкі Space, перемотування під час гри, J/L, стрілки, Home/End — стан не ламається', async () => {
  const p = await richProject(); p.allow = [/Поставте|NotAllowed|play\(\)|AbortError/];
  for (let i = 0; i < 12; i++) { await p.keyboard.press('Space'); await p.waitForTimeout(40 + (i % 3) * 50); }
  for (const k of ['KeyL', 'KeyJ', 'ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'End', 'Home', 'Shift+ArrowRight', 'Shift+ArrowLeft']) { await p.keyboard.press(k); await p.waitForTimeout(80); await audit(p, 'клавіша ' + k); }
  await p.keyboard.press('Space'); await p.waitForTimeout(300); await p.evaluate(() => window.VideoCut.seek(window.VideoCut.duration() - 0.05)); await p.waitForTimeout(600);
  await p.evaluate(() => window.VideoCut.seek(0)); await p.waitForTimeout(200); await audit(p, 'після перемотувань'); await p.close();
});

// ═════ 11. Гарячі клавіші з груповим виділенням ═════
await run('клавіші: Ctrl+A, Ctrl+C/V, Ctrl+D, Ctrl+X, Delete для змішаного виділення (музика + голос + текст + субтитр)', async () => {
  const p = await richProject(); const n0 = async () => (await proj(p));
  const count = o => o.clips.length + o.music.length + o.overlays.length + o.captions.length;
  await p.evaluate(() => document.body.focus()); await p.keyboard.press('Control+a'); await p.waitForTimeout(150);
  const sel = await p.evaluate(() => window.VideoCut.S.multi.length); assert.ok(sel >= 6, 'Ctrl+A виділяє все: ' + sel);
  await audit(p, 'виділено все');
  await p.evaluate(async () => { const st = await import('./videocut-app/js/state.js'); const P = window.VideoCut.S.project; st.selectMany([...P.music.map(x => ({ kind: 'music', id: x.id })), ...P.overlays.map(x => ({ kind: 'overlay', id: x.id })), ...P.captions.map(x => ({ kind: 'caption', id: x.id }))]); });
  const before = count(await n0());
  await p.keyboard.press('Control+d'); await p.waitForTimeout(200); await audit(p, 'Ctrl+D'); assert.equal(count(await n0()), before + 6, 'дублювання додає по копії кожного');
  await p.keyboard.press('Control+z'); await p.waitForTimeout(150); assert.equal(count(await n0()), before, 'скасування прибирає копії');
  await p.evaluate(async () => { const st = await import('./videocut-app/js/state.js'); const P = window.VideoCut.S.project; st.selectMany([...P.music.map(x => ({ kind: 'music', id: x.id })), ...P.overlays.map(x => ({ kind: 'overlay', id: x.id }))]); });
  await p.keyboard.press('Control+c'); await p.evaluate(() => window.VideoCut.seek(8)); await p.keyboard.press('Control+v'); await p.waitForTimeout(250); await audit(p, 'Ctrl+V');
  const a = await n0(); assert.equal(count(a), before + 5, 'вставлено 3 музики + 2 накладання'); 
  const starts = a.music.map(x => x.start).sort((x, y) => x - y).slice(-3); assert.ok(starts[0] >= 7.99, 'вставлено у позиції курсора: ' + starts);
  await p.keyboard.press('Delete'); await p.waitForTimeout(200); await audit(p, 'Delete'); { const c = count(await n0()); assert.ok(c <= before, `Delete видаляє виділене (вставлені елементи): було ${before + 5}, стало ${c}, виділено ${await p.evaluate(() => JSON.stringify(window.VideoCut.S.multi.length + '/' + (window.VideoCut.S.sel && window.VideoCut.S.sel.kind)))}`); }
  await p.keyboard.press('Control+z'); await p.waitForTimeout(100); await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(100); await audit(p, 'скасувати й повторити'); await p.close();
});


// ═════ 12. Макет: вікна різних розмірів ═════
await run('макет: на екранах 1024–1920 пікселів панель перегляду не має накладань, сторінка не прокручується вбік, права панель вміщається', async () => {
  for (const [w, h] of [[1024, 640], [1180, 720], [1280, 720], [1366, 768], [1536, 864], [1920, 1080]]) {
    const p = await richProject(); await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(500);
    for (const sel of ['music', 'clip', 'overlay']) {
      await p.evaluate(async sel => { const P = window.VideoCut.S.project, st = await import('./videocut-app/js/state.js'); st.select(sel, (sel === 'music' ? P.music : sel === 'clip' ? P.clips : P.overlays)[0].id); }, sel); await p.waitForTimeout(250);
      const r = await p.evaluate(() => {
        const box = e => { if (!e) return null; const b = e.getBoundingClientRect(); return b.width ? { l: b.left, r: b.right, t: b.top, b: b.bottom } : null; };
        const hit = (a, b) => a && b && a.l < b.r - 1 && a.r > b.l + 1 && a.t < b.b - 1 && a.b > b.t + 1;
        const tools = document.querySelector('.pv-tools'), tc = document.querySelector('.pv-bar .tb-c'), insp = document.getElementById('inspector');
        const wide = [...insp.querySelectorAll('*')].filter(e => e.offsetParent && e.getBoundingClientRect().right > insp.getBoundingClientRect().right + 1 && getComputedStyle(e).position !== 'fixed').slice(0, 3).map(e => e.className || e.tagName);
        const el = document.documentElement;
        return { overlap: hit(box(tools), box(tc)), hs: el.scrollWidth > innerWidth, vs: el.scrollHeight > innerHeight + 1, wide };
      });
      assert.ok(!r.overlap, `${w}×${h} ${sel}: кнопки масштабу налізають на кнопки відтворення`); assert.ok(!r.hs, `${w}×${h}: з’явилась горизонтальна прокрутка`); assert.ok(!r.vs, `${w}×${h}: з’явилась вертикальна прокрутка сторінки`); assert.deepEqual(r.wide, [], `${w}×${h} ${sel}: елементи праворуч виходять за праву панель: ${r.wide}`);
    }
    await p.close();
  }
});


// ═════ 13. Налаштування звуку в експорті: гучність, вимкнення, соло, фейди, швидкість ═════
await run('звук в експорті: гучність кліпа й музики, вимкнення, соло, поява (fade), швидкість змінюють результат так, як обіцяє панель', async () => {
  const p = await open(1500, 900); await addFiles(p, ['v1.webm', 'a2.wav'], 3000);
  const set = fn => p.evaluate(async fnSrc => { const V = window.VideoCut, st = await import('./videocut-app/js/state.js'); const P = V.S.project; P.clips[0].in = 0; P.clips[0].out = 4; P.clips[0].speed = 1; P.clips[0].volume = 1; P.clips[0].muted = false;
    window.__m ||= structuredClone(P.music[0]); P.music = [structuredClone(window.__m)]; const m = P.music[0]; m.start = 0; m.in = 0; m.out = 4; m.volume = 1; m.fadeIn = 0; m.fadeOut = 0; m.duck = false; P.tracks = {}; new Function('P', 'st', fnSrc)(P, st); st.commit('Тест'); }, fn);
  const exp = async (range = [0, 4]) => exportBlob(p, { format: 'webm', quality: 'low', short: 360, fps: 10, range });
  await set("P.music.length = 0;"); const base = rmsOf(await exp(), 0.5, 3);
  await set("P.music.length = 0; P.clips[0].volume = 0.5;"); const half = rmsOf(await exp(), 0.5, 3); assert.ok(Math.abs((base - half) - 6) < 1.8, `гучність кліпа 50 % тихіша на ~6 дБ: ${base} → ${half}`);
  await set("P.clips[0].muted = true; P.music.length = 0;"); const muted = rmsOf(await exp(), 0.5, 3); assert.ok(muted === null || muted < -70, 'вимкнений кліп мовчить: ' + muted);
  await set("P.clips[0].muted = true;"); const mu1 = rmsOf(await exp(), 0.5, 3); await set("P.clips[0].muted = true; P.music[0].volume = 0.5;"); const mu2 = rmsOf(await exp(), 0.5, 3); assert.ok(Math.abs((mu1 - mu2) - 6) < 1.8, `музика 50 % тихіша на ~6 дБ: ${mu1} → ${mu2}`);
  await set("P.clips[0].muted = true; P.music[0].fadeIn = 2;"); const fe = await exp(); const f0 = rmsOf(fe, 0.05, 0.4), f1 = rmsOf(fe, 2.5, 1); assert.ok(f1 - f0 > 8, `поява музики 2 с: початок тихіший за середину: ${f0} → ${f1}`);
  await set("P.clips[0].muted = true; P.music[0].fadeOut = 2;"); const fo = await exp(); const g0 = rmsOf(fo, 0.5, 1), g1 = rmsOf(fo, 3.6, 0.35); assert.ok(g0 - g1 > 8, `зникнення музики 2 с: кінець тихіший: ${g0} → ${g1}`);
  await set("P.tracks = { a: { solo: true } };"); const solo = rmsOf(await exp(), 0.5, 3); assert.ok(Math.abs(solo - mu1) < 2, `соло музичної доріжки: звучить лише музика (${solo} проти ${mu1})`);
  await set("P.tracks = { a: { mute: true } }; P.clips[0].muted = true;"); const am = rmsOf(await exp(), 0.5, 3); assert.ok(am === null || am < -70, 'вимкнена доріжка звуку мовчить: ' + am);
  await set("P.music.length = 0; P.clips[0].out = 4; P.clips[0].speed = 2;"); const sp = await exp([0, 2]); assert.ok(Math.abs(parseFloat(probe(sp).format.duration) - 2) < 0.4, 'швидкість 2×: 4 с стають 2 с'); const spr = rmsOf(sp, 0.3, 1.4); assert.ok(spr > -45, 'при прискоренні звук є: ' + spr);
  await audit(p, 'після усіх експортів'); await p.close();
});


// ═════ 14. Права панель: кожна кнопка (дії, швидкі набори, піпетка, форми) ═════
async function clickAllInspector(p, kind, id, label) {
  const SKIPRE = /^\s*#[0-9a-f]{3,8}\b|стабіл|задом|реверс|шум|голос|розпіз|автосубтитр|\.cube|LUT|Імпорт|файл|Додати файл|Обрати файл|Завантаж/i;
  await p.evaluate(async ({ kind, id }) => { (await import('./videocut-app/js/state.js')).select(kind, id); }, { kind, id }); await p.waitForTimeout(250);
  const tabs = await p.locator('#inspector [role=tab]').count(); let clicked = 0;
  for (let ti = -1; ti < tabs; ti++) {
    if (ti >= 0) { const exists = await p.evaluate(({ kind, id }) => { const P = window.VideoCut.S.project; return [...P.clips, ...P.music, ...P.overlays, ...P.captions].some(o => o.id === id); }, { kind, id }); if (!exists) return clicked; await p.locator('#inspector [role=tab]').nth(ti).click().catch(() => {}); await p.waitForTimeout(120); }
    const n = await p.locator('#inspector button:not([role=tab])').count();
    for (let i = 0; i < n; i++) {
      const b = p.locator('#inspector button:not([role=tab])').nth(i); if (!await b.isVisible().catch(() => false)) continue; if (await b.isDisabled().catch(() => true)) continue;
      const txt = await b.evaluate(e => e.innerText.trim() + ' ' + (e.dataset.a || e.dataset.act || e.dataset.set || '') + ' ' + (e.getAttribute('aria-label') || ''));
      if (SKIPRE.test(txt) || /deselect|Готово|p:aspect|p:fps/.test(txt)) continue;
      const still = await p.evaluate(({ id }) => { const P = window.VideoCut.S.project; return [...P.clips, ...P.music, ...P.overlays, ...P.captions].some(o => o.id === id); }, { id }); if (!still) return clicked;
      if (process.env.VC_TRACE) console.log('   клік:', label, '·', txt.trim().slice(0, 50));
      await b.click({ timeout: 1500 }).catch(() => {}); clicked++; await p.waitForTimeout(60);
      if (await p.locator('.overlay.open').count()) { const yes = p.locator('.overlay.open #confirmNo'); if (await yes.count()) await yes.click().catch(() => {}); else await p.keyboard.press('Escape'); await p.waitForTimeout(80); }
      const bad = await p.evaluate(AUDIT, { fast: true }); assert.deepEqual(bad, [], `${label} · кнопка «${txt.trim().slice(0, 40)}»: ${bad.join('; ')}`);
    }
  }
  return clicked;
}
await run('права панель: кожна кнопка для кліпа, фото, музики, голосу, тексту, фігур, шару поверх відео, субтитру — без помилок і з коректним проєктом', async () => {
  const p = await richProject(); p.allow = [/Поставте|Не вдалося|Error: Немає/]; await addFiles(p, ['photo.png', 'v2.webm'], 2500);
  await p.evaluate(async () => { const ops = await import('./videocut-app/js/ops.js'), V = window.VideoCut; const ms = [...V.media.values()]; V.seek(3); ops.addLayerAt(ms.find(m => m.name === 'v2.webm'), { start: 2 }); ops.addLayerAt(ms.find(m => m.name === 'photo.png'), { start: 3 }); for (const t of ['arrow', 'blur', 'spot', 'emoji', 'progress']) ops.addOverlay(t); });
  await p.waitForTimeout(500);
  const all = await p.evaluate(() => { const P = window.VideoCut.S.project; return [...P.clips.map(o => ['clip', o.id, 'кліп']), ...P.music.map(o => ['music', o.id, o.voice ? 'голос' : 'музика']), ...P.overlays.map(o => ['overlay', o.id, 'накладання ' + o.type]), ...P.captions.map(o => ['caption', o.id, 'субтитр'])]; });
  const seen = new Set(), reps = all.filter(([k, , l]) => !seen.has(l) && seen.add(l)); // по одному представнику кожного виду
  let total = 0; for (const [kind, id, label] of reps) total += await clickAllInspector(p, kind, id, label); await audit(p, 'після усіх кнопок');
  assert.ok(total > 30, 'натиснуто достатньо кнопок: ' + total);
  assert.deepEqual(p.errors.filter(e => !(p.allow || []).some(r => r.test(e))), [], 'помилки сторінки'); await p.close();
});

//__NEXT__
await browser.close(); srv.close();
if (failed) console.log(`\nНе пройшло: ${failed}`);
