// @ts-check
// Slušné sťahovanie: vlastný User-Agent, časový limit, opakovanie a pauza medzi požiadavkami na ten istý web.

const UA = 'oplati-sa/0.1 (osobny projekt na porovnanie akcii; kontakt v README)';
const lastHit = new Map();

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string} url
 * @param {RequestInit & { retries?: number, delayMs?: number, timeoutMs?: number }} [opts]
 */
export async function politeFetch(url, opts = {}) {
  const { retries = 2, delayMs = 1500, timeoutMs = 30000, ...init } = opts;
  const host = new URL(url).host;
  const wait = (lastHit.get(host) ?? 0) + delayMs - Date.now();
  if (wait > 0) await sleep(wait);
  for (let attempt = 0; ; attempt++) {
    lastHit.set(host, Date.now());
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': UA, 'Accept-Language': 'sk,cs;q=0.9', ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} pre ${url}`), { fatal: true });
      return res;
    } catch (err) {
      if (/** @type {any} */ (err).fatal || attempt >= retries) throw err;
      await sleep(2000 * (attempt + 1));
    }
  }
}

export const http = {
  /** @param {string} url @param {RequestInit} [init] */
  text: async (url, init) => (await politeFetch(url, init)).text(),
  /** @param {string} url @param {RequestInit} [init] */
  json: async (url, init) => (await politeFetch(url, init)).json(),
  /** @param {string} url @param {RequestInit} [init] */
  bytes: async (url, init) => new Uint8Array(await (await politeFetch(url, init)).arrayBuffer()),
};
