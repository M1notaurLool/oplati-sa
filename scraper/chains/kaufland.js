// @ts-check
// Kaufland – kaufland.sk (leták štvrtok–streda) a kaufland.cz (streda–utorok).
//
// Zistené 24. 10. 2026: kaufland.sk aj kaufland.cz chráni Cloudflare – stránka chce potvrdenie
// „Overte, že ste človek“ (Turnstile). Server ani automatický prehliadač sa k akciám nedostane
// a ochranu proti robotom neobchádzame. Preto tu nie je automatické sťahovanie.
//
// Ručná cesta so záložkou (kaufland-zalozka.html): človek otvorí akcie Kauflandu vo svojom prehliadači
// (overenie, ak príde, potvrdí sám), klikne na záložku „Oplatí sa → Kaufland“ a tá uloží dlaždice akcií
// z práve zobrazenej stránky do Stiahnutých súborov ako kaufland-SK-….raw.json. Nič ďalšie nesťahuje.
// Súbor si pri najbližšej aktualizácii vezme tools/aktualizuj.ps1 a tu sa prevedie na ponuky.
//
// Text dlaždice je napr. „Rama / Rastlinný tuk / 400 g / 1 kg = 4,98 / -33 % / 2,99 / 1,99“.
// Ponuku berieme len vtedy, keď stará cena, nová cena a vytlačená zľava navzájom sedia.
import { guessCategory, localDate, matchKey, parseSize, shiftDate, tidyName } from '../lib/normalize.js';

const PRICE = /(?<![\d,.])(\d{1,4})[.,](\d{2})(?![\d])/g;
const PCT = /[-−–]\s?(\d{1,2})\s?%/;
const UNIT_LINE = /=|\/\s?(kg|l|ks|100\s?(g|ml))\b|za\s+1\s?(kg|l|ks)\b/i;
const NOISE = /kaufland card|k card|do košíka|do kosika|pridať|pridat|detail|cena platí|platí|plati|platnost|platnosť|akcia|akce|novinka|odporúčame|doporučujeme|^\*|^\d+\s?x$/i;

/**
 * Ceny a zľavy rozdelené do viacerých prvkov stránky spojí: „1“ + „99“ → „1,99“, „-33“ + „%“ → „-33 %“.
 * @param {string[]} lines
 */
function joinSplit(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i];
    const b = lines[i + 1] ?? '';
    if (/^\d{1,4}[.,]?$/.test(a) && /^\d{2}$/.test(b)) {
      out.push(`${a.replace(/[.,]$/, '')},${b}`);
      i++;
    } else if (/^[-−–]\s?\d{1,2}$/.test(a) && /^%$/.test(b)) {
      out.push(`${a} %`);
      i++;
    } else out.push(a);
  }
  return out;
}

/**
 * Dlaždica akcie (text z kaufland.sk/cz) → ceny a názov, alebo null, keď sa ceny nedajú overiť.
 * @param {string} text
 */
export function parseTile(text) {
  const lines = joinSplit(String(text || '').split(/\n+/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean));
  if (lines.length < 2 || lines.length > 25) return null;
  const pctLine = lines.find((l) => PCT.test(l));
  const pct = pctLine ? Number(pctLine.match(PCT)?.[1]) : null;
  /** @type {number[]} */
  const prices = [];
  for (const l of lines) {
    if (UNIT_LINE.test(l) || PCT.test(l) && !/\d[.,]\d{2}.*\d[.,]\d{2}/.test(l)) continue;
    for (const m of l.matchAll(PRICE)) prices.push(Number(`${m[1]}.${m[2]}`));
  }
  const uniq = [...new Set(prices)];
  if (uniq.length < 2 || uniq.length > 3) return null;
  const sorted = [...uniq].sort((a, b) => a - b);
  // cena s kartou je najnižšia; stará cena najvyššia
  const price = sorted[0];
  const old = sorted[sorted.length - 1];
  if (!(price > 0 && old > price)) return null;
  const real = Math.round((1 - price / old) * 100);
  if (pct !== null ? Math.abs(real - pct) > 1 : uniq.length !== 2 || real < 5) return null;
  const card = lines.some((l) => /kaufland card|k card|s kartou/i.test(l));
  const middle = uniq.length === 3 ? sorted[1] : null;
  const nameLines = lines.filter((l) => /\p{L}{2,}/u.test(l) && !PCT.test(l) && !UNIT_LINE.test(l) && !NOISE.test(l) && !/^\d/.test(l) && !/^(€|kč)$/i.test(l));
  const name = nameLines.slice(0, 3).join(' ').replace(/\s+/g, ' ').trim();
  if (name.length < 3) return null;
  const sizeLine = lines.find((l) => !UNIT_LINE.test(l) && parseSize(l));
  return { name, price, regularPrice: old, priceWithoutCard: card && middle ? middle : null, requiresCard: card, size: sizeLine ? parseSize(sizeLine) : null, pct: pct ?? real };
}

/**
 * Platnosť letáku z textu stránky („platí od 23. 10. do 29. 10. 2026“), inak týždeň Kauflandu
 * (SK štvrtok–streda, CZ streda–utorok) podľa dňa uloženia.
 * @param {string[]} texts @param {'SK'|'CZ'} country @param {string} fetchedAt
 */
export function kauflandDates(texts, country, fetchedAt) {
  const today = localDate(new Date(fetchedAt));
  for (const t of texts) {
    const m = String(t).match(/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})?\s*(?:[-–]|do)\s*(?:\p{L}+\s+)?(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})?/u);
    if (!m) continue;
    const year = Number(m[6] ?? m[3] ?? today.slice(0, 4));
    const p2 = (/** @type {string} */ v) => v.padStart(2, '0');
    const from = `${m[3] ?? (Number(m[2]) > Number(m[5]) ? year - 1 : year)}-${p2(m[2])}-${p2(m[1])}`;
    const to = `${year}-${p2(m[5])}-${p2(m[4])}`;
    if (from <= to && to >= today && shiftDate(from, 21) >= to) return { validFrom: from, validTo: to };
  }
  const [y, mo, d] = today.split('-').map(Number);
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const start = country === 'SK' ? 4 : 3; // štvrtok / streda
  const validFrom = shiftDate(today, -((dow - start + 7) % 7));
  return { validFrom, validTo: shiftDate(validFrom, 6) };
}

/**
 * Súbor zo záložky → ponuky.
 * @param {{ source: string, url?: string, fetchedAt?: string, dates?: string[], items?: { text: string, parts?: string[], href?: string | null }[] }} raw
 */
export function offersFromPage(raw) {
  const country = /** @type {'SK'|'CZ'} */ (String(raw.source).endsWith('-CZ') ? 'CZ' : 'SK');
  const fetchedAt = raw.fetchedAt ?? new Date().toISOString();
  const { validFrom, validTo } = kauflandDates(raw.dates ?? [], country, fetchedAt);
  const host = country === 'CZ' ? 'kaufland.cz' : 'kaufland.sk';
  const okUrl = (/** @type {unknown} */ u) => (typeof u === 'string' && new RegExp(`^https://(www\\.)?${host.replace('.', '\\.')}/`).test(u) ? u.slice(0, 300) : null);
  const out = new Map();
  for (const item of raw.items ?? []) {
    // „parts“ = texty jednotlivých prvkov dlaždice (záložka ich ukladá), presnejšie než innerText
    const t = parseTile(Array.isArray(item?.parts) && item.parts.length ? item.parts.join('\n') : item?.text ?? '');
    if (!t) continue;
    const name = tidyName(t.name);
    const id = `${country.toLowerCase()}-kaufland-${matchKey(name, t.size)}-${validFrom}`.slice(0, 150);
    if (out.has(id)) continue;
    out.set(id, {
      id,
      country,
      chain: 'kaufland',
      name: name.slice(0, 160),
      brand: null,
      category: guessCategory(name),
      size: t.size,
      price: t.price,
      regularPrice: t.regularPrice,
      lowest30d: null,
      validFrom,
      validTo,
      requiresCard: t.requiresCard,
      priceWithoutCard: t.priceWithoutCard,
      note: null,
      tryIt: null,
      matchKey: matchKey(name, t.size),
      sourceUrl: okUrl(item?.href) ?? okUrl(raw.url),
    });
  }
  return [...out.values()];
}

/** @param {'SK'|'CZ'} country @param {typeof import('../lib/http.js').http} http */
export async function fetchOffers(country, http) {
  void country;
  void http;
  throw new Error('Kaufland: web vyžaduje overenie „nie som robot“ – len ručne cez záložku (kaufland-zalozka.html).');
}
