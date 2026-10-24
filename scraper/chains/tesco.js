// @ts-check
// Tesco Slovensko – akcie zvyčajne streda–utorok, veľa cien len s Clubcard.
//
// Zdroj (overené 24. 10. 2026): online obchod potravinydomov.itesco.sk, stránka
//   /shop/sk-SK/promotions/all?page=N&count=48   (~4 700 produktov v akcii, 48 na stranu)
// HTML obsahuje <script type="application/discover+json"> s Apollo cache:
//   ProductType  – title, brandName, superDepartmentName/departmentName, price.actual/unitPrice/unitOfMeasure
//   PromotionType – startDate, endDate, description, price.beforeDiscount/afterDiscount, attributes
// Typy akcií:
//   „-38%, predtým 0,89 €“          → beforeDiscount 0,89, afterDiscount 0,55 (pre všetkých)
//   „0,45 € s Clubcard“             → afterDiscount = bežná cena, cena s kartou je v popise
//   „1,49 € Ušetrite 25% s Clubcard“ / „… Polovičná cena s Clubcard“ / „1,99 € za kg s Clubcard“
//   „Kúpte 6 a viac ušetrite 31 %…“, „Super cena“ → bez jasnej jednotkovej ceny, preskočíme
// Pozor: pri rýchlom sťahovaní (≈40 strán za 2 min) web vráti 403 – preto 5 s pauza medzi stranami.
// Ceny online obchodu sa zhodujú s letákom hypermarketov (Clubcard ceny platia v obchode aj online).
// Leták na tesco.sk je len obrázok/PDF, preto berieme online obchod.
import { guessCategory, localDate, matchKey, norm, parsePrice, parseSize, tidyName } from '../lib/normalize.js';

const HOST = 'https://potravinydomov.itesco.sk';
const PAGE_SIZE = 48;

/** Hlavné oddelenia Tesca → kategória v apke. null = nie sú potraviny ani drogéria (hračky, záhrada…). */
const DEPARTMENTS = /** @type {Record<string, string | null | ((dep: string, name: string) => string)>} */ ({
  'ovocie, zelenina': (dep) => (/orech|susen/.test(dep) ? 'snacky' : /dzus/.test(dep) ? 'napoje' : 'ovocie'),
  'mliecne vyrobky a vajcia': (dep) => (/majonez|dressing/.test(dep) ? 'trvanlive' : 'mliecne'),
  'pekaren': 'pecivo',
  'maso a lahodky': 'maso',
  'mrazene': 'mrazene',
  'trvanlive potraviny': (dep) => (/sladk|slane/.test(dep) ? 'snacky' : 'trvanlive'),
  'napoje': 'napoje',
  'specialna vyziva': (_dep, name) => guessCategory(name, 'trvanlive'),
  'dieta': (dep, name) => (/strava|vyziva/.test(dep) ? guessCategory(name, 'trvanlive') : 'drogeria'),
  'domacnost': 'drogeria',
  'drogeria': 'drogeria',
  'zvierata': 'drogeria',
  'domov a zabava': null,
});

/** @param {any} p @returns {string | null} */
export function tescoCategory(p) {
  const rule = DEPARTMENTS[norm(p?.superDepartmentName ?? '')];
  const name = String(p?.title ?? '');
  if (rule === null) return null;
  if (typeof rule === 'string') return rule;
  if (typeof rule === 'function') return rule(norm(p?.departmentName ?? ''), name);
  return guessCategory(name); // „Top ponuky“ a nové oddelenia
}

/** Koniec platnosti „2026-10-27T23:00:00Z“ (= polnoc) → posledný deň 2026-10-27. @param {string} iso */
const lastDay = (iso) => localDate(new Date(Date.parse(iso) - 60_000));

/**
 * Cena z jednej akcie. null = akcia bez jasnej ceny za kus/kg (napr. „Kúpte 6 a viac…“).
 * @param {any} p @param {any} promo
 * @returns {{ price: number, regularPrice: number, requiresCard: boolean, perKg: boolean } | null}
 */
export function tescoPromoPrice(p, promo) {
  const desc = String(promo?.description ?? '');
  const before = promo?.price?.beforeDiscount;
  const after = promo?.price?.afterDiscount;
  const card = Array.isArray(promo?.attributes) && promo.attributes.includes('CLUBCARD_PRICING') || /clubcard/i.test(desc);
  const unit = String(p?.price?.unitOfMeasure ?? '').toLowerCase();
  const perKgItem = p?.displayType !== 'Quantity' && unit === 'kg';
  if (typeof before === 'number' && typeof after === 'number' && before > after && after > 0) {
    return { price: after, regularPrice: before, requiresCard: card, perKg: perKgItem };
  }
  if (!card) return null;
  const m = desc.match(/^\s*(\d+(?:[.,]\d+)?)\s*€\s*(za kg\s+)?(?:ušetrite \d+\s*%\s*|ušetrite 1\/3\s*|polovičná cena\s*)?s clubcard\s*$/i);
  if (!m) return null;
  const cc = parsePrice(m[1]);
  const perKg = Boolean(m[2]) || perKgItem;
  const regular = perKg ? p?.price?.unitPrice : (typeof after === 'number' ? after : p?.price?.actual);
  if (!cc || typeof regular !== 'number' || regular <= cc) return null;
  return { price: cc, regularPrice: regular, requiresCard: true, perKg };
}

/**
 * Produkt z online obchodu Tesca → ponuka vo formáte apky (najvýhodnejšia platná akcia), alebo null.
 * @param {any} p
 * @param {string} [today] dnešný dátum (YYYY-MM-DD); akcie, ktoré už skončili, sa ignorujú
 */
export function tescoProductToOffer(p, today) {
  if (!p || p.isForSale === false || !Array.isArray(p.promotions)) return null;
  const category = tescoCategory(p);
  if (!category) return null;
  const name = tidyName(p.title);
  if (!name) return null;

  /** @type {null | { price: number, regularPrice: number, requiresCard: boolean, perKg: boolean, promo: any }} */
  let best = null;
  for (const promo of p.promotions) {
    if (!promo?.startDate || !promo?.endDate) continue;
    if (today && lastDay(promo.endDate) < today) continue;
    const r = tescoPromoPrice(p, promo);
    if (r && (!best || r.price / r.regularPrice < best.price / best.regularPrice)) best = { ...r, promo };
  }
  if (!best) return null;

  const size = best.perKg ? { amount: 1, unit: /** @type {const} */ ('kg') } : parseSize(p.title);
  const validFrom = localDate(new Date(best.promo.startDate));
  const multi = /kúpte|kupte/i.test(String(best.promo.description));
  const id = String(p.id ?? '').replace(/[^0-9a-z]/gi, '');
  return {
    id: `sk-tesco-${id}-${validFrom}`,
    country: 'SK',
    chain: 'tesco',
    name,
    brand: typeof p.brandName === 'string' && p.brandName.trim() && !/^tesco$/i.test(p.brandName.trim()) ? p.brandName.trim().slice(0, 80) : null,
    category,
    size,
    price: best.price,
    regularPrice: best.regularPrice,
    lowest30d: null,
    validFrom,
    validTo: lastDay(best.promo.endDate),
    requiresCard: best.requiresCard,
    priceWithoutCard: best.requiresCard ? best.regularPrice : null,
    note: [best.perKg && size?.unit === 'kg' && !/\bkg\b/i.test(p.title) ? 'cena za kg' : '', multi ? String(best.promo.description) : ''].filter(Boolean).join(', ').slice(0, 80) || null,
    tryIt: null,
    matchKey: matchKey(name, size),
    sourceUrl: id ? `${HOST}/groceries/sk-SK/products/${id}` : null,
  };
}

/** Nájde Apollo cache (objekt s kľúčmi „ProductType:…“) kdekoľvek v dátach stránky. @param {any} o @returns {any} */
function findCache(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 8) return null;
  if (Object.keys(o).some((k) => k.startsWith('ProductType:'))) return o;
  for (const v of Object.values(o)) {
    const c = findCache(v, depth + 1);
    if (c) return c;
  }
  return null;
}

/**
 * Z HTML stránky akcií vytiahne produkty s rozbalenými akciami a celkový počet akcií.
 * @param {string} html
 * @returns {{ total: number | null, products: any[] }}
 */
export function productsFromHtml(html) {
  const m = html.match(/<script[^>]*type="application\/discover\+json"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return { total: null, products: [] };
  const json = JSON.parse(m[1]);
  const totalMatch = m[1].match(/"pageSize":\d+,"total":(\d+)/);
  const cache = findCache(json);
  if (!cache) return { total: totalMatch ? Number(totalMatch[1]) : null, products: [] };
  const products = [];
  for (const [k, p] of Object.entries(cache)) {
    if (!k.startsWith('ProductType:') || !Array.isArray(p?.promotions) || !p.promotions.length) continue;
    products.push({ ...p, promotions: p.promotions.map((/** @type {any} */ r) => (r?.__ref ? cache[r.__ref] : r)).filter(Boolean) });
  }
  return { total: totalMatch ? Number(totalMatch[1]) : null, products };
}

/**
 * @param {'SK'|'CZ'} country
 * @param {{ text: (url: string, init?: any) => Promise<string> }} http
 * @param {Date} [now]
 */
export async function fetchOffers(country, http, now = new Date()) {
  if (country !== 'SK') return [];
  const today = localDate(now);
  const out = new Map();
  let total = Infinity;
  for (let page = 1; (page - 1) * PAGE_SIZE < total && page <= 150; page++) {
    // Pomaly: po ~40 rýchlych stranách web vracia 403 (ochrana proti preťaženiu) – neobchádzame ju.
    const html = await http.text(`${HOST}/shop/sk-SK/promotions/all?page=${page}&count=${PAGE_SIZE}`, { delayMs: 5000 });
    const res = productsFromHtml(html);
    if (res.total !== null) total = res.total;
    if (!res.products.length) break;
    for (const p of res.products) {
      const o = tescoProductToOffer(p, today);
      if (o && !out.has(o.id)) out.set(o.id, o);
    }
  }
  if (!out.size) throw new Error('Tesco: na stránke akcií sa nenašli žiadne produkty (zmenil sa web alebo blokuje server).');
  return [...out.values()];
}
