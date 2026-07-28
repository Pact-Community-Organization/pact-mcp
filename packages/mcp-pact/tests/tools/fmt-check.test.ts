/**
 * @fileoverview Unit tests for pact_fmt_check tool
 */

import { describe, test, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import {
  createFmtCheckTool,
  analyzeFormat
} from '../../src/tools/fmt-check.js';

const fixtures = path.resolve(import.meta.dirname, '../fixtures');
const fmt = createFmtCheckTool({ workspaceRoot: fixtures });

describe('pact_fmt_check', () => {
  test('clean file passes with zero issues', async () => {
    const r = await fmt({ files: ['fmt-clean.pact'] });
    const p = r.content[0]!;
    expect(p.summary.clean).toBe(1);
    expect(p.summary.dirty).toBe(0);
    expect(p.results[0]!.clean).toBe(true);
    expect(p.results[0]!.issues).toEqual([]);
  });

  test('dirty file reports multiple issue kinds', async () => {
    const r = await fmt({ files: ['fmt-dirty.pact'] });
    const p = r.content[0]!;
    expect(p.results[0]!.clean).toBe(false);
    const kinds = new Set(p.results[0]!.issues.map((i) => i.kind));
    expect(kinds.has('trailing-whitespace')).toBe(true);
    expect(kinds.has('tab-character')).toBe(true);
    expect(kinds.has('excess-blank-lines')).toBe(true);
    expect(kinds.has('no-trailing-newline')).toBe(true);
  });

  test('CRLF file reports crlf-line-ending', async () => {
    const r = await fmt({ files: ['fmt-crlf.pact'] });
    const kinds = new Set(r.content[0]!.results[0]!.issues.map((i) => i.kind));
    expect(kinds.has('crlf-line-ending')).toBe(true);
  });

  test('rejects wrong extension', async () => {
    await expect(fmt({ files: ['notes.txt'] })).rejects.toMatchObject({
      code: 'INVALID_FILE_TYPE'
    });
  });

  test('rejects missing files', async () => {
    await expect(fmt({ files: ['does-not-exist.pact'] })).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND'
    });
  });

  test('rejects zero-length array (zod)', async () => {
    await expect(fmt({ files: [] })).rejects.toThrow();
  });

  test('rejects more than 100 files', async () => {
    const files = Array.from({ length: 101 }, () => 'fmt-clean.pact');
    await expect(fmt({ files })).rejects.toThrow();
  });

  test('handles mixed clean + dirty files', async () => {
    const r = await fmt({
      files: ['fmt-clean.pact', 'fmt-dirty.pact']
    });
    const p = r.content[0]!;
    expect(p.summary.total).toBe(2);
    expect(p.summary.clean).toBe(1);
    expect(p.summary.dirty).toBe(1);
  });

  test('accepts .repl extension', async () => {
    const r = await fmt({ files: ['simple.repl'] });
    expect(r.content[0]!.results[0]!.file).toBe('simple.repl');
  });
});

describe('analyzeFormat (pure)', () => {
  test('detects trailing whitespace only on non-blank lines', () => {
    const issues = analyzeFormat('foo   \nbar\n');
    expect(issues.filter((i) => i.kind === 'trailing-whitespace').length).toBe(1);
  });

  test('detects tab characters', () => {
    const issues = analyzeFormat('a\tb\n');
    expect(issues.some((i) => i.kind === 'tab-character')).toBe(true);
  });

  test('does not flag single blank lines', () => {
    const issues = analyzeFormat('a\n\nb\n');
    expect(issues.some((i) => i.kind === 'excess-blank-lines')).toBe(false);
  });

  test('flags >=2 consecutive blank lines once per run', () => {
    const issues = analyzeFormat('a\n\n\nb\n');
    const excess = issues.filter((i) => i.kind === 'excess-blank-lines');
    expect(excess.length).toBe(1);
  });

  test('reports missing trailing newline', () => {
    const issues = analyzeFormat('abc');
    expect(issues.some((i) => i.kind === 'no-trailing-newline')).toBe(true);
  });

  test('empty content has no issues', () => {
    expect(analyzeFormat('')).toEqual([]);
  });

  test('lone LF-terminated file reports no issues for the trailing blank', () => {
    expect(analyzeFormat('a\n')).toEqual([]);
  });
});

describe('fmt_check does not write', () => {
  test('fs.writeFileSync is never called during fmt_check', async () => {
    // spy on fs.writeFileSync at the package level
    const realWrite = fs.writeFileSync;
    let calls = 0;
    (fs as unknown as { writeFileSync: unknown }).writeFileSync = (
      ...args: unknown[]
    ) => {
      calls++;
      return realWrite.apply(fs, args as Parameters<typeof fs.writeFileSync>);
    };
    try {
      await fmt({ files: ['fmt-dirty.pact', 'fmt-clean.pact'] });
    } finally {
      (fs as unknown as { writeFileSync: typeof realWrite }).writeFileSync =
        realWrite;
    }
    expect(calls).toBe(0);
  });
});
