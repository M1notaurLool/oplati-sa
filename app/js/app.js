// @ts-check
// UI apky „Oplatí sa“. Logika je v deals.js, tu sa len vykresľuje a reaguje na používateľa.
import {
  isoDate, rebaseByWeeks, discountInfo, unitPrice, filterOffers, sortOffers,
  compareAcrossChains, chainSummary, groupList, timeWindow, overlaps, tryReason,
} from './deals.js';
import { money, validity, sizeLabel, unitLabel, distance, esc, safeUrl } from './format.js';
import { nearestByChain, directionsLink, searchLink, CITIES, fetchNearbyStores, distanceKm } from './geo.js';
import { CATEGORIES, chainName, cardName, chainsFor } from './chains.js';

/** @typedef {import('./deals.js').Offer} Offer */
/** @typedef {import('./geo.js').Store} Store */
/** @typedef {import('./geo.js').Position} Position */
/** @typedef {'deals'|'try'|'stores'|'list'} Tab */

const TAB_HASH = /** @type {Record<Tab, string>} */ ({ deals: 'akcie', try: 'vyskusat', stores: 'predajne', list: 'zoznam' });
const HASH_TAB = /** @type {Record<string, Tab>} */ (Object.fromEntries(Object.entries(TAB_HASH).map(([k, v]) => [v, k])));

/** @param {string} sel */
const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel));

// Uloženie nastavení v prehliadači. Môže zlyhať (súkromné okno) – apka funguje aj bez neho.
const saved = {
  /** @param {string} key @param {any} fallback */
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`oplati:${key}`);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  /** @param {string} key @param {any} value */
  set(key, value) {
    try {
      localStorage.setItem(`oplati:${key}`, JSON.stringify(value));
    } catch {
      /* nevadí */
    }
  },
};

const today = isoDate(new Date());
const prefs = saved.get('prefs', {});
const clamp = (/** @type {number} */ n, /** @type {number} */ lo, /** @type {number} */ hi) => Math.min(hi, Math.max(lo, n));

const state = {
  /** @type {'SK'|'CZ'} */ country: prefs.country === 'CZ' ? 'CZ' : 'SK',
  /** @type {Tab} */ tab: HASH_TAB[location.hash.slice(1)] ?? 'deals',
  /** @type {'today'|'week'} */ when: prefs.when === 'week' ? 'week' : 'today',
  /** @type {Set<string>} */ chains: new Set(),
  /** @type {Set<string>} */ categories: new Set(),
  minDiscount: clamp(Number(prefs.minDiscount) || 25, 20, 60),
  noCard: Boolean(prefs.noCard),
  showInflated: false,
  query: '',
  /** @type {'discount'|'savings'|'unit'|'ending'} */ sort: ['discount', 'savings', 'unit', 'ending'].includes(prefs.sort) ? prefs.sort : 'discount',
  /** @type {Position | null} */ pos: prefs.pos ?? null,
  /** @type {{ SK: string[], CZ: string[] }} */ list: saved.get('list', { SK: [], CZ: [] }),
  /** @type {Offer[]} */ offers: [],
  /** @type {Store[]} */ stores: [],
  /** @type {Store[]} */ nearby: [],
  /** @type {Record<string, any>} */ meta: {},
  limit: 60,
  locMsg: '',
  /** @type {''|'loading'|'error'} */ nearbyStatus: '',
  confirmClear: false,
  loadError: '',
  loading: true,
};

function savePrefs() {
  saved.set('prefs', {
    country: state.country,
    when: state.when,
    minDiscount: state.minDiscount,
    noCard: state.noCard,
    sort: state.sort,
    pos: state.pos,
  });
  saved.set('list', state.list);
}

/** @param {Partial<import('./deals.js').Filters>} [extra] */
function currentFilters(extra = {}) {
  return {
    country: state.country,
    when: state.when,
    chains: state.chains,
    categories: state.categories,
    // Apka je hlavne na potraviny: drogériu ukážeme, len keď si ju niekto vyberie.
    excludeCategories: state.categories.size ? new Set() : new Set(['drogeria']),
    minDiscount: state.minDiscount,
    noCard: state.noCard,
    showInflated: state.showInflated,
    query: state.query,
    ...extra,
  };
}

/** Slovenské skloňovanie: 1 akcia, 2 akcie, 5 akcií. @param {number} n @param {[string,string,string]} forms */
function plural(n, [one, few, many]) {
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}
const AKCIE = /** @type {[string,string,string]} */ (['akcia', 'akcie', 'akcií']);

/** Kreslené piktogramy kategórií (jedna hrúbka čiary) – keď produkt nemá obrázok alebo sa nenačíta. */
const CAT_ICON = /** @type {Record<string, string>} */ ({
  ovocie: '<path d="M12 7.6c-1.7-1.3-4.7-1.2-6.1 1-1.7 2.7-.6 7.3 1.7 9.7 1.3 1.4 2.6 1.6 4.4.9 1.8.7 3.1.5 4.4-.9 2.3-2.4 3.4-7 1.7-9.7-1.4-2.2-4.4-2.3-6.1-1Z"/><path d="M12 7.6c0-2.1.9-3.7 2.8-4.6"/>',
  maso: '<path d="M5.3 14c-2-3.7.6-8.4 5.3-8.9 4.5-.5 9 2.3 8.5 6.6-.4 3.3-3.3 4.5-5.7 5-1.6.3-2.6 1.3-3.4 2.4-.9 1.2-2.8 1.1-3.4-.3L5.3 14Z"/><circle cx="14.1" cy="10.4" r="1.9"/>',
  mliecne: '<path d="M7.5 9.2 9.6 4.5h4.8l2.1 4.7V19a1.5 1.5 0 0 1-1.5 1.5H9A1.5 1.5 0 0 1 7.5 19V9.2Z"/><path d="M7.5 9.2h9M10.5 13.5h3"/>',
  pecivo: '<path d="M4.5 11.3c0-3 3.4-5 7.5-5s7.5 2 7.5 5c0 .9-.6 1.6-1.5 1.8V19a1.5 1.5 0 0 1-1.5 1.5H7.5A1.5 1.5 0 0 1 6 19v-5.9c-.9-.2-1.5-.9-1.5-1.8Z"/><path d="M9.2 10.2 10.6 12M13.2 9.6l1.4 1.8"/>',
  trvanlive: '<path d="M8.5 3.5h7M8 6.5h8"/><path d="M7.5 6.5h9V19a1.5 1.5 0 0 1-1.5 1.5H9A1.5 1.5 0 0 1 7.5 19V6.5Z"/><path d="M7.5 11h9v5h-9"/>',
  napoje: '<path d="M10 3.5h4M10.5 3.5v3.3L8.6 9.5a3 3 0 0 0-.6 1.8V19a1.5 1.5 0 0 0 1.5 1.5h5A1.5 1.5 0 0 0 16 19v-7.7a3 3 0 0 0-.6-1.8l-1.9-2.7V3.5"/><path d="M8 13.5h8"/>',
  snacky: '<circle cx="12" cy="12" r="3.7"/><path d="M8.7 10.3 4.5 8v8l4.2-2.3M15.3 10.3 19.5 8v8l-4.2-2.3"/>',
  mrazene: '<path d="M12 3.5v17M4.6 7.75l14.8 8.5M4.6 16.25l14.8-8.5"/><path d="M9.8 4.9 12 6.8l2.2-1.9M9.8 19.1 12 17.2l2.2 1.9"/>',
  drogeria: '<path d="M10 3.5h3.6l1.6 1.6M11.6 3.5V7M9.2 7h4.8v2.4"/><path d="M7.5 11.5a2 2 0 0 1 2-2h4.5a2 2 0 0 1 2 2V19a1.5 1.5 0 0 1-1.5 1.5H9A1.5 1.5 0 0 1 7.5 19v-7.5Z"/>',
  _: '<path d="M4 9.5h16l-1.6 9a1.5 1.5 0 0 1-1.5 1.2H7.1a1.5 1.5 0 0 1-1.5-1.2L4 9.5Z"/><path d="M8.5 9.5 11 4.5M15.5 9.5 13 4.5"/>',
});
/** @param {string} category */
const catIcon = (category) => `<svg class="media__icon" viewBox="0 0 24 24" aria-hidden="true">${CAT_ICON[category] ?? CAT_ICON._}</svg>`;
/** Nezalomiteľná medzera pred % a jednotkami („−68 %“ nikdy nie na dvoch riadkoch). */
const NB = '\u00a0';
/** Bezpečný kúsok triedy z dát (len malé písmená). @param {unknown} s */
const cls = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');
/** Počet s medzerami po tisícoch: 1 291. @param {number} n */
const count = (n) => new Intl.NumberFormat('sk-SK').format(n);
const POLOZKY = /** @type {[string,string,string]} */ (['položka', 'položky', 'položiek']);

function listIds() {
  return state.list[state.country] ?? [];
}

// ---------- Vykreslenie ----------

/** Koľko kariet ukážeme naraz (Billa má cez 1000 akcií týždenne). */
const PAGE = 60;

function render() {
  state.limit = PAGE;
  renderChrome();
  renderView();
  savePrefs();
}

function renderChrome() {
  document.querySelectorAll('[data-country]').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-country') === state.country)));
  document.querySelectorAll('[data-tab]').forEach((b) => {
    if (b.getAttribute('data-tab') === state.tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-when]').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-when') === state.when)));

  const count = listIds().length;
  const badge = $('#list-count');
  badge.hidden = count === 0;
  badge.textContent = String(count);

  // reťazce s cenami najprv, bez cien na koniec
  const chains = [...chainsFor(state.country)].sort((a, b) => Number(hasData(b, state.country)) - Number(hasData(a, state.country)));
  $('#chain-chips').innerHTML =
    chip('data-chain', '', 'Všetky reťazce', state.chains.size === 0) +
    chains
      .map((c) =>
        hasData(c, state.country)
          ? chip('data-chain', c, chainName(c), state.chains.has(c), `<i class="dot chain--${cls(c)}" aria-hidden="true"></i>`)
          : `<button type="button" class="chip chip--off" disabled title="Pre tento reťazec teraz nie sú aktuálne ceny"><i class="dot chain--${cls(c)}" aria-hidden="true"></i>${esc(chainName(c))}<span class="chip__note">bez cien</span></button>`,
      )
      .join('');
  $('#cat-chips').innerHTML =
    chip('data-cat', '', 'Všetky potraviny', state.categories.size === 0) +
    CATEGORIES.map((c) => chip('data-cat', c.id, c.name, state.categories.has(c.id))).join('');

  /** @type {HTMLInputElement} */ ($('#min')).value = String(state.minDiscount);
  $('#min-out').textContent = `${state.minDiscount}${NB}%`;
  /** @type {HTMLInputElement} */ ($('#nocard')).checked = state.noCard;
  /** @type {HTMLInputElement} */ ($('#inflated')).checked = state.showInflated;
  const extras = [`od ${state.minDiscount}${NB}%`];
  if (state.noCard) extras.push('bez karty');
  if (state.showInflated) extras.push('aj nafúknuté');
  $('#more-summary').textContent = extras.join(', ');

  $('#filters').hidden = state.tab === 'list';
}

/** Má apka pre reťazec v krajine skutočné dáta? (ukážkové dáta majú všetky) @param {string} chain @param {string} country */
function hasData(chain, country) {
  if (state.meta.sample || !state.meta.sources) return true;
  return Boolean(state.meta.sources[`${chain}-${country}`]?.ok);
}

/** @param {string} attr @param {string} value @param {string} label @param {boolean} pressed @param {string} [lead] dôveryhodný HTML kúsok pred textom (ikona) */
function chip(attr, value, label, pressed, lead = '') {
  return `<button type="button" class="chip" ${attr}="${esc(value)}" aria-pressed="${pressed}">${lead}${esc(label)}</button>`;
}

function renderView() {
  const view = $('#view');
  const summary = $('#summary');
  if (state.loadError) {
    summary.innerHTML = '<h2>Akcie sa nepodarilo načítať</h2>';
    view.innerHTML = `<div class="empty"><p>${esc(state.loadError)}</p><div class="btn-row"><button type="button" class="btn btn--primary" data-action="reload">Skúsiť znova</button></div></div>`;
    return;
  }
  if (state.loading && state.tab !== 'list') {
    summary.innerHTML = '<h1 class="summary__title">Načítavam akcie…</h1><p>Porovnávam ceny s najnižšími za posledných 30 dní.</p>';
    const ghost = '<div class="deal deal--skeleton"><div class="deal__media"><div class="media"></div></div><div class="deal__main"><span class="sk sk--title"></span><span class="sk sk--line"></span><span class="sk sk--price"></span></div></div>';
    view.innerHTML = `<div class="grid" aria-hidden="true">${ghost.repeat(6)}</div>`;
    return;
  }
  if (state.tab === 'list') return renderList(summary, view);
  if (state.tab === 'stores') return renderStores(summary, view);
  return renderDeals(summary, view, state.tab === 'try');
}

/** @param {HTMLElement} summary @param {HTMLElement} view @param {boolean} onlyTry */
function renderDeals(summary, view, onlyTry) {
  const visible = sortOffers(filterOffers(state.offers, currentFilters({ onlyTryIt: onlyTry }), today), state.sort);
  const { from, to } = timeWindow(state.when, today);
  const comparable = state.offers.filter((o) => o.country === state.country && overlaps(o, from, to));
  const cmp = compareAcrossChains(comparable);
  const whenText = state.when === 'today' ? 'platí dnes' : 'na najbližších 7 dní';

  if (onlyTry) {
    summary.innerHTML = `<h1 class="summary__title">Oplatí sa vyskúšať</h1><p>Novinky, tematické týždne a lepšia kvalita za cenu, pri ktorej nič neriskuješ.</p>`;
  } else if (visible.length) {
    const top = chainSummary(visible)[0];
    const best = sortOffers(visible, 'discount')[0];
    const bestPct = discountInfo(best).real ?? 0;
    summary.innerHTML = `<h1 class="summary__title"><span class="summary__num">${count(visible.length)}</span> ${plural(visible.length, AKCIE)} so skutočnou zľavou od ${state.minDiscount}${NB}% ${whenText}</h1>
      <p>Najviac ich má <b>${esc(chainName(top.chain))}</b>. Najväčšia zľava je −${bestPct}${NB}% na ${esc(best.name)} (${esc(chainName(best.chain))}).</p>`;
  } else {
    summary.innerHTML = `<h1 class="summary__title">Žiadna akcia od ${state.minDiscount}${NB}% ${whenText}</h1>`;
  }

  if (!visible.length) {
    view.innerHTML = emptyDeals(onlyTry);
    return;
  }
  const sortSelect = `<label class="visually-hidden" for="sort">Zoradiť</label>
    <select id="sort">
      ${[
        ['discount', 'Najväčšia zľava'],
        ['savings', 'Najväčšia úspora'],
        ['unit', 'Najlacnejšie za kg / l'],
        ['ending', 'Čoskoro končí'],
      ].map(([v, l]) => `<option value="${v}"${v === state.sort ? ' selected' : ''}>${l}</option>`).join('')}
    </select>`;
  const shown = visible.slice(0, state.limit);
  const rest = visible.length - shown.length;
  const more = rest
    ? `<div class="more-row"><button type="button" class="btn btn--primary" data-action="more">Zobraziť ďalšie (${Math.min(rest, PAGE)} z ${rest})</button></div>`
    : '';
  view.innerHTML = `<h2 class="visually-hidden">Zoznam akcií</h2><div class="results-head"><p>${count(visible.length)} ${plural(visible.length, AKCIE)}</p><div class="sort">${sortSelect}</div></div>
    <div class="grid">${shown.map((o) => card(o, cmp, onlyTry)).join('')}</div>${more}`;
}

/** @param {boolean} onlyTry */
function emptyDeals(onlyTry) {
  const tips = [];
  if (state.when === 'today') tips.push('<button type="button" class="btn btn--primary" data-action="week">Ukázať najbližších 7 dní</button>');
  if (state.minDiscount > 20) tips.push(`<button type="button" class="btn" data-action="min20">Znížiť hranicu na 20${NB}%</button>`);
  if (state.chains.size || state.categories.size || state.query || state.noCard) tips.push('<button type="button" class="btn" data-action="reset">Zrušiť filtre</button>');
  const what = onlyTry ? 'Na vyskúšanie teraz nič nevyhovuje filtrom.' : 'Pri týchto filtroch nie je žiadna akcia so skutočnou zľavou.';
  return `<div class="empty"><span class="empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg></span><h2>${what}</h2><p>Akcie sa menia väčšinou v stredu a vo štvrtok, keď vychádzajú nové letáky. Skús širší výber:</p><div class="btn-row">${tips.join('')}</div></div>`;
}

/** Obrázok produktu, alebo ikona kategórie, keď obrázok nie je (či sa nenačíta). @param {Offer} o */
function media(o) {
  const img = safeUrl(o.image);
  return `<div class="media media--${cls(o.category)}${img ? ' media--photo' : ''}">${catIcon(o.category)}${
    img ? `<img class="media__img" src="${esc(img)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''
  }</div>`;
}

/** @param {Offer} o @param {ReturnType<typeof compareAcrossChains>} cmp */
function card(o, cmp, onlyTry = false) {
  const d = discountInfo(o);
  const v = validity(o, today);
  const up = unitPrice(o);
  const inList = listIds().includes(o.id);
  const weak = d.inflated && (d.real ?? 0) < state.minDiscount;
  const pctShown = d.real ?? d.claimed ?? 0;
  const basisText = d.basis === 'lowest30d' ? 'oproti najnižšej cene za 30 dní' : 'oproti bežnej cene';

  const flags = [];
  const tryText = tryReason(o);
  const c = cmp.get(o.id);
  if (c?.isCheapest) flags.push(`<li class="flag flag--best">Najlacnejšie z ${c.count} reťazcov</li>`);
  else if (c) flags.push(`<li class="flag">Lacnejšie v ${esc(chainName(c.cheapest.chain))}: ${esc(unitLabel(unitPrice(c.cheapest), o.country) || money(c.cheapest.price, o.country))}</li>`);
  if (o.requiresCard) flags.push(`<li class="flag flag--card">S kartou ${esc(cardName(o.chain, o.country))}${o.priceWithoutCard ? `, bez nej ${money(o.priceWithoutCard, o.country)}` : ''}</li>`);
  if (o.note) flags.push(`<li class="flag flag--card">${esc(o.note)}</li>`);
  if (d.inflated) flags.push(`<li class="flag flag--warn">Leták hlási −${d.claimed}${NB}%, reálne je to −${d.real}${NB}%</li>`);
  // dôvod „vyskúšať“ len v záložke Vyskúšať – v hlavnom zozname by bol pri každej druhej akcii
  if (tryText && onlyTry) flags.push(`<li class="flag flag--try">${esc(tryText)}</li>`);

  const meta = [o.brand, sizeLabel(o.size)].filter(Boolean).map(esc).join(', ');
  const src = safeUrl(o.sourceUrl);
  const chain = cls(o.chain);

  return `<article class="deal chain--${chain}">
    <div class="deal__media">
      ${media(o)}
      <p class="sticker${weak ? ' sticker--warn' : ''}" title="Skutočná zľava ${pctShown}${NB}% ${basisText}"><span class="visually-hidden">Zľava </span><b>−${pctShown}</b><small>%</small></p>
    </div>
    <div class="deal__main">
      <h3 class="deal__name">${esc(o.name)}</h3>
      ${meta ? `<p class="deal__meta">${meta}</p>` : ''}
      <p class="deal__prices"><span class="price">${money(o.price, o.country)}</span>${
        o.regularPrice ? ` <s class="was"><span class="visually-hidden">pôvodne </span>${money(o.regularPrice, o.country)}</s>` : ''
      }</p>
      ${up ? `<p class="unit">${esc(unitLabel(up, o.country))}</p>` : ''}
      ${flags.length ? `<ul class="flags">${flags.join('')}</ul>` : ''}
    </div>
    <div class="deal__foot">
      <p class="deal__where"><span class="store"><i class="dot chain--${chain}" aria-hidden="true"></i>${esc(chainName(o.chain))}</span><span class="when when--${v.tone}">${esc(v.text)}</span></p>
      <div class="deal__actions">${
        src
          ? `<a class="icon-btn src" href="${esc(src)}" target="_blank" rel="noopener noreferrer" title="Overiť cenu na webe ${esc(chainName(o.chain))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 4.5h6v6M19.5 4.5 11 13M17 13.5v4.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18v-9a1.5 1.5 0 0 1 1.5-1.5H11"/></svg><span class="visually-hidden">Overiť cenu na webe ${esc(chainName(o.chain))}</span></a>`
          : ''
      }<button type="button" class="add" data-add="${esc(o.id)}" aria-pressed="${inList}" aria-label="${inList ? 'Odobrať zo zoznamu' : 'Pridať do zoznamu'}: ${esc(o.name)}">${
        inList
          ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>V zozname'
          : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Do zoznamu'
      }</button></div>
    </div>
  </article>`;
}

/** Predajne z dát + z okolia (OpenStreetMap). */
function allStores() {
  return state.stores.length ? state.stores.concat(state.nearby) : state.nearby;
}

/** @param {string} chain */
function nearBlock(chain) {
  const near = state.pos ? nearestByChain(allStores(), state.pos, state.country).get(chain) : undefined;
  if (near && near.km < 40) {
    const where = [near.store.address, near.store.city].filter(Boolean).map(esc).join(', ');
    return `<div class="near"><p><b>${distance(near.km)}</b> ${esc(near.store.name ?? chainName(chain))}${where ? `<small>${where}</small>` : ''}</p>
      <a class="btn" href="${esc(directionsLink(near.store))}" target="_blank" rel="noopener noreferrer">Navigovať</a></div>`;
  }
  const label = state.pos?.label ? `v okolí: ${esc(state.pos.label)}` : 'v okolí';
  return `<div class="near"><p>Najbližšia predajňa<small>${label}</small></p>
    <a class="btn" href="${esc(searchLink(chainName(chain), state.pos))}" target="_blank" rel="noopener noreferrer">Nájsť v Mapách</a></div>`;
}

function locateMessage() {
  let text = state.locMsg;
  if (!text && state.nearbyStatus === 'loading') text = 'Hľadám predajne v okolí… (prvýkrát to môže trvať aj 10 sekúnd)';
  if (!text && state.nearbyStatus === 'error') {
    return `<p class="locate__msg" role="status">Mapový server je preťažený, predajne v okolí sa nepodarilo načítať. Medzitým funguje tlačidlo Nájsť v Mapách.
      <button type="button" class="btn" data-action="retry-nearby">Skúsiť znova</button></p>`;
  }
  return text ? `<p class="locate__msg" role="status">${esc(text)}</p>` : '';
}

/** @param {HTMLElement} summary @param {HTMLElement} view */
function renderStores(summary, view) {
  const visible = filterOffers(state.offers, currentFilters(), today);
  const rows = chainSummary(visible);
  const whenText = state.when === 'today' ? 'dnes' : 'tento týždeň';
  summary.innerHTML = rows.length
    ? `<h1 class="summary__title">${whenText === 'dnes' ? 'Dnes' : 'Tento týždeň'} sa najviac oplatí ${esc(chainName(rows[0].chain))}</h1>
       <p>Poradie podľa počtu akcií so skutočnou zľavou od ${state.minDiscount} % a ich veľkosti.</p>`
    : `<h1 class="summary__title">Žiadny reťazec nemá ${whenText} akcie od ${state.minDiscount}${NB}%</h1>`;

  const cities = CITIES.filter((c) => c.country === state.country);
  const selected = state.pos?.label ?? '';
  const locate = `<div class="locate">
      <button type="button" class="btn btn--primary" data-action="locate"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/></svg>Použiť moju polohu</button>
      <label class="visually-hidden" for="city">Mesto</label>
      <select id="city">
        <option value="">${state.pos && !state.pos.label ? 'Moja poloha' : 'alebo vyber mesto'}</option>
        ${cities.map((c) => `<option value="${esc(c.label)}"${c.label === selected ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}
      </select>
      ${locateMessage()}
    </div>`;

  const ranking = rows
    .map(
      (r, i) => `<li class="rank chain--${cls(r.chain)}">
        <div class="rank__head"><span class="rank__pos">${i + 1}.</span><h2><i class="dot chain--${cls(r.chain)}" aria-hidden="true"></i>${esc(chainName(r.chain))}</h2></div>
        <dl class="stats">
          <div><dt>Akcie</dt><dd>${count(r.count)}</dd></div>
          <div><dt>Priemer</dt><dd>−${r.avgDiscount}${NB}%</dd></div>
          <div><dt>Ušetríš</dt><dd>${money(r.totalSavings, state.country)}</dd></div>
        </dl>
        <ul class="top3">${r.top
          .map((o) => `<li><span>${esc(o.name)}</span><b>−${discountInfo(o).real ?? 0}${NB}%</b></li>`)
          .join('')}</ul>
        ${nearBlock(r.chain)}
      </li>`,
    )
    .join('');
  const relevant = chainsFor(state.country).filter((c) => !rows.some((r) => r.chain === c) && (!state.chains.size || state.chains.has(c)));
  const noDeals = relevant.filter((c) => hasData(c, state.country));
  const notYet = relevant.filter((c) => !hasData(c, state.country));
  const missingText =
    (noDeals.length ? `<p class="locate__msg">Bez akcií od ${state.minDiscount} %: ${noDeals.map(chainName).map(esc).join(', ')}.</p>` : '') +
    (notYet.length ? `<p class="locate__msg">Ceny ešte nie sú napojené: ${notYet.map(chainName).map(esc).join(', ')}.</p>` : '');
  view.innerHTML = `${locate}<ol class="ranking">${ranking}</ol>${missingText}`;
}

/** @param {HTMLElement} summary @param {HTMLElement} view */
function renderList(summary, view) {
  const byId = new Map(state.offers.map((o) => [o.id, o]));
  const items = listIds().map((id) => byId.get(id)).filter((o) => o !== undefined);
  const groups = groupList(/** @type {Offer[]} */ (items));
  const saved = groups.reduce((a, g) => a + g.saved, 0);
  summary.innerHTML = items.length
    ? `<h1 class="summary__title">Môj zoznam: ušetríš <span class="summary__num">${money(saved, state.country)}</span></h1><p>${items.length} ${plural(items.length, POLOZKY)} v ${groups.length} ${plural(groups.length, ['obchode', 'obchodoch', 'obchodoch'])}. Zoznam ostáva len v tomto zariadení.</p>`
    : `<h1 class="summary__title">Nákupný zoznam je prázdny</h1>`;

  if (!items.length) {
    view.innerHTML = `<div class="empty"><span class="empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3.5 4.5h2.2l2 10.5h10.2l1.8-7.5H7"/><circle cx="9.5" cy="19" r="1.3"/><circle cx="16.5" cy="19" r="1.3"/></svg></span><h2>Zatiaľ tu nič nie je</h2><p>Pri akcii ťukni na <b>Do zoznamu</b>. Tu potom uvidíš, čo kúpiť v ktorom obchode a koľko ušetríš.</p>
      <div class="btn-row"><button type="button" class="btn btn--primary" data-tab="deals">Prejsť na akcie</button></div></div>`;
    return;
  }
  const groupHtml = groups
    .map(
      (g) => `<section class="list-group chain--${cls(g.chain)}">
        <div class="list-group__head"><div><h2><i class="dot chain--${cls(g.chain)}" aria-hidden="true"></i>${esc(chainName(g.chain))}</h2>
          <p>${g.items.length} ${plural(g.items.length, POLOZKY)} za ${money(g.total, state.country)}, ušetríš ${money(g.saved, state.country)}</p></div></div>
        <ul class="list-items">${g.items
          .map((o) => {
            const expired = o.validTo < today;
            const v = expired ? 'akcia skončila' : validity(o, today).text;
            return `<li class="${expired ? 'expired' : ''}"><span class="thumb">${media(o)}</span><span class="name">${esc(o.name)}<small>${esc([sizeLabel(o.size), v].filter(Boolean).join(', '))}</small></span>
              <span class="amount">${money(o.price, o.country)}</span>
              <button type="button" class="icon-btn" data-remove="${esc(o.id)}" aria-label="Odobrať ${esc(o.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></li>`;
          })
          .join('')}</ul>
        <div class="list-group__near">${nearBlock(g.chain)}</div>
      </section>`,
    )
    .join('');
  const clear = state.confirmClear
    ? `<div class="btn-row"><span>Naozaj vymazať celý zoznam?</span><button type="button" class="btn btn--danger" data-action="clear-yes">Vymazať</button><button type="button" class="btn" data-action="clear-no">Nechať</button></div>`
    : `<button type="button" class="btn" data-action="clear">Vymazať zoznam</button>`;
  view.innerHTML = `<div class="grid">${groupHtml}</div><div class="list-total"><p></p>${clear}</div>`;
}

function renderFoot() {
  const when = state.meta.generatedAt ? new Date(state.meta.generatedAt) : null;
  const stamp = when && !Number.isNaN(when.getTime())
    ? when.toLocaleString('sk-SK', { weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'neznáme';
  const fmt = (/** @type {string} */ iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('sk-SK', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const live = Object.entries(state.meta.sources ?? {})
    .filter(([, s]) => s?.ok)
    .map(([k, s]) => {
      const [chain, country] = k.split('-');
      return `<li><i class="dot chain--${cls(chain)}" aria-hidden="true"></i>${esc(chainName(chain))} ${esc(country)}<span>${esc(fmt(s.fetchedAt))}</span></li>`;
    });
  $('#foot').innerHTML = `<p><b>Akcie aktualizované:</b> ${esc(stamp)}. Ceny sú z webov reťazcov, pred nákupom ich over v predajni.</p>
    ${live.length ? `<ul class="sources" aria-label="Zdroje cien">${live.join('')}</ul>` : ''}
    <p>Polohy predajní © prispievatelia <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>.</p>`;
  const note = $('#sample-note');
  note.hidden = !state.meta.sample;
  note.textContent = 'Ukážkové ceny na vyskúšanie apky. Skutočné akcie z letákov sem pribudnú po napojení zdrojov.';
}

// ---------- Poloha ----------

let nearbyKey = '';
function loadNearby() {
  const pos = state.pos;
  if (!pos) return;
  const haveLocal = state.stores.some((s) => s.country === state.country && distanceKm(pos, s) < 25);
  if (haveLocal) return;
  const key = `${state.country}:${pos.lat.toFixed(2)},${pos.lon.toFixed(2)}`;
  if (key === nearbyKey) return;
  nearbyKey = key;
  const refresh = () => {
    if (state.tab === 'stores' || state.tab === 'list') renderView();
  };
  // Predajne v okolí si pamätáme 7 dní, aby sa nemuselo zakaždým čakať na OpenStreetMap.
  const cached = saved.get(`nearby:${key}`, null);
  if (cached && Date.now() - cached.at < 7 * 86400000 && Array.isArray(cached.stores)) {
    state.nearby = cached.stores;
    state.nearbyStatus = '';
    refresh();
    return;
  }
  state.nearbyStatus = 'loading';
  refresh();
  fetchNearbyStores(pos, state.country)
    .then((stores) => {
      if (key !== nearbyKey) return; // medzitým si vybral iné mesto
      state.nearby = stores;
      state.nearbyStatus = '';
      saved.set(`nearby:${key}`, { at: Date.now(), stores });
      refresh();
    })
    .catch(() => {
      // Bez siete alebo zablokované – ostanú odkazy do Máp. Ďalší pokus pri zmene mesta.
      if (key !== nearbyKey) return;
      nearbyKey = '';
      state.nearbyStatus = 'error';
      refresh();
    });
}

function locate() {
  if (!('geolocation' in navigator)) {
    state.locMsg = 'Tento prehliadač polohu nepodporuje. Vyber mesto.';
    renderView();
    return;
  }
  state.locMsg = 'Zisťujem polohu…';
  renderView();
  navigator.geolocation.getCurrentPosition(
    (p) => {
      state.pos = { lat: p.coords.latitude, lon: p.coords.longitude };
      state.locMsg = '';
      savePrefs();
      loadNearby();
      renderView();
    },
    (err) => {
      state.locMsg = err.code === 1 ? 'Poloha nie je povolená. Vyber mesto zo zoznamu.' : 'Polohu sa nepodarilo zistiť. Vyber mesto zo zoznamu.';
      renderView();
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
  );
}

// ---------- Udalosti ----------

/** @param {Tab} tab */
function goTab(tab) {
  state.tab = tab;
  state.confirmClear = false;
  try {
    history.replaceState(null, '', `#${TAB_HASH[tab]}`);
  } catch {
    /* nevadí */
  }
  render();
  window.scrollTo({ top: 0 });
}

/** Odznak pri „Zoznam“ krátko poskočí, keď v ňom pribudne položka (len ak používateľ nevypol animácie). */
function bumpBadge() {
  const badge = $('#list-count');
  badge.classList.remove('badge--bump');
  void badge.offsetWidth; // reštart animácie
  badge.classList.add('badge--bump');
}

/** @param {string} id */
function toggleList(id) {
  const ids = listIds();
  state.list[state.country] = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

document.addEventListener('click', (e) => {
  const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button, a[data-tab-link]'));
  if (!el) return;
  const d = el.dataset;
  if (d.tabLink) {
    e.preventDefault();
    return goTab(/** @type {Tab} */ (d.tabLink));
  }
  if (d.tab) return goTab(/** @type {Tab} */ (d.tab));
  if (d.country) {
    if (d.country === state.country) return;
    state.country = /** @type {'SK'|'CZ'} */ (d.country);
    state.chains.clear();
    if (state.pos?.label && !CITIES.some((c) => c.label === state.pos?.label && c.country === state.country)) state.pos = null;
    state.nearby = [];
    nearbyKey = '';
    loadNearby();
    return render();
  }
  if (d.when) {
    state.when = /** @type {'today'|'week'} */ (d.when);
    return render();
  }
  if (d.chain !== undefined) {
    if (!d.chain) state.chains.clear();
    else if (state.chains.has(d.chain)) state.chains.delete(d.chain);
    else state.chains.add(d.chain);
    return render();
  }
  if (d.cat !== undefined) {
    if (!d.cat) state.categories.clear();
    else if (state.categories.has(d.cat)) state.categories.delete(d.cat);
    else state.categories.add(d.cat);
    return render();
  }
  if (d.add) {
    const adding = !listIds().includes(d.add);
    toggleList(d.add);
    render();
    if (adding) bumpBadge();
    return;
  }
  if (d.remove) {
    toggleList(d.remove);
    return render();
  }
  switch (d.action) {
    case 'week':
      state.when = 'week';
      return render();
    case 'min20':
      state.minDiscount = 20;
      return render();
    case 'reset':
      state.chains.clear();
      state.categories.clear();
      state.noCard = false;
      state.query = '';
      /** @type {HTMLInputElement} */ ($('#q')).value = '';
      return render();
    case 'more': {
      state.limit += PAGE;
      const y = window.scrollY;
      renderView();
      window.scrollTo({ top: y });
      return;
    }
    case 'locate':
      return locate();
    case 'retry-nearby':
      nearbyKey = '';
      return loadNearby();
    case 'clear':
      state.confirmClear = true;
      return renderView();
    case 'clear-no':
      state.confirmClear = false;
      return renderView();
    case 'clear-yes':
      state.list[state.country] = [];
      state.confirmClear = false;
      return render();
    case 'reload':
      location.reload();
  }
});

let searchTimer = 0;
$('#q').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const value = /** @type {HTMLInputElement} */ (e.target).value;
  searchTimer = window.setTimeout(() => {
    state.query = value.trim();
    state.limit = PAGE;
    renderView();
  }, 120);
});
$('#min').addEventListener('input', (e) => {
  state.minDiscount = clamp(Number(/** @type {HTMLInputElement} */ (e.target).value), 20, 60);
  render();
});
$('#nocard').addEventListener('change', (e) => {
  state.noCard = /** @type {HTMLInputElement} */ (e.target).checked;
  render();
});
$('#inflated').addEventListener('change', (e) => {
  state.showInflated = /** @type {HTMLInputElement} */ (e.target).checked;
  render();
});
document.addEventListener('change', (e) => {
  const t = /** @type {HTMLSelectElement} */ (e.target);
  if (t.id === 'sort') {
    state.sort = /** @type {any} */ (t.value);
    render();
  } else if (t.id === 'city') {
    const city = CITIES.find((c) => c.label === t.value);
    state.pos = city ? { lat: city.lat, lon: city.lon, label: city.label } : null;
    state.locMsg = '';
    loadNearby();
    render();
  }
});
// Obrázok produktu: kým sa nenačíta, vidno ikonu kategórie; keď sa nenačíta vôbec (zmazaný, blokovaný), ikona ostane.
document.addEventListener(
  'load',
  (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.classList.contains('media__img')) img.closest('.media')?.classList.add('media--loaded');
  },
  true,
);
document.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.classList.contains('media__img')) {
      img.closest('.media')?.classList.remove('media--photo');
      img.remove();
    }
  },
  true,
);
window.addEventListener('hashchange', () => {
  const tab = HASH_TAB[location.hash.slice(1)];
  if (tab && tab !== state.tab) goTab(tab);
});

// ---------- Štart ----------

/** Dáta: v ukážke sú vložené priamo do stránky, v nasadenej apke sa načítajú zo súborov. @param {string} id @param {string} url */
async function loadJson(id, url) {
  const inline = document.getElementById(id);
  if (inline?.textContent?.trim()) return JSON.parse(inline.textContent);
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Súbor ${url} vrátil chybu ${res.status}.`);
  return res.json();
}

async function start() {
  render();
  try {
    const [offersFile, storesFile] = await Promise.all([
      loadJson('data-offers', 'data/offers.json'),
      loadJson('data-stores', 'data/stores.json').catch(() => ({ stores: [] })),
    ]);
    state.meta = offersFile.meta ?? {};
    /** @type {Offer[]} */
    let offers = Array.isArray(offersFile.offers) ? offersFile.offers : [];
    if (state.meta.sample && state.meta.anchorDate) offers = rebaseByWeeks(offers, state.meta.anchorDate, today);
    state.offers = offers;
    state.stores = Array.isArray(storesFile.stores) ? storesFile.stores : [];
    // Položky zo zoznamu, ktoré už v dátach nie sú, zahodíme.
    const ids = new Set(offers.map((o) => o.id));
    state.list = { SK: (state.list.SK ?? []).filter((id) => ids.has(id)), CZ: (state.list.CZ ?? []).filter((id) => ids.has(id)) };
  } catch (err) {
    state.loadError = err instanceof Error ? err.message : 'Neznáma chyba.';
  }
  state.loading = false;
  renderFoot();
  render();
  loadNearby();
}

start();

if ('serviceWorker' in navigator && location.protocol === 'https:' && !document.getElementById('data-offers')) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    /* offline režim je bonus, nie podmienka */
  });
}
