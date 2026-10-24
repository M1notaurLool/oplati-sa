import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice, parseSize, guessCategory, matchKey, offerId } from '../scraper/lib/normalize.js';
import { lowestBefore, applyHistory, updateHistory, historyKey } from '../scraper/lib/history.js';
import { parseOverpass, chainFromBrand } from '../app/js/geo.js';

test('ceny z letákov', () => {
  assert.equal(parsePrice('1,49 €'), 1.49);
  assert.equal(parsePrice('24,90 Kč'), 24.9);
  assert.equal(parsePrice('1.299,00 Kč'), 1299);
  assert.equal(parsePrice('-,99'), 0.99);
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice('zadarmo'), null);
  assert.equal(parsePrice(2.5), 2.5);
});

test('balenia', () => {
  assert.deepEqual(parseSize('250 g'), { amount: 250, unit: 'g' });
  assert.deepEqual(parseSize('1,5 l'), { amount: 1.5, unit: 'l' });
  assert.deepEqual(parseSize('2 x 500 ml'), { amount: 1000, unit: 'ml' });
  assert.deepEqual(parseSize('10 ks'), { amount: 10, unit: 'ks' });
  assert.deepEqual(parseSize('cca 0,7 kg'), { amount: 0.7, unit: 'kg' });
  assert.deepEqual(parseSize('33 cl'), { amount: 330, unit: 'ml' });
  assert.equal(parseSize('balenie'), null);
});

test('kategórie a kľúče', () => {
  assert.equal(guessCategory('Kuracie prsné rezne'), 'maso');
  assert.equal(guessCategory('Máslo 82 %'), 'mliecne');
  assert.equal(guessCategory('Prací gél Color'), 'drogeria');
  assert.equal(guessCategory('Pizza Ristorante'), 'mrazene');
  assert.equal(matchKey('Maslo 82 % čerstvé', { amount: 250, unit: 'g' }), matchKey('maslo 82 %', { amount: 250, unit: 'g' }));
  assert.equal(offerId('SK', 'lidl', 'Maslo 82 %', '2026-10-22', { amount: 250, unit: 'g' }), 'sk-lidl-maslo-82-250g-2026-10-22');
});

test('história odhalí, že akcia nie je výnimočná', () => {
  const offer = { id: 'a', country: 'SK', chain: 'billa', name: 'Mandarínky', category: 'ovocie', size: { amount: 1, unit: 'kg' }, price: 1.29, regularPrice: 2.29, validFrom: '2026-10-21', validTo: '2026-10-27' };
  const key = historyKey(offer);
  const history = { [key]: [{ d: '2026-10-07', p: 1.39, r: 2.29 }, { d: '2026-05-01', p: 0.99 }] };
  assert.equal(lowestBefore(history, key, '2026-10-21'), 1.39, 'staršie ako 30 dní sa nepočíta');
  assert.equal(applyHistory([offer], history)[0].lowest30d, 1.39);
  assert.equal(applyHistory([{ ...offer, lowest30d: 1.1 }], history)[0].lowest30d, 1.1, 'údaj od reťazca má prednosť');
  const next = updateHistory(history, [offer], '2026-10-24');
  assert.equal(next[key].length, 2, 'záznam starší ako 120 dní zmizol, pribudol nový');
  assert.equal(updateHistory(next, [offer], '2026-10-24')[key].length, 2, 'rovnaký záznam sa nezdvojí');
});

test('predajne z OpenStreetMap', () => {
  assert.equal(chainFromBrand('BILLA'), 'billa');
  assert.equal(chainFromBrand('Albert Supermarket'), 'albert');
  assert.equal(chainFromBrand('Coop Jednota'), null);
  const json = {
    elements: [
      { type: 'node', lat: 49.2101234, lon: 16.5951234, tags: { brand: 'Lidl', name: 'Lidl', 'addr:street': 'Purkyňova', 'addr:housenumber': '99', 'addr:city': 'Brno' } },
      { type: 'way', center: { lat: 49.19, lon: 16.61 }, tags: { brand: 'Albert', name: 'Albert Supermarket' } },
      { type: 'node', lat: 49.1, lon: 16.6, tags: { brand: 'Penny' } },
    ],
  };
  const stores = parseOverpass(json, () => 'CZ');
  assert.equal(stores.length, 2);
  assert.deepEqual(stores[0], { chain: 'lidl', country: 'CZ', lat: 49.21012, lon: 16.59512, name: 'Lidl', address: 'Purkyňova 99', city: 'Brno' });
  assert.equal(stores[1].chain, 'albert');
});

test('kategórie z názvov letákov (Billa, Lidl)', () => {
  const cases = {
    'Persil gél color 44pd': 'drogeria',
    'Old spice sg 400 ml original': 'drogeria',
    'Felix kapsicka 12x85 g junior mix maso': 'drogeria',
    'Movino pálava vzh vášeň 0,75 l': 'napoje',
    'Templar. sk. cabernet sauvignon 0,75 l': 'napoje',
    'Dolce gusto lungo 89,6 g': 'napoje',
    'Pribináček vanilka 70 g': 'mliecne',
    'Tami encián nakladaný v oleji 610 g': 'mliecne',
    'Debrecínska pečienka ca.1.7 kg leco': 'maso',
    'Treska v majonezovej omacke 140 g': 'maso',
    'Podravka paradajkový pretlak 3x200 g': 'trvanlive',
    'Panzani špagety 500 g': 'trvanlive',
    'Cheetos chrumky kecup 85 g': 'snacky',
    'Lindt lindor white 200 g': 'snacky',
    'Algida magnum classic 110 ml': 'mrazene',
    'Bagetka s kváskom 50 g la lorraine': 'pecivo',
    'Brokolica 500 g / bon via': 'ovocie',
    'Pór': 'ovocie',
  };
  for (const [name, cat] of Object.entries(cases)) assert.equal(guessCategory(name), cat, name);
});

test('kategórie: snacky so slaninou nie sú mäso, ústna voda nie je nápoj', () => {
  assert.equal(guessCategory('Cheetos chrumky sunka/syr 80 g'), 'snacky');
  assert.equal(guessCategory('Gazdovské zemiak. lupienky slanina70 g'), 'snacky');
  assert.equal(guessCategory('Colgate ustna voda 500 ml plax cool mint'), 'drogeria');
});
