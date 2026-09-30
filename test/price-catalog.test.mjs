import assert from 'node:assert/strict';
import test from 'node:test';
import { convertPriceForEmail, parsePriceCatalog, selectPricedModels } from '../src/lib/price-catalog.mjs';

test('price catalog applies the legacy cost markup before marketing markup', () => {
  const catalog = parsePriceCatalog([
    '# Kulon 最新报价',
    '- 数据生成日期：2026-08-29',
    '- 型号 LRS-100-24 的最新报价是 100，报价日期为 2026-06-30。',
    '- 型号 HDR-60-24 的最新报价是 100，报价日期为 2026-07-01。',
  ].join('\n'));

  assert.equal(catalog.entries.length, 2);
  const legacy = catalog.entries.find((entry) => entry.model === 'LRS-100-24');
  const current = catalog.entries.find((entry) => entry.model === 'HDR-60-24');
  assert.equal(legacy.costPrice, 105);
  assert.equal(legacy.marketingPrice, 110.25);
  assert.equal(current.costPrice, 100);
  assert.equal(current.marketingPrice, 105);
});

test('priced model selection returns no internal cost fields and caps the email list at eight', () => {
  const lines = ['# Kulon 最新报价'];
  for (let index = 1; index <= 6; index += 1) {
    lines.push(`- 型号 LRS-${index * 100}-24 的最新报价是 ${index * 10}，报价日期为 2026-07-01。`);
    lines.push(`- 型号 HDR-${index * 10}-24 的最新报价是 ${index * 11}，报价日期为 2026-07-01。`);
  }
  const catalog = parsePriceCatalog(lines.join('\n'));
  const products = selectPricedModels({
    catalog,
    recommendedProducts: [
      { name: 'enclosed industrial power supply', reason: 'industrial controls' },
      { name: 'DIN rail power supply', reason: 'control cabinets' },
    ],
    limit: 8,
  });

  assert.equal(products.length, 8);
  assert.ok(products.every((product) => product.availability === 'In Stock'));
  assert.ok(products.every((product) => !('sourcePrice' in product) && !('costPrice' in product)));
  assert.ok(products.every((product) => product.currency === 'USD'));
});

test('email prices convert CNY marketing prices to USD', () => {
  assert.deepEqual(
    convertPriceForEmail({ price: 110.25, currency: 'CNY', emailCurrency: 'USD', cnyPerUsd: 7.2 }),
    { price: 15.31, currency: 'USD' },
  );
});
