// @ts-check
// Billa – billa.sk (leták streda–utorok, ceny s BILLA Bonus) a billa.cz.
//
// Zdroj SK (overené 24. 10. 2026): web billa.sk má API
//   /api/product-discovery/categories/kw-<týždeň><rok>/products?page=N&pageSize=100
// so všetkými produktmi letáku daného týždňa (napr. kw-432026 = leták 21.–27. 10. 2026).
// Ceny sú v centoch: price.regular.value = aktuálna cena, price.crossed = prečiarknutá,
// price.loyalty.value = cena s BILLA Bonus, regular.promotionText = podmienka (napr. „pri kúpe 2 ks“).
//
// Leták budúceho týždňa (kw+1) býva v API už od štvrtka – berieme oba.
//
// Zdroj CZ (overené 24. 10. 2026): billa.cz má rovnaké API, ale bez letákových kategórií:
//   /api/product-discovery/products?inPromotion=true&page=N&pageSize=200  (~3 400 produktov v akcii)
// Navyše má price.lowestPrice = najnižšia cena za 30 dní pred akciou (Omnibus). Keď je nižšia než
// prečiarknutá cena, skutočná zľava je menšia (a pod akciovou cenou dokonca žiadna) – apka to tak označí.
// (Na billa.sk lowestPrice nedáva zmysel – napr. 0,46 € pri cene 9,90 € – preto ho tam ignorujeme.)
import { guessCategory, localDate, matchKey, norm, safeImage, shiftDate, tidyName, wednesdayWeek, isoWeek } from '../lib/normalize.js';

const SK_HOST = 'https://www.billa.sk';
const CZ_HOST = 'https://www.billa.cz';

/** Slovenské a české názvy kategórií (Billa CZ) → kategória v apke. */
const LOCAL_CATEGORY_RULES = /** @type {Array<[RegExp, string]>} */ ([
  [/drogeri|kosmetik|hygien|domacnost|zvirat|zvierat|mazlic|domaci miláč|pro deti|pre deti|plenk|plienk|papirov|uklid|prani|pranie/, 'drogeria'],
  [/mrazen/, 'mrazene'],
  [/napoj|lihovin|liehovin|vino|vina|pivo|piva|kava|caj|dzus|limonad|voda|vody/, 'napoje'],
  [/maso|uzenin|udenin|lahudk|ryby|drubez|hydin/, 'maso'],
  [/mlecn|mliecn|syry|syr\b|vejce|vajc|jogurt|chlazen/, 'mliecne'],
  [/pecivo|pekar|chleb|chlieb/, 'pecivo'],
  [/ovoce|ovocie|zelenin|bylink/, 'ovocie'],
  [/sladk|slane|slané|cukrovin|cokolad|susenk|susienk|bonbon|orisk|orech/, 'snacky'],
  [/trvanliv|konzerv|testovin|cestovin|ryze|ryza|mouk|muk|olej|koren|omack|polevk|polievk|cereal/, 'trvanlive'],
]);

/** Anglické kategórie Billy → kategória v apke. Poradie je dôležité. */
const CATEGORY_RULES = /** @type {Array<[RegExp, string]>} */ ([
  [/pet|dog|cat food|clean|toilet|detergent|laundry|dish|hair|shampoo|shower|soap|body|dental|tooth|deodor|diaper|tissue|cosmetic|hygien|household|paper/i, 'drogeria'],
  [/frozen|ice cream/i, 'mrazene'],
  [/coffee|tea|beer|wine|juice|water|soft drink|lemonade|sirup|syrup|spirit|liquor|drink|energy|cocoa|sparkling/i, 'napoje'],
  [/pork|poultry|beef|meat|sausage|ham|salami|fish|seafood|chicken|turkey|veal|lamb|game|bacon/i, 'maso'],
  [/cheese|milk|yog|butter|cream|egg|dairy|quark|curd|kefir|dessert/i, 'mliecne'],
  [/fruit|vegetable|potato|salad|herb|mushroom|nuts? &|f\+v/i, 'ovocie'],
  [/bread|bakery|roll|pastry|baguette|toast|cake/i, 'pecivo'],
  [/spread|jam|marmelade|honey|cereal|m[uü]sli|pasta|rice|flour|sauce|oil|canned|soup|spice/i, 'trvanlive'],
  [/choco|waff|biscuit|cookie|chips|crisps|snack|sweet|candy|gum|praline|bar\b/i, 'snacky'],
]);

/**
 * Strom kategórií billa.cz (overené 24. 10. 2026) je spoľahlivý – berieme ho pred názvom produktu.
 * Kľúč = hlavná kategória bez diakritiky; hodnota = kategória alebo funkcia podľa podkategórie.
 * @type {Record<string, string | ((sub: string, name: string) => string)>}
 */
const CZ_TREE = {
  'drogerie a kosmetika': 'drogeria',
  'domacnost': 'drogeria',
  'mazlicci': 'drogeria',
  'pece o dite': (sub, name) => (/strava|napoj/.test(sub) ? guessCategory(name, 'trvanlive') : 'drogeria'),
  'napoje': 'napoje',
  'mrazene': 'mrazene',
  'maso a ryby': 'maso',
  'uzeniny, lahudky a hotova jidla': 'maso',
  'chlazene, mlecne a rostlinne vyrobky': (sub) => (/majonez|dresink/.test(sub) ? 'trvanlive' : 'mliecne'),
  'ovoce a zelenina': (sub) => (/orech|seminka/.test(sub) ? 'snacky' : 'ovocie'),
  'pecivo': (sub) => (/peceni/.test(sub) ? 'trvanlive' : 'pecivo'),
  'cukrovinky': 'snacky',
  'trvanlive potraviny': (sub) => (/slane|snack/.test(sub) ? 'snacky' : 'trvanlive'),
  'specialni a rostlinna vyziva': (_sub, name) => guessCategory(name, 'trvanlive'),
};

/** @param {any} product */
export function billaCategory(product) {
  const paths = Array.isArray(product?.parentCategories) ? product.parentCategories : [];
  const own = paths.find((p) => Array.isArray(p) && p[0]?.name !== 'LEAFLET');
  const tree = Array.isArray(own) ? CZ_TREE[norm(own[0]?.name ?? '')] : undefined;
  if (tree) return typeof tree === 'string' ? tree : tree(norm(own?.[1]?.name ?? ''), String(product?.name ?? ''));
  const text = Array.isArray(own) ? own.map((c) => c?.name ?? '').join(' > ') : '';
  for (const [re, cat] of CATEGORY_RULES) if (text && re.test(text)) return cat;
  // Názov má často presnejšiu informáciu než široká kategória („Sladké a slané“ → čipsy aj oriešky).
  const byName = guessCategory(String(product?.name ?? ''), '');
  if (byName) return byName;
  const local = norm(text);
  for (const [re, cat] of LOCAL_CATEGORY_RULES) if (local && re.test(local)) return cat;
  return 'trvanlive';
}

const UNIT = /** @type {Record<string, 'g'|'kg'|'ml'|'l'|'ks'>} */ ({ g: 'g', gr: 'g', kg: 'kg', ml: 'ml', l: 'l', ks: 'ks', kus: 'ks', pc: 'ks' });

/** @param {any} product */
function billaSize(product) {
  if (product?.weightArticle) return { amount: 1, unit: /** @type {const} */ ('kg') };
  const amount = Number(String(product?.amount ?? '').replace(',', '.'));
  const unit = UNIT[String(product?.volumeLabelShort ?? product?.volumeLabelKey ?? '').toLowerCase()];
  return amount > 0 && unit ? { amount, unit } : null;
}

/**
 * Je produkt v letáku daného týždňa len vo „Víkendovej ponuke“?
 * @param {any} product @param {string} [slug] napr. kw-432026
 */
export function isWeekendOnly(product, slug) {
  if (!slug) return false;
  const paths = Array.isArray(product?.parentCategories) ? product.parentCategories : [];
  const inWeek = paths.filter((p) => Array.isArray(p) && p[0]?.name === 'LEAFLET' && (p[1]?.slug === slug || String(p[1]?.name ?? '').replace(/\D/g, '') === slug.replace(/\D/g, '')));
  return inWeek.length > 0 && inWeek.every((p) => /v[ií]kend/i.test(String(p[2]?.name ?? '')));
}

/** centy → eurá @param {unknown} v */
const cents = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) / 100 : null);

/**
 * Najnižšia cena za 30 dní pred akciou (billa.cz, pravidlo EÚ Omnibus).
 * Berieme ju, keď je nižšia než prečiarknutá cena – vtedy je skutočná zľava menšia, než hlási leták
 * (napr. Haribo 16,90 Kč „z 24,90“, ale pred 2 týždňami bolo za 17,90). Nezmyselné hodnoty ignorujeme.
 * @param {any} pr @param {number} price @param {number} regularPrice @param {{ useLowestPrice?: boolean }} ctx
 */
function lowest30(pr, price, regularPrice, ctx) {
  const low = cents(pr?.lowestPrice);
  if (!ctx.useLowestPrice || !low) return null;
  return low < regularPrice && low > price * 0.4 ? low : null;
}

/** Názov kategórie týždňového letáku Billy: týždeň 43/2026 → kw-432026. @param {{ week: number, year: number }} w */
export function weekSlug(w) {
  return `kw-${w.week}${w.year}`;
}

/**
 * Produkt z API Billy → ponuka vo formáte apky (alebo null, ak nie je zľavnený).
 * @param {any} product
 * @param {{ country: 'SK'|'CZ', validFrom: string, validTo: string, slug?: string, useLowestPrice?: boolean, host?: string }} ctx
 */
export function billaProductToOffer(product, ctx) {
  const pr = product?.price;
  if (!pr || product?.published === false) return null;
  const now = cents(pr.regular?.value);
  const crossed = cents(pr.crossed);
  const card = cents(pr.loyalty?.value);

  let price = now;
  let regularPrice = crossed;
  let requiresCard = false;
  /** @type {number | null} */ let priceWithoutCard = null;
  if (card && (!now || card < now)) {
    price = card;
    requiresCard = true;
    priceWithoutCard = now;
    regularPrice = crossed ?? now;
  }
  if (!price || !regularPrice || regularPrice <= price) return null;

  const name = tidyName(product.name);
  if (!name) return null;
  const size = billaSize(product);
  const promo = String(pr.regular?.promotionText ?? pr.loyalty?.promotionText ?? '').trim();
  const weekendOnly = isWeekendOnly(product, ctx.slug);
  const note = [weekendOnly ? 'len cez víkend' : '', promo].filter(Boolean).join(', ');
  return {
    id: `${ctx.country.toLowerCase()}-billa-${product.sku ?? product.productId}-${ctx.validFrom}`,
    country: ctx.country,
    chain: 'billa',
    name,
    brand: typeof product.brand?.name === 'string' && product.brand.name.trim() ? product.brand.name.trim().slice(0, 80) : null,
    category: billaCategory(product),
    size,
    price,
    regularPrice,
    lowest30d: lowest30(pr, price, regularPrice, ctx),
    validFrom: ctx.validFrom,
    validTo: ctx.validTo,
    requiresCard,
    priceWithoutCard: priceWithoutCard && priceWithoutCard > price && priceWithoutCard < regularPrice ? priceWithoutCard : null,
    note: note ? note.slice(0, 80) : null,
    tryIt: null,
    matchKey: matchKey(name, size),
    sourceUrl: ctx.host && typeof product.slug === 'string' && /^[a-z0-9-]+$/.test(product.slug) ? `${ctx.host}/produkt/${product.slug}` : null,
    image: Array.isArray(product.images) ? safeImage(product.images[0]) : null,
  };
}

/**
 * @param {'SK'|'CZ'} country
 * @param {{ json: (url: string) => Promise<any> }} http
 * @param {Date} [now]
 */
export async function fetchOffers(country, http, now = new Date()) {
  const week = wednesdayWeek(localDate(now));
  return country === 'CZ' ? fetchCz(http, week) : fetchSk(http, week);
}

/**
 * Billa SK: leták tohto a budúceho týždňa.
 * @param {{ json: (url: string) => Promise<any> }} http @param {ReturnType<typeof wednesdayWeek>} week
 */
async function fetchSk(http, week) {
  const nextFrom = shiftDate(week.from, 7);
  const weeks = [
    { from: week.from, to: week.to, slug: weekSlug(week) },
    { from: nextFrom, to: shiftDate(nextFrom, 6), slug: weekSlug(isoWeek(nextFrom)) },
  ];
  /** @type {Map<string, any>} */
  const offers = new Map();
  for (const w of weeks) {
    try {
      for (let page = 0, total = Infinity, seen = 0; seen < total && page < 40; page++) {
        const data = await http.json(`${SK_HOST}/api/product-discovery/categories/${w.slug}/products?sortBy=relevance&page=${page}&pageSize=100`);
        const results = Array.isArray(data?.results) ? data.results : [];
        total = Number(data?.total) || 0;
        seen += results.length;
        for (const p of results) {
          const offer = billaProductToOffer(p, { country: 'SK', validFrom: w.from, validTo: w.to, slug: w.slug });
          if (offer && !offers.has(offer.id)) offers.set(offer.id, offer);
        }
        if (!results.length) break;
      }
    } catch {
      /* budúci leták ešte nemusí existovať */
    }
  }
  if (!offers.size) throw new Error(`Billa SK: pre týždeň ${week.week}/${week.year} sa nenašli žiadne akcie.`);
  return [...offers.values()];
}

/**
 * Billa CZ: všetky produkty v akcii; platnosť = aktuálny leták (streda–utorok).
 * @param {{ json: (url: string) => Promise<any> }} http @param {ReturnType<typeof wednesdayWeek>} week
 */
async function fetchCz(http, week) {
  /** @type {Map<string, any>} */
  const offers = new Map();
  for (let page = 0, total = Infinity, seen = 0; seen < total && page < 40; page++) {
    const data = await http.json(`${CZ_HOST}/api/product-discovery/products?inPromotion=true&page=${page}&pageSize=200`);
    const results = Array.isArray(data?.results) ? data.results : [];
    total = Number(data?.total) || 0;
    seen += results.length;
    for (const p of results) {
      const offer = billaProductToOffer(p, { country: 'CZ', validFrom: week.from, validTo: week.to, useLowestPrice: true, host: CZ_HOST });
      if (offer && !offers.has(offer.id)) offers.set(offer.id, offer);
    }
    if (!results.length) break;
  }
  if (!offers.size) throw new Error('Billa CZ: nenašli sa žiadne akcie.');
  return [...offers.values()];
}
