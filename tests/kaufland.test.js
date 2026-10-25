import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { offersFromKauflandLeaflet, kauflandUnitPrices, fetchOffers } from '../scraper/chains/kaufland.js';

// Skutočné texty s polohou z 1. strany letákov (CZ 21.–27. 10. 2026, SK 22.–28. 10. 2026) z leaflets.kaufland.com.
const fx = JSON.parse(readFileSync(new URL('./fixtures/kaufland-leaflet.json', import.meta.url), 'utf8'));
const run = (cc) => offersFromKauflandLeaflet([fx[cc].page], { country: cc, validFrom: fx[cc].validFrom, validTo: fx[cc].validTo, flyerUrl: `https://leaflets.kaufland.com/x/${fx[cc].id}` });

test('Kaufland CZ leták: všetky zľavnené položky titulky so správnymi cenami', () => {
  const by = Object.fromEntries(run('CZ').map((o) => [o.name, o]));
  // podľa obrázka letáku: -25 % 7,90→5,90 … -53 % 129,90→59,90; „AKCE! pouze“ bez zľavy sa neberie
  const expect = {
    'Cereální bagetka': [5.9, 7.9],
    Pomelo: [29.9, 59.9],
    Kaki: [54.9, 79.9],
    'Vepřový bok': [89.9, 159.9],
    'Kimbex Aljašská treska': [169.9, 279.9],
    'Madeta Jihočeské máslo': [32.9, 46.9],
    'Sedlčanský Hermelín': [27.9, 44.9],
    'Bernard 11 Pivo': [15.9, 28.9],
    'Zewa Toaletní papír': [59.9, 129.9],
  };
  for (const [name, [price, old]] of Object.entries(expect)) {
    assert.ok(by[name], `chýba ${name}`);
    assert.deepEqual([by[name].price, by[name].regularPrice], [price, old], name);
  }
  assert.equal(Object.keys(by).some((n) => /kachna|jihlavanka|lindor/i.test(n)), false, 'AKCE bez zľavy nepatrí medzi zľavy');
  const maslo = by['Madeta Jihočeské máslo'];
  assert.deepEqual([maslo.requiresCard, maslo.priceWithoutCard, maslo.validFrom, maslo.validTo, maslo.size], [true, 37.9, '2026-10-21', '2026-10-22', { amount: 250, unit: 'g' }], 'XTRA cena s kartou + platnosť len 2 dni');
  assert.equal(by['Bernard 11 Pivo'].category, 'napoje');
  assert.match(by.Pomelo.sourceUrl, /\/view\/flyer\/page\/1$/);
});

test('Kaufland SK leták: názvy, karta XTRA, bodka v cenách', () => {
  const by = Object.fromEntries(run('SK').map((o) => [o.name, o]));
  assert.deepEqual([by['Treska Exklusiv']?.price, by['Treska Exklusiv']?.regularPrice, by['Treska Exklusiv']?.size], [0.89, 1.49, { amount: 140, unit: 'g' }]);
  assert.deepEqual([by['Cestoviny 8-vaječné']?.price, by['Cestoviny 8-vaječné']?.regularPrice], [0.65, 1.15]);
  assert.deepEqual([by['Spišské párky']?.price, by['Spišské párky']?.priceWithoutCard, by['Spišské párky']?.regularPrice], [6.39, 6.99, 9.49]);
  assert.ok(by['Vodka alebo Liehovina'], 'spojka „alebo“ v názve');
  assert.equal(by.Mandarínky?.category, 'ovocie');
  for (const o of Object.values(by)) assert.equal(o.validTo, '2026-10-28');
});

test('Kaufland: jednotková cena overí priradenie názvu k cenovke', () => {
  assert.deepEqual(kauflandUnitPrices('110 g (=1 kg 8,09)').map((v) => Math.round(v * 100) / 100), [0.89]);
  assert.deepEqual(kauflandUnitPrices('200 g (=100 g 59,95)').map((v) => Math.round(v * 100) / 100), [119.9]);
  assert.deepEqual(kauflandUnitPrices('250 g (*=1 00 g X: 13,16/ A: 15,16)').map((v) => Math.round(v * 100) / 100), [32.9, 37.9]);
  assert.deepEqual(kauflandUnitPrices('1 kus'), []);
});

test('Kaufland: identifikátor letáku podľa týždňa, budúci týždeň nie je povinný', async () => {
  const asked = [];
  const http = {
    json: async (url) => {
      asked.push(new URL(url).searchParams.get('flyer_identifier'));
      return { success: false, message: 'There is no data for given filters.' };
    },
    bytes: async () => new Uint8Array(),
  };
  await assert.rejects(fetchOffers('SK', http, new Date('2026-10-25T08:00:00Z')), /Kaufland/);
  // pdfjs-dist nemusí byť nainštalovaný – vtedy sa na leták ani nepýta
  if (asked.length) assert.deepEqual(asked, ['SK_sk_KDZ_1020_SK43-LFT', 'SK_sk_KDZ_1020_SK44-LFT']);
});
