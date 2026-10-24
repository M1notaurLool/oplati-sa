import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeImage } from '../scraper/lib/normalize.js';
import { invalidReason } from '../scraper/lib/validate.js';
import { billaProductToOffer } from '../scraper/chains/billa.js';
import { gridItemToOffer } from '../scraper/chains/lidl.js';
import { tescoProductToOffer } from '../scraper/chains/tesco.js';

const BILLA_IMG = 'https://images.cdn.europe-west1.gcp.commercetools.com/bfd52ff5-9443-4b5e-85a4-cf3626446b7b/53-170829-0878247899-oK0WgzXk.png';
const LIDL_IMG = 'https://www.lidl.sk/assets/gcp081b47b516974e2e85865559cf2a5dff.png';
const TESCO_IMG = 'https://digitalcontent.api.tesco.com/v2/media/ghs/3316b6b9-a55e-42d4-8feb-bc5755ccfa07/1ffcd576-d011-4826-9590-fd4f9b5e8c80_1891079937.jpeg?h=225&w=225';

test('safeImage: len bezpečné https adresy', () => {
  assert.equal(safeImage(BILLA_IMG), BILLA_IMG);
  assert.equal(safeImage(TESCO_IMG), TESCO_IMG, 'parametre veľkosti ostanú');
  assert.equal(safeImage(`  ${LIDL_IMG} `), LIDL_IMG);
  assert.equal(safeImage('javascript:alert(1)'), null);
  assert.equal(safeImage('http://www.lidl.sk/a.png'), null);
  assert.equal(safeImage('//www.lidl.sk/a.png'), null);
  assert.equal(safeImage('https://evil.sk/a.png" onerror="alert(1)'), null);
  assert.equal(safeImage('https://a.sk/x y.png'), null);
  assert.equal(safeImage(`https://a.sk/${'x'.repeat(500)}.png`), null);
  assert.equal(safeImage(null), null);
  assert.equal(safeImage(['https://a.sk/a.png']), null);
});

test('Billa: obrázok z images[0], bez obrázka null', () => {
  const product = {
    name: 'Rama 400 g', sku: '82-1', slug: 'rama-400g-821', amount: '400', volumeLabelShort: 'g',
    parentCategories: [[{ name: 'Chlazené, mléčné a rostlinné výrobky' }, { name: 'Máslo, margaríny a pomazánkové' }]],
    price: { regular: { value: 4990 }, crossed: 7990 },
    images: [BILLA_IMG, 'https://images.cdn.europe-west1.gcp.commercetools.com/druhy.png'],
  };
  const ctx = { country: /** @type {const} */ ('CZ'), validFrom: '2026-10-21', validTo: '2026-10-27', host: 'https://www.billa.cz' };
  assert.equal(billaProductToOffer(product, ctx).image, BILLA_IMG);
  assert.equal(billaProductToOffer({ ...product, images: [] }, ctx).image, null);
  assert.equal(billaProductToOffer({ ...product, images: undefined }, ctx).image, null);
  assert.equal(billaProductToOffer({ ...product, images: ['javascript:alert(1)'] }, ctx).image, null);
});

test('Lidl: obrázok z gridbox.data.image', () => {
  const item = {
    productId: 1, fullTitle: 'Maslo 82 %', image: LIDL_IMG, canonicalUrl: '/p/maslo/p1',
    storeStartDate: Date.parse('2026-10-22T00:00:00+02:00'), storeEndDate: Date.parse('2026-10-25T23:59:00+02:00'),
    price: { price: 1.29, oldPrice: 2.19, packaging: { text: '250 g' } },
  };
  const o = gridItemToOffer(item, { country: 'SK', host: 'https://www.lidl.sk' });
  assert.equal(o.image, LIDL_IMG);
  assert.equal(gridItemToOffer({ ...item, image: 'http://www.lidl.sk/x.png' }, { country: 'SK', host: 'https://www.lidl.sk' }).image, null);
});

test('Tesco: obrázok z defaultImageUrl', () => {
  const p = {
    id: '213968665', isForSale: true, title: 'Uhorka šalátová ks', brandName: 'TESCO', superDepartmentName: 'Ovocie, zelenina', departmentName: 'Zelenina',
    displayType: 'Quantity', price: { actual: 0.55, unitPrice: 0.55, unitOfMeasure: 'kus' }, defaultImageUrl: TESCO_IMG,
    promotions: [{ id: 'a', startDate: '2026-10-20T22:00:00Z', endDate: '2026-10-27T23:00:00Z', description: '-38%, predtým 0,89 €', price: { beforeDiscount: 0.89, afterDiscount: 0.55 }, attributes: [] }],
  };
  assert.equal(tescoProductToOffer(p, '2026-10-24').image, TESCO_IMG);
  assert.equal(tescoProductToOffer({ ...p, defaultImageUrl: null }, '2026-10-24').image, null);
});

test('validate: image len https do 500 znakov', () => {
  const base = { id: 'sk-lidl-1', country: 'SK', chain: 'lidl', name: 'Maslo', category: 'mliecne', price: 1.29, regularPrice: 2.19, validFrom: '2026-10-22', validTo: '2026-10-25' };
  assert.equal(invalidReason(base), null, 'bez obrázka je v poriadku');
  assert.equal(invalidReason({ ...base, image: null }), null);
  assert.equal(invalidReason({ ...base, image: LIDL_IMG }), null);
  assert.equal(invalidReason({ ...base, image: 'javascript:alert(1)' }), 'image');
  assert.equal(invalidReason({ ...base, image: 'http://www.lidl.sk/a.png' }), 'image');
  assert.equal(invalidReason({ ...base, image: `https://a.sk/${'x'.repeat(500)}` }), 'image');
  assert.equal(invalidReason({ ...base, image: 'https://a.sk/a.png"><script>' }), 'image');
  assert.equal(invalidReason({ ...base, image: 42 }), 'image');
});
