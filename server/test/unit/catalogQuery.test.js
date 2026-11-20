import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProductFilter, buildSort, SORTS } from '../../src/utils/catalogQuery.js';

test('always restricts to active, non-archived products', () => {
  assert.deepEqual(buildProductFilter({}), { isActive: true, isArchived: false });
});
test('brand filter is case-insensitive, exact, and regex-escaped', () => {
  const f = buildProductFilter({ brand: 'boAt, Fire-Boltt, a.b(c' });
  assert.equal(f.brand.$in.length, 3);
  assert.ok(f.brand.$in[0].test('BOAT'));
  assert.equal(f.brand.$in[0].test('boat extra'), false);
  assert.equal(f.brand.$in[2].test('aXb(c'), false); // "." is literal, not a wildcard
  assert.ok(f.brand.$in[2].test('a.b(c'));
});
test('price range and rating map onto stored selling price', () => {
  const f = buildProductFilter({ minPrice: 50000, maxPrice: 200000, minRating: 4 });
  assert.deepEqual(f.sellingPricePaise, { $gte: 50000, $lte: 200000 });
  assert.deepEqual(f.ratingAverage, { $gte: 4 });
});
test('inStock uses on-hand minus reserved', () => {
  assert.ok(buildProductFilter({ inStock: true }).$expr);
});
test('sorting falls back sensibly', () => {
  assert.equal(buildSort('relevance', false), SORTS.newest);
  assert.equal(buildSort('relevance', true), SORTS.relevance);
  assert.equal(buildSort('price_asc', false), SORTS.price_asc);
  assert.equal(buildSort('nonsense', false), SORTS.newest);
});
