// @ts-check
// Spoločný koniec sťahovania: overenie dát, reálna zľava z histórie, zápis app/data/offers.json.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { applyHistory, updateHistory } from './history.js';
import { invalidReason } from './validate.js';
import { guessCategory } from './normalize.js';

export const OFFERS_FILE = new URL('../../app/data/offers.json', import.meta.url);
export const HISTORY_FILE = new URL('../../data/price-history.json', import.meta.url);

/** Do apky dávame len akcie s aspoň takouto zľavou (posúvač v apke začína na 20 %). */
export const MIN_KEEP_DISCOUNT = 20;

/** @param {URL} file @param {any} fallback */
export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Úpravy podľa reťazca, ktoré sa môžu zlepšovať aj spätne (napr. pravidlá kategórií).
 * @param {any} o
 */
export function refine(o) {
  if (o.chain === 'lidl') return { ...o, category: guessCategory(o.name, o.category) };
  return o;
}

/** @param {any} o */
function discountPct(o) {
  const refs = [o.lowest30d, o.regularPrice].filter((v) => typeof v === 'number' && v > 0);
  if (!refs.length) return 0;
  const ref = Math.min(...refs);
  return Math.round(((ref - o.price) / ref) * 100);
}

/**
 * @param {{ collected: any[], sources: Record<string, any>, today: string }} input
 * @returns {Promise<{ written: number, dropped: number }>}
 */
export async function publish({ collected, sources, today }) {
  const history = await readJson(HISTORY_FILE, {});
  let dropped = 0;
  const valid = [];
  const seen = new Set();
  for (const raw of collected) {
    const o = refine(raw);
    const why = invalidReason(o);
    if (why || seen.has(o.id)) {
      dropped++;
      continue;
    }
    seen.add(o.id);
    valid.push(o);
  }
  // História sa zapisuje zo všetkých platných cien; do apky idú len zľavy, ktoré dávajú zmysel.
  const withHistory = applyHistory(valid, history).filter((o) => o.validTo >= today && discountPct(o) >= MIN_KEEP_DISCOUNT);
  withHistory.sort((a, b) => a.id.localeCompare(b.id));
  const file = { meta: { generatedAt: new Date().toISOString(), sample: false, sources }, offers: withHistory };
  await writeFile(OFFERS_FILE, JSON.stringify(file) + '\n');
  await mkdir(new URL('.', HISTORY_FILE), { recursive: true });
  await writeFile(HISTORY_FILE, JSON.stringify(updateHistory(history, valid, today)) + '\n');
  return { written: withHistory.length, dropped };
}
