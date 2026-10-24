// @ts-check
// Reťazce, krajiny a kategórie. Pridanie nového reťazca = jeden riadok tu + adaptér v scraper/chains.

export const CHAINS = /** @type {const} */ ({
  kaufland: { name: 'Kaufland', countries: ['SK', 'CZ'], card: { SK: 'Kaufland Card', CZ: 'Kaufland Card' } },
  lidl: { name: 'Lidl', countries: ['SK', 'CZ'], card: { SK: 'Lidl Plus', CZ: 'Lidl Plus' } },
  billa: { name: 'Billa', countries: ['SK', 'CZ'], card: { SK: 'BILLA Bonus', CZ: 'BILLA karta' } },
  tesco: { name: 'Tesco', countries: ['SK'], card: { SK: 'Clubcard', CZ: 'Clubcard' } },
  albert: { name: 'Albert', countries: ['CZ'], card: { SK: 'Můj Albert', CZ: 'Můj Albert' } },
});

export const COUNTRIES = /** @type {const} */ ({
  SK: { name: 'Slovensko', short: 'SK' },
  CZ: { name: 'Česko', short: 'CZ' },
});

export const CATEGORIES = /** @type {const} */ ([
  { id: 'ovocie', name: 'Ovocie a zelenina' },
  { id: 'maso', name: 'Mäso a ryby' },
  { id: 'mliecne', name: 'Mliečne a vajcia' },
  { id: 'pecivo', name: 'Pečivo' },
  { id: 'trvanlive', name: 'Trvanlivé' },
  { id: 'napoje', name: 'Nápoje' },
  { id: 'snacky', name: 'Sladké a slané' },
  { id: 'mrazene', name: 'Mrazené' },
  { id: 'drogeria', name: 'Drogéria' },
]);

/** @param {string} id */
export function chainName(id) {
  return CHAINS[/** @type {keyof typeof CHAINS} */ (id)]?.name ?? id;
}

/** @param {string} id @param {string} country */
export function cardName(id, country) {
  const c = CHAINS[/** @type {keyof typeof CHAINS} */ (id)];
  return c ? c.card[/** @type {'SK'|'CZ'} */ (country)] : 'vernostná karta';
}

/** @param {string} country */
export function chainsFor(country) {
  return Object.entries(CHAINS)
    .filter(([, c]) => /** @type {readonly string[]} */ (c.countries).includes(country))
    .map(([id]) => id);
}

/** @param {string} id */
export function categoryName(id) {
  return CATEGORIES.find((c) => c.id === id)?.name ?? id;
}
