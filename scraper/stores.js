// @ts-check
// Stiahne polohy predajní Kaufland, Lidl, Billa, Tesco a Albert v SK a CZ z OpenStreetMap.
// Spustenie: npm run stores   (stačí raz za týždeň; s --force aj skôr)
import { readFile, writeFile } from 'node:fs/promises';
import { parseOverpass, OVERPASS_URL } from '../app/js/geo.js';
import { politeFetch } from './lib/http.js';

const OUT = new URL('../app/data/stores.json', import.meta.url);
const MAX_AGE_DAYS = 7;

/** @param {'SK'|'CZ'} country */
const query = (country) =>
  `[out:json][timeout:180];area["ISO3166-1"="${country}"][admin_level=2]->.c;` +
  `nwr[shop=supermarket][brand~"^(Lidl|Kaufland|Billa|BILLA|Albert|Tesco)"](area.c);out center tags;`;

async function main() {
  const current = JSON.parse(await readFile(OUT, 'utf8').catch(() => '{"meta":{},"stores":[]}'));
  const age = current.meta?.generatedAt ? (Date.now() - Date.parse(current.meta.generatedAt)) / 86400000 : Infinity;
  if (age < MAX_AGE_DAYS && !process.argv.includes('--force')) {
    console.log(`Predajne sú staré ${age.toFixed(1)} dňa, netreba sťahovať.`);
    return;
  }
  const stores = [];
  for (const country of /** @type {const} */ (['SK', 'CZ'])) {
    const res = await politeFetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query(country)),
      timeoutMs: 200000,
      delayMs: 5000,
    });
    const list = parseOverpass(await res.json(), () => country);
    console.log(`${country}: ${list.length} predajní`);
    stores.push(...list);
  }
  if (stores.length < 100) throw new Error(`Podozrivo málo predajní (${stores.length}), súbor neprepisujem.`);
  await writeFile(
    OUT,
    JSON.stringify({ meta: { generatedAt: new Date().toISOString(), source: 'OpenStreetMap (© prispievatelia OpenStreetMap, ODbL)' }, stores }) + '\n',
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
