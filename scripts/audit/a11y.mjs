// Доступність: axe-core (WCAG 2.1 A/AA) на порожньому редакторі, з файлом, з виділеним кліпом, у вкладках, меню й вікнах. npm run audit:a11y (код виходу 1 при critical/serious)
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, launch, newPage } from '../../tests/_harness.mjs';
const axeSrc = readFileSync(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'vca-')), vid = join(tmp, 'v.webm');
execFileSync(process.env.FFMPEG || 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:v', 'libvpx', '-b:v', '600k', '-c:a', 'libopus', '-shortest', vid]);
const server = await startServer(), b = await launch(), errors = [];
const theme = process.env.THEME || 'dark';
const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, bypassCSP: false }); await ctx.addInitScript(t => { try { localStorage.setItem('edvault-theme', t); } catch { /* немає */ } }, theme);
const p = await newPage(ctx, errors); p.setDefaultTimeout(10000);
const agg = new Map();
const scan = async tag => {
  await p.evaluate(s => { if (!window.axe) (0, eval)(s); }, axeSrc);
  const r = await p.evaluate(async () => { const x = await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'], resultTypes: ['violations'] }); return x.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, sample: v.nodes.slice(0, 3).map(n => n.target.join(' ').slice(0, 50) + (n.any[0]?.data?.fgColor ? ' ' + n.any[0].data.fgColor + '/' + n.any[0].data.bgColor + ' ' + n.any[0].data.contrastRatio : '')).join(' ; '), html: v.nodes[0].html.slice(0, 90) })); });
  for (const v of r) { const a = agg.get(v.id) || { ...v, n: 0, where: new Set() }; a.n += v.n; a.where.add(tag); agg.set(v.id, a); }
};
await p.goto(server.url + '/index.html'); await p.waitForFunction(() => window.VideoCut); await p.waitForTimeout(400);
await scan('порожній редактор');
await p.setInputFiles('#fileInput', vid); await p.waitForFunction(() => window.VideoCut.S.project.clips.length > 0); await p.waitForTimeout(1500); await scan('з відео');
await p.evaluate(() => window.VideoCut.seek(2)); await p.click('.tl-lanes .clip', { timeout: 3000 }).catch(() => {}); await p.waitForTimeout(500); await scan('виділений кліп');
for (const t of ['text', 'elements', 'captions']) { await p.click(`[data-tab="${t}"]`); await p.waitForTimeout(400); await scan('вкладка ' + t); }
await p.keyboard.press('Control+e'); await p.waitForTimeout(500); await scan('вікно експорту'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
await p.click('#menubar button').catch(() => {}); await p.waitForTimeout(300); await scan('меню');
const rows = [...agg.values()].sort((a, b) => ({ critical: 0, serious: 1, moderate: 2, minor: 3 }[a.impact] - { critical: 0, serious: 1, moderate: 2, minor: 3 }[b.impact]) || b.n - a.n);
for (const r of rows) console.log(`${(r.impact || '').padEnd(9)} ${r.id.padEnd(34)} вузлів ${String(r.n).padStart(4)}  екранів ${r.where.size}  ${r.help.slice(0, 60)}\n          напр. ${r.sample} | ${r.html}`);
console.log('тема:', theme, '| помилки', errors.slice(0, 2)); if (!rows.length) console.log('порушень немає'); if (rows.some(r => r.impact === 'critical' || r.impact === 'serious')) process.exitCode = 1;
await b.close(); server.close();
