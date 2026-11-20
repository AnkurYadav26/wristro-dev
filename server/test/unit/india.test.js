import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_STATES, STATES, UNION_TERRITORIES, canonicalState, isValidPincode, parsePincodeResponse, normalizeMobile } from '../../src/utils/india.js';

describe('states and union territories', () => {
  test('28 states + 8 UTs = 36, no duplicates', () => {
    assert.equal(STATES.length, 28);
    assert.equal(UNION_TERRITORIES.length, 8);
    assert.equal(new Set(ALL_STATES).size, 36);
  });
  test('canonicalises common spellings from postal data', () => {
    assert.equal(canonicalState('Orissa'), 'Odisha');
    assert.equal(canonicalState('Jammu & Kashmir'), 'Jammu and Kashmir');
    assert.equal(canonicalState('NCT of Delhi'), 'Delhi');
    assert.equal(canonicalState('Dadra & Nagar Haveli'), 'Dadra and Nagar Haveli and Daman and Diu');
    assert.equal(canonicalState('Daman & Diu'), 'Dadra and Nagar Haveli and Daman and Diu');
    assert.equal(canonicalState('tamil nadu'), 'Tamil Nadu');
    assert.equal(canonicalState('Narnia'), null);
  });
});

describe('pincode', () => {
  test('format', () => {
    for (const ok of ['110001', '560001', '999999']) assert.equal(isValidPincode(ok), true);
    for (const bad of ['011001', '12345', '1234567', '11000a', '', null, undefined]) assert.equal(isValidPincode(bad), false);
  });
  test('parses India Post success response', () => {
    const r = parsePincodeResponse([{ Status: 'Success', PostOffice: [
      { Name: 'Connaught Place', District: 'New Delhi', State: 'Delhi', Block: 'New Delhi' },
      { Name: 'Baroda House', District: 'New Delhi', State: 'Delhi', Block: 'New Delhi' }] }]);
    assert.deepEqual(r, { found: true, state: 'Delhi', district: 'New Delhi', city: 'New Delhi', areas: ['Connaught Place', 'Baroda House'] });
  });
  test('falls back to district when Block is NA; canonicalises state', () => {
    const r = parsePincodeResponse([{ Status: 'Success', PostOffice: [{ Name: 'X', District: 'Puri', State: 'Orissa', Block: 'NA' }] }]);
    assert.equal(r.city, 'Puri');
    assert.equal(r.state, 'Odisha');
  });
  test('handles errors/empty/garbage', () => {
    assert.deepEqual(parsePincodeResponse([{ Status: 'Error', PostOffice: null }]), { found: false });
    assert.deepEqual(parsePincodeResponse([{ Status: '404' }]), { found: false });
    assert.deepEqual(parsePincodeResponse(null), { found: false });
    assert.deepEqual(parsePincodeResponse({}), { found: false });
  });
});

describe('mobile normalisation', () => {
  test('accepts common Indian formats', () => {
    for (const v of ['9876543210', '+91 98765 43210', '919876543210', '09876543210', '98765-43210']) assert.equal(normalizeMobile(v), '9876543210');
  });
  test('rejects invalid', () => {
    for (const v of ['5876543210', '98765432', '98765432101', 'abc', '', null]) assert.equal(normalizeMobile(v), null);
  });
});
