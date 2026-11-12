// Стрес: швидкі перемикання відтворення, перемотування під час відтворення, undo/redo, 60 розрізів, експорт довгого проєкту, пам'ять після багатьох імпортів. npm run audit:stress (код виходу 1 при збоях)
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, launch, newPage } from '../../tests/_harness.mjs';
const tmp = mkdtempSync(join(tmpdir(), 'vcs-')), vid = join(tmp, 'v.webm');
execFileSync(process.env.FFMPEG || 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30', '-c:v', 'libvpx', '-g', '30', '-b:v', '2M', '-c:a', 'libopus', '-shortest', vid]);
const server = await startServer(), b = await launch(), errors = [];
const p = await newPage(await b.newContext({ viewport: { width: 1440, height: 860 } }), errors); p.setDefaultTimeout(60000);
await p.addInitScript(() => { window.__lt = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true }); } catch { /* немає */ } });
await p.goto(server.url + '/index.html'); await p.waitForFunction(() => window.VideoCut);
await p.setInputFiles('#fileInput', vid); await p.waitForFunction(() => window.VideoCut.S.project.clips.length > 0); await p.waitForTimeout(1000);
const problems = [], note = (ok, msg) => { console.log(ok ? 'ok  ' : 'ПРОБЛЕМА', msg); if (!ok) problems.push(msg); };
// 1) 60 розрізів
await p.evaluate(async () => { const V = window.VideoCut, { splitAt } = await import('./videocut-app/js/ops.js'); for (let i = 1; i <= 59; i++) { V.seek(i * 0.5); splitAt(); } });
note((await p.evaluate(() => window.VideoCut.S.project.clips.length)) === 60, '60 кліпів після розрізів');
// 2) швидкі play/pause й перемотування під час відтворення
await p.evaluate(() => { window.__lt.length = 0; });
const r2 = await p.evaluate(async () => { const V = window.VideoCut; let err = null; window.addEventListener('error', e => { err = e.message; }); const wait = ms => new Promise(r => setTimeout(r, ms)); const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k === ' ' ? 'Space' : k, bubbles: true }));
  for (let i = 0; i < 40; i++) { key(' '); await wait(30 + (i % 5) * 40); if (i % 3 === 0) V.seek(Math.random() * 29); } key(' '); await wait(300); return { err, playing: V.S.playing, t: V.S.t }; });
note(!r2.err, 'швидкі play/pause й перемотування без винятків' + (r2.err ? ': ' + r2.err : ''));
const lt = await p.evaluate(() => window.__lt.slice()); note(Math.max(0, ...lt) < 500, `довгі задачі під час перемикань: макс ${Math.max(0, ...lt)} мс`);
// 3) плавне відтворення з перемотуванням: відео стоїть там, де курсор
await p.evaluate(() => { const V = window.VideoCut; if (V.S.playing) document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })); V.seek(10); }); await p.waitForTimeout(700);
const sync = await p.evaluate(() => { const V = window.VideoCut; const vs = [...document.querySelectorAll('#mediaPool video')]; return { t: V.S.t, els: vs.map(v => +v.currentTime.toFixed(2)) }; });
note(sync.els.some(x => Math.abs(x - 10) < 0.15), 'у паузі відео стоїть на курсорі ' + JSON.stringify(sync));
// 4) undo/redo сто разів
const r4 = await p.evaluate(async () => { const V = window.VideoCut, { undo, redo } = await import('./videocut-app/js/state.js'); const n0 = V.S.project.clips.length; const t = performance.now(); for (let i = 0; i < 30; i++) undo(); const n1 = V.S.project.clips.length; for (let i = 0; i < 30; i++) redo(); return { n0, n1, n2: V.S.project.clips.length, ms: Math.round(performance.now() - t) }; });
note(r4.n2 === r4.n0 && r4.n1 < r4.n0 && r4.ms < 4000, `undo/redo ×30: ${JSON.stringify(r4)}`);
// 5) експорт 60 кліпів
const t0 = Date.now(); const ex = await p.evaluate(async () => { try { const r = await window.VideoCut.exportVideo({ format: 'webm', quality: 'low', short: 360, range: [0, 12], fps: 15 }); return { size: r.blob?.size ?? r.size ?? 0 }; } catch (e) { return { err: e.message }; } });
note(!ex.err && ex.size > 5000, `експорт 12 с із 60 кліпів: ${JSON.stringify(ex)} за ${Date.now() - t0} мс`);
// 6) пам'ять після багатьох імпортів і видалень
const heap = async () => { const c = await p.context().newCDPSession(p); await c.send('HeapProfiler.collectGarbage'); return Math.round((await p.evaluate(() => performance.memory.usedJSHeapSize)) / 1048576); };
const h0 = await heap();
for (let i = 0; i < 6; i++) { await p.setInputFiles('#fileInput', vid); await p.waitForTimeout(1200); await p.evaluate(() => { const V = window.VideoCut; V.S.project.clips.splice(0); }); }
const h1 = await heap(); note(h1 - h0 < 120, `пам'ять після 6 імпортів: ${h0} → ${h1} МБ`);
console.log('помилки сторінки:', errors.slice(0, 3)); if (errors.length) problems.push('помилки в консолі');
process.exitCode = problems.length ? 1 : 0; await b.close(); server.close();
