import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  referencePrice, discountInfo, savings, unitPrice, isActiveOn, timeWindow, matchesFilters,
  filterOffers, sortOffers, compareAcrossChains, chainSummary, rebaseByWeeks, addDays, normalizeText, groupList,
} from '../app/js/deals.js';
import { validity, money, esc, safeUrl } from '../app/js/format.js';
import { distanceKm, nearestByChain } from '../app/js/geo.js';

const base = {
  id: 'x', country: 'SK', chain: 'lidl', name: 'Maslo 82 %', brand: 'Rajo', category: 'mliecne',
  size: { amount: 250, unit: 'g' }, price: 1.19, regularPrice: 1.99, lowest30d: null,
  validFrom: '2026-10-22', validTo: '2026-10-25', requiresCard: false, tryIt: null, matchKey: 'maslo-82-250g',
};
const o = (over) => ({ ...base, ...over });
const filters = (over = {}) => ({
  country: 'SK', when: 'today', chains: new Set(), categories: new Set(), minDiscount: 25,
  noCard: false, showInflated: false, query: '', ...over,
});
const TODAY = '2026-10-24';

test('zľava z letáku bez histórie = reálna zľava', () => {
  const d = discountInfo(base);
  assert.equal(d.claimed, 40);
  assert.equal(d.real, 40);
  assert.equal(d.inflated, false);
  assert.equal(d.basis, 'regular');
});

test('najnižšia cena za 30 dní odhalí nafúknutú zľavu', () => {
  const d = discountInfo(o({ price: 1.59, regularPrice: 2.49, lowest30d: 1.79 }));
  assert.equal(d.claimed, 36);
  assert.equal(d.real, 11);
  assert.equal(d.inflated, true);
  assert.equal(d.basis, 'lowest30d');
  assert.equal(referencePrice(o({ price: 1.59, regularPrice: 2.49, lowest30d: 1.79 })), 1.79);
});

test('bez pôvodnej ceny nevieme zľavu a ponuka neprejde filtrom', () => {
  const x = o({ regularPrice: null });
  assert.equal(discountInfo(x).real, null);
  assert.equal(matchesFilters(x, filters(), TODAY), false);
});

test('úspora a cena za kg / l / ks', () => {
  assert.equal(savings(base), 0.8);
  assert.deepEqual(unitPrice(base), { value: 4.76, unit: 'kg' });
  assert.deepEqual(unitPrice(o({ price: 0.89, size: { amount: 1.5, unit: 'l' } })), { value: 0.59, unit: 'l' });
  assert.deepEqual(unitPrice(o({ price: 2.5, size: { amount: 10, unit: 'ks' } })), { value: 0.25, unit: 'ks' });
  assert.equal(unitPrice(o({ size: null })), null);
  assert.equal(savings(o({ price: 2.5 })), 0, 'drahšie než bežná cena = žiadna úspora');
});

test('platnosť: dnes vs. najbližších 7 dní', () => {
  assert.equal(isActiveOn(base, TODAY), true);
  const next = o({ validFrom: '2026-10-28', validTo: '2026-11-03' });
  assert.equal(matchesFilters(next, filters(), TODAY), false);
  assert.equal(matchesFilters(next, filters({ when: 'week' }), TODAY), true);
  assert.deepEqual(timeWindow('week', TODAY), { from: '2026-10-24', to: '2026-10-30' });
  const later = o({ validFrom: '2026-11-05', validTo: '2026-11-08' });
  assert.equal(matchesFilters(later, filters({ when: 'week' }), TODAY), false);
});

test('filter: krajina, reťazec, kategória, karta, prah zľavy, hľadanie bez diakritiky', () => {
  assert.equal(matchesFilters(base, filters({ country: 'CZ' }), TODAY), false);
  assert.equal(matchesFilters(base, filters({ chains: new Set(['billa']) }), TODAY), false);
  assert.equal(matchesFilters(base, filters({ categories: new Set(['maso']) }), TODAY), false);
  assert.equal(matchesFilters(o({ requiresCard: true }), filters({ noCard: true }), TODAY), false);
  assert.equal(matchesFilters(base, filters({ minDiscount: 45 }), TODAY), false);
  assert.equal(matchesFilters(base, filters({ query: 'MASLO' }), TODAY), true);
  assert.equal(matchesFilters(o({ name: 'Kuracie prsia' }), filters({ query: 'kuracie' }), TODAY), true);
  assert.equal(normalizeText('Čučoriedky  ŠŤAVA'), 'cucoriedky stava');
});

test('vylúčené kategórie (drogéria) sa neukážu', () => {
  const soap = o({ category: 'drogeria' });
  assert.equal(matchesFilters(soap, filters({ excludeCategories: new Set(['drogeria']) }), TODAY), false);
  assert.equal(matchesFilters(soap, filters(), TODAY), true);
});

test('nafúknuté zľavy sa ukážu len keď o ne používateľ požiada', () => {
  const fake = o({ price: 1.59, regularPrice: 2.49, lowest30d: 1.79 });
  assert.equal(matchesFilters(fake, filters(), TODAY), false);
  assert.equal(matchesFilters(fake, filters({ showInflated: true }), TODAY), true);
});

test('radenie podľa zľavy, úspory a ceny za jednotku', () => {
  const a = o({ id: 'a', price: 1.5, regularPrice: 2 }); // 25 %
  const b = o({ id: 'b', price: 1, regularPrice: 2 }); // 50 %
  const c = o({ id: 'c', price: 10, regularPrice: 14, size: { amount: 1, unit: 'kg' } }); // 29 %, úspora 4
  assert.deepEqual(sortOffers([a, b, c], 'discount').map((x) => x.id), ['b', 'c', 'a']);
  assert.deepEqual(sortOffers([a, b, c], 'savings').map((x) => x.id), ['c', 'b', 'a']);
  assert.deepEqual(sortOffers([a, b, c], 'unit').map((x) => x.id), ['b', 'a', 'c']);
});

test('porovnanie rovnakého produktu naprieč reťazcami podľa ceny za kg', () => {
  const lidl = o({ id: 'l', chain: 'lidl', price: 1.19 });
  const billa = o({ id: 'b', chain: 'billa', price: 1.49 });
  const kaufland = o({ id: 'k', chain: 'kaufland', price: 2.49, size: { amount: 500, unit: 'g' } }); // 4,98 €/kg
  const map = compareAcrossChains([lidl, billa, kaufland]);
  assert.equal(map.get('l').isCheapest, true);
  assert.equal(map.get('l').count, 3);
  assert.equal(map.get('b').isCheapest, false);
  assert.equal(map.get('b').diff, 1.2); // 5,96 – 4,76 €/kg
  assert.equal(map.get('k').diff, 0.22, 'väčšie balenie sa porovná cez cenu za kg');
  assert.equal(compareAcrossChains([lidl]).size, 0, 'jeden reťazec = nie je čo porovnať');
});

test('súhrn reťazcov a nákupný zoznam', () => {
  const rows = chainSummary([o({ id: '1' }), o({ id: '2', price: 1.49 }), o({ id: '3', chain: 'billa', price: 1.39 })]);
  assert.equal(rows[0].chain, 'lidl');
  assert.equal(rows[0].count, 2);
  const groups = groupList([o({ id: '1' }), o({ id: '3', chain: 'billa', price: 1.39 }), o({ id: '2', price: 1.49 })]);
  assert.equal(groups[0].chain, 'lidl');
  assert.equal(groups[0].total, 2.68);
  assert.equal(groups[0].saved, 1.3);
});

test('ukážkové dáta sa posúvajú o celé týždne', () => {
  const shifted = rebaseByWeeks([base], '2026-10-24', '2026-11-09');
  assert.equal(shifted[0].validFrom, addDays('2026-10-22', 14));
  assert.equal(rebaseByWeeks([base], '2026-10-24', '2026-10-26')[0].validFrom, '2026-10-22');
});

test('formátovanie platnosti a meny', () => {
  assert.deepEqual(validity(base, TODAY), { text: 'do zajtra', tone: 'last' });
  assert.deepEqual(validity(o({ validTo: TODAY }), TODAY), { text: 'len dnes', tone: 'last' });
  assert.deepEqual(validity(o({ validFrom: '2026-10-28', validTo: '2026-11-03' }), TODAY), { text: 'od st 28. 10.', tone: 'soon' });
  assert.match(money(1.19, 'SK'), /1,19\s€/);
  assert.match(money(24.9, 'CZ'), /24,90\sKč/);
});

test('bezpečnosť: escapovanie a len https odkazy', () => {
  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('http://example.com'), null);
  assert.equal(safeUrl('https://www.lidl.sk/'), 'https://www.lidl.sk/');
});

test('najbližšia predajňa podľa reťazca', () => {
  const brno = { lat: 49.1951, lon: 16.6068 };
  const stores = [
    { chain: 'lidl', country: 'CZ', lat: 49.21, lon: 16.6 },
    { chain: 'lidl', country: 'CZ', lat: 49.3, lon: 16.7 },
    { chain: 'billa', country: 'CZ', lat: 49.19, lon: 16.61 },
    { chain: 'lidl', country: 'SK', lat: 49.195, lon: 16.607 },
  ];
  const near = nearestByChain(stores, brno, 'CZ');
  assert.equal(near.get('lidl').store.lat, 49.21);
  assert.ok(near.get('billa').km < 1);
  assert.ok(Math.abs(distanceKm({ lat: 48.1486, lon: 17.1077 }, brno) - 122) < 3, 'Bratislava–Brno vzdušnou čiarou ≈ 122 km');
});

test('filterOffers vráti len vyhovujúce', () => {
  const list = [base, o({ id: 'y', country: 'CZ' })];
  assert.equal(filterOffers(list, filters(), TODAY).length, 1);
});

test('bez karty: použije sa cena bez karty, a keď zľava bez karty nie je, ponuka zmizne', () => {
  const lp = o({ id: 'lp', price: 1.79, priceWithoutCard: 1.89, regularPrice: 2.99, requiresCard: true });
  const onlyCard = o({ id: 'oc', price: 2.49, priceWithoutCard: null, regularPrice: 2.99, requiresCard: true });
  const res = filterOffers([lp, onlyCard], filters({ noCard: true }), TODAY);
  assert.equal(res.length, 1);
  assert.equal(res[0].price, 1.89);
  assert.equal(res[0].requiresCard, false);
  assert.equal(filterOffers([lp, onlyCard], filters({ minDiscount: 15 }), TODAY).length, 2);
});
