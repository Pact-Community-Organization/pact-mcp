/**
 * @fileoverview Recursive Pact JSON-boundary type unwrapping.
 *
 * Chainweb Pact API returns PactValue-encoded JSON. Without explicit
 * unwrapping, these objects leak into consumer logic as
 *   `{"int": 5}`   instead of  `5`
 *   `{"decimal": "3.14"}` instead of `"3.14"`  (we keep as string for precision)
 *   `{"time": "..."}`    instead of `"..."`   (ISO string)
 * causing the `{int:N} === N` false-negative pattern documented in
 * CARRY-FORWARD-FINDINGS and user memory.
 *
 * Rules:
 *  - `{int: N}` where N is a number OR numeric string → number (bigint-safe
 *    up to 2^53-1; larger values are returned as string to preserve precision)
 *  - `{decimal: "N.M"}` → string (preserve precision)
 *  - `{decimal: N}`  → N (Pact sometimes emits whole decimals as plain numbers
 *    — pass through; no reason to coerce)
 *  - `{time: "..."}` → string
 *  - `null`/`undefined` → preserved verbatim (do NOT coerce nonexistent
 *    fields to NaN — silent false-positive source)
 *  - Arrays: unwrap each element.
 *  - Objects with ONLY a single recognized sentinel key are unwrapped;
 *    regular multi-field objects are recursed into.
 */

export type PactValue =
  | null
  | string
  | number
  | boolean
  | PactValue[]
  | { [k: string]: PactValue };

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const MIN_SAFE = Number.MIN_SAFE_INTEGER;

function unwrapInt(raw: unknown): number | string {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return String(raw);
    return raw;
  }
  if (typeof raw === 'string') {
    // Preserve precision: if outside safe integer range, keep string.
    if (!/^-?\d+$/.test(raw)) return raw;
    const n = Number(raw);
    if (n > MAX_SAFE || n < MIN_SAFE) return raw;
    return n;
  }
  // Unexpected shape — return as-is so the caller can see raw value.
  return raw as string;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return (
    typeof x === 'object' &&
    x !== null &&
    !Array.isArray(x) &&
    Object.getPrototypeOf(x) === Object.prototype
  );
}

/**
 * Recursively unwrap a Pact JSON value tree.
 *
 * Never throws. Always returns a fully plain JS value (no sentinel wrappers
 * remain at any depth).
 */
export function unwrapPactValue(input: unknown): PactValue {
  if (input === null || input === undefined) return null;
  if (typeof input === 'string') return input;
  if (typeof input === 'number' || typeof input === 'boolean') return input;

  if (Array.isArray(input)) {
    return input.map(unwrapPactValue);
  }

  if (!isPlainObject(input)) {
    // Functions, Dates, etc. should not appear in parsed JSON. Coerce to string.
    return String(input);
  }

  const keys = Object.keys(input);
  if (keys.length === 1) {
    const k = keys[0]!;
    const v = input[k];
    if (k === 'int') return unwrapInt(v);
    if (k === 'decimal') {
      // Preserve precision: decimals are returned as their string form when
      // Pact encoded them that way; if Pact gave us a plain number, pass it.
      if (typeof v === 'string') return v;
      if (typeof v === 'number') return v;
      return String(v);
    }
    if (k === 'time' || k === 'timep') {
      return typeof v === 'string' ? v : String(v);
    }
  }

  const out: Record<string, PactValue> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = unwrapPactValue(v);
  }
  return out;
}
