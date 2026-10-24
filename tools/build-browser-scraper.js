// Zloží adaptéry reťazcov do jedného skriptu, ktorý sa dá spustiť priamo na stránke reťazca v prehliadači
// (keď web blokuje sťahovanie zo servera). Výsledok: dist/browser-scraper.js definuje window.__oplati.
// Použitie: node tools/build-browser-scraper.js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/** Odstráni importy, exporty a komentáre (kód ostáva rovnaký). */
function strip(src) {
  return src
    .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/^export\s+/gm, '')
    .replace(/\/\*\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

const adapter = (name, file) => `const ${name} = (() => {\n${strip(read(file))}\nreturn { fetchOffers };\n})();`;

const out = `(() => {
${strip(read('scraper/lib/normalize.js'))}
${adapter('lidl', 'scraper/chains/lidl.js')}
${adapter('billa', 'scraper/chains/billa.js')}
const http = {
  text: async (u) => { const r = await fetch(u, { credentials: 'omit' }); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u); return r.text(); },
  json: async (u) => { const r = await fetch(u, { credentials: 'omit', headers: { accept: 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u); return r.json(); },
};
window.__oplati = { lidl, billa, http };
return 'ok';
})();
`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'browser-scraper.js'), out);
console.log(`dist/browser-scraper.js: ${(out.length / 1024).toFixed(1)} kB`);
