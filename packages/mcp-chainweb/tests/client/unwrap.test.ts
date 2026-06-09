/**
 * @fileoverview Exhaustive tests for recursive Pact JSON unwrapping.
 */

import { describe, test, expect } from 'vitest';
import { unwrapPactValue } from '../../src/client/unwrap.js';

describe('unwrapPactValue', () => {
  test('passes through primitives', () => {
    expect(unwrapPactValue('abc')).toBe('abc');
    expect(unwrapPactValue(42)).toBe(42);
    expect(unwrapPactValue(true)).toBe(true);
    expect(unwrapPactValue(false)).toBe(false);
  });

  test('null/undefined both become null (not NaN)', () => {
    expect(unwrapPactValue(null)).toBe(null);
    expect(unwrapPactValue(undefined)).toBe(null);
  });

  test('{int: N} where N is a number returns the number', () => {
    expect(unwrapPactValue({ int: 5 })).toBe(5);
    expect(unwrapPactValue({ int: -17 })).toBe(-17);
    expect(unwrapPactValue({ int: 0 })).toBe(0);
  });

  test('{int: "N"} where N is a numeric string returns the number', () => {
    expect(unwrapPactValue({ int: '12345' })).toBe(12345);
    expect(unwrapPactValue({ int: '-9999' })).toBe(-9999);
  });

  test('{int: "N"} outside safe integer range preserves string', () => {
    const big = '99999999999999999999';
    expect(unwrapPactValue({ int: big })).toBe(big);
  });

  test('{decimal: "N.M"} returns the string form (precision preserved)', () => {
    expect(unwrapPactValue({ decimal: '3.14' })).toBe('3.14');
    expect(unwrapPactValue({ decimal: '0.000000000001' })).toBe(
      '0.000000000001'
    );
  });

  test('{decimal: N} (plain number) returns the number', () => {
    expect(unwrapPactValue({ decimal: 5 })).toBe(5);
    expect(unwrapPactValue({ decimal: 3.14 })).toBe(3.14);
  });

  test('{time: "..."} returns the string', () => {
    expect(unwrapPactValue({ time: '2024-01-01T00:00:00Z' })).toBe(
      '2024-01-01T00:00:00Z'
    );
  });

  test('plain objects are recursed into', () => {
    const input = { foo: { int: 1 }, bar: { decimal: '2.5' } };
    expect(unwrapPactValue(input)).toEqual({ foo: 1, bar: '2.5' });
  });

  test('arrays are recursed element-wise', () => {
    expect(unwrapPactValue([{ int: 1 }, { int: '2' }, 'x'])).toEqual([
      1,
      2,
      'x'
    ]);
  });

  test('nested structures unwrap at every depth', () => {
    const input = {
      account: 'alice',
      balance: { decimal: '100.5' },
      votes: [
        { proposalId: { int: 1 }, amount: { decimal: '10.0' } },
        { proposalId: { int: 2 }, amount: { decimal: '20.0' } }
      ],
      meta: { lastVote: { time: '2024-06-01T00:00:00Z' } }
    };
    expect(unwrapPactValue(input)).toEqual({
      account: 'alice',
      balance: '100.5',
      votes: [
        { proposalId: 1, amount: '10.0' },
        { proposalId: 2, amount: '20.0' }
      ],
      meta: { lastVote: '2024-06-01T00:00:00Z' }
    });
  });

  test('multi-field objects containing an int key are NOT treated as wrappers', () => {
    // Only single-field {int: ...} is a sentinel wrapper.
    expect(
      unwrapPactValue({ int: 5, description: 'a count' })
    ).toEqual({ int: 5, description: 'a count' });
  });

  test('weird inputs are stringified, never thrown', () => {
    expect(unwrapPactValue(new Date(0))).toBe(String(new Date(0)));
  });

  test('{int: ...} non-string non-number is returned as-is string', () => {
    // Defensive: we never throw, caller sees raw.
    const out = unwrapPactValue({ int: null as unknown });
    // null input to unwrapInt returns `null as string` — we just want no throw.
    expect(out).toBeNull();
  });
});
