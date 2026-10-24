// Testy adaptérov na skutočných tvaroch dát z webov (vzorky zo 24. 10. 2026, skrátené).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractGridData, gridItemToOffer, categoryForPath, isFood } from '../scraper/chains/lidl.js';
import { billaProductToOffer, billaCategory } from '../scraper/chains/billa.js';
import { decodeEntities, localDate, wednesdayWeek, isoWeek, tidyName } from '../scraper/lib/normalize.js';
import { invalidReason } from '../scraper/lib/validate.js';

// --- Lidl: data-grid-data (tvar z lidl.sk, produkt Maliny) ---
const malinyJson = {
  brand: { name: 'RYNECZEK LIDLA', showBrand: false },
  canonicalUrl: '/p/maliny/p11029869',
  fullTitle: 'Maliny',
  keyfacts: { wonCategoryPrimary: 'Svety potrieb/Potraviny a potraviny v blízkosti potravín/Syr, mliečne výrobky a vajcia/Jogurt' },
  lidlPlus: [{ highlightText: '-40﹪', lidlPlusText: 's Lidl Plus', price: { packaging: { text: '125 g balenie' }, price: 1.79 } }],
  price: { discount: { deletedPrice: 2.99, percentageDiscount: 36 }, oldPrice: 2.99, packaging: { text: '125 g balenie' }, price: 1.89 },
  productId: 11029869,
  store: true,
  storeStartDate: 1792620000, // 22. 10. 2026 00:00 SELČ
  storeEndDate: 1792965599, // 25. 10. 2026 23:59 SELČ
};
const horalky = {
  fullTitle: 'Horalky Retro',
  lidlPlus: [{ highlightText: 'od 3 kusov', price: { packaging: { text: '50 g' }, price: 0.49 } }],
  price: { packaging: { text: '50 g' }, price: 0.59 },
  productId: 1,
  store: true,
  storeStartDate: 1792620000,
  storeEndDate: 1792965599,
};
const attr = (obj) => JSON.stringify(obj).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const lidlHtml = `<div data-grid-data="${attr(malinyJson)}"></div><div data-grid-data="${attr(horalky)}"></div><p>Zobrazené produkty 2 / 2 produktov</p>`;

test('Lidl: vytiahne JSON z data-grid-data aj s entitami', () => {
  const items = extractGridData(lidlHtml);
  assert.equal(items.length, 2);
  assert.equal(items[0].fullTitle, 'Maliny');
  assert.equal(decodeEntities('a &quot;b&quot; &amp; &#x2F; &#39;'), 'a "b" & / \'');
});

test('Lidl: cena s Lidl Plus, cena bez karty, pôvodná cena a dátumy', () => {
  const o = gridItemToOffer(malinyJson, { country: 'SK', host: 'https://www.lidl.sk', category: 'ovocie' });
  assert.equal(o.price, 1.79);
  assert.equal(o.priceWithoutCard, 1.89);
  assert.equal(o.regularPrice, 2.99);
  assert.equal(o.requiresCard, true);
  assert.deepEqual(o.size, { amount: 125, unit: 'g' });
  assert.equal(o.validFrom, '2026-10-22');
  assert.equal(o.validTo, '2026-10-25');
  assert.equal(o.sourceUrl, 'https://www.lidl.sk/p/maliny/p11029869');
  assert.equal(o.brand, null);
  assert.equal(invalidReason(o), null);
});

test('Lidl: zľava len s Lidl Plus má bežnú cenu = cena bez karty a podmienku', () => {
  const o = gridItemToOffer(horalky, { country: 'SK', host: 'https://www.lidl.sk', category: 'snacky' });
  assert.equal(o.price, 0.49);
  assert.equal(o.regularPrice, 0.59);
  assert.equal(o.priceWithoutCard, null, 'bez karty tu zľava nie je');
  assert.equal(o.note, 'od 3 kusov');
});

test('Lidl: bez zľavy alebo len online → nič', () => {
  assert.equal(gridItemToOffer({ ...malinyJson, lidlPlus: null, price: { price: 1.89 } }, { country: 'SK', host: '', category: null }), null);
  assert.equal(gridItemToOffer({ ...malinyJson, storeStartDate: undefined, storeEndDate: undefined }, { country: 'SK', host: '', category: null }), null, 'len online');
  assert.equal(gridItemToOffer({ ...malinyJson, store: false }, { country: 'SK', host: 'x', category: 'ovocie' })?.price, 1.79, 'príde do predajní neskôr');
});

test('Lidl: kategórie podľa adresy a rozpoznanie potravín', () => {
  assert.equal(categoryForPath('/h/ovocie-a-zelenina/h10071012'), 'ovocie');
  assert.equal(categoryForPath('/h/syry-mlecne-vyrobky-a-vejce/h10095761'), 'mliecne');
  assert.equal(categoryForPath('/h/vino-pivo-a-lihoviny/h10096268'), 'napoje');
  assert.equal(categoryForPath('/h/chovatelske-potreby/h10071025'), null);
  assert.equal(isFood(malinyJson), true);
  assert.equal(isFood({ keyfacts: { wonCategoryPrimary: 'Svety potrieb/Obývacia izba a nábytok/Spálňa' } }), false);
});

// --- Billa SK: API product-discovery (tvar z billa.sk) ---
const jam = {
  amount: '350',
  name: 'RISO ŠÍPKOVÝ DŽEM 350G',
  parentCategories: [
    [{ name: 'Sweet Spreads' }, { name: 'Marmelade&Jam' }],
    [{ name: 'LEAFLET' }, { name: 'KW 43/2026' }],
  ],
  price: { crossed: 279, discountPercentage: -28, regular: { tags: ['SO'], value: 199 } },
  sku: '84-182842',
  volumeLabelShort: 'g',
  weightArticle: false,
};
const parky = {
  amount: '180',
  name: 'MEDVEDÍK PÁRKY 180G REINERT',
  parentCategories: [[{ name: 'Sausages' }, { name: 'Wiener' }]],
  price: { loyalty: { tags: ['SO'], value: 249 }, regular: { tags: [], value: 299 } },
  sku: '1',
  volumeLabelShort: 'g',
};
const bocik = {
  amount: '1000',
  name: 'KU PEČENÝ BRAVČOVÝ BÔČIK ROZRAB71/175026',
  parentCategories: [[{ name: 'LEAFLET' }, { name: 'KW 45/2026' }, { name: 'Inside' }]],
  price: { crossed: 1950, regular: { value: 1550, promotionText: 'pri kúpe 2 ks' } },
  sku: '53-158346',
  volumeLabelShort: 'g',
  weightArticle: true,
};
const ctx = { country: 'SK', validFrom: '2026-10-21', validTo: '2026-10-27' };

test('Billa: akciová cena z centov a pekný názov', () => {
  const o = billaProductToOffer(jam, ctx);
  assert.equal(o.name, 'Riso šípkový džem 350 g');
  assert.equal(o.price, 1.99);
  assert.equal(o.regularPrice, 2.79);
  assert.equal(o.requiresCard, false);
  assert.deepEqual(o.size, { amount: 350, unit: 'g' });
  assert.equal(o.category, 'trvanlive');
  assert.equal(invalidReason(o), null);
});

test('Billa: cena s BILLA Bonus', () => {
  const o = billaProductToOffer(parky, ctx);
  assert.equal(o.price, 2.49);
  assert.equal(o.regularPrice, 2.99);
  assert.equal(o.requiresCard, true);
  assert.equal(o.category, 'maso');
});

test('Billa: vážený tovar za kg, podmienka akcie, interný kód preč', () => {
  const o = billaProductToOffer(bocik, ctx);
  assert.equal(o.name, 'Pečený bravčový bôčik');
  assert.deepEqual(o.size, { amount: 1, unit: 'kg' });
  assert.equal(o.note, 'pri kúpe 2 ks');
  assert.equal(o.category, 'maso');
  assert.equal(billaCategory({ name: 'X', parentCategories: [[{ name: 'Cleaning' }, { name: 'Toilet' }]] }), 'drogeria');
  assert.equal(billaProductToOffer({ ...jam, price: { regular: { value: 199 } } }, ctx), null, 'bez zľavy nič');
});

test('dátumy: miestny čas, ISO týždeň a leták streda–utorok', () => {
  assert.equal(localDate(1792965599), '2026-10-25');
  assert.deepEqual(isoWeek('2026-10-21'), { year: 2026, week: 43 });
  assert.deepEqual(wednesdayWeek('2026-10-24'), { from: '2026-10-21', to: '2026-10-27', year: 2026, week: 43 });
  assert.deepEqual(wednesdayWeek('2026-10-27'), { from: '2026-10-21', to: '2026-10-27', year: 2026, week: 43 });
  assert.equal(wednesdayWeek('2026-10-28').week, 44);
  assert.equal(tidyName('NUTELLA 600G'), 'Nutella 600 g');
});

// --- Lidl: vyhľadávacie API /q/api/search (tvar z lidl.cz, skrátené) ---
test('Lidl: vyhľadávanie – potraviny áno, krmivo a nepotravinové nie', async () => {
  const { offersFromSearch, categoryForItem, searchUrl } = await import('../scraper/chains/lidl.js');
  const food = {
    fullTitle: 'Pórek',
    keyfacts: { wonCategoryPrimary: 'Světy potřeb/Potraviny a blízké potraviny/Ovoce a zelenina/Zelenina' },
    price: { basePrice: { text: 'kus' }, discount: { deletedPrice: 24.9, percentageDiscount: 40 }, oldPrice: 24.9, price: 14.9 },
    productId: 7,
    store: true,
    storeStartDate: 1793311200, // 29. 10. 2026
    storeEndDate: 1793573999, // 1. 11. 2026 23:59
  };
  const pet = { ...food, fullTitle: 'Paštika pro kočky', productId: 8, keyfacts: { wonCategoryPrimary: 'Světy potřeb/Potraviny a blízké potraviny/Potřeby pro domácí zvířata/Krmivo' } };
  const tool = { ...food, fullTitle: 'PARKSIDE fólie', productId: 9, keyfacts: { wonCategoryPrimary: 'Světy potřeb/Dílna a zahrada/Zahrada' } };
  assert.equal(categoryForItem(food), 'ovocie');
  assert.equal(categoryForItem(pet), null);
  assert.equal(categoryForItem(tool), null);
  const offers = offersFromSearch({ items: [{ gridbox: { data: food } }, { gridbox: { data: pet } }, { gridbox: { data: tool } }, {}] }, 'CZ');
  assert.equal(offers.length, 1);
  assert.equal(offers[0].price, 14.9);
  assert.equal(offers[0].regularPrice, 24.9);
  assert.equal(offers[0].validFrom, '2026-10-29');
  assert.equal(offers[0].validTo, '2026-11-01');
  assert.equal(offers[0].country, 'CZ');
  assert.match(searchUrl('SK'), /^https:\/\/www\.lidl\.sk\/q\/api\/search\?assortment=SK&locale=sk_SK/);
});

test('Lidl CZ: balenie z basePrice („1,1 kg, 1 kg = 45,36 Kč“), nie cena za jednotku', async () => {
  const { gridItemToOffer } = await import('../scraper/chains/lidl.js');
  const base = { fullTitle: 'Jogurt řeckého typu', productId: 3, store: true, storeStartDate: 1792620000, storeEndDate: 1792965599 };
  const cz = gridItemToOffer({ ...base, price: { basePrice: { text: '1,1 kg, 1 kg = 45,36 Kč' }, oldPrice: 59.9, price: 49.9 } }, { country: 'CZ', host: 'https://www.lidl.cz' });
  assert.deepEqual(cz.size, { amount: 1.1, unit: 'kg' });
  const sk = gridItemToOffer({ ...base, price: { basePrice: { text: '100 g = 0,25' }, oldPrice: 0.39, price: 0.29 } }, { country: 'SK', host: 'https://www.lidl.sk' });
  assert.equal(sk.size, null);
});

test('Lidl: pivo a liehoviny sú tiež potraviny', async () => {
  const { isFood, categoryForItem } = await import('../scraper/chains/lidl.js');
  const vodka = { fullTitle: 'Vodka 1906', keyfacts: { wonCategoryPrimary: 'Svety potrieb/Víno, pivo a liehoviny/liehoviny, destiláty/Vodka' } };
  assert.equal(isFood(vodka), true);
  assert.equal(categoryForItem(vodka), 'napoje');
});

test('Lidl: vyhľadávanie sa stránkuje až po numFound', async () => {
  const { fetchOffers } = await import('../scraper/chains/lidl.js');
  const item = (id) => ({ gridbox: { data: { fullTitle: `Jablka ${id}`, productId: id, keyfacts: { wonCategoryPrimary: 'Světy potřeb/Potraviny a blízké potraviny/Ovoce a zelenina/Ovoce' }, price: { price: 19.9, oldPrice: 39.9 }, storeStartDate: 1792620000, storeEndDate: 1792965599 } } });
  const urls = [];
  const http = {
    text: async () => '',
    json: async (url) => {
      urls.push(url);
      const offset = Number(new URL(url).searchParams.get('offset'));
      return { numFound: 3, items: offset === 0 ? [item(1), item(2)] : offset === 2 ? [item(3)] : [] };
    },
  };
  const offers = await fetchOffers('CZ', http);
  assert.equal(offers.length, 3);
  assert.equal(urls.length, 2);
});

test('Billa: interné predpony v názvoch zmiznú', () => {
  assert.equal(tidyName('KU (R) VB BRAVČ. KARÉ BK PLÁTKY'), 'Bravč. karé bk plátky');
  assert.equal(tidyName('KU (R) MB BRAVČ.STEHNO VCELKU BK (70)'), 'Bravč.stehno vcelku bk');
  assert.equal(tidyName('KU PEČENÉ JATERNICE'), 'Pečené jaternice');
  assert.equal(tidyName('CS BRAVČOVÉ KARÉ BK V CELKU OA CA.3,6KG'), 'Bravčové karé bk v celku oa ca.3,6 kg');
  assert.equal(tidyName('MV.ZABÍJAČKOVÝ BALÍČEK CA.4KG'), 'Zabíjačkový balíček ca.4 kg');
  assert.equal(tidyName('ST.NICOLAUS KLASIK TUZEMSKÝ UM 40% 0,5L'), 'St.nicolaus klasik tuzemský um 40% 0,5 l');
});

test('Billa: víkendová ponuka sa označí', async () => {
  const { isWeekendOnly } = await import('../scraper/chains/billa.js');
  const leaflet = (wk, sub) => [{ name: 'LEAFLET' }, { name: `KW ${wk}/2026`, slug: `kw-${wk}2026` }, { name: sub }];
  assert.equal(isWeekendOnly({ parentCategories: [leaflet(44, 'Víkendová ponuka'), leaflet(43, 'Inside')] }, 'kw-442026'), true);
  assert.equal(isWeekendOnly({ parentCategories: [leaflet(44, 'Víkendová ponuka'), leaflet(43, 'Inside')] }, 'kw-432026'), false);
  assert.equal(isWeekendOnly({ parentCategories: [leaflet(43, 'Inside')] }, 'kw-432026'), false);
});

// --- Billa CZ: /api/product-discovery/products?inPromotion=true (tvar z billa.cz) ---
test('Billa CZ: najnižšia cena za 30 dní odhalí nafúknutú zľavu, odkaz na produkt', async () => {
  const { billaProductToOffer, fetchOffers } = await import('../scraper/chains/billa.js');
  const sekt = {
    name: 'Bohemia Sekt Brut jakostní šumivé víno 0,75l', sku: '82-1', slug: 'bohemia-sekt-brut-82000001', amount: '0.75', volumeLabelShort: 'l',
    brand: { name: 'Bohemia Sekt' },
    parentCategories: [[{ name: 'Nápoje' }, { name: 'Víno' }, { name: 'Šumivé víno' }]],
    price: { crossed: 17990, discountPercentage: -33, lowestPrice: 10990, regular: { value: 11990, tags: ['pt-aktion'] } },
  };
  const ctx = { country: 'CZ', validFrom: '2026-10-21', validTo: '2026-10-27', useLowestPrice: true, host: 'https://www.billa.cz' };
  const o = billaProductToOffer(sekt, ctx);
  assert.equal(o.price, 119.9);
  assert.equal(o.regularPrice, 179.9);
  assert.equal(o.lowest30d, 109.9);
  assert.equal(o.brand, 'Bohemia Sekt');
  assert.equal(o.category, 'napoje');
  assert.equal(o.sourceUrl, 'https://www.billa.cz/produkt/bohemia-sekt-brut-82000001');
  // lowestPrice medzi akciovou a prečiarknutou cenou → skutočná zľava je menšia (Haribo 16,90 „z 24,90“, nedávno 17,90)
  const haribo = billaProductToOffer({ ...sekt, price: { crossed: 2490, lowestPrice: 1790, regular: { value: 1690 } } }, ctx);
  assert.equal(haribo.lowest30d, 17.9);
  // lowestPrice = prečiarknutá cena → žiadna nová informácia
  assert.equal(billaProductToOffer({ ...sekt, price: { ...sekt.price, lowestPrice: 17990 } }, ctx).lowest30d, null);
  // na SK sa lowestPrice ignoruje
  assert.equal(billaProductToOffer(sekt, { ...ctx, country: 'SK', useLowestPrice: false }).lowest30d, null);

  const pages = [];
  const http = { json: async (url) => { pages.push(url); const page = Number(new URL(url).searchParams.get('page')); return { total: 3, results: page === 0 ? [sekt, { ...sekt, sku: '82-2', slug: 'x-2' }] : page === 1 ? [{ ...sekt, sku: '82-3', slug: 'x-3' }] : [] }; } };
  const offers = await fetchOffers('CZ', http, new Date('2026-10-24T12:00:00Z'));
  assert.equal(offers.length, 3);
  assert.equal(pages.length, 2);
  assert.match(pages[0], /^https:\/\/www\.billa\.cz\/api\/product-discovery\/products\?inPromotion=true&page=0&pageSize=200$/);
  assert.equal(offers[0].validFrom, '2026-10-21');
});

test('Billa SK: stiahne leták tohto aj budúceho týždňa', async () => {
  const { fetchOffers } = await import('../scraper/chains/billa.js');
  const seen = [];
  const prod = (sku) => ({ name: 'RAJO MASLO 250G', sku, amount: '250', volumeLabelShort: 'g', parentCategories: [], price: { crossed: 249, regular: { value: 179 } } });
  const http = { json: async (url) => { seen.push(new URL(url).pathname); const page = Number(new URL(url).searchParams.get('page')); return page ? { total: 1, results: [] } : { total: 1, results: [prod(url.includes('kw-44') ? 'b' : 'a')] }; } };
  const offers = await fetchOffers('SK', http, new Date('2026-10-24T12:00:00Z'));
  assert.deepEqual([...new Set(seen)], ['/api/product-discovery/categories/kw-432026/products', '/api/product-discovery/categories/kw-442026/products']);
  assert.deepEqual(offers.map((o) => [o.validFrom, o.validTo]), [['2026-10-21', '2026-10-27'], ['2026-10-28', '2026-11-03']]);
});

test('Billa CZ: kategórie podľa stromu billa.cz, nie podľa názvu', () => {
  const p = (name, top, sub) => ({ name, parentCategories: [[{ name: top }, { name: sub }]] });
  assert.equal(billaCategory(p('Whiskas kapsičky s kuřecím 12x85 g', 'Mazlíčci', 'Kočka')), 'drogeria');
  assert.equal(billaCategory(p('Relax pomeranč 1 l', 'Nápoje', 'Džusy a ovocné nápoje')), 'napoje');
  assert.equal(billaCategory(p('Hellmann\'s majonéza 405 ml', 'Chlazené, mléčné a rostlinné výrobky', 'Majonézy, tatarské omáčky a dresinky')), 'trvanlive');
  assert.equal(billaCategory(p('Bohemia chips solené 130 g', 'Trvanlivé potraviny', 'Slané, snacky a ořechy')), 'snacky');
  assert.equal(billaCategory(p('Vitana hovězí vývar', 'Trvanlivé potraviny', 'Koření a ochucovadla')), 'trvanlive');
  assert.equal(billaCategory(p('Pampers Premium 3', 'Péče o dítě', 'Pleny a doplňky na přebalování')), 'drogeria');
});

// --- Tesco SK: online obchod potravinydomov.itesco.sk (tvar Apollo cache z 24. 10. 2026) ---
test('Tesco: akcie pre všetkých, Clubcard ceny, cena za kg a preskočené typy', async () => {
  const { tescoProductToOffer, productsFromHtml, fetchOffers } = await import('../scraper/chains/tesco.js');
  const promo = (description, before, after, attributes = []) => ({ id: description, startDate: '2026-10-20T22:00:00Z', endDate: '2026-10-27T23:00:00Z', description, price: { beforeDiscount: before, afterDiscount: after }, attributes });
  const base = { id: '213968665', isForSale: true, brandName: 'TESCO', superDepartmentName: 'Ovocie, zelenina', departmentName: 'Zelenina', displayType: 'Quantity' };

  const uhorka = tescoProductToOffer({ ...base, title: 'Uhorka šalátová ks', price: { actual: 0.55, unitPrice: 0.55, unitOfMeasure: 'kus' }, promotions: [promo('-38%, predtým 0,89 €', 0.89, 0.55)] }, '2026-10-24');
  assert.deepEqual([uhorka.price, uhorka.regularPrice, uhorka.requiresCard, uhorka.validFrom, uhorka.validTo, uhorka.category, uhorka.brand], [0.55, 0.89, false, '2026-10-21', '2026-10-27', 'ovocie', null]);
  assert.equal(uhorka.sourceUrl, 'https://potravinydomov.itesco.sk/groceries/sk-SK/products/213968665');

  const pomaranc = tescoProductToOffer({ ...base, title: 'Pomaranče voľné', displayType: 'QuantityOrWeight', price: { actual: 0.4, unitPrice: 1.19, unitOfMeasure: 'kg' }, promotions: [promo('-45%, predtým 2,19 €', 2.19, 1.19)] }, '2026-10-24');
  assert.deepEqual([pomaranc.price, pomaranc.regularPrice, pomaranc.size, pomaranc.note], [1.19, 2.19, { amount: 1, unit: 'kg' }, 'cena za kg']);

  const groc = { ...base, superDepartmentName: 'Trvanlivé potraviny', departmentName: 'Prísady na varenie a pečenie', brandName: 'Dr. Oetker' };
  const kypriaci = tescoProductToOffer({ ...groc, title: 'Dr. Oetker Kypriaci prášok do pečiva 5 x 12 g (60 g)', price: { actual: 0.87, unitPrice: 14.5, unitOfMeasure: 'kg' }, promotions: [promo('0,45 € s Clubcard', null, 0.87, ['CLUBCARD_PRICING'])] }, '2026-10-24');
  assert.deepEqual([kypriaci.price, kypriaci.regularPrice, kypriaci.requiresCard, kypriaci.priceWithoutCard, kypriaci.size, kypriaci.brand], [0.45, 0.87, true, 0.87, { amount: 60, unit: 'g' }, 'Dr. Oetker']);

  const horalky = tescoProductToOffer({ ...groc, departmentName: 'Sladké pochutiny', title: 'Sedita Horalky 50 g', price: { actual: 0.78 }, promotions: [promo('0,54 € s Clubcard', null, 0.78, ['CLUBCARD_PRICING'])] }, '2026-10-24');
  assert.equal(horalky.category, 'snacky');
  const polovica = tescoProductToOffer({ ...base, superDepartmentName: 'Mliečne výrobky a vajcia', title: 'Milsy Bánovecká nátierka 200 g', price: { actual: 1.99 }, promotions: [promo('0,99 € Polovičná cena s Clubcard', null, 1.99, ['CLUBCARD_PRICING'])] }, '2026-10-24');
  assert.deepEqual([polovica.price, polovica.category], [0.99, 'mliecne']);

  // „Kúpte 6 a viac…“ a „Super cena“ nemajú jasnú cenu, hračky nie sú potraviny, skončená akcia sa ignoruje
  assert.equal(tescoProductToOffer({ ...base, title: 'Voda 1,5 l', price: { actual: 0.52 }, promotions: [{ ...promo('Kúpte 6 a viac ušetrite 31 % s Clubcard', null, null, ['CLUBCARD_PRICING']), price: null }] }, '2026-10-24'), null);
  assert.equal(tescoProductToOffer({ ...base, title: 'Cukor práškový 1 kg', price: { actual: 1.45 }, promotions: [promo('Super cena', null, 1.45)] }, '2026-10-24'), null);
  assert.equal(tescoProductToOffer({ ...base, superDepartmentName: 'Domov a zábava', title: 'Lego', price: { actual: 20 }, promotions: [promo('-50%, predtým 40 €', 40, 20)] }, '2026-10-24'), null);
  assert.equal(tescoProductToOffer({ ...base, title: 'Uhorka', price: { actual: 0.55 }, promotions: [promo('-38%, predtým 0,89 €', 0.89, 0.55)] }, '2026-10-29'), null);

  // HTML → produkty s rozbalenými akciami, stránkovanie podľa „total“
  const cache = { 'ProductType:1': { ...base, id: '1', title: 'Uhorka šalátová ks', price: { actual: 0.55 }, promotions: [{ __ref: 'PromotionType:a' }] }, 'PromotionType:a': promo('-38%, predtým 0,89 €', 0.89, 0.55) };
  const parsed = productsFromHtml(`<script type="application/discover+json">${JSON.stringify({ a: { props: { cache, info: { count: 1 } } } })}</script>`);
  assert.equal(parsed.products.length, 1);
  assert.equal(parsed.products[0].promotions[0].description, '-38%, predtým 0,89 €');

  const urls = [];
  const http = { text: async (url) => { urls.push(url); const page = Number(new URL(url).searchParams.get('page')); const c = { [`ProductType:${page}`]: { ...cache['ProductType:1'], id: String(page) }, 'PromotionType:a': cache['PromotionType:a'] }; return `<script type="application/discover+json">{"x":{"pageSize":48,"total":60},"c":${JSON.stringify(c)}}</script>`; } };
  const offers = await fetchOffers('SK', http, new Date('2026-10-24T12:00:00Z'));
  assert.equal(offers.length, 2);
  assert.equal(urls.length, 2, '60 akcií po 48 = 2 strany');
  assert.deepEqual(await fetchOffers('CZ', http), []);
});

// --- Albert CZ: texty s polohou z PDF letáku (skutočné súradnice zo strany 3 a 10 letáku 43/2026) ---
test('Albert: cenovky z PDF letáku – overenie zľavou aj jednotkovou cenou', async () => {
  const { offersFromLeaflet, expectedPrice, cleanName } = await import('../scraper/chains/albert.js');
  const page3 = { n: 3, w: 482, h: 843, items: [
    ['Jablka', 21, 492, 18, 40], ['Kunín', 251, 492, 18, 35], ['Golden', 21, 509, 18, 39], ['%', 194, 509, 36, 23], ['Smetana', 251, 509, 18, 52],
    ['%', 429, 509, 36, 23], ['39,90/', 113, 510, 16, 22], ['-37', 152, 510, 39, 40], ['27,90/', 347, 510, 16, 22], ['-46', 385, 510, 39, 42],
    ['Delicious', 21, 527, 18, 49], ['na vaření 12%', 251, 527, 18, 79], ['• 200 g', 251, 542, 13, 33], ['skládaná', 21, 545, 18, 50],
    ['90', 161, 556, 43, 29], ['90', 392, 556, 43, 29], ['• 100 g = 7,45 Kč', 251, 557, 13, 68], ['• 1 kg', 21, 560, 13, 24],
    ['24', 118, 577, 73, 43], ['14', 354, 577, 73, 38],
    ['produkty, jejichž cena byla nejnižší…', 53, 797, 10, 400],
  ] };
  // hustá strana: cenovka vpravo od názvu (Haribo) aj pod ním (Trolli); bez overenia zľavy sa nič neberie
  const page10 = { n: 10, w: 482, h: 843, items: [
    ['Trolli', 198, 163, 11, 20], ['Želé Tarantula', 198, 174, 11, 54], ['• 175 g', 198, 183, 8, 18], ['• 100 g = 22,80 Kč', 198, 193, 8, 47],
    ['Haribo', 334, 188, 11, 25], ['209,-/', 411, 196, 8, 10], ['-28', 430, 196, 19, 21], ['%', 452, 196, 18, 11],
    ['Želé bonbony', 334, 199, 11, 51], ['• 630 g', 334, 209, 8, 20], ['49,90/', 204, 218, 8, 11], ['%', 246, 218, 18, 11],
    ['• 100 g = 23,80 Kč', 334, 218, 8, 47], ['-20', 223, 219, 19, 21], ['90', 438, 219, 19, 12], ['149', 412, 228, 32, 26],
    ['90', 229, 241, 21, 14], ['39', 206, 252, 37, 23],
    ['Lampion pavouk', 30, 300, 11, 60], ['• 1 ks • 41 cm', 30, 310, 8, 40], ['209,-/', 100, 300, 8, 10], ['-28', 119, 300, 19, 21], ['149', 100, 330, 32, 26], ['90', 126, 322, 19, 12],
    ['Nabídka na této straně platí do 31. 10. 2026', 37, 807, 8, 300],
  ] };
  const offers = offersFromLeaflet([page3, page10], { validFrom: '2026-10-21', validTo: '2026-10-27', slug: '43hm_akcni_letak' });
  const by = Object.fromEntries(offers.map((o) => [o.name, o]));
  assert.deepEqual(Object.keys(by).sort(), ['Haribo Želé bonbony', 'Jablka Golden Delicious skládaná', 'Kunín Smetana na vaření 12%', 'Trolli Želé Tarantula']);
  assert.deepEqual([by['Kunín Smetana na vaření 12%'].price, by['Kunín Smetana na vaření 12%'].regularPrice, by['Kunín Smetana na vaření 12%'].size], [14.9, 27.9, { amount: 200, unit: 'g' }]);
  assert.deepEqual([by['Jablka Golden Delicious skládaná'].price, by['Jablka Golden Delicious skládaná'].regularPrice, by['Jablka Golden Delicious skládaná'].category], [24.9, 39.9, 'ovocie']);
  assert.deepEqual([by['Haribo Želé bonbony'].price, by['Haribo Želé bonbony'].regularPrice, by['Haribo Želé bonbony'].validTo], [149.9, 209, '2026-10-31']);
  assert.deepEqual([by['Trolli Želé Tarantula'].price, by['Trolli Želé Tarantula'].category], [39.9, 'snacky']);
  assert.equal(by['Haribo Želé bonbony'].sourceUrl, 'https://letaky.albert.cz/43hm_akcni_letak/page/10');

  assert.equal(Math.round(expectedPrice('• 200 g • 100 g = 7,45 Kč') * 100) / 100, 14.9);
  assert.equal(Math.round(expectedPrice('• masný polotovar • 300 g • 1 kg = 199,67 Kč') * 100) / 100, 59.9);
  assert.equal(expectedPrice('• 1 ks'), null);
  assert.equal(cleanName('Bonduelle Zlatá kukuřice = 10,23 Kč vybrané druhy*'), 'Bonduelle Zlatá kukuřice');
});

test('Albert: odkaz na PDF letáku zo stránky Publitas, budúci týždeň nie je povinný', async () => {
  const { pdfUrlFromHtml, fetchOffers } = await import('../scraper/chains/albert.js');
  const html = '<script>window.data={"downloadPdfUrl":"https://view.publitas.com/90263/3449342/pdfs/b672.pdf?response-content-disposition=attachment%3B\\u0026x=1"}</script>';
  assert.equal(pdfUrlFromHtml(html), 'https://view.publitas.com/90263/3449342/pdfs/b672.pdf?response-content-disposition=attachment%3B&x=1');
  assert.equal(pdfUrlFromHtml('"downloadPdfUrl":"javascript:alert(1)"'), null);
  assert.deepEqual(await fetchOffers('SK', { text: async () => '', bytes: async () => new Uint8Array() }), []);
});

test('Albert: najnižšia cena za 30 dní a platnosť z titulky', async () => {
  const { lowestFromBullets, leafletDates } = await import('../scraper/chains/albert.js');
  assert.equal(lowestFromBullets('• 1 l • 9,90 Kč'), 9.9);
  assert.equal(lowestFromBullets('• mletá káva • 1 kg • 187 Kč'), 187);
  assert.equal(lowestFromBullets('• 250 g • 100 g = 11,16 Kč'), null);
  assert.equal(lowestFromBullets('• záloha na láhev 3 Kč'), null);
  assert.deepEqual(leafletDates([{ n: 1, w: 1, h: 1, items: [['Od čtvrtka 29. 10. do 3. 11. 2026', 245, 7, 11, 114]] }]), { validFrom: '2026-10-29', validTo: '2026-11-03' });
  assert.deepEqual(leafletDates([{ n: 1, w: 1, h: 1, items: [['Od středy 30. 12. do 5. 1. 2027', 245, 7, 11, 114]] }]), { validFrom: '2026-12-30', validTo: '2027-01-05' });
  assert.equal(leafletDates([{ n: 1, w: 1, h: 1, items: [] }]), null);
});
