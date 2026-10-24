// @ts-check
// Kaufland – kaufland.sk (leták štvrtok–streda) a kaufland.cz (streda–utorok).
//
// Zistené 24. 10. 2026: kaufland.sk aj kaufland.cz (aj „Aktuálna ponuka“) chráni Cloudflare –
// stránka chce potvrdenie „Overte, že ste človek“ (Turnstile). Server ani automatický prehliadač
// sa k akciám nedostane a ochranu proti robotom (CAPTCHA) neobchádzame.
//
// Jediná poctivá cesta: človek otvorí kaufland.sk v bežnom prehliadači, potvrdí overenie a potom sa
// dáta stiahnu v tom istom prehliadači (rovnako ako pri iných reťazcoch cez data/raw/*.raw.json).
// Nájsť pri tom JSON, z ktorého sa vykresľujú dlaždice akcií (DevTools → Network), a doplniť prevod.
//
// Výstup: pole ponúk vo formáte Offer (pozri app/js/deals.js), napr. cez helpery
// parsePrice, parseSize, guessCategory, matchKey, offerId zo scraper/lib/normalize.js.

/** @param {'SK'|'CZ'} country @param {typeof import('../lib/http.js').http} http */
export async function fetchOffers(country, http) {
  void country;
  void http;
  throw new Error('Kaufland: web vyžaduje overenie „nie som robot“ (Cloudflare) – automaticky sa nedá, len ručne v prehliadači.');
}
