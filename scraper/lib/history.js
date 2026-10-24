// @ts-check
// História cien: z nej počítame, či je zľava reálna (najnižšia cena za 30 dní pred akciou).
import { addDays } from '../../app/js/deals.js';
import { slug } from './normalize.js';

/** @typedef {import('../../app/js/deals.js').Offer} Offer */
/** @typedef {Record<string, Array<{ d: string, p: number, r?: number | null }>>} History */

const KEEP_DAYS = 120;

/** Kľúč produktu v rámci reťazca a krajiny. @param {Offer} o */
export function historyKey(o) {
  const size = o.size ? `${o.size.amount}${o.size.unit}` : '';
  return `${o.country}|${o.chain}|${o.matchKey ?? slug(o.name)}|${size}`;
}

/**
 * Najnižšia známa cena v 30 dňoch pred dátumom (akciové aj bežné ceny, ktoré sme videli).
 * @param {History} history @param {string} key @param {string} beforeDate
 */
export function lowestBefore(history, key, beforeDate, days = 30) {
  const from = addDays(beforeDate, -days);
  let low = Infinity;
  for (const e of history[key] ?? []) {
    if (e.d < from || e.d >= beforeDate) continue;
    low = Math.min(low, e.p, e.r && e.r > 0 ? e.r : Infinity);
  }
  return Number.isFinite(low) ? low : null;
}

/**
 * Doplní lowest30d tam, kde ho reťazec sám neuvádza.
 * @param {Offer[]} offers @param {History} history
 * @returns {Offer[]}
 */
export function applyHistory(offers, history) {
  return offers.map((o) => {
    if (typeof o.lowest30d === 'number' && o.lowest30d > 0) return o;
    const low = lowestBefore(history, historyKey(o), o.validFrom);
    return low !== null ? { ...o, lowest30d: low } : o;
  });
}

/**
 * Zapíše dnešné ceny do histórie a zahodí staré záznamy.
 * @param {History} history @param {Offer[]} offers @param {string} today
 * @returns {History}
 */
export function updateHistory(history, offers, today) {
  const next = structuredClone(history);
  for (const o of offers) {
    const key = historyKey(o);
    const list = next[key] ?? [];
    if (!list.some((e) => e.d === o.validFrom && e.p === o.price)) list.push({ d: o.validFrom, p: o.price, r: o.regularPrice ?? null });
    next[key] = list;
  }
  const cutoff = addDays(today, -KEEP_DAYS);
  for (const key of Object.keys(next)) {
    next[key] = next[key].filter((e) => e.d >= cutoff).sort((a, b) => a.d.localeCompare(b.d));
    if (!next[key].length) delete next[key];
  }
  return next;
}
