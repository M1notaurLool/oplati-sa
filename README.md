# Oplatí sa

Web apka (PWA), ktorá ukáže **len skutočné zľavy na potraviny od 25 %** v Kauflande, Lidli, Bille, Tescu (SK) a Alberte (CZ), povie, **kde sa dnes alebo tento týždeň oplatí nakúpiť**, ukáže **najbližšiu predajňu** a čo sa oplatí **vyskúšať**. Funguje na mobile aj počítači, dá sa pridať na plochu ako appka.

> Stav (24. 10. 2026): **skutočné ceny** z Lidla (SK, CZ), Billy (SK, CZ), Tesca (SK) a Albertu (CZ, tento aj budúci týždeň) – spolu ~3 700 akcií.
> Kaufland zatiaľ nie: jeho web vyžaduje overenie „nie som robot“ a to apka neobchádza.

## Čo apka vie

- **Skutočná zľava, nie letáková.** Zľava sa počíta od najnižšej ceny za posledných 30 dní (pravidlo EÚ Omnibus). Keď leták hlási −36 %, ale minulý týždeň bol produkt lacnejší, apka to označí ako *nafúknutú zľavu* a predvolene ju skryje.
- **Dnes / najbližších 7 dní**, filtre podľa reťazca, kategórie, hľadanie bez diakritiky, „len bez vernostnej karty“.
- **Porovnanie naprieč reťazcami** podľa ceny za kg / l / kus („najlacnejšie z 3 reťazcov“ alebo „lacnejšie v Lidli“).
- **Kde nakúpiť:** poradie reťazcov podľa počtu a veľkosti zliav + najbližšia predajňa a navigácia.
- **Vyskúšať:** novinky a tematické týždne za dobrú cenu.
- **Nákupný zoznam** rozdelený podľa obchodu s tým, koľko ušetríš. Ostáva len v zariadení.
- **SK / CZ** prepínač, € aj Kč. Tmavý režim podľa systému. Offline režim.

## Spustenie vo VS Code

1. Nainštaluj [Node.js 22+](https://nodejs.org) a [Git](https://git-scm.com).
2. Otvor priečinok `oplati-sa` vo VS Code (File → Open Folder). VS Code ponúkne odporúčané rozšírenia (Claude Code, Live Server).
3. Terminál (Ctrl+`):
   ```bash
   npm test          # 46 testov logiky, cien, adaptérov reťazcov a bezpečnosti
   npm start         # apka na http://localhost:5173
   ```
   Alternatíva bez internetu: pravý klik na `app/index.html` → *Open with Live Server*.

Nič sa neinštaluje – projekt nemá žiadne závislosti (čistý HTML/CSS/JS), takže je rýchly a bezpečný.

## Ako to funguje

```
GitHub Actions (každé ráno)
  └─ scraper/run.js ── chains/kaufland.js, lidl.js, billa.js, tesco.js, albert.js
        │  overenie dát (lib/validate.js), história cien (lib/history.js)
        ▼
  app/data/offers.json  +  app/data/stores.json (OpenStreetMap, raz týždenne)
        ▼
  GitHub Pages ── app/ (PWA) ── mobil / počítač
```

| Priečinok | Čo tam je |
|---|---|
| `app/` | Celá apka. `js/deals.js` = logika zliav (bez DOM, testovaná), `js/app.js` = UI |
| `app/data/` | Dáta, ktoré apka číta (`offers.json` = akcie, `stores.json` = predajne) |
| `scraper/` | Sťahovanie akcií a predajní. `chains/` = jeden súbor na reťazec |
| `data/price-history.json` | História cien na výpočet reálnej zľavy |
| `tests/` | Testy (`node --test`) |
| `tools/build-preview.js` | Zloží apku do jedného HTML súboru na rýchlu ukážku |

### Formát ponuky
Každý reťazec vracia pole objektov v rovnakom tvare (`Offer` v `app/js/deals.js`):

```json
{ "id": "sk-lidl-maslo-82-250g-2026-10-22", "country": "SK", "chain": "lidl",
  "name": "Maslo 82 %", "brand": "Pilos", "category": "mliecne",
  "size": { "amount": 250, "unit": "g" }, "price": 1.29, "regularPrice": 2.19,
  "lowest30d": null, "validFrom": "2026-10-22", "validTo": "2026-10-25",
  "requiresCard": false, "tryIt": null, "matchKey": "82-maslo-250g", "sourceUrl": "https://…" }
```

## Aktualizácia cien

| Reťazec | Zdroj | Automaticky |
|---|---|---|
| Lidl SK/CZ | vyhľadávacie API webu `/q/api/search?category.id=10068374` (potraviny v akcii, aj budúce) | ✅ |
| Billa SK | API webu `/api/product-discovery/categories/kw-<týždeň><rok>/products` (celý leták, 2 týždne) | ✅ |
| Billa CZ | API webu `/api/product-discovery/products?inPromotion=true` + najnižšia cena za 30 dní | ✅ |
| Tesco SK | akcie online obchodu potravinydomov.itesco.sk (Clubcard ceny označené) | ✅ pomaly (web pri rýchlom sťahovaní vráti 403) |
| Albert CZ | PDF letáku z letaky.albert.cz → texty s polohou → cenovky (overené vytlačenou zľavou a cenou za 100 g) | ✅ (treba `pdfjs-dist`) |
| Kaufland SK/CZ | web chráni Cloudflare „Overte, že ste človek“ | ❌ len ručne v prehliadači |

**Billa CZ ukazuje, prečo apka počíta „skutočnú“ zľavu:** z ~3 400 akcií hlási −25 % a viac 1 800, ale voči najnižšej cene za 30 dní
ich je len ~220. Napr. Haribo „16,90 Kč z 24,90“ – pred dvoma týždňami stálo 17,90.

### Ako sa to deje samo

1. **GitHub Actions** (`.github/workflows/update.yml`) – každé ráno, v utorok a stredu aj poobede. Beží na serveroch GitHubu,
   aj keď je tvoj počítač vypnutý. Čo sa nepodarí stiahnuť (niektoré reťazce blokujú dátové centrá), ostane z posledného behu,
   kým akcia platí.
2. **Tvoj počítač** (záloha pre reťazce, ktoré GitHub blokujú) – Plánovač úloh vo Windows spustí `tools/aktualizuj.ps1`
   o 7:10 a 15:10 (alebo hneď po zapnutí PC) a výsledok pošle na GitHub. Nastavenie raz: **dvojklik na
   `nastav-automaticku-aktualizaciu.cmd`** – doinštaluje Node.js a Git (Windows sa opýta na povolenie), prepojí priečinok
   s GitHubom (raz sa prihlásiš), naplánuje úlohu a hneď spraví prvú aktualizáciu. Záznam behu: `data\raw\aktualizacia.log`.
3. **Ručne cez prehliadač** – keď web chce overenie človekom: stiahnuť surové dáta do `data/raw/<zdroj>.raw.json`, potom
   `node scraper/from-raw.js data/raw/*.raw.json` a `node scraper/import.js data/raw/*.json`.

Reálna zľava sa počíta od najnižšej ceny za 30 dní – od reťazca (Billa CZ, Albert ▼) alebo z vlastnej histórie
(`data/price-history.json`), ktorá sa plní pri každej aktualizácii.

### Potrebujem „tunel“?

Nie. Tunel (Cloudflare Tunnel, ngrok) sprístupní stránku bežiacu na tvojom počítači cez verejnú adresu – počítač by musel
stále bežať. Apka je statická stránka, takže ju zadarmo a nonstop hostí **GitHub Pages**, a dáta jej dopĺňa GitHub Actions
alebo Plánovač úloh. Tunel sa hodí len na rýchle vyskúšanie rozpracovanej verzie na mobile mimo domácej Wi-Fi
(`cloudflared tunnel --url http://localhost:5173`).

## Zverejnenie (zadarmo)

1. Vytvor na GitHube **verejný** repozitár `oplati-sa` (GitHub Pages je zadarmo len pre verejné repozitáre) a nahraj projekt.
2. Settings → Pages → Source: **GitHub Actions**.
3. Actions → *Aktualizácia akcií* → **Run workflow** (prvé spustenie; ďalej beží samo).
4. Apka bude na `https://<tvoje-meno>.github.io/oplati-sa/`. Na iPhone: Safari → Zdieľať → Pridať na plochu. Na Androide: Chrome → Inštalovať aplikáciu.

## Bezpečnosť

- Dáta z cudzích webov sú nedôveryhodné: každá ponuka prejde kontrolou tvaru (`lib/validate.js`) a v UI sa všetok text escapuje (`esc()`), odkazy len `https://`.
- Prísna Content-Security-Policy v `index.html` (žiadne cudzie skripty, žiadny inline JS).
- Žiadne účty, heslá ani API kľúče. Poloha sa spracúva len v zariadení, na server ide maximálne dotaz na predajne v okolí (OpenStreetMap).
- Scraper sa správa slušne: vlastný User-Agent, pauzy medzi požiadavkami, žiadne obchádzanie ochrany proti robotom.

## Právna poznámka

Ceny sú fakty, na osobné použitie s kamarátmi je to v poriadku. Ak by apka išla verejne: čerpať len z verejných stránok reťazcov, nekopírovať celé letáky ani obrázky, nepreberať databázy iných porovnávačov, uvádzať zdroj a dátum a pred spustením si to dať preveriť právnikom. Toto nie je právna rada.
