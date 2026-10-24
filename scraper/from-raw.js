// @ts-check
// Prevedie surové dáta stiahnuté v prehliadači (vyhľadávanie Lidlu, API Billy, akcie online obchodu Tesca, texty PDF letáku Albertu)
// na ponuky vo formáte apky: data/raw/<zdroj>.raw.json → data/raw/<zdroj>.json.
// Použitie: node scraper/from-raw.js data/raw/lidl-SK.raw.json …  potom: node scraper/import.js data/raw/*.json
import { readFile, writeFile } from 'node:fs/promises';
import { offersFromSearch } from './chains/lidl.js';
import { billaProductToOffer } from './chains/billa.js';
import { tescoProductToOffer } from './chains/tesco.js';
import { offersFromLeaflet } from './chains/albert.js';
import { localDate } from './lib/normalize.js';

/** @param {any} raw */
function convert(raw) {
  const [chain, country] = String(raw.source).split('-');
  if (country !== 'SK' && country !== 'CZ') throw new Error(`Neznámy zdroj ${raw.source}`);
  if (chain === 'lidl') return offersFromSearch({ items: raw.items.map((/** @type {any} */ data) => ({ gridbox: { data } })) }, country);
  if (chain === 'billa') {
    const ctx = { country, validFrom: raw.validFrom, validTo: raw.validTo, slug: raw.slug, useLowestPrice: country === 'CZ', host: country === 'CZ' ? 'https://www.billa.cz' : undefined };
    const out = new Map();
    for (const p of raw.items) {
      const o = billaProductToOffer(p, ctx);
      if (o && !out.has(o.id)) out.set(o.id, o);
    }
    return [...out.values()];
  }
  if (chain === 'tesco') {
    const today = localDate(new Date(raw.fetchedAt));
    const out = new Map();
    for (const p of raw.items) {
      const o = tescoProductToOffer(p, today);
      if (o && !out.has(o.id)) out.set(o.id, o);
    }
    return [...out.values()];
  }
  if (chain === 'albert') return offersFromLeaflet(raw.pages, { validFrom: raw.validFrom, validTo: raw.validTo, slug: raw.slug });
  throw new Error(`Pre ${chain} prevod zo surových dát nie je`);
}

for (const file of process.argv.slice(2)) {
  const raw = JSON.parse(await readFile(file, 'utf8'));
  const offers = convert(raw);
  const out = file.replace(/\.raw\.json$/, '.json');
  await writeFile(out, JSON.stringify({ source: raw.source, fetchedAt: raw.fetchedAt, offers }, null, 1) + '\n');
  console.log(`${raw.source}: ${(raw.items ?? raw.pages).length} ${raw.items ? 'položiek' : 'strán'} → ${offers.length} akcií → ${out}`);
}
