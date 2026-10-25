// @ts-check
// Albert – len Česko, leták streda–utorok (hypermarket „<týždeň>hm_akcni_letak“, supermarket „<týždeň>sm_…“).
//
// Zdroj (overené 24. 10. 2026): Albert nemá e-shop ani API s akciami, len leták na letaky.albert.cz (Publitas):
//   https://letaky.albert.cz/<týždeň>hm_akcni_letak/  → odkaz na PDF (≈ 20 MB, s textovou vrstvou)
// Z PDF sa vytiahnu texty s polohou (pdf.js getTextContent) a tu sa poskladajú do ponúk:
//   cenovka = stará cena „27,90/“ + zľava „-46“ „%“ + veľké celé číslo „14“ + malé desatinné „90“
//   blok s názvom = riadky s rovnakým ľavým okrajom; odrážky „• 200 g • 100 g = 7,45 Kč“
// Cenovka sa k bloku priradí cez jednotkovú cenu (14,90 Kč / 200 g = 7,45 Kč za 100 g), inak k najbližšiemu
// bloku nad ňou alebo vľavo. Ponuka sa vezme len vtedy, keď sedí aj vytlačená zľava (−46 % = 27,90 → 14,90),
// takže zle poskladané cenovky sa zahodia. Čo sa nedá overiť, radšej vynecháme.
import { guessCategory, localDate, matchKey, parseSize, tidyName, wednesdayWeek } from '../lib/normalize.js';

const HOST = 'https://letaky.albert.cz';

/** @typedef {[string, number, number, number, number]} PdfItem  [text, x, y (zhora), výška písma, šírka] */
/** @typedef {{ n: number, w: number, h: number, items: PdfItem[] }} PdfPage */

const OLD = /^(\d{1,4})(?:,(\d{2}|-))\/$/;
const PCT = /^-(\d{1,2})$/;
const INT = /^\d{1,4}(,-)?$/;
const DEC = /^(\d{2}|-)$/;
export const NONFOOD = /lampion|kost[yý]m|kniha|knížk|knizk|samolep|svíčk|svick|dekor|hrač|hrac|tričk|trick|ponožk|ponozk|polštář|polstar|ručník|rucnik|hrnek|talíř|talir|pánev|panev|baterie|žárovk|zarovk|led\b|náramk|naramk|čelenk|celenk|tetování|tetovani|kanvic|konvic|rychlovarn|hrnc|hrnč|panvic|stolič|stolic|lampa|vankúš|vankus|uterák|uterak|obliečk|obliecka|deka\b|fritéz|fritez|krájač|krajac|držiak|drziak|taburet|lavic|rolák|rolak|esmara|livarno|parkside|silvercrest|crivit|lupilu|sensiplast|podložk|podlozk|okrasn|výhrevn|vyhrevn|\b[A-Z]{2,3}-\d{3,}/i;

/** @param {string} s */
const num = (s) => Number(String(s).replace(/\s/g, '').replace(',', '.'));

/**
 * Cenovky na strane: stará cena, zľava v %, nová cena. Overí, že vytlačená zľava sedí s cenami.
 * @param {PdfItem[]} items
 */
export function findBadges(items) {
  const badges = [];
  const used = new Set();
  for (const o of items) {
    const om = o[0].trim().match(OLD);
    if (!om) continue;
    const old = om[2] && om[2] !== '-' ? num(`${om[1]},${om[2]}`) : num(om[1]);
    // „-46“ vpravo na tom istom riadku
    const pct = items.find((p) => PCT.test(p[0].trim()) && Math.abs(p[2] - o[2]) <= 6 && p[1] > o[1] && p[1] - (o[1] + o[4]) < 30);
    if (!pct) continue;
    const claimed = Number(pct[0].trim().slice(1));
    // veľké celé číslo pod starou cenou
    const ints = items.filter((i) => INT.test(i[0].trim()) && !used.has(i) && i[3] >= o[3] * 2.5 && i[2] > o[2] + 5 && i[2] - o[2] < o[3] * 9 && i[1] > o[1] - o[3] * 4 && i[1] < pct[1] + pct[4] + o[3] * 2);
    let best = null;
    for (const i of ints) {
      const dec = items.find((d) => d !== i && DEC.test(d[0].trim()) && d[3] < i[3] * 0.85 && d[3] > i[3] * 0.3 && d[1] >= i[1] + i[4] - 6 && d[1] <= i[1] + i[4] + i[3] * 0.6 && d[2] <= i[2] + 3 && d[2] >= i[2] - i[3] * 0.9);
      // celé koruny len pri „149,-“ alebo malej pomlčke; inak musí byť nájdené desatinné číslo (89,90 vs 90 by sa pomýlilo)
      const whole = i[0].trim().endsWith(',-') || dec?.[0].trim() === '-';
      if (!dec && !whole) continue;
      const decimals = dec && !whole ? Number(dec[0].trim()) / 100 : 0;
      const price = Math.round((parseInt(i[0].trim(), 10) + decimals) * 100) / 100;
      if (!(price > 0 && price < old)) continue;
      const real = Math.round((1 - price / old) * 100);
      if (Math.abs(real - claimed) > 1) continue;
      const dist = Math.hypot(i[1] - o[1], i[2] - o[2]);
      if (!best || dist < best.dist) best = { i, dec, price, dist };
    }
    if (!best) continue;
    used.add(best.i);
    badges.push({ old, price: best.price, pct: claimed, x: Math.min(o[1], best.i[1]), y: o[2], x2: Math.max(pct[1] + pct[4], best.i[1] + best.i[4]), y2: best.i[2], parts: [o, pct, best.i, best.dec].filter(Boolean) });
  }
  return badges;
}

/**
 * Spojí kúsky textu na tom istom riadku tesne vedľa seba („•“ + „27,90 Kč“ → „• 27,90 Kč“).
 * @param {PdfItem[]} items @returns {PdfItem[]}
 */
export function mergeLine(items) {
  const sorted = [...items].sort((a, b) => a[2] - b[2] || a[1] - b[1]);
  /** @type {PdfItem[]} */
  const out = [];
  for (const t of sorted) {
    const prev = out[out.length - 1];
    const gap = prev ? t[1] - (prev[1] + prev[4]) : Infinity;
    if (prev && Math.abs(prev[2] - t[2]) <= 2 && Math.abs(prev[3] - t[3]) <= 2 && gap >= -2 && gap <= 9) {
      out[out.length - 1] = [`${prev[0].trimEnd()} ${t[0].trimStart()}`, prev[1], prev[2], prev[3], t[1] + t[4] - prev[1]];
    } else out.push(t);
  }
  return out;
}

/**
 * Bloky textu (názov + odrážky): riadky s rovnakým ľavým okrajom tesne pod sebou.
 * @param {PdfItem[]} items @param {Set<PdfItem>} skip @param {number} pageH
 */
export function findBlocks(items, skip, pageH) {
  const lines = mergeLine(items.filter((t) => !skip.has(t) && t[2] < pageH - 55 && t[3] <= 26))
    .filter((t) => t[0].trim().length > 1 && !/^[\d\s,.%/-]+$/.test(t[0].trim()))
    .sort((a, b) => a[2] - b[2] || a[1] - b[1]);
  /** @type {{ x: number, y: number, y2: number, x2: number, lines: PdfItem[] }[]} */
  const blocks = [];
  for (const t of lines) {
    const b = blocks.find((bl) => Math.abs(bl.x - t[1]) <= 3 && t[2] - bl.y2 >= 0 && t[2] - bl.y2 <= Math.max(t[3], bl.lines[bl.lines.length - 1][3]) * 1.7);
    if (b) {
      b.lines.push(t);
      b.y2 = t[2];
      b.x2 = Math.max(b.x2, t[1] + t[4]);
    } else blocks.push({ x: t[1], y: t[2], y2: t[2], x2: t[1] + t[4], lines: [t] });
  }
  return blocks
    .map((b) => {
      const name = b.lines.filter((l) => !l[0].trim().startsWith('•')).map((l) => l[0].trim());
      const bullets = b.lines.filter((l) => l[0].trim().startsWith('•')).map((l) => l[0].trim()).join(' ');
      return { ...b, name: name.join(' ').replace(/\s+/g, ' ').trim(), bullets };
    })
    .filter((b) => b.name.length >= 3 && b.bullets);
}

/**
 * Cena podľa jednotkovej ceny v odrážkach („• 200 g • 100 g = 7,45 Kč“) → 14,90. null, keď sa nedá.
 * @param {string} bullets
 */
export function expectedPrice(bullets) {
  const unit = bullets.match(/(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l|ks|role|rolí|pr\.?|praní)\s*=\s*(\d+(?:[.,]\d+)?)\s*Kč/i);
  if (!unit) return null;
  const rest = bullets.replace(unit[0], ' ');
  const size = parseSize(rest);
  if (!size) return null;
  const base = { amount: num(unit[1]), unit: unit[2].toLowerCase() };
  const toBase = (/** @type {{amount:number,unit:string}} */ s) => (s.unit === 'kg' || s.unit === 'l' ? s.amount * 1000 : s.amount);
  const sameKind = (a, b) => (['g', 'kg'].includes(a) && ['g', 'kg'].includes(b)) || (['ml', 'l'].includes(a) && ['ml', 'l'].includes(b)) || a === b;
  if (!sameKind(size.unit, base.unit)) return null;
  return (num(unit[3]) * toBase(size)) / toBase(base);
}

/** Názov z letáku bez jednotkových cien, poznámok a „vybrané druhy“. @param {string} raw */
export function cleanName(raw) {
  return tidyName(
    raw
      .replace(/=\s*[\d.,]+\s*Kč/gi, ' ')
      .replace(/\d+(?:,\d+)?\s*g na 100 g výrobku/gi, ' ')
      .replace(/\b(?:vybrané\s+)?druhy\b/gi, ' ')
      .replace(/\*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

/**
 * Najnižšia cena za 30 dní (▼ v letáku) – samostatná odrážka „• 9,90 Kč“ (nie „= … Kč“, nie záloha).
 * @param {string} bullets
 */
export function lowestFromBullets(bullets) {
  for (const seg of bullets.split('•')) {
    const m = seg.trim().match(/^(\d{1,4}(?:,\d{2})?)\s*Kč$/);
    if (m) return num(m[1]);
  }
  return null;
}

/**
 * Platnosť z titulnej strany: „Od čtvrtka 29. 10. do 3. 11. 2026“ (keď je sviatok, leták začína neskôr).
 * @param {PdfPage[]} pages
 */
export function leafletDates(pages) {
  const text = (pages[0]?.items ?? []).map((t) => t[0]).join(' ');
  const m = text.match(/Od\s+\S+\s+(\d{1,2})\.\s*(\d{1,2})\.\s*(?:(\d{4})\s*)?do\s+\S*?\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/i);
  if (!m) return null;
  const p2 = (/** @type {string} */ v) => v.padStart(2, '0');
  const y2 = Number(m[6]);
  const y1 = m[3] ? Number(m[3]) : Number(m[2]) > Number(m[5]) ? y2 - 1 : y2;
  return { validFrom: `${y1}-${p2(m[2])}-${p2(m[1])}`, validTo: `${y2}-${p2(m[5])}-${p2(m[4])}` };
}

/** „platí do 3. 11. 2026“ → 2026-11-03 @param {string} s */
function untilDate(s) {
  const m = s.match(/platí do (\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

/**
 * Strany letáku (texty s polohou) → ponuky.
 * @param {PdfPage[]} pages
 * @param {{ validFrom: string, validTo: string, slug: string }} ctx
 */
export function offersFromLeaflet(pages, ctx) {
  ctx = { ...ctx, ...(leafletDates(pages) ?? {}) };
  const out = new Map();
  for (const page of pages) {
    const items = page.items.filter((t) => typeof t[0] === 'string' && t[0].trim());
    const badges = findBadges(items);
    if (!badges.length) continue;
    const skip = new Set(badges.flatMap((b) => b.parts));
    const blocks = findBlocks(items, skip, page.h);
    const footer = items.filter((t) => t[2] >= page.h - 55).map((t) => t[0]).join(' ');
    const pageTo = untilDate(footer.replace(/Více informací.*?\./, ''));
    const taken = new Set();

    // 1) jednotková cena sedí → isté priradenie; 2) zvyšok k najbližšiemu bloku nad/vľavo
    const pairs = [];
    for (const b of badges) {
      const cands = blocks.filter((bl) => {
        const e = expectedPrice(bl.bullets);
        return e && Math.abs(e - b.price) / b.price <= 0.02;
      });
      if (cands.length) {
        const dist = (/** @type {any} */ bl) => Math.hypot(bl.x - b.x, bl.y - b.y);
        pairs.push({ b, bl: cands.sort((p, q) => dist(p) - dist(q))[0], sure: true });
      } else pairs.push({ b, bl: null, sure: false });
    }
    for (const p of pairs) if (p.bl) taken.add(p.bl);
    for (const p of pairs) {
      if (p.bl) continue;
      const { b } = p;
      const near = blocks
        .filter((bl) => !taken.has(bl) && !expectedPrice(bl.bullets))
        .map((bl) => {
          const above = bl.y2 <= b.y + 6 && b.y - bl.y2 < 70 && bl.x < b.x2 && bl.x2 > b.x - 40;
          const left = bl.x2 <= b.x + 10 && b.x - bl.x2 < 60 && bl.y < b.y2 && bl.y2 > b.y - 40;
          return { bl, ok: above || left, d: Math.hypot(bl.x - b.x, bl.y - b.y) };
        })
        .filter((c) => c.ok)
        .sort((a, c) => a.d - c.d);
      if (near.length === 1 || (near.length > 1 && near[1].d - near[0].d > 25)) {
        p.bl = near[0].bl;
        taken.add(near[0].bl);
      }
    }

    for (const { b, bl } of pairs) {
      if (!bl) continue;
      const name = cleanName(bl.name);
      if (!name || NONFOOD.test(name) || NONFOOD.test(bl.bullets)) continue;
      const size = parseSize(bl.bullets.replace(/•\s*\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l)\s*=\s*[\d.,]+\s*Kč/gi, ' '));
      const byName = guessCategory(name, '');
      // bez hmotnosti/objemu len vtedy, keď názov jasne hovorí o jedle (ovocie „• 1 ks“)
      if ((!size || size.unit === 'ks') && !byName) continue;
      const validTo = untilDate(bl.bullets) ?? pageTo ?? ctx.validTo;
      const id = `cz-albert-${matchKey(name, size)}-${ctx.validFrom}`.slice(0, 120);
      if (out.has(id)) continue;
      out.set(id, {
        id,
        country: 'CZ',
        chain: 'albert',
        name,
        brand: null,
        category: byName || 'trvanlive',
        size,
        price: b.price,
        regularPrice: b.old,
        lowest30d: (() => {
          const low = lowestFromBullets(bl.bullets);
          return low && low < b.old && low > b.price * 0.4 ? low : null;
        })(),
        validFrom: ctx.validFrom,
        validTo: validTo < ctx.validFrom ? ctx.validTo : validTo,
        requiresCard: false,
        priceWithoutCard: null,
        note: null,
        tryIt: null,
        matchKey: matchKey(name, size),
        sourceUrl: `${HOST}/${ctx.slug}/page/${page.n}`,
        image: null,
      });
    }
  }
  return [...out.values()];
}

/** Platnosť letáku týždňa: streda–utorok. @param {Date} now */
export function leafletWeek(now) {
  const w = wednesdayWeek(localDate(now));
  return { week: w.week, validFrom: w.from, validTo: w.to };
}

/**
 * Odkaz na PDF zo stránky letáku: v HTML je JSON s „downloadPdfUrl“ (view.publitas.com/…/pdfs/….pdf).
 * @param {string} html
 */
export function pdfUrlFromHtml(html) {
  const m = html.match(/"downloadPdfUrl":"((?:[^"\\]|\\.)+)"/);
  if (!m) return null;
  try {
    const url = JSON.parse(`"${m[1]}"`);
    return /^https:\/\/[^/]+\/.+\.pdf/.test(url) ? url : null;
  } catch {
    return null;
  }
}

/**
 * Texty s polohou zo všetkých strán PDF (pdf.js).
 * @param {any} pdfjs @param {Uint8Array} data @returns {Promise<PdfPage[]>}
 */
export async function pdfPages(pdfjs, data) {
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false }).promise;
  /** @type {PdfPage[]} */
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items
      .filter((/** @type {any} */ it) => it.str && it.str.trim())
      .map((/** @type {any} */ it) => /** @type {PdfItem} */ ([it.str, Math.round(it.transform[4]), Math.round(vp.height - it.transform[5]), Math.round(Math.hypot(it.transform[2], it.transform[3])), Math.round(it.width)]));
    pages.push({ n, w: Math.round(vp.width), h: Math.round(vp.height), items });
  }
  return pages;
}

/**
 * Leták hypermarketu tento a budúci týždeň (budúci býva online už od štvrtka).
 * V Node.js treba na čítanie PDF knižnicu pdf.js (pdfjs-dist) – načíta sa len tu, apka ju nepotrebuje.
 * @param {'SK'|'CZ'} country
 * @param {{ text: (url: string) => Promise<string>, bytes: (url: string, init?: any) => Promise<Uint8Array> }} http
 * @param {Date} [now]
 */
export async function fetchOffers(country, http, now = new Date()) {
  if (country !== 'CZ') return [];
  /** @type {any} */
  let pdfjs;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch {
    throw new Error('Albert: chýba pdfjs-dist (npm install --no-save pdfjs-dist@4), leták sa nedá prečítať.');
  }
  const out = [];
  const errors = [];
  for (const shift of [0, 7]) {
    const { week, validFrom, validTo } = leafletWeek(new Date(now.getTime() + shift * 86_400_000));
    const slug = `${week}hm_akcni_letak`;
    try {
      const pdf = pdfUrlFromHtml(await http.text(`${HOST}/${slug}/page/1`));
      if (!pdf) throw new Error(`v letáku ${slug} sa nenašlo PDF`);
      const pages = await pdfPages(pdfjs, await http.bytes(pdf, { timeoutMs: 120_000 }));
      out.push(...offersFromLeaflet(pages, { validFrom, validTo, slug }));
    } catch (err) {
      // budúci týždeň ešte nemusí byť zverejnený
      if (shift === 0) errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (!out.length) throw new Error(`Albert: ${errors.join('; ') || 'žiadne ponuky'}`);
  return out;
}
