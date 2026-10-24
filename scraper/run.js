// @ts-check
// Stiahne akcie zo všetkých reťazcov a zapíše app/data/offers.json.
// Spustenie: npm run update   (lokálne aj v GitHub Actions každé ráno)
//
// Keď nejaký web sťahovanie zo servera blokuje, dá sa spustiť adaptér priamo v prehliadači
// (tools/build-browser-scraper.js) a výsledok naimportovať: npm run import -- data/raw/*.json
import { CHAINS } from '../app/js/chains.js';
import { isoDate } from '../app/js/deals.js';
import { http } from './lib/http.js';
import { publish, readJson, OFFERS_FILE } from './lib/publish.js';

/** @type {Record<string, () => Promise<{ fetchOffers: (country: 'SK'|'CZ', h: typeof http) => Promise<any[]> }>>} */
const ADAPTERS = {
  kaufland: () => import('./chains/kaufland.js'),
  lidl: () => import('./chains/lidl.js'),
  billa: () => import('./chains/billa.js'),
  tesco: () => import('./chains/tesco.js'),
  albert: () => import('./chains/albert.js'),
};

async function main() {
  const today = isoDate(new Date());
  const previous = await readJson(OFFERS_FILE, { meta: { sample: true }, offers: [] });
  /** @type {any[]} */
  const collected = [];
  /** @type {Record<string, any>} */
  const sources = {};

  for (const [chain, info] of Object.entries(CHAINS)) {
    for (const country of info.countries) {
      const label = `${chain}-${country}`;
      try {
        const mod = await ADAPTERS[chain]();
        const offers = await mod.fetchOffers(country, http);
        collected.push(...offers);
        sources[label] = { ok: true, count: offers.length, fetchedAt: new Date().toISOString() };
        console.log(`✓ ${label}: ${offers.length} akcií`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`✗ ${label}: ${message}`);
        // Keď zdroj vypadne, necháme jeho posledné ešte platné akcie.
        const kept = previous.meta?.sample ? [] : previous.offers.filter((/** @type {any} */ o) => o.chain === chain && o.country === country && o.validTo >= today);
        collected.push(...kept);
        const prev = previous.meta?.sources?.[label];
        sources[label] = kept.length && prev?.ok ? { ...prev, stale: true } : { ok: false, error: message };
      }
    }
  }

  if (!collected.length) {
    console.warn('Žiadne skutočné dáta – app/data/offers.json nechávam tak, ako je.');
    return;
  }
  const { written, dropped } = await publish({ collected, sources, today });
  console.log(`Zapísaných ${written} akcií (zahodených neplatných: ${dropped}).`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
