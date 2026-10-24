// @ts-check
// Formátovanie pre slovenské UI: meny, dátumy, jednotky.
import { parseIso, daysBetween } from './deals.js';

/** @type {Record<string, Intl.NumberFormat>} */
const moneyFmt = {
  SK: new Intl.NumberFormat('sk-SK', { style: 'currency', currency: 'EUR' }),
  CZ: new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', minimumFractionDigits: 2 }),
};

/** @param {number} value @param {string} country */
export function money(value, country) {
  return (moneyFmt[country] ?? moneyFmt.SK).format(value);
}

const DAYS = ['ne', 'po', 'ut', 'st', 'št', 'pi', 'so'];

/** „st 28. 10.“ @param {string} iso */
export function shortDate(iso) {
  const d = parseIso(iso);
  return `${DAYS[d.getDay()]} ${d.getDate()}. ${d.getMonth() + 1}.`;
}

/**
 * Text o platnosti akcie z pohľadu dneška.
 * @param {{ validFrom: string, validTo: string }} o @param {string} today
 * @returns {{ text: string, tone: 'soon'|'last'|'normal' }}
 */
export function validity(o, today) {
  if (o.validFrom > today) {
    const inDays = daysBetween(today, o.validFrom);
    return { text: inDays === 1 ? 'od zajtra' : `od ${shortDate(o.validFrom)}`, tone: 'soon' };
  }
  if (o.validTo === today) return { text: 'len dnes', tone: 'last' };
  if (daysBetween(today, o.validTo) === 1) return { text: 'do zajtra', tone: 'last' };
  return { text: `do ${shortDate(o.validTo)}`, tone: 'normal' };
}

/** @param {{ amount: number, unit: string } | null | undefined} size */
export function sizeLabel(size) {
  if (!size) return '';
  const n = new Intl.NumberFormat('sk-SK', { maximumFractionDigits: 3 }).format(size.amount);
  return `${n} ${size.unit}`;
}

/** @param {{ value: number, unit: string } | null} up @param {string} country */
export function unitLabel(up, country) {
  if (!up) return '';
  return `${money(up.value, country)}/${up.unit}`;
}

/** @param {number} km */
export function distance(km) {
  if (km < 1) return `${Math.round(km * 1000 / 10) * 10} m`;
  return `${new Intl.NumberFormat('sk-SK', { maximumFractionDigits: 1 }).format(km)} km`;
}

/** Bezpečné vloženie textu z dát do HTML (dáta zo scrapera sú nedôveryhodné). @param {unknown} s */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** Pustí len https odkazy – nič ako javascript: z cudzích dát. @param {unknown} url */
export function safeUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
