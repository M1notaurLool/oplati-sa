// Zloží apku do jedného HTML súboru (CSS, JS aj dáta vnútri) – na ukážku ako Claude artifact.
// Použitie: node tools/build-preview.js [výstup]   (predvolene dist/preview.html)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = (p) => join(root, 'app', p);
const out = process.argv[2] ?? join(root, 'dist', 'preview.html');

const MODULES = ['js/deals.js', 'js/format.js', 'js/geo.js', 'js/chains.js', 'js/app.js'];

// Moduly spojíme do jedného: zahodíme importy a slovo export. Kontrolujeme, či sa nebijú mená.
const seen = new Map();
const bundle = MODULES.map((file) => {
  const src = readFileSync(app(file), 'utf8');
  for (const m of src.matchAll(/^(?:export\s+)?(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    if (seen.has(m[1])) throw new Error(`Meno ${m[1]} je v ${seen.get(m[1])} aj v ${file}`);
    seen.set(m[1], file);
  }
  const body = src
    .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/^export\s+/gm, '')
    .replace(/^\/\/ @ts-check\s*$/gm, '');
  return `// ---- ${file} ----\n${body.trim()}\n`;
}).join('\n');

const json = (p) => JSON.stringify(JSON.parse(readFileSync(app(p), 'utf8'))).replace(/</g, '\\u003c');
const html = readFileSync(app('index.html'), 'utf8');
// písmo pre ceny vložené priamo (ukážka je jeden súbor)
const css = readFileSync(app('styles.css'), 'utf8').replace(/url\(['"]?(fonts\/[^'")]+\.woff2?)['"]?\)/g, (_, f) => `url(data:font/${f.endsWith('2') ? 'woff2' : 'woff'};base64,${readFileSync(app(f)).toString('base64')})`);

const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<!-- preview:start -->[\s\S]*?<!-- preview:end -->/, '');
const fontLinks = [...head.matchAll(/<link[^>]+(?:fonts\.googleapis|fonts\.gstatic)[^>]*>/g)].map((m) => m[0]).join('\n');
const body = html
  .match(/<body>([\s\S]*?)<\/body>/)[1]
  .replace(
    /<script type="module" src="js\/app\.js"><\/script>/,
    () =>
      `<script type="application/json" id="data-offers">${json('data/offers.json')}</script>\n` +
      `<script type="application/json" id="data-stores">${json('data/stores.json')}</script>\n` +
      `<script type="module">\n${bundle}</script>`,
  );

const page = `${title}
<meta name="claude:viewport-fit-sides" content="cover">
${fontLinks}
<style>
${css}
</style>
${body.trim()}
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`Hotovo: ${out} (${(page.length / 1024).toFixed(0)} kB)`);
