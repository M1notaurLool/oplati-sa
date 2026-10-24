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

  const chains = chainsFor(state.country);
  $('#chain-chips').innerHTML =
    chip('data-chain', '', 'Všetky reťazce', state.chains.size === 0) +
    chains
      .map((c) =>
        hasData(c, state.country)
          ? chip('data-chain', c, chainName(c), state.chains.has(c))
          : `<button type="button" class="chip chip--off" disabled title="${c === 'kaufland' ? 'Web Kauflandu vyžaduje overenie „nie som robot“, ceny sa nedajú sťahovať automaticky' : 'Pre tento reťazec teraz nie sú aktuálne ceny'}">${esc(chainName(c))} · bez cien</button>`,
      )
      .join('');
  $('#cat-chips').innerHTML =
    chip('data-cat', '', 'Všetky potraviny', state.categories.size === 0) +
    CATEGORIES.map((c) => chip('data-cat', c.id, c.name, state.categories.has(c.id))).join('');

  /** @type {HTMLInputElement} */ ($('#min')).value = String(state.minDiscount);
  $('#min-out').textContent = `${state.minDiscount} %`;
  /** @type {HTMLInputElement} */ ($('#nocard')).checked = state.noCard;
  /** @type {HTMLInputElement} */ ($('#inflated')).checked = state.showInflated;
  const extras = [`od ${state.minDiscount} %`];
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

/** @param {string} attr @param {string} value @param {string} label @param {boolean} pressed */
function chip(attr, value, label, pressed) {
  return `<button type="button" class="chip" ${attr}="${esc(value)}" aria-pressed="${pressed}">${esc(label)}</button>`;
}

function renderView() {
  const view = $('#view');
  const summary = $('#summary');
  if (state.loadError) {
    summary.innerHTML = '<h2>Akcie sa nepodarilo načítať</h2>';
    view.innerHTML = `<div class="empty"><p>${esc(state.loadError)}</p><div class="btn-row"><button type="button" class="btn btn--primary" data-action="reload">Skúsiť znova</button></div></div>`;
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
    summary.innerHTML = `<h2>Oplatí sa vyskúšať</h2><p>Novinky, tematické týždne a lepšia kvalita za cenu, pri ktorej nič neriskuješ.</p>`;
  } else if (visible.length) {
    const top = chainSummary(visible)[0];
    const best = sortOffers(visible, 'discount')[0];
    const bestPct = discountInfo(best).real ?? 0;
    summary.innerHTML = `<h2><em>${visible.length}</em> ${plural(visible.length, AKCIE)} so skutočnou zľavou od ${state.minDiscount} % ${whenText}</h2>
      <p>Najviac ich má ${esc(chainName(top.chain))}. Najväčšia zľava: −${bestPct} % na ${esc(best.name)} (${esc(chainName(best.chain))}).</p>`;
  } else {
    summary.innerHTML = `<h2>Žiadna akcia od ${state.minDiscount} % ${whenText}</h2>`;
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
  view.innerHTML = `<div class="results-head"><p>${visible.length} ${plural(visible.length, AKCIE)}</p>${sortSelect}</div>
    <div class="grid">${shown.map((o) => card(o, cmp)).join('')}</div>${more}`;
}

/** @param {boolean} onlyTry */
function emptyDeals(onlyTry) {
  const tips = [];
  if (state.when === 'today') tips.push('<button type="button" class="btn btn--primary" data-action="week">Ukázať najbližších 7 dní</button>');
  if (state.minDiscount > 20) tips.push('<button type="button" class="btn" data-action="min20">Znížiť hranicu na 20 %</button>');
  if (state.chains.size || state.categories.size || state.query || state.noCard) tips.push('<button type="button" class="btn" data-action="reset">Zrušiť filtre</button>');
  const what = onlyTry ? 'Na vyskúšanie teraz nič nevyhovuje filtrom.' : 'Pri týchto filtroch nie je žiadna akcia so skutočnou zľavou.';
  return `<div class="empty"><h3>${what}</h3><p>Akcie sa menia väčšinou v pondelok, stredu a štvrtok, keď vychádzajú nové letáky.</p><div class="btn-row">${tips.join('')}</div></div>`;
}

/** @param {Offer} o @param {ReturnType<typeof compareAcrossChains>} cmp */
function card(o, cmp) {
  const d = discountInfo(o);
  const v = validity(o, today);
  const up = unitPrice(o);
  const inList = listIds().includes(o.id);
  const weak = d.inflated && (d.real ?? 0) < state.minDiscount;
  const pctShown = d.real ?? d.claimed ?? 0;
  const basisText = d.basis === 'lowest30d' ? 'oproti najnižšej cene za 30 dní' : 'oproti bežnej cene';

  const flags = [];
  const tryText = tryReason(o);
  if (tryText) flags.push(`<li class="flag flag--try">${esc(tryText)}</li>`);
  if (o.requiresCard) flags.push(`<li class="flag flag--card">s ${esc(cardName(o.chain, o.country))}</li>`);
  if (o.requiresCard && o.priceWithoutCard) flags.push(`<li class="flag">bez karty ${money(o.priceWithoutCard, o.country)}</li>`);
  if (o.note) flags.push(`<li class="flag flag--card">${esc(o.note)}</li>`);
  if (d.inflated) flags.push(`<li class="flag flag--warn">leták −${d.claimed} %, reálne −${d.real} %</li>`);
  const c = cmp.get(o.id);
  if (c?.isCheapest) flags.push(`<li class="flag flag--best">najlacnejšie z ${c.count} reťazcov</li>`);
  else if (c) flags.push(`<li class="flag">lacnejšie v ${esc(chainName(c.cheapest.chain))}: ${esc(unitLabel(unitPrice(c.cheapest), o.country) || money(c.cheapest.price, o.country))}</li>`);

  const meta = [o.brand, sizeLabel(o.size)].filter(Boolean).map(esc).join(' · ');
  const src = safeUrl(o.sourceUrl);
  const srcLink = src ? ` · <a href="${esc(src)}" target="_blank" rel="noopener noreferrer">na webe ${esc(chainName(o.chain))}</a>` : '';

  return `<article class="deal">
    <div class="sticker${weak ? ' sticker--warn' : ''}" title="Skutočná zľava ${pctShown} % ${basisText}" aria-label="Zľava ${pctShown} percent"><b>−${pctShown}</b><small>%</small></div>
    <div class="deal__body">
      <h3 class="deal__name">${esc(o.name)}</h3>
      <p class="deal__meta">${meta}${srcLink}</p>
      <p class="deal__where"><span class="chain">${esc(chainName(o.chain))}</span><span class="when when--${v.tone}">${esc(v.text)}</span></p>
      ${flags.length ? `<ul class="flags">${flags.join('')}</ul>` : ''}
    </div>
    <div class="deal__price">
      <p class="price">${money(o.price, o.country)}</p>
      ${o.regularPrice ? `<p class="was"><s>${money(o.regularPrice, o.country)}</s></p>` : ''}
      ${up ? `<p class="unit">${esc(unitLabel(up, o.country))}</p>` : ''}
      <button type="button" class="add" data-add="${esc(o.id)}" aria-pressed="${inList}" aria-label="${inList ? 'Odobrať zo zoznamu' : 'Pridať do zoznamu'}: ${esc(o.name)}">${inList ? 'V zozname' : '+ Zoznam'}</button>
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
    return `<div class="near"><p><b>${distance(near.km)}</b> · ${esc(near.store.name ?? chainName(chain))}${where ? `<small>${where}</small>` : ''}</p>
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
    ? `<h2>${whenText === 'dnes' ? 'Dnes' : 'Tento týždeň'} sa najviac oplatí <em>${esc(chainName(rows[0].chain))}</em></h2>
       <p>Poradie podľa počtu akcií so skutočnou zľavou od ${state.minDiscount} % a ich veľkosti.</p>`
    : `<h2>Žiadny reťazec nemá ${whenText} akcie od ${state.minDiscount} %</h2>`;

  const cities = CITIES.filter((c) => c.country === state.country);
  const selected = state.pos?.label ?? '';
  const locate = `<div class="locate">
      <button type="button" class="btn btn--primary" data-action="locate">Použiť moju polohu</button>
      <label class="visually-hidden" for="city">Mesto</label>
      <select id="city">
        <option value="">${state.pos && !state.pos.label ? 'Moja poloha' : 'alebo vyber mesto'}</option>
        ${cities.map((c) => `<option value="${esc(c.label)}"${c.label === selected ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}
      </select>
      ${locateMessage()}
    </div>`;

  const ranking = rows
    .map(
      (r, i) => `<li class="rank">
        <div class="rank__head"><span class="rank__pos">${i + 1}.</span><h3>${esc(chainName(r.chain))}</h3></div>
        <dl class="stats">
          <div><dt>Akcie</dt><dd>${r.count}</dd></div>
          <div><dt>Priemer</dt><dd>−${r.avgDiscount} %</dd></div>
          <div><dt>Ušetríš</dt><dd>${money(r.totalSavings, state.country)}</dd></div>
        </dl>
        <ul class="top3">${r.top
          .map((o) => `<li><span>${esc(o.name)}</span><b>−${discountInfo(o).real ?? 0} %</b></li>`)
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
    ? `<h2>Môj zoznam: ušetríš <em>${money(saved, state.country)}</em></h2><p>${items.length} ${plural(items.length, POLOZKY)} v ${groups.length} ${plural(groups.length, ['obchode', 'obchodoch', 'obchodoch'])}. Zoznam ostáva len v tomto zariadení.</p>`
    : `<h2>Nákupný zoznam je prázdny</h2>`;

  if (!items.length) {
    view.innerHTML = `<div class="empty"><p>Pri akcii ťukni na <b>+ Zoznam</b>. Tu potom uvidíš, čo kúpiť v ktorom obchode a koľko ušetríš.</p>
      <div class="btn-row"><button type="button" class="btn btn--primary" data-tab="deals">Prejsť na akcie</button></div></div>`;
    return;
  }
  const groupHtml = groups
    .map(
      (g) => `<section class="list-group">
        <div class="list-group__head"><div><h3>${esc(chainName(g.chain))}</h3>
          <p>${g.items.length} ${plural(g.items.length, POLOZKY)} · ${money(g.total, state.country)} · ušetríš ${money(g.saved, state.country)}</p></div></div>
        <ul class="list-items">${g.items
          .map((o) => {
            const expired = o.validTo < today;
            const v = expired ? 'akcia skončila' : validity(o, today).text;
            return `<li class="${expired ? 'expired' : ''}"><span class="name">${esc(o.name)}<small>${esc([sizeLabel(o.size), v].filter(Boolean).join(' · '))}</small></span>
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
    ? when.toLocaleString('sk-SK', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'neznáme';
  const fmt = (/** @type {string} */ iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('sk-SK', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const live = Object.entries(state.meta.sources ?? {})
    .filter(([, s]) => s?.ok)
    .map(([k, s]) => {
      const [chain, country] = k.split('-');
      return `${chainName(chain)} ${country} (${fmt(s.fetchedAt)})`;
    });
  const sourcesText = live.length ? ` Zdroje: ${live.map(esc).join(', ')}.` : '';
  $('#foot').innerHTML = `<p>Akcie aktualizované: ${esc(stamp)}.${sourcesText} Ceny sú z webov reťazcov, pred nákupom ich over v predajni.</p>
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
    toggleList(d.add);
    return render();
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
