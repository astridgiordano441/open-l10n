import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  coerceValue,
  sanitizeAttribute,
  sanitizeAttributes,
  scalarTypeOf,
  SCALAR_TYPES,
} from '../src/index.js';

test('scalarTypeOf identifies the four supported scalar types', () => {
  assert.equal(scalarTypeOf('hello'), 'string');
  assert.equal(scalarTypeOf(true), 'boolean');
  assert.equal(scalarTypeOf(false), 'boolean');
  assert.equal(scalarTypeOf(42), 'int');
  assert.equal(scalarTypeOf(3.14), 'double');
  assert.equal(scalarTypeOf(0), 'int');
  assert.equal(scalarTypeOf(-0), 'int'); // -0 is integer-valued
  assert.equal(scalarTypeOf(NaN), null);
  assert.equal(scalarTypeOf(Infinity), null);
  assert.equal(scalarTypeOf(-Infinity), null);
  assert.equal(scalarTypeOf(null), null);
  assert.equal(scalarTypeOf(undefined), null);
  assert.equal(scalarTypeOf({}), null);
  assert.equal(scalarTypeOf([]), null);
});

test('coerceValue passes through already-valid scalars', () => {
  assert.equal(coerceValue('x'), 'x');
  assert.equal(coerceValue(true), true);
  assert.equal(coerceValue(7), 7);
  assert.equal(coerceValue(1.5), 1.5);
  assert.deepEqual(coerceValue([1, 2, 3]), [1, 2, 3]);
  assert.deepEqual(coerceValue(['a', 'b']), ['a', 'b']);
});

test('coerceValue coerces string booleans', () => {
  assert.equal(coerceValue('true'), true);
  assert.equal(coerceValue('TRUE'), true);
  assert.equal(coerceValue('false'), false);
  assert.equal(coerceValue('False'), false);
});

test('coerceValue coerces numeric strings to int when whole', () => {
  assert.equal(coerceValue('42'), 42);
  assert.equal(coerceValue('-7'), -7);
  assert.equal(coerceValue('+3'), 3);
  assert.equal(scalarTypeOf(coerceValue('42')), 'int');
});

test('coerceValue coerces floating-point strings to double', () => {
  assert.equal(coerceValue('3.14'), 3.14);
  assert.equal(coerceValue('1e3'), 1000);
  assert.equal(scalarTypeOf(coerceValue('1e3')), 'int'); // 1e3 is whole
  assert.equal(scalarTypeOf(coerceValue('1.5e1')), 'int'); // 1.5e1 = 15, whole
});

test('coerceValue rejects non-finite numeric strings', () => {
  assert.equal(coerceValue('NaN'), 'NaN'); // not a recognized numeric literal
  assert.equal(coerceValue('Infinity'), 'Infinity');
  assert.equal(scalarTypeOf(coerceValue('NaN')), 'string');
  assert.equal(scalarTypeOf(coerceValue('Infinity')), 'string');
});

test('coerceValue accepts BigInt within safe integer range', () => {
  assert.equal(coerceValue(0n), 0);
  assert.equal(coerceValue(42n), 42);
  assert.equal(scalarTypeOf(coerceValue(42n)), 'int');
});

test('coerceValue rejects BigInt outside safe integer range', () => {
  assert.equal(coerceValue(BigInt(Number.MAX_SAFE_INTEGER) + 2n), null);
  assert.equal(coerceValue(BigInt(Number.MIN_SAFE_INTEGER) - 2n), null);
});

test('coerceValue rejects plain objects and functions', () => {
  assert.equal(coerceValue({ a: 1 }), null);
  assert.equal(coerceValue(() => {}), null);
  assert.equal(coerceValue(Symbol('x')), null);
});

test('coerceValue rejects mixed-type arrays entirely', () => {
  assert.equal(coerceValue([1, 'two']), null);
  assert.equal(coerceValue([true, false, 1]), null);
  assert.equal(coerceValue(['a', 1, null]), null);
});

test('coerceValue rejects arrays containing non-coercible elements', () => {
  assert.equal(coerceValue([1, 2, {}]), null);
  assert.equal(coerceValue([1, Symbol('x')]), null);
});

test('coerceValue keeps empty arrays as empty arrays', () => {
  assert.deepEqual(coerceValue([]), []);
});

test('coerceValue coerces homogeneous string-numeric arrays to int arrays', () => {
  const result = coerceValue(['1', '2', '3']);
  assert.deepEqual(result, [1, 2, 3]);
  for (const v of result) assert.equal(scalarTypeOf(v), 'int');
});

test('coerceValue rejects arrays mixing int and double literals after coercion', () => {
  // '1' -> int 1, '2.5' -> double 2.5; different scalar types -> reject.
  assert.equal(coerceValue(['1', '2.5']), null);
});

test('sanitizeAttribute accepts a valid key and value', () => {
  assert.deepEqual(sanitizeAttribute('http.method', 'GET'), ['http.method', 'GET']);
  assert.deepEqual(sanitizeAttribute('user.id', 42), ['user.id', 42]);
  assert.deepEqual(sanitizeAttribute('ok', true), ['ok', true]);
});

test('sanitizeAttribute rejects malformed keys', () => {
  assert.equal(sanitizeAttribute('', 'x'), null);
  assert.equal(sanitizeAttribute('1abc', 'x'), null); // leading digit
  assert.equal(sanitizeAttribute('bad key', 'x'), null); // space
  assert.equal(sanitizeAttribute('bad/key', 'x'), null); // slash
  assert.equal(sanitizeAttribute(123, 'x'), null); // non-string key
  assert.equal(sanitizeAttribute(null, 'x'), null);
});

test('sanitizeAttribute drops null and undefined values', () => {
  assert.equal(sanitizeAttribute('k', null), null);
  assert.equal(sanitizeAttribute('k', undefined), null);
});

test('sanitizeAttributes filters an object to valid pairs only', () => {
  const out = sanitizeAttributes({
    'http.method': 'GET',
    'http.status_code': 200,
    '1bad': 'dropped',
    'good.empty': [],
    'bad.value': { not: 'allowed' },
    'bad.array': [1, 'mixed'],
    'good.bool': 'true',
  });
  assert.deepEqual(out, {
    'http.method': 'GET',
    'http.status_code': 200,
    'good.empty': [],
    'good.bool': true,
  });
});

test('sanitizeAttributes returns empty object for non-object input', () => {
  assert.deepEqual(sanitizeAttributes(null), {});
  assert.deepEqual(sanitizeAttributes('string'), {});
  assert.deepEqual(sanitizeAttributes(undefined), {});
  assert.deepEqual(sanitizeAttributes(42), {});
});

test('sanitizeAttributes preserves insertion order of valid keys', () => {
  const input = {
    z: 1,
    a: 2,
    m: 3,
    '1bad': 'drop',
    b: 4,
  };
  const out = sanitizeAttributes(input);
  assert.deepEqual(Object.keys(out), ['z', 'a', 'm', 'b']);
});

test('SCALAR_TYPES is a frozen array with the four type names', () => {
  assert.equal(Object.isFrozen(SCALAR_TYPES), true);
  assert.deepEqual([...SCALAR_TYPES], ['string', 'int', 'double', 'boolean']);
});

test('coerceValue treats empty string as a valid string scalar, not false', () => {
  assert.equal(coerceValue(''), '');
  assert.equal(scalarTypeOf(coerceValue('')), 'string');
});

test('coerceValue rejects NaN and Infinity numbers directly', () => {
  assert.equal(coerceValue(NaN), null);
  assert.equal(coerceValue(Infinity), null);
  assert.equal(coerceValue(-Infinity), null);
});

test('coerceValue coerces string "0" to integer zero', () => {
  const r = coerceValue('0');
  assert.equal(r, 0);
  assert.equal(scalarTypeOf(r), 'int');
});

test('coerceValue rejects oversized integer strings', () => {
  // Beyond safe integer range -> reject rather than round.
  assert.equal(coerceValue('9007199254740993'), null); // MAX_SAFE_INTEGER + 2
});
