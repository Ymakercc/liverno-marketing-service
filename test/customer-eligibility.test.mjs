import assert from 'node:assert/strict';
import test from 'node:test';
import { isMarketableCustomerState } from '../src/lib/customer-eligibility.mjs';

test('all customer states without an explicit block are eligible for research', () => {
  assert.equal(isMarketableCustomerState(''), true);
  assert.equal(isMarketableCustomerState('1'), true);
  assert.equal(isMarketableCustomerState(2), true);
  assert.equal(isMarketableCustomerState('4'), true);
});

test('converted, closed, and rejected customer states are excluded before research', () => {
  assert.equal(isMarketableCustomerState('3'), false);
  assert.equal(isMarketableCustomerState('5'), false);
  assert.equal(isMarketableCustomerState('6'), false);
});
