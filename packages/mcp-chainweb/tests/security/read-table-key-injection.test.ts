/**
 * @fileoverview Security: read_table key injection guard.
 *
 * The read_table tool composes `(read module.table "<key>")` as Pact source.
 * The key MUST reject `"` and `\\` at the zod layer so an attacker cannot
 * escape the string literal and inject arbitrary Pact code.
 */

import { describe, test, expect } from 'vitest';
import { ReadTableInputSchema } from '../../src/tools/read-table.js';

describe('read_table: key injection guard', () => {
  test('rejects keys containing double-quote', () => {
    const r = ReadTableInputSchema.safeParse({
      chainId: '0',
      module: 'n_abc.demo',
      table: 'accounts',
      key: 'alice") (call-hack) ;;'
    });
    expect(r.success).toBe(false);
  });

  test('rejects keys containing backslash', () => {
    const r = ReadTableInputSchema.safeParse({
      chainId: '0',
      module: 'n_abc.demo',
      table: 'accounts',
      key: 'alice\\x'
    });
    expect(r.success).toBe(false);
  });

  test('accepts normal k: accounts, principals, hex, and dots', () => {
    const cases = [
      'alice',
      'k:368820f80c324bbc7c2b0610688a7da43e39f91d118732671cd9c7500ff43cca',
      'n_560eefcee4a090a24f12d7cf68cd48f11d8d2bd9',
      '1234-abcd.user',
      'a'.repeat(256)
    ];
    for (const key of cases) {
      const r = ReadTableInputSchema.safeParse({
        chainId: '0',
        module: 'n_abc.demo',
        table: 'accounts',
        key
      });
      expect(r.success).toBe(true);
    }
  });

  test('rejects empty key', () => {
    const r = ReadTableInputSchema.safeParse({
      chainId: '0',
      module: 'n_abc.demo',
      table: 'accounts',
      key: ''
    });
    expect(r.success).toBe(false);
  });

  test('rejects key >512 chars', () => {
    const r = ReadTableInputSchema.safeParse({
      chainId: '0',
      module: 'n_abc.demo',
      table: 'accounts',
      key: 'x'.repeat(513)
    });
    expect(r.success).toBe(false);
  });
});
