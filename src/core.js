/**
 * Coerce a single value into an OpenTelemetry-compatible attribute value, or
 * return `null` when the value is not coercible.
 *
 * OpenTelemetry attribute values are constrained to a small set of scalar and
 * homogeneous-array types. This module performs best-effort coercion so that
 * callers can hand in loosely-typed values (e.g. a string "true" for a boolean
 * flag) without having to sanitize every callsite. Coercion never throws:
 * invalid values become `null`, which the caller can drop or replace.
 *
 * The supported scalar types after coercion are:
 *   - string
 *   - boolean
 *   - number (finite only; NaN and ±Infinity are rejected because they
 *     cannot survive JSON serialization in the OTLP export path)
 *   - Integer (stored as a number; enforced to be a whole number)
 *
 * Arrays must be homogeneous: after coercion every element must share the
 * same scalar type. Mixed-type arrays are rejected as a whole rather than
 * silently dropping individual elements, because partial data loss in a
 * telemetry span is usually worse than missing the attribute entirely.
 */

const TYPE_STRING = 'string';
const TYPE_INT = 'int';
const TYPE_DOUBLE = 'double';
const TYPE_BOOLEAN = 'boolean';

/**
 * Ordered list of scalar type names. Order matters only for documentation
 * purposes; coercion is driven by explicit branches rather than this array.
 */
export const SCALAR_TYPES = Object.freeze([TYPE_STRING, TYPE_INT, TYPE_DOUBLE, TYPE_BOOLEAN]);

/**
 * Determine the canonical OpenTelemetry scalar type name for a value, or
 * `null` if the value is not directly a scalar. This performs no coercion:
 * a string "123" is TYPE_STRING, not TYPE_INT. Callers that want coercion
 * should use `coerceValue` instead.
 *
 * Numbers are split into TYPE_INT and TYPE_DOUBLE because the OTLP wire format
 * distinguishes them, and some backends reject doubles stored in int fields.
 */
export function scalarTypeOf(value) {
  if (typeof value === 'string') return TYPE_STRING;
  if (typeof value === 'boolean') return TYPE_BOOLEAN;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Number.isInteger(value) ? TYPE_INT : TYPE_DOUBLE;
  }
  return null;
}

/**
 * Coerce a scalar value to one of the supported scalar types, or return
 * `null` if it is not coercible. BigInt is accepted for integer conversion
 * because OpenTelemetry's semantic conventions frequently describe 64-bit
 * integer fields and JSON cannot natively represent int64; accepting BigInt
 * and converting it to a number (where safe) is the pragmatic choice. Values
 * exceeding Number.MAX_SAFE_INTEGER are rejected rather than silently rounded.
 */
function coerceScalar(value) {
  if (value === null || value === undefined) return null;

  const direct = scalarTypeOf(value);
  if (direct !== null && direct !== TYPE_STRING) return value;

  if (typeof value === 'bigint') {
    if (value > Number.MAX_SAFE_INTEGER || value < Number.MIN_SAFE_INTEGER) return null;
    return Number(value);
  }

  // Strings may carry a boolean or numeric literal. We deliberately avoid
  // accepting "" as a boolean false; empty string is a legitimate string
  // attribute value and reinterpreting it would surprise callers.
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;

    // Try integer first so "5" becomes int, not double.
    if (/^[+-]?\d+$/.test(value)) {
      const n = Number(value);
      if (Number.isSafeInteger(n)) return n;
      return null;
    }
    // Floating-point literals (including scientific notation and a leading
    // sign). NaN/Infinity spelled out as "NaN"/"Infinity" are intentionally
    // rejected by the Number.isFinite check below.
    if (/^[+-]?(\d+\.\d*|\.\d+|\d+)(e[+-]?\d+)?$/i.test(value)) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    // Not a recognized literal — treat the raw string as a string attribute.
    return value;
  }

  return null;
}

/**
 * Coerce a value (scalar or array) into an OpenTelemetry-compatible attribute
 * value. Returns `null` for values that cannot be represented. Arrays must
 * become homogeneous after coercion; a single incompatible element rejects
 * the whole array.
 */
export function coerceValue(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    const coerced = [];
    let elementType = null;
    for (const item of value) {
      const c = coerceScalar(item);
      if (c === null) return null;
      const t = scalarTypeOf(c);
      if (elementType === null) {
        elementType = t;
      } else if (t !== elementType) {
        return null;
      }
      coerced.push(c);
    }
    return coerced;
  }
  return coerceScalar(value);
}

/**
 * Validate a single key-value attribute pair and return a sanitized
 * `[key, value]` pair, or `null` if the pair must be dropped.
 *
 * Keys must be non-empty strings matching the OpenTelemetry key grammar:
 * letters, digits, '.', '_', '-' allowed, and the first character must not be
 * a digit. This is stricter than "any non-empty string" but matches what
 * real OTLP collectors accept; sending malformed keys typically causes the
 * entire attribute map to be rejected.
 */
export function sanitizeAttribute(key, value) {
  if (typeof key !== 'string' || key.length === 0) return null;
  if (!/^[a-zA-Z_][a-zA-Z0-9._-]*$/.test(key)) return null;

  const coerced = coerceValue(value);
  if (coerced === null) return null;

  // Empty arrays are valid OTel values (a homogeneous empty array of any
  // scalar type). We keep them rather than dropping.
  return [key, coerced];
}

/**
 * Sanitize a map of attributes. Returns a new object containing only the
 * key-value pairs that passed validation, in insertion order. If `input` is
 * not an object, returns an empty object rather than throwing; telemetry
 * sanitization must never be the reason a program crashes.
 */
export function sanitizeAttributes(input) {
  const out = {};
  if (input === null || typeof input !== 'object') return out;
  for (const [key, value] of Object.entries(input)) {
    const pair = sanitizeAttribute(key, value);
    if (pair !== null) {
      out[pair[0]] = pair[1];
    }
  }
  return out;
}
