// @ts-check
// Import akcií stiahnutých v prehliadači (súbory {source, fetchedAt, offers}) do app/data/offers.json.
// Zdroje, ktoré v importe nie sú, ostanú z predchádzajúcich dát (ak ešte platia).
// Použitie: node scraper/import.js data/raw/lidl-SK.json data/raw/billa-SK.json …
import { readFile } from 'node:fs/promises';
import { isoDate } from '../app/js/deals.js';
import { publish, readJson, OFFERS_FILE } from './lib/publish.js';

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) throw new Error('Zadaj aspoň jeden súbor, napr. data/raw/lidl-SK.json');
  const today = isoDate(new Date());
  const previous = await readJson(OFFERS_FILE, { meta: { sample: true }, offers: [] });

  /** @type {Record<string, any>} */
  const sources = previous.meta?.sample ? {} : { ...(previous.meta?.sources ?? {}) };
  /** @type {Set<string>} */
  const replaced = new Set();
  /** @type {any[]} */
  const collected = [];

  for (const file of files) {
    const data = JSON.parse(await readFile(file, 'utf8'));
    const label = String(data.source);
    if (!/^[a-z]+-(SK|CZ)$/.test(label) || !Array.isArray(data.offers)) throw new Error(`${file}: neplatný formát`);
    const count = (replaced.has(label) ? sources[label].count : 0) + data.offers.length; // viac súborov jedného zdroja (napr. 2 týždne)
    replaced.add(label);
    collected.push(...data.offers);
    sources[label] = { ok: true, count, fetchedAt: data.fetchedAt ?? new Date().toISOString(), via: 'browser' };
    console.log(`✓ ${label}: ${data.offers.length} akcií z ${file}`);
  }
  if (!previous.meta?.sample) {
    collected.push(...previous.offers.filter((/** @type {any} */ o) => !replaced.has(`${o.chain}-${o.country}`)));
  }
  const { written, dropped } = await publish({ collected, sources, today });
  console.log(`Zapísaných ${written} akcií do app/data/offers.json (zahodených neplatných: ${dropped}).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
