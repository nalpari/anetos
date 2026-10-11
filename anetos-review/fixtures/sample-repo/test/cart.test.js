const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tipFor } = require('../src/cart');

test('tipFor: 십분율로 팁을 계산한다', () => {
  assert.equal(tipFor(100, 1), 10);
  assert.equal(tipFor(250, 2), 50);
});
