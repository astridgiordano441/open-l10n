# OpenTelemetry Attribute Sanitizer

A small, zero-dependency TypeScript-free JavaScript (ESM) library that validates and coerces key-value attribute pairs against OpenTelemetry's semantic type constraints before export.

```js
import { sanitizeAttributes, sanitizeAttribute, coerceValue, scalarTypeOf, SCALAR_TYPES } from './src/index.js';

// Sanitize a whole attribute map in one call:
const clean = sanitizeAttributes({
  'http.method': 'GET',
  'http.status_code': '200',   // coerced to int 200
  'http.url': null,            // dropped
  'bad key': 'x',              // dropped (invalid key)
  'user.tags': [1, 'two'],     // dropped (mixed-type array)
});
// -> { 'http.method': 'GET', 'http.status_code': 200 }

// Or sanitize one pair at a time:
const pair = sanitizeAttribute('retry.count', '3');
// -> ['retry.count', 3]
```

## Why this exists

OpenTelemetry attribute values are constrained to a small set of scalar types (string, boolean, int, double) and homogeneous arrays of those types. In practice, applications hand instrumentation loosely-typed values: strings that should be numbers, booleans spelled out, `null` where a field was unset, or arrays that accidentally mix element types. Sending these raw causes either silent rejection by the collector or, worse, a partial attribute map that misleads downstream queries.

This library performs deterministic, side-effect-free coercion so that instrumentation code can stay loose while the export path stays strict. It never throws — invalid values become `null` and are dropped, because sanitization must never be the reason a program crashes.

The trade-off is that coercion is opinionated. Strings are parsed for numeric and boolean literals; the string `"true"` becomes the boolean `true`, and `"42"` becomes the integer `42`. If you need to preserve the original string type of a numeric-looking value, do not route it through `coerceValue` — pass it as an already-typed value or skip sanitization for that key.

## Exported names

- `sanitizeAttributes(input)` — returns a new object containing only valid key-value pairs.
- `sanitizeAttribute(key, value)` — returns a `[key, value]` pair or `null`.
- `coerceValue(value)` — returns a coerced scalar/array value or `null`.
- `scalarTypeOf(value)` — returns the canonical OTel scalar type name (`'string' | 'int' | 'double' | 'boolean'`) or `null`.
- `SCALAR_TYPES` — frozen array `['string', 'int', 'double', 'boolean']`.

## Edge cases you will hit

- **Non-finite numbers** (`NaN`, `Infinity`, `-Infinity`) are rejected because they cannot survive JSON serialization in the OTLP export path.
- **BigInt** is accepted only within `Number.MIN_SAFE_INTEGER`..`Number.MAX_SAFE_INTEGER`; larger values are dropped rather than silently rounded.
- **Mixed-type arrays** are rejected entirely. The library does not drop individual elements, because partial data loss in a telemetry span is usually worse than a missing attribute.
- **Empty arrays** are kept as empty arrays (a valid OTel value) rather than dropped.
- **Empty strings** are treated as the string `""`, not as boolean `false`.
- **Numeric strings beyond the safe integer range** are rejected, not rounded.

## Tests

```
node --test
```
