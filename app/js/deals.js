// @ts-check
// Čistá logika akcií: žiadne DOM, žiadna sieť. Používa ju apka aj testy.

/** @typedef {'SK'|'CZ'} Country */
/** @typedef {'g'|'kg'|'ml'|'l'|'ks'} SizeUnit */
/** @typedef {{ amount: number, unit: SizeUnit }} Size */
/**
 * Jedna akciová ponuka v jednotnom formáte (rovnaký pre všetky reťazce).
 * @typedef {{
 *   id: string,
 *   country: Country,
 *   chain: string,
 *   name: string,
 *   brand?: string | null,
 *   category: string,
 *   size?: Size | null,
 *   price: number,
 *   regularPrice?: number | null,
 *   lowest30d?: number | null,
 *   validFrom: string,
 *   validTo: string,
 *   requiresCard?: boolean,
 *   priceWithoutCard?: number | null,
 *   note?: string | null,
 *   tryIt?: string | null,
 *   matchKey?: string | null,
 *   sourceUrl?: string | null,
 *   image?: string | null
 * }} Offer
 */
/**
 * @typedef {{
 *   country: Country,
 *   when: 'today' | 'week',
 *   chains: Set<string>,
 *   categories: Set<string>,
 *   excludeCategories?: Set<string>,
 *   minDiscount: number,
 *   noCard: boolean,
 *   showInflated: boolean,
 *   query: string,
 *   onlyTryIt?: boolean
 * }} Filters
 */

/** Rozdiel medzi zľavou z letáku a reálnou zľavou, od ktorého ju označíme ako nafúknutú (percentuálne body). */
export const INFLATED_GAP = 8;

// ---------- Dátumy (formát YYYY-MM-DD, miestny čas) ----------

/** @param {Date} d */
export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** @param {string} iso */
export function parseIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12); // poludnie: bez problémov so zmenou času
}

/** @param {string} iso @param {number} days */
export function addDays(iso, days) {
  const d = parseIso(iso);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

/** Počet dní medzi dvoma dátumami (b - a). @param {string} a @param {string} b */
export function daysBetween(a, b) {
  return Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86400000);
}

/** Je ponuka platná v daný deň? @param {Offer} o @param {string} day */
export function isActiveOn(o, day) {
  return o.validFrom <= day && day <= o.validTo;
}

/** Prekrýva sa platnosť ponuky s obdobím [from, to]? @param {Offer} o @param {string} from @param {string} to */
export function overlaps(o, from, to) {
  return o.validFrom <= to && o.validTo >= from;
}

/** Obdobie pre filter času. @param {'today'|'week'} when @param {string} today */
export function timeWindow(when, today) {
  return when === 'today' ? { from: today, to: today } : { from: today, to: addDays(today, 6) };
}

/**
 * Ukážkové dáta posunie o celé týždne dopredu, aby vždy vyzerali aktuálne
 * a dni v týždni (napr. leták od stredy) ostali zachované.
 * @param {Offer[]} offers @param {string} anchor @param {string} today
 */
export function rebaseByWeeks(offers, anchor, today) {
  const weeks = Math.floor(daysBetween(anchor, today) / 7);
  if (weeks <= 0) return offers;
  const shift = weeks * 7;
  return offers.map((o) => ({ ...o, validFrom: addDays(o.validFrom, shift), validTo: addDays(o.validTo, shift) }));
}

// ---------- Ceny a zľavy ----------

/** @param {unknown} v */
const positive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** @param {number} price @param {number} ref */
function pct(price, ref) {
  return Math.round(((ref - price) / ref) * 100);
}

/**
 * Referenčná cena na výpočet reálnej zľavy: najnižšia známa cena za 30 dní pred akciou,
 * inak bežná (prečiarknutá) cena z letáku. Nižšia z nich vyhráva.
 * @param {Offer} o
 * @returns {number | null}
 */
export function referencePrice(o) {
  const refs = [o.lowest30d, o.regularPrice].filter(positive);
  return refs.length ? Math.min(.../** @type {number[]} */ (refs)) : null;
}

/**
 * @param {Offer} o
 * @returns {{ claimed: number|null, real: number|null, inflated: boolean, basis: 'lowest30d'|'regular'|null }}
 */
export function discountInfo(o) {
  const claimed = positive(o.regularPrice) ? pct(o.price, /** @type {number} */ (o.regularPrice)) : null;
  const ref = referencePrice(o);
  const real = ref ? pct(o.price, ref) : null;
  const basis = ref === null ? null : positive(o.lowest30d) && ref === o.lowest30d ? 'lowest30d' : 'regular';
  const inflated = claimed !== null && real !== null && claimed - real >= INFLATED_GAP;
  return { claimed, real, inflated, basis };
}

/** Koľko reálne ušetríš na jednom kuse (oproti referenčnej cene). @param {Offer} o */
export function savings(o) {
  const ref = referencePrice(o);
  if (!ref || ref <= o.price) return 0;
  return Math.round((ref - o.price) * 100) / 100;
}

/**
 * Cena za kg / l / kus, aby sa dali porovnať rôzne balenia.
 * @param {Offer} o
 * @returns {{ value: number, unit: 'kg'|'l'|'ks' } | null}
 */
export function unitPrice(o) {
  const s = o.size;
  if (!s || !positive(s.amount)) return null;
  const table = { g: ['kg', 1000], kg: ['kg', 1], ml: ['l', 1000], l: ['l', 1], ks: ['ks', 1] };
  const entry = table[s.unit];
  if (!entry) return null;
  const [unit, div] = /** @type {['kg'|'l'|'ks', number]} */ (entry);
  const qty = s.amount / div;
  return { value: Math.round((o.price / qty) * 100) / 100, unit };
}

// ---------- Text ----------

/** Malé písmená bez diakritiky – na vyhľadávanie a párovanie. @param {string} s */
export function normalizeText(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- Filtrovanie a radenie ----------

const PREMIUM = /\b(bio|premium|deluxe|gourmet|finest|novinka|limitovan|limited|edicia|edice|specialit|craft|exoti|mango|avokad|burrat|prosciutto|parmez|losos|krevet|wagyu|sushi|matcha)/;

/**
 * Prečo sa oplatí vyskúšať (alebo null): tematický týždeň od reťazca, prémiový či nezvyčajný produkt v akcii,
 * alebo zľava aspoň 45 %, pri ktorej nič neriskuješ.
 * @param {Offer} o
 */
export function tryReason(o) {
  if (o.tryIt) return o.tryIt;
  const real = discountInfo(o).real ?? 0;
  if (real >= 25 && PREMIUM.test(normalizeText(`${o.name} ${o.brand ?? ''}`))) return 'Lepšia kvalita v akcii';
  if (real >= 45 && o.category !== 'drogeria') return 'Za pol ceny – dobrá príležitosť vyskúšať';
  return null;
}

/** @param {Offer} o @param {Filters} f @param {string} today */
export function matchesFilters(o, f, today) {
  if (o.country !== f.country) return false;
  const { from, to } = timeWindow(f.when, today);
  if (!overlaps(o, from, to)) return false;
  if (f.chains.size && !f.chains.has(o.chain)) return false;
  if (f.categories.size && !f.categories.has(o.category)) return false;
  if (f.excludeCategories?.has(o.category)) return false;
  if (f.noCard && o.requiresCard) return false;
  if (f.onlyTryIt && !tryReason(o)) return false;
  const d = discountInfo(o);
  if (d.real === null || d.real < f.minDiscount) {
    // Nafúknuté zľavy (leták tvrdí veľa, reálne málo) ukážeme len na požiadanie.
    if (!(f.showInflated && d.inflated && (d.claimed ?? 0) >= f.minDiscount)) return false;
  }
  if (f.query) {
    const hay = normalizeText(`${o.name} ${o.brand ?? ''}`);
    const words = normalizeText(f.query).split(' ').filter(Boolean);
    if (!words.every((w) => hay.includes(w))) return false;
  }
  return true;
}

/**
 * Ponuka tak, ako ju uvidí človek bez vernostnej karty: cena bez karty, alebo null, ak bez karty zľava nie je.
 * @param {Offer} o
 * @returns {Offer | null}
 */
export function withoutCard(o) {
  if (!o.requiresCard) return o;
  if (typeof o.priceWithoutCard === 'number' && o.priceWithoutCard > 0) {
    return { ...o, price: o.priceWithoutCard, requiresCard: false, priceWithoutCard: null };
  }
  return null;
}

/** @param {Offer[]} offers @param {Filters} f @param {string} today */
export function filterOffers(offers, f, today) {
  const list = f.noCard ? /** @type {Offer[]} */ (offers.map(withoutCard).filter(Boolean)) : offers;
  return list.filter((o) => matchesFilters(o, f, today));
}

/**
 * @param {Offer[]} offers
 * @param {'discount'|'savings'|'unit'|'ending'} key
 */
export function sortOffers(offers, key) {
  const list = [...offers];
  const real = (/** @type {Offer} */ o) => discountInfo(o).real ?? -1;
  const byDiscount = (/** @type {Offer} */ a, /** @type {Offer} */ b) => real(b) - real(a) || savings(b) - savings(a);
  if (key === 'savings') list.sort((a, b) => savings(b) - savings(a) || byDiscount(a, b));
  else if (key === 'ending') list.sort((a, b) => a.validTo.localeCompare(b.validTo) || byDiscount(a, b));
  else if (key === 'unit') {
    const order = { kg: 0, l: 1, ks: 2 };
    list.sort((a, b) => {
      const ua = unitPrice(a);
      const ub = unitPrice(b);
      if (!ua || !ub) return ua ? -1 : ub ? 1 : byDiscount(a, b);
      return order[ua.unit] - order[ub.unit] || ua.value - ub.value;
    });
  } else list.sort(byDiscount);
  return list;
}

// ---------- Porovnanie naprieč reťazcami ----------

/**
 * Pre rovnaký produkt (rovnaký matchKey) v rôznych reťazcoch zistí, kde je najlacnejší
 * (podľa ceny za kg / l / ks, aby sedeli aj rôzne balenia).
 * @param {Offer[]} offers ponuky, ktoré sa dajú kúpiť v rovnakom období
 * @returns {Map<string, { count: number, cheapest: Offer, isCheapest: boolean, diff: number }>}
 */
export function compareAcrossChains(offers) {
  /** @type {Map<string, Offer[]>} */
  const groups = new Map();
  for (const o of offers) {
    if (!o.matchKey) continue;
    const k = `${o.country}|${o.matchKey}`;
    const g = groups.get(k) ?? [];
    g.push(o);
    groups.set(k, g);
  }
  const result = new Map();
  for (const g of groups.values()) {
    const chains = new Set(g.map((o) => o.chain));
    if (chains.size < 2) continue;
    const score = (/** @type {Offer} */ o) => unitPrice(o)?.value ?? o.price;
    const sorted = [...g].sort((a, b) => score(a) - score(b));
    const cheapest = sorted[0];
    for (const o of g) {
      const diff = Math.round((score(o) - score(cheapest)) * 100) / 100;
      result.set(o.id, { count: chains.size, cheapest, isCheapest: o === cheapest || diff === 0, diff });
    }
  }
  return result;
}

/**
 * Súhrn podľa reťazca: kde sa v danom výbere oplatí nakúpiť najviac.
 * @param {Offer[]} offers už vyfiltrované ponuky
 */
export function chainSummary(offers) {
  /** @type {Map<string, Offer[]>} */
  const by = new Map();
  for (const o of offers) {
    const g = by.get(o.chain) ?? [];
    g.push(o);
    by.set(o.chain, g);
  }
  const rows = [...by.entries()].map(([chain, list]) => {
    const reals = list.map((o) => discountInfo(o).real ?? 0);
    const sorted = sortOffers(list, 'discount');
    return {
      chain,
      count: list.length,
      avgDiscount: Math.round(reals.reduce((a, b) => a + b, 0) / list.length),
      totalSavings: Math.round(list.reduce((a, o) => a + savings(o), 0) * 100) / 100,
      top: sorted.slice(0, 3),
    };
  });
  // Viac výhodných akcií a vyššia priemerná zľava = lepšie miesto na nákup.
  rows.sort((a, b) => b.count * b.avgDiscount - a.count * a.avgDiscount || b.totalSavings - a.totalSavings);
  return rows;
}

/**
 * Nákupný zoznam rozdelený podľa obchodu.
 * @param {Offer[]} items
 */
export function groupList(items) {
  /** @type {Map<string, Offer[]>} */
  const by = new Map();
  for (const o of items) {
    const g = by.get(o.chain) ?? [];
    g.push(o);
    by.set(o.chain, g);
  }
  return [...by.entries()]
    .map(([chain, list]) => ({
      chain,
      items: list,
      total: Math.round(list.reduce((a, o) => a + o.price, 0) * 100) / 100,
      saved: Math.round(list.reduce((a, o) => a + savings(o), 0) * 100) / 100,
    }))
    .sort((a, b) => b.items.length - a.items.length);
}
