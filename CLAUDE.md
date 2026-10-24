# Oplatí sa – pokyny pre Claude Code

Web apka (PWA) so skutočnými zľavami na potraviny od 25 % v SK a CZ. Komunikuj po slovensky.

## Pravidlá projektu
- Bez závislostí a bez build kroku: čisté ES moduly v `app/js/`, JSDoc typy s `// @ts-check`. Novú knižnicu pridaj len so silným dôvodom.
- Logika patrí do `app/js/deals.js` (čisté funkcie, bez DOM) a má test v `tests/`. UI je v `app/js/app.js`.
- Každý text z dát vkladaj do HTML cez `esc()`, odkazy cez `safeUrl()`. Žiadne inline skripty ani štýly (CSP v `index.html`).
- Nové reťazce: riadok v `app/js/chains.js` + adaptér v `scraper/chains/<id>.js`, ktorý vracia pole `Offer`. Výstup vždy prejde `scraper/lib/validate.js`.
- Scraper: len verejné stránky, `scraper/lib/http.js` (User-Agent, pauzy). CAPTCHA ani ochranu proti robotom neobchádzaj – zdroj radšej vynechaj.
- UI texty po slovensky, krátko a konkrétne. Mobil je prvý: dotykové ciele aspoň 44 px, žiadne vodorovné posúvanie stránky.

## Príkazy
- `npm test` – všetky testy (musia prejsť pred commitom)
- `npm start` – apka na http://localhost:5173
- `npm run update` – stiahne akcie do `app/data/offers.json`
- `node scraper/from-raw.js data/raw/*.raw.json` + `node scraper/import.js data/raw/*.json` – import akcií stiahnutých v prehliadači
- `npm run stores` – predajne z OpenStreetMap (raz za týždeň, `--force` na vynútenie)
- `npm run build:preview` – jeden HTML súbor na ukážku v `dist/`
- `tools/aktualizuj.ps1` / `tools/naplanuj.ps1` – aktualizácia z Windows PC a jej naplánovanie (Plánovač úloh)
- Albert potrebuje na čítanie PDF `npm install --no-save --no-package-lock pdfjs-dist@4.10.38` (len scraper)
