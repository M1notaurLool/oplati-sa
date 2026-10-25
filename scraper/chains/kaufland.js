// @ts-check
// Kaufland – kaufland.sk (leták štvrtok–streda) a kaufland.cz (streda–utorok).
//
// Zistené 24. 10. 2026: web kaufland.sk/.cz chráni Cloudflare („Overte, že ste človek“) – ten neobchádzame.
//
// Zdroj (overené 25. 10. 2026): verejný leták na leaflets.kaufland.com (platforma leaflets.schwarz, bez overenia,
// sťahovanie PDF povolené – „enableDownload“: true):
//   https://endpoints.leaflets.schwarz/v4/flyer?flyer_identifier=SK_sk_KDZ_1020_SK43-LFT&region_id=0&region_code=0
//   → offerStartDate/offerEndDate, pdfUrl (≈ 20 MB, s textovou vrstvou)
//   identifikátor: SK_sk_KDZ_1020_SK<týždeň>-LFT, CZ_cs_KDZ_4310_CZ<týždeň>-LFT (týždeň = ISO týždeň začiatku letáku)
// Z PDF sa vytiahnu texty s polohou (pdf.js) a poskladajú do ponúk ako pri Alberte:
//   cenovka = zľava „-44%“ (aj „-“ „25“ „%“) + stará cena „1.59“ + nová cena „0.89“ (SK bodka, CZ čiarka)
//   dve zľavy s rovnakou starou cenou = cena s Kaufland Card XTRA (nižšia) a bez nej
//   blok s názvom = riadky s rovnakým ľavým okrajom: „Encián 45 %“ / „110 g“ / „(=1 kg 8,09)“
// Cenovka ide k bloku, keď sedí jednotková cena (0,89 € / 110 g = 8,09 €/kg), inak k jedinému blízkemu bloku.
// Ponuka prejde, len keď vytlačená zľava sedí so starou a novou cenou.
//
// Záložne ostáva ručná cesta so záložkou (kaufland-zalozka.html) – dlaždice z webu Kauflandu.
import { guessCategory, isoWeek, localDate, matchKey, parseSize, shiftDate, tidyName } from '../lib/normalize.js';
import { mergeLine, NONFOOD, pdfPages } from './albert.js';

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

// ---------- Leták (PDF) ----------

const API = 'https://endpoints.leaflets.schwarz/v4/flyer';
const FLYER = { SK: (/** @type {number} */ w) => `SK_sk_KDZ_1020_SK${w}-LFT`, CZ: (/** @type {number} */ w) => `CZ_cs_KDZ_4310_CZ${w}-LFT` };
const L_PCT = /^[-–−]\s?(\d{1,2})\s?%$/;
const L_PRICE = /^(\d{1,4})[.,](\d{2}|-)$/;
const L_SKIP = /^(pouze|iba|len|akce!?|akcia!?|a|k|c|e|super|cena|novinka|nové|nove|xtra)$/i;

/** @typedef {[string, number, number, number, number]} PdfItem */

/** „1.59“ / „59,90“ / „149,-“ → číslo @param {string} s */
const lp = (s) => {
  const m = s.trim().match(L_PRICE);
  return m ? Math.round((Number(m[1]) + (m[2] === "-" ? 0 : Number(m[2]) / 100)) * 100) / 100 : null;
};

/** „MADETA Jihočeské máslo“ → „Madeta Jihočeské máslo“ @param {string} s */
function niceName(s) {
  return tidyName(
    s
      .replace(/\s+/g, ' ')
      .replace(/(?<!\p{L})(\p{Lu}{3,})(?!\p{L})/gu, (w) => w.charAt(0) + w.slice(1).toLocaleLowerCase('sk'))
      .trim(),
  );
}

/**
 * Cenovky: zľava + stará + nová cena, ktoré k sebe sedia. Dve zľavy s rovnakou starou cenou (XTRA) spojí.
 * @param {PdfItem[]} items
 */
export function kauflandBadges(items) {
  const pcts = items.filter((t) => L_PCT.test(t[0].trim()));
  const prices = items.filter((t) => lp(t[0]) !== null);
  /** @type {{ old: number, price: number, pct: number, x: number, y: number, parts: PdfItem[], oldItem: PdfItem }[]} */
  const raw = [];
  for (const p of pcts) {
    const pct = Number(p[0].trim().match(L_PCT)?.[1]);
    const cx = p[1] + p[4] / 2;
    const near = prices.filter((q) => Math.abs(q[1] + q[4] / 2 - cx) < 90 && q[2] > p[2] - 60 && q[2] - p[2] < 110);
    let best = null;
    for (const o of near) {
      for (const n of near) {
        if (o === n) continue;
        const old = lp(o[0]);
        const price = lp(n[0]);
        if (!old || !price || price >= old) continue;
        if (Math.abs(Math.round((1 - price / old) * 100) - pct) > 1) continue;
        if (n[3] < o[3]) continue; // nová cena je väčšie písmo než stará
        const d = Math.hypot(o[1] - p[1], o[2] - p[2]) + Math.hypot(n[1] - p[1], n[2] - p[2]);
        if (!best || d < best.d) best = { o, n, old, price, d };
      }
    }
    if (best) raw.push({ old: best.old, price: best.price, pct, x: Math.min(p[1], best.n[1], best.o[1]), y: Math.min(p[2], best.o[2]), parts: [p, best.o, best.n], oldItem: best.o });
  }
  // rovnaká stará cena blízko seba = jedna ponuka (nižšia cena je s kartou XTRA)
  /** @type {{ old: number, price: number, withoutCard: number | null, x: number, y: number, parts: PdfItem[] }[]} */
  const out = [];
  for (const b of raw) {
    const twin = out.find((o) => o.old === b.old && Math.abs(o.x - b.x) < 120 && Math.abs(o.y - b.y) < 120);
    if (twin) {
      const lo = Math.min(twin.price, b.price);
      const hi = Math.max(twin.price, b.price);
      if (lo !== hi) Object.assign(twin, { price: lo, withoutCard: hi });
      twin.parts.push(...b.parts);
      twin.x = Math.min(twin.x, b.x);
      twin.y = Math.min(twin.y, b.y);
    } else out.push({ old: b.old, price: b.price, withoutCard: null, x: b.x, y: b.y, parts: [...b.parts] });
  }
  return out;
}

/**
 * Bloky s názvom: riadky s rovnakým ľavým okrajom. Názov = úvodné riadky rovnakej (väčšej) veľkosti písma.
 * @param {PdfItem[]} items @param {Set<PdfItem>} skip @param {number} pageH
 */
export function kauflandBlocks(items, skip, pageH) {
  const lines = mergeLine(items.filter((t) => !skip.has(t) && t[2] < pageH - 40 && t[3] <= 24 && t[3] >= 7))
    .filter((t) => {
      const s = t[0].trim();
      return s.length > 1 && !L_SKIP.test(s) && !L_PCT.test(s) && lp(s) === null && !/^[\d\s,.%/()*-]+$/.test(s) && !/^(nabídka platí|ponuka platí|platí|max\.|na osobu|od \d|samoobsluž|pultov[ýá] prode|chlazen[éá] potrav|chladen[éá] potrav|mražen[éá] potrav|mrazen[éá] potrav)/i.test(s);
    })
    .sort((a, b) => a[2] - b[2] || a[1] - b[1]);
  /** @type {{ x: number, y: number, y2: number, x2: number, lines: PdfItem[] }[]} */
  const blocks = [];
  for (const t of lines) {
    const b = blocks.find((bl) => Math.abs(bl.x - t[1]) <= 3 && t[2] - bl.y2 >= 0 && t[2] - bl.y2 <= Math.max(t[3], bl.lines[bl.lines.length - 1][3]) * 1.8);
    if (b) {
      if (!b.lines.some((l) => l[0] === t[0] && l[2] === t[2])) b.lines.push(t);
      b.y2 = t[2];
      b.x2 = Math.max(b.x2, t[1] + t[4]);
    } else blocks.push({ x: t[1], y: t[2], y2: t[2], x2: t[1] + t[4], lines: [t] });
  }
  return blocks
    .map((b) => {
      const h = b.lines[0][3];
      const isDetail = (/** @type {string} */ s) => /^\(|=|\d+\s?(g|kg|ml|l|ks|kus|kusy|kusov)\b|rôzne druhy|různé druhy|cena za|podiel|podíl|balenie|balení|% alk/i.test(s);
      let k = 0;
      for (;;) {
        const cur = b.lines[k];
        if (!cur) break;
        const s = cur[0].trim();
        if (Math.abs(cur[3] - h) <= 1 && !isDetail(s)) k++;
        // „Vodka“ / „alebo“ / „Liehovina“ – spojka menším písmom medzi dvoma názvami
        else if (/^(alebo|nebo)$/i.test(s) && b.lines[k + 1] && Math.abs(b.lines[k + 1][3] - h) <= 1) k += 2;
        else break;
      }
      const words = b.lines.slice(0, k).map((l) => l[0].trim()).join(' ').split(/\s+/).length;
      // jednoslovný názov („Cestoviny“) doplň o prvý popis menším písmom („8-vaječné“), nie však „ze zmrazeného…“
      const next = b.lines[k]?.[0].trim() ?? '';
      if (k > 0 && words === 1 && next && next.length <= 24 && !isDetail(next) && !/^(ze?|so?|bez|na|ve?|do|pre|pro|od|za|alebo|nebo|a)\s/i.test(next) && /\p{L}{3,}/u.test(next)) k++;
      const name = b.lines.slice(0, k).map((l) => l[0].trim()).join(' ');
      const details = b.lines.slice(k).map((l) => l[0].trim()).join(' ');
      return { ...b, name, details, nameH: h };
    })
    .filter((b) => b.name.length >= 3 && /\p{L}{3,}/u.test(b.name) && b.nameH >= 9);
}

/**
 * Ceny podľa jednotkovej ceny „(=1 kg 8,09)“, „(=100 g 59,95)“, „(*=1 00 g X: 13,16/ A: 15,16)“.
 * @param {string} details @returns {number[]}
 */
export function kauflandUnitPrices(details) {
  const m = details.replace(/1 00 g/g, '100 g').match(/\(\*?=\s?(\d+(?:[.,]\d+)?)\s?(g|kg|ml|l)\b([^)]*)\)/i);
  if (!m) return [];
  const size = parseSize(details.replace(m[0], ' '));
  if (!size) return [];
  const toBase = (/** @type {number} */ a, /** @type {string} */ u) => (u === 'kg' || u === 'l' ? a * 1000 : a);
  const kind = (/** @type {string} */ u) => (u === 'g' || u === 'kg' ? 'm' : u === 'ml' || u === 'l' ? 'v' : u);
  const unit = m[2].toLowerCase();
  if (kind(unit) !== kind(size.unit)) return [];
  const per = toBase(Number(m[1].replace(',', '.')), unit);
  return [...m[3].matchAll(/(\d+)[.,](\d{2})/g)].map((x) => (Number(`${x[1]}.${x[2]}`) * toBase(size.amount, size.unit)) / per);
}

/** „OD 21. 10. DO 22. 10. 2026“ blízko cenovky → platnosť položky. @param {PdfItem[]} items @param {{x:number,y:number}} b */
function itemValidity(items, b) {
  for (const t of items) {
    const m = t[0].match(/OD\s+(\d{1,2})\.\s?(\d{1,2})\.\s+DO\s+(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/i);
    if (!m || Math.abs(t[1] - b.x) > 160 || Math.abs(t[2] - b.y) > 120) continue;
    const p2 = (/** @type {string} */ v) => v.padStart(2, '0');
    return { from: `${m[5]}-${p2(m[2])}-${p2(m[1])}`, to: `${m[5]}-${p2(m[4])}-${p2(m[3])}` };
  }
  return null;
}

/**
 * Strany PDF letáku → ponuky.
 * @param {{ n: number, w: number, h: number, items: PdfItem[] }[]} pages
 * @param {{ country: 'SK'|'CZ', validFrom: string, validTo: string, flyerUrl: string }} ctx
 */
export function offersFromKauflandLeaflet(pages, ctx) {
  const out = new Map();
  for (const page of pages) {
    const seen = new Set();
    const items = page.items.filter((t) => {
      const k = `${t[0]}|${t[1]}|${t[2]}`;
      if (!t[0]?.trim() || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const merged = mergeLine(items);
    const badges = kauflandBadges(merged);
    if (!badges.length) continue;
    const skip = new Set(badges.flatMap((b) => b.parts));
    const blocks = kauflandBlocks(merged, skip, page.h);
    const taken = new Set();
    const pairs = badges.map((b) => {
      const sure = blocks.filter((bl) => kauflandUnitPrices(bl.details).some((e) => [b.price, b.withoutCard].some((p) => p && Math.abs(e - p) / p <= 0.02)));
      const dist = (/** @type {any} */ bl) => Math.hypot(bl.x - b.x, bl.y - b.y);
      return { b, bl: sure.sort((p, q) => dist(p) - dist(q))[0] ?? null };
    });
    for (const p of pairs) if (p.bl) taken.add(p.bl);
    // bez jednotkovej ceny: najbližší voľný blok (názov býva vľavo alebo nad cenovkou); opakuj, kým pribúdajú
    for (let pass = 0, changed = true; pass < 4 && changed; pass++) {
      changed = false;
      for (const p of pairs) {
        if (p.bl) continue;
        const { b } = p;
        const near = blocks
          .filter((bl) => !taken.has(bl) && !kauflandUnitPrices(bl.details).length)
          .map((bl) => ({ bl, d: Math.hypot(bl.x - b.x, bl.y - b.y) + (bl.x > b.x + 30 ? 80 : 0) }))
          .filter((c) => c.d < 170 && c.bl.y <= b.y + 60)
          .sort((a, c) => a.d - c.d);
        if (near.length === 1 || (near.length > 1 && near[1].d - near[0].d > 30)) {
          p.bl = near[0].bl;
          taken.add(near[0].bl);
          changed = true;
        }
      }
    }
    for (const { b, bl } of pairs) {
      if (!bl) continue;
      const name = niceName(bl.name.replace(/\*+/g, ' '));
      if (!name || NONFOOD.test(name) || NONFOOD.test(bl.details)) continue;
      const size = parseSize(bl.details.replace(/\([^)]*\)/g, ' ')) ?? parseSize(name);
      const byName = guessCategory(name, '');
      if ((!size || size.unit === 'ks') && !byName) continue;
      const v = itemValidity(merged, b);
      const validFrom = v && v.from >= ctx.validFrom && v.from <= ctx.validTo ? v.from : ctx.validFrom;
      const validTo = v && v.to >= validFrom && v.to <= ctx.validTo ? v.to : ctx.validTo;
      const id = `${ctx.country.toLowerCase()}-kaufland-${matchKey(name, size)}-${ctx.validFrom}`.slice(0, 150);
      if (out.has(id)) continue;
      out.set(id, {
        id,
        country: ctx.country,
        chain: 'kaufland',
        name: name.slice(0, 160),
        brand: null,
        category: byName || 'trvanlive',
        size,
        price: b.price,
        regularPrice: b.old,
        lowest30d: null,
        validFrom,
        validTo,
        requiresCard: b.withoutCard !== null,
        priceWithoutCard: b.withoutCard,
        note: v && v.to < ctx.validTo ? `len do ${Number(v.to.slice(8))}. ${Number(v.to.slice(5, 7))}.` : null,
        tryIt: null,
        image: null,
        matchKey: matchKey(name, size),
        sourceUrl: `${ctx.flyerUrl}/view/flyer/page/${page.n}`,
      });
    }
  }
  return [...out.values()];
}

/**
 * Leták tento a budúci týždeň (ak je už zverejnený) z leaflets.kaufland.com.
 * V Node.js treba na čítanie PDF knižnicu pdf.js (pdfjs-dist), rovnako ako pri Alberte.
 * @param {'SK'|'CZ'} country
 * @param {{ json: (url: string) => Promise<any>, bytes: (url: string, init?: any) => Promise<Uint8Array> }} http
 * @param {Date} [now]
 */
export async function fetchOffers(country, http, now = new Date()) {
  /** @type {any} */
  let pdfjs;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch {
    throw new Error('Kaufland: chýba pdfjs-dist (npm install --no-save pdfjs-dist@4), leták sa nedá prečítať.');
  }
  const { validFrom } = kauflandDates([], country, now.toISOString());
  const out = [];
  const errors = [];
  for (const shift of [0, 7]) {
    const week = isoWeek(shiftDate(validFrom, shift)).week;
    const id = FLYER[country](week);
    try {
      const res = await http.json(`${API}?flyer_identifier=${id}&region_id=0&region_code=0`);
      const f = res?.flyer;
      if (!res?.success || !f?.pdfUrl || !/^https:\/\/[a-z0-9.-]+\.schwarz\//.test(f.pdfUrl)) throw new Error(`leták ${id} nie je zverejnený`);
      const pages = await pdfPages(pdfjs, await http.bytes(f.pdfUrl, { timeoutMs: 180_000 }));
      const flyerUrl = `https://leaflets.kaufland.com/${country === 'SK' ? 'sk-SK' : 'cz-CZ'}/${id}`;
      out.push(...offersFromKauflandLeaflet(pages, { country, validFrom: f.offerStartDate, validTo: f.offerEndDate, flyerUrl }));
    } catch (err) {
      if (shift === 0) errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (!out.length) throw new Error(`Kaufland: ${errors.join('; ') || 'žiadne ponuky'}`);
  return out;
}
