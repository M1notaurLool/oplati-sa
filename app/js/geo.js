// @ts-check
// Vzdialenosti a najbližšie predajne. Poloha zostáva v zariadení, nikam sa neposiela.

/** @typedef {{ chain: string, country: string, lat: number, lon: number, name?: string, address?: string, city?: string }} Store */
/** @typedef {{ lat: number, lon: number, label?: string }} Position */

/** Vzdialenosť po zemskom povrchu v km (haversine). @param {Position} a @param {Position} b */
export function distanceKm(a, b) {
  const R = 6371;
  const rad = (/** @type {number} */ x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Najbližšia predajňa každého reťazca.
 * @param {Store[]} stores @param {Position} pos @param {string} country
 * @returns {Map<string, { store: Store, km: number }>}
 */
export function nearestByChain(stores, pos, country) {
  const best = new Map();
  for (const s of stores) {
    if (s.country !== country) continue;
    const km = distanceKm(pos, s);
    const cur = best.get(s.chain);
    if (!cur || km < cur.km) best.set(s.chain, { store: s, km });
  }
  return best;
}

/** Navigácia k predajni v Mapách Google (na mobile otvorí appku). @param {Store} s */
export function directionsLink(s) {
  return `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`;
}

/**
 * Hľadanie reťazca v Mapách – záloha, keď nemáme zoznam predajní.
 * @param {string} chainName @param {Position | null} pos
 */
export function searchLink(chainName, pos) {
  const q = encodeURIComponent(pos?.label ? `${chainName} ${pos.label}` : chainName);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

// ---------- Predajne z OpenStreetMap (Overpass API) ----------

const BRANDS = /** @type {const} */ ([
  [/^lidl/i, 'lidl'],
  [/^kaufland/i, 'kaufland'],
  [/^billa/i, 'billa'],
  [/^tesco/i, 'tesco'],
  [/^albert/i, 'albert'],
]);

/** @param {string | undefined} brand */
export function chainFromBrand(brand) {
  if (!brand) return null;
  for (const [re, id] of BRANDS) if (re.test(brand.trim())) return id;
  return null;
}

/**
 * Prevedie odpoveď Overpass API na zoznam predajní.
 * @param {{ elements?: Array<{ lat?: number, lon?: number, center?: { lat: number, lon: number }, tags?: Record<string, string> }> }} json
 * @param {(lat: number, lon: number, tags: Record<string, string>) => string | null} countryOf
 * @returns {Store[]}
 */
export function parseOverpass(json, countryOf) {
  /** @type {Store[]} */
  const out = [];
  for (const el of json.elements ?? []) {
    const tags = el.tags ?? {};
    const chain = chainFromBrand(tags.brand);
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!chain || typeof lat !== 'number' || typeof lon !== 'number') continue;
    const country = countryOf(lat, lon, tags);
    if (!country) continue;
    const street = [tags['addr:street'] ?? tags['addr:place'], tags['addr:housenumber'] ?? tags['addr:conscriptionnumber']]
      .filter(Boolean)
      .join(' ');
    out.push({
      chain,
      country,
      lat: Math.round(lat * 1e5) / 1e5,
      lon: Math.round(lon * 1e5) / 1e5,
      name: tags.name ?? tags.brand,
      address: street || undefined,
      city: tags['addr:city'] || undefined,
    });
  }
  return out;
}

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
/** Verejné servery OpenStreetMap; keď je prvý preťažený, skúsime druhý. */
export const OVERPASS_MIRRORS = [OVERPASS_URL, 'https://overpass.private.coffee/api/interpreter'];
const BRAND_RE = '^(Lidl|Kaufland|Billa|BILLA|Albert|Tesco)';

/** Dotaz na predajne v okruhu okolo polohy. @param {Position} pos @param {number} radiusM */
export function nearbyQuery(pos, radiusM = 15000) {
  return `[out:json][timeout:25];nwr[shop=supermarket][brand~"${BRAND_RE}"](around:${radiusM},${pos.lat},${pos.lon});out center tags;`;
}

/**
 * Najbližšie predajne priamo z OpenStreetMap (záloha, keď zoznam predajní ešte nie je v dátach).
 * @param {Position} pos @param {string} country
 */
export async function fetchNearbyStores(pos, country) {
  let lastError = new Error('Overpass nedostupný');
  for (const url of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(nearbyQuery(pos)),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      return parseOverpass(await res.json(), () => country);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError;
}

/** Mestá na ručný výber, keď prehliadač polohu nepovolí. */
export const CITIES = /** @type {const} */ ([
  { label: 'Bratislava', country: 'SK', lat: 48.1486, lon: 17.1077 },
  { label: 'Košice', country: 'SK', lat: 48.7164, lon: 21.2611 },
  { label: 'Žilina', country: 'SK', lat: 49.2231, lon: 18.7394 },
  { label: 'Banská Bystrica', country: 'SK', lat: 48.7363, lon: 19.1462 },
  { label: 'Nitra', country: 'SK', lat: 48.3069, lon: 18.0864 },
  { label: 'Prešov', country: 'SK', lat: 48.9985, lon: 21.2339 },
  { label: 'Trnava', country: 'SK', lat: 48.3774, lon: 17.5872 },
  { label: 'Trenčín', country: 'SK', lat: 48.8945, lon: 18.0444 },
  { label: 'Brno', country: 'CZ', lat: 49.1951, lon: 16.6068 },
  { label: 'Praha', country: 'CZ', lat: 50.0755, lon: 14.4378 },
  { label: 'Ostrava', country: 'CZ', lat: 49.8209, lon: 18.2625 },
  { label: 'Olomouc', country: 'CZ', lat: 49.5938, lon: 17.2509 },
  { label: 'Plzeň', country: 'CZ', lat: 49.7384, lon: 13.3736 },
  { label: 'Zlín', country: 'CZ', lat: 49.2265, lon: 17.6707 },
]);
