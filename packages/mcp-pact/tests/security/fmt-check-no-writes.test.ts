/**
 * @fileoverview Security — fmt_check is read-only. Verify NO write-class fs
 *               operations occur during a check, even on dirty files.
 */

import { describe, test, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { createFmtCheckTool } from '../../src/tools/fmt-check.js';

const fixtures = path.resolve(import.meta.dirname, '../fixtures');
const fmt = createFmtCheckTool({ workspaceRoot: fixtures });

const WRITE_APIS = [
  'writeFileSync',
  'appendFileSync',
  'truncateSync',
  'rmSync',
  'unlinkSync',
  'mkdirSync',
  'renameSync',
  'copyFileSync',
  'chmodSync',
  'chownSync',
  'symlinkSync',
  'linkSync'
] as const;

describe('fmt_check write-abstinence', () => {
  test('no fs write API is invoked during fmt_check on mixed files', async () => {
    const calls: string[] = [];
    const originals: Record<string, unknown> = {};
    const fsAny = fs as unknown as Record<string, unknown>;

    for (const name of WRITE_APIS) {
      originals[name] = fsAny[name];
      fsAny[name] = (...args: unknown[]) => {
        calls.push(name);
        return (originals[name] as (...a: unknown[]) => unknown).apply(fs, args);
      };
    }

    try {
      await fmt({ files: ['fmt-clean.pact', 'fmt-dirty.pact', 'fmt-crlf.pact'] });
    } finally {
      for (const name of WRITE_APIS) {
        fsAny[name] = originals[name];
      }
    }

    expect(calls).toEqual([]);
  });
});
