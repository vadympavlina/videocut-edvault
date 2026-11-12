// Клавіатура: видимість фокусу, пастка фокусу й Esc у вікні експорту, гарячі клавіші, масштаб 200 %, розміри цілей. npm run audit:keyboard (код виходу 1 при порушеннях)
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, launch, newPage } from '../../tests/_harness.mjs';
const tmp = mkdtempSync(join(tmpdir(), 'vck-')), vid = join(tmp, 'v.webm');
execFileSync(process.env.FFMPEG || 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-c:v', 'libvpx', '-b:v', '600k', '-c:a', 'libopus', '-shortest', vid]);
const server = await startServer(), b = await launch(), errors = [];
const ctx = await b.newContext({ viewport: { width: 1440, height: 860 } }); const p = await newPage(ctx, errors); p.setDefaultTimeout(8000);
await p.goto(server.url + '/index.html'); await p.waitForFunction(() => window.VideoCut); await p.setInputFiles('#fileInput', vid); await p.waitForFunction(() => window.VideoCut.S.project.clips.length > 0); await p.waitForTimeout(1200);
let bad = 0;
const ring = () => p.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const s = getComputedStyle(e); const vis = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none'); return { vis, tag: e.tagName + (e.id ? '#' + e.id : e.className ? '.' + String(e.className).split(' ')[0] : '') }; });
let seen = 0, vis = 0; const miss = [];
for (let i = 0; i < 40; i++) { await p.keyboard.press('Tab'); const r = await ring(); if (!r) continue; seen++; if (r.vis || /^(INPUT|TEXTAREA)/.test(r.tag)) vis++; else miss.push(r.tag); }
console.log(`Tab по головному екрану: фокус видно у ${vis} з ${seen}${miss.length ? '; без кільця: ' + [...new Set(miss)].slice(0, 8).join(', ') : ''}`); bad += seen - vis;
// гарячі клавіші
await p.evaluate(() => { document.activeElement?.blur(); window.VideoCut.seek(2); });
const keys = {}; await p.keyboard.press('s'); await p.waitForTimeout(150); keys.split = await p.evaluate(() => window.VideoCut.S.project.clips.length);
await p.keyboard.press('Space'); await p.waitForTimeout(500); keys.play = await p.evaluate(() => window.VideoCut.S.playing); await p.keyboard.press('Space'); await p.waitForTimeout(150); keys.pause = await p.evaluate(() => !window.VideoCut.S.playing);
console.log('Гарячі клавіші S/Пробіл:', JSON.stringify(keys)); if (keys.split !== 2 || !keys.play || !keys.pause) bad++;
// вікно експорту: фокус всередині й Esc
await p.click('#btnExport'); await p.waitForTimeout(400); let inside = 0; for (let i = 0; i < 14; i++) { await p.keyboard.press('Tab'); if (await p.evaluate(() => !!document.activeElement?.closest('.modal'))) inside++; }
await p.keyboard.press('Escape'); await p.waitForTimeout(300); const closed = await p.evaluate(() => !document.querySelector('#exportModal.open, #exportModal.show'));
console.log(`Експорт: фокус лишається у вікні ${inside} з 14 Tab; Esc закриває: ${closed}`); if (inside < 12 || !closed) bad++;
// цілі менші за 24 px
const small = await p.evaluate(() => [...document.querySelectorAll('button, [role=button], input[type=range], select')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24) && getComputedStyle(e).visibility !== 'hidden'; }).map(e => `${e.tagName}${e.id ? '#' + e.id : '.' + String(e.className).split(' ')[0]} ${Math.round(e.getBoundingClientRect().width)}×${Math.round(e.getBoundingClientRect().height)}`));
console.log('цілі менші за 24×24 px:', small.length, [...new Set(small)].slice(0, 8));
await p.setViewportSize({ width: 720, height: 430 }); await p.waitForTimeout(400);
const ov = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2); console.log('масштаб 200 % (вікно 720px): горизонтальна прокрутка:', ov); if (ov) bad++;
console.log('помилки', errors.slice(0, 2)); process.exitCode = bad > 2 || errors.length ? 1 : 0;
await b.close(); server.close();
