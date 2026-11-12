// Перелік модулів гри для <link rel="modulepreload">: браузер вантажить усі одразу, а не по рівнях імпорту.
//   node scripts/preload.mjs          — оновити index.html
//   node scripts/preload.mjs --check  — лише перевірити (код виходу 1, якщо застаріло)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname, ENTRY = resolve(ROOT, 'videocut-app/js/main.js');
const seen = new Set(), walk = f => {
  if (seen.has(f)) return; seen.add(f);
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?:import|export)\s[^'"`]*?from\s*['"](\.[^'"]+)['"]|import\s*['"](\.[^'"]+)['"]/g)) walk(resolve(dirname(f), m[1] || m[2]));
};
walk(ENTRY);
const links = [...seen].map(f => relative(ROOT, f)).sort().map(f => `<link rel="modulepreload" href="${f}">`).join('\n');
const block = `<!-- preload -->\n${links}\n<!-- /preload -->`;
const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const next = /<!-- preload -->[\s\S]*?<!-- \/preload -->/.test(html) ? html.replace(/<!-- preload -->[\s\S]*?<!-- \/preload -->/, block) : html.replace('<script type="module" src="videocut-app/js/main.js"></script>', block + '\n<script type="module" src="videocut-app/js/main.js"></script>');
if (process.argv.includes('--check')) { if (next !== html) { console.error('index.html: список modulepreload застарів. Запустіть node scripts/preload.mjs'); process.exit(1); } console.log(`modulepreload актуальний (${seen.size} модулів)`); }
else { writeFileSync(resolve(ROOT, 'index.html'), next); console.log(`записано ${seen.size} модулів`); }
