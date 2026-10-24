// @ts-check
// Lidl – lidl.sk a lidl.cz.
//
// Zdroj (overené 24. 10. 2026):
// 1. Vyhľadávanie webu /q/api/search?…&category.id=10068374 vráti naraz všetky potraviny v akcii
//    v predajniach (SK ~40, CZ ~500 položiek) – každá má gridbox.data s cenou, pôvodnou cenou,
//    cenou s Lidl Plus, balením, kategóriou a dátumami platnosti.
// 2. Záloha: kategórie potravín (/h/...) a akciové stránky (/c/.../a...) majú rovnaký JSON
//    v atribúte data-grid-data. Stránkovanie: ?offset=48.
// Kód beží v Node aj v prehliadači – potrebuje len http.text(url) a http.json(url).
import { decodeEntities, guessCategory, localDate, matchKey, norm, parseSize } from '../lib/normalize.js';

const SITES = /** @type {const} */ ({
  SK: { host: 'https://www.lidl.sk', foodRoot: '/c/jedlo-a-napoje/s10068374', locale: 'sk_SK' },
  CZ: { host: 'https://www.lidl.cz', foodRoot: '/c/potraviny-a-napoje/s10068374', locale: 'cs_CZ' },
});
const FOOD_CATEGORY_ID = '10068374';

/** @param {'SK'|'CZ'} country @param {number} [offset] */
export function searchUrl(country, offset = 0) {
  const s = SITES[country];
  return `${s.host}/q/api/search?assortment=${country}&locale=${s.locale}&version=v2.0.0&category.id=${FOOD_CATEGORY_ID}&offset=${offset}&fetchsize=100`;
}

/** Kategória Lidlu (časť adresy /h/...) → kategória v apke. Nepotravinové kategórie vynecháme. */
const CATEGORY_BY_SLUG = /** @type {Array<[RegExp, string | null]>} */ ([
  [/ovoc|zelenin/, 'ovocie'],
  [/maso|ryby/, 'maso'],
  [/syry|mlie|mlec/, 'mliecne'],
  [/pekar/, 'pecivo'],
  [/mrazen/, 'mrazene'],
  [/sladk|snack/, 'snacky'],
  [/napoj|kava|vino|pivo|liehovin|lihovin|destil/, 'napoje'],
  [/trvanl|olej|hotov|cereal|spiz/, 'trvanlive'],
  [/zdravi|krasa|domacnost|chovatel|zvierat|zvirat|drogeri|kvet|kvetin/, null],
]);

/**
 * Kategória z cesty kategórie produktu (keyfacts.wonCategoryPrimary).
 * „Svety potrieb/Potraviny…/Mäso a hydina/hydina“ → 'maso'; nepotravinové → null.
 * @param {any} item
 */
export function categoryForItem(item) {
  const path = String(item?.keyfacts?.wonCategoryPrimary || '');
  if (!isFood(item)) return null;
  const parts = path.split('/').slice(1).map(norm).join('/');
  return parts ? categoryForPath(parts) : undefined;
}

/** @param {string} path */
export function categoryForPath(path) {
  for (const [re, cat] of CATEGORY_BY_SLUG) if (re.test(path)) return cat;
  return undefined; // neznáma – kategóriu odhadneme z názvu
}

/**
 * Všetky produkty z data-grid-data na stránke.
 * @param {string} html
 * @returns {any[]}
 */
export function extractGridData(html) {
  const out = [];
  for (const m of html.matchAll(/data-grid-data="([^"]*)"/g)) {
    try {
      out.push(JSON.parse(decodeEntities(m[1])));
    } catch {
      /* poškodený záznam preskočíme */
    }
  }
  return out;
}

/** „Zobrazené produkty 48 / 67“ → 67 @param {string} html */
function totalCount(html) {
  const m = html.replace(/<[^>]+>/g, ' ').match(/(\d+)\s*\/\s*(\d+)\s*produkt/);
  return m ? Number(m[2]) : 0;
}

/** Je to potravina? (akciové stránky miešajú jedlo s Parkside a módou) @param {any} item */
export function isFood(item) {
  const path = norm(String(item?.keyfacts?.wonCategoryPrimary || item?.wonCategoryPrimary || ''));
  return /potravin|jedlo|napoj|vino|pivo|liehovin|lihovin/.test(path) && !/zvierat|zvirat|chovatel/.test(path);
}

/** @param {unknown} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);

/**
 * Jeden produkt z data-grid-data → ponuka vo formáte apky (alebo null, ak nie je v akcii v predajni).
 * @param {any} item
 * @param {{ country: 'SK'|'CZ', host: string, category?: string | null }} ctx
 */
export function gridItemToOffer(item, ctx) {
  // store=false má aj tovar, ktorý do predajní príde až o pár dní – rozhoduje, či má dátumy v predajni.
  // Len online tovar (Parkside, móda z e-shopu) dátumy v predajni nemá.
  if (!item || !item.storeStartDate || !item.storeEndDate) return null;
  const name = String(item.fullTitle || item.title || '').trim();
  if (!name) return null;

  const p = item.price ?? {};
  const lp = Array.isArray(item.lidlPlus) ? item.lidlPlus[0] : null;
  const basePrice = num(p.price);
  const cardPrice = num(lp?.price?.price);
  let regular = num(p.oldPrice) ?? num(p.discount?.deletedPrice) ?? num(lp?.price?.oldPrice) ?? num(lp?.price?.discount?.deletedPrice);

  let price = basePrice;
  let requiresCard = false;
  /** @type {number | null} */ let priceWithoutCard = null;
  if (cardPrice && (!basePrice || cardPrice < basePrice)) {
    price = cardPrice;
    requiresCard = true;
    priceWithoutCard = basePrice;
    if (!regular && basePrice) regular = basePrice; // zľava len s Lidl Plus: bežná cena je cena bez karty
  }
  if (!price || !regular || regular <= price) return null;

  const highlight = String(lp?.highlightText ?? '').trim();
  const note = highlight && !/\d\s*[%﹪]/.test(highlight) ? highlight.slice(0, 80) : null;
  // SK: balenie je v packaging.text („250 g balenie“). CZ: len v basePrice.text („500 g, 1 kg = 59,80 Kč“) –
  // berieme časť pred čiarkou; samotné „100 g = 0,25“ je cena za jednotku, nie balenie.
  const base = String(lp?.price?.basePrice?.text || p.basePrice?.text || '');
  const basePack = /,\s/.test(base) ? base.split(/,\s/)[0] : /=/.test(base) ? '' : base;
  const size = parseSize(lp?.price?.packaging?.text || p.packaging?.text || basePack);
  const validFrom = localDate(Number(item.storeStartDate));
  const validTo = localDate(Number(item.storeEndDate));
  // Názov má prednosť: Lidl občas zaradí napr. maliny medzi mliečne výrobky.
  const category = guessCategory(name, ctx.category ?? 'trvanlive');
  const brand = item.brand?.showBrand && item.brand?.name ? String(item.brand.name) : null;
  const path = typeof item.canonicalUrl === 'string' && item.canonicalUrl.startsWith('/') ? item.canonicalUrl : null;

  return {
    id: `${ctx.country.toLowerCase()}-lidl-${item.productId ?? item.erpNumber}-${validFrom}`,
    country: ctx.country,
    chain: 'lidl',
    name,
    brand,
    category,
    size,
    price,
    regularPrice: regular,
    lowest30d: null,
    validFrom,
    validTo,
    requiresCard,
    priceWithoutCard: priceWithoutCard && priceWithoutCard > price && priceWithoutCard < regular ? priceWithoutCard : null,
    note,
    tryIt: null,
    matchKey: matchKey(name, size),
    sourceUrl: path ? ctx.host + path : null,
  };
}

/**
 * Ponuky z vyhľadávacieho API (hlavný zdroj).
 * @param {any} json odpoveď /q/api/search
 * @param {'SK'|'CZ'} country
 */
export function offersFromSearch(json, country) {
  const host = SITES[country].host;
  /** @type {Map<string, any>} */
  const offers = new Map();
  for (const entry of Array.isArray(json?.items) ? json.items : []) {
    const item = entry?.gridbox?.data;
    const category = categoryForItem(item);
    if (category === null) continue; // nepotravinové
    const offer = gridItemToOffer(item, { country, host, category });
    if (offer && !offers.has(offer.id)) offers.set(offer.id, offer);
  }
  return [...offers.values()];
}

/**
 * @param {'SK'|'CZ'} country
 * @param {{ text: (url: string) => Promise<string>, json?: (url: string) => Promise<any> }} http
 */
export async function fetchOffers(country, http) {
  const site = SITES[country];
  if (!site) return [];
  if (http.json) {
    try {
      // Server vracia najviac ~60–100 položiek naraz, preto stránkujeme až po numFound.
      const items = [];
      for (let offset = 0, total = Infinity, guard = 0; offset < total && guard < 30; guard++) {
        const page = await http.json(searchUrl(country, offset));
        const got = Array.isArray(page?.items) ? page.items : [];
        total = Number(page?.numFound) || 0;
        items.push(...got);
        offset += got.length;
        if (!got.length) break;
      }
      const found = offersFromSearch({ items }, country);
      if (found.length) return found;
    } catch {
      /* vyhľadávanie nedostupné – skúsime stránky kategórií */
    }
  }
  return fetchFromPages(country, http);
}

/**
 * Záloha: prejde stránky kategórií potravín a akciové stránky.
 * @param {'SK'|'CZ'} country
 * @param {{ text: (url: string) => Promise<string> }} http
 */
async function fetchFromPages(country, http) {
  const site = SITES[country];
  const root = await http.text(site.host + site.foodRoot);

  // Kategórie potravín (/h/...) a akciové stránky (/c/.../a123) odkazované z potravín aj z úvodnej stránky.
  const home = await http.text(site.host + '/').catch(() => '');
  const hrefs = [...(root + home).matchAll(/href="(\/(?:h\/[^"#?]+|c\/[^"#?]+\/a\d+))"/g)].map((m) => m[1]);
  // Z kategórií /h/ len potraviny; akciové stránky /a… berieme všetky, ale bez online-only sortimentu (/c/asc/).
  const pages = [...new Set(hrefs)].filter((h) => (h.startsWith('/h/') ? typeof categoryForPath(h) === 'string' : !h.startsWith('/c/asc/')));

  /** @type {Map<string, any>} */
  const offers = new Map();
  for (const path of pages) {
    const category = path.startsWith('/h/') ? categoryForPath(path) : undefined;
    const maxPages = category ? 10 : 3; // akciové stránky miešajú jedlo s inými vecami – stačia prvé strany
    for (let offset = 0, guard = 0; guard < maxPages; guard++) {
      const html = await http.text(site.host + path + (offset ? `?offset=${offset}` : ''));
      const items = extractGridData(html);
      for (const item of items) {
        if (!category && !isFood(item)) continue;
        const offer = gridItemToOffer(item, { country, host: site.host, category });
        if (offer && !offers.has(offer.id)) offers.set(offer.id, offer);
      }
      const total = totalCount(html);
      offset += items.length;
      if (!items.length || !total || offset >= total) break;
    }
  }
  return [...offers.values()];
}
