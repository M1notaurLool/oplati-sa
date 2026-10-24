// @ts-check
// Dáta z cudzích webov sú nedôveryhodné: do apky pustíme len ponuky v presnom tvare.
import { CHAINS, CATEGORIES } from '../../app/js/chains.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UNITS = new Set(['g', 'kg', 'ml', 'l', 'ks']);
const CATS = new Set(CATEGORIES.map((c) => c.id));

/** @param {unknown} v @param {number} max */
const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
/** @param {unknown} v */
const money = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 100000;

/**
 * Vráti chybu (text) alebo null, keď je ponuka v poriadku.
 * @param {any} o
 */
export function invalidReason(o) {
  if (!o || typeof o !== 'object') return 'nie je objekt';
  if (!str(o.id, 160)) return 'id';
  if (o.country !== 'SK' && o.country !== 'CZ') return 'country';
  if (!(o.chain in CHAINS)) return 'chain';
  if (!str(o.name, 160)) return 'name';
  if (o.brand != null && !str(o.brand, 80)) return 'brand';
  if (!CATS.has(o.category)) return 'category';
  if (!money(o.price)) return 'price';
  if (o.regularPrice != null && !money(o.regularPrice)) return 'regularPrice';
  if (o.lowest30d != null && !money(o.lowest30d)) return 'lowest30d';
  if (!DATE.test(o.validFrom) || !DATE.test(o.validTo) || o.validFrom > o.validTo) return 'dates';
  if (o.size != null && !(UNITS.has(o.size.unit) && typeof o.size.amount === 'number' && o.size.amount > 0)) return 'size';
  if (o.sourceUrl != null && !/^https:\/\//.test(o.sourceUrl)) return 'sourceUrl';
  if (o.tryIt != null && !str(o.tryIt, 80)) return 'tryIt';
  if (o.note != null && !str(o.note, 80)) return 'note';
  if (o.priceWithoutCard != null && !money(o.priceWithoutCard)) return 'priceWithoutCard';
  if (o.requiresCard != null && typeof o.requiresCard !== 'boolean') return 'requiresCard';
  return null;
}
