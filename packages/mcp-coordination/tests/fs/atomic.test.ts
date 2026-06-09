/**
 * @fileoverview tests for src/fs/atomic.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  writeJsonAtomic,
  appendJsonl,
  readJsonlAll,
  rewriteJsonl,
  readJsonOrNull
} from '../../src/fs/atomic.js';
import { McpToolError, ErrorCodes } from '@pact-community/mcp-shared';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'atomic-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('writeJsonAtomic', () => {
  it('writes formatted JSON and cleans up temp', async () => {
    const target = path.join(tmp, 'a.json');
    await writeJsonAtomic(target, { a: 1 });
    expect(readFileSync(target, 'utf8')).toContain('"a": 1');
    const stragglers = readdirSync(tmp).filter((f) => f.startsWith('a.json.tmp-'));
    expect(stragglers).toHaveLength(0);
  });

  it('creates parent dirs', async () => {
    const target = path.join(tmp, 'deep', 'nested', 'x.json');
    await writeJsonAtomic(target, { x: true });
    expect(existsSync(target)).toBe(true);
  });

  it('replaces existing file atomically', async () => {
    const target = path.join(tmp, 'b.json');
    await writeJsonAtomic(target, { v: 1 });
    await writeJsonAtomic(target, { v: 2 });
    expect(JSON.parse(readFileSync(target, 'utf8')).v).toBe(2);
  });
});

describe('appendJsonl', () => {
  it('appends records as lines', async () => {
    const target = path.join(tmp, 'a.jsonl');
    await appendJsonl(target, { n: 1 });
    await appendJsonl(target, { n: 2 });
    const lines = readFileSync(target, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).n).toBe(1);
  });
});

describe('readJsonlAll', () => {
  it('returns empty on ENOENT', async () => {
    const r = await readJsonlAll(path.join(tmp, 'missing.jsonl'), (raw) => raw);
    expect(r.records).toEqual([]);
    expect(r.corruptCount).toBe(0);
  });

  it('skips corrupt lines and counts them', async () => {
    const target = path.join(tmp, 'c.jsonl');
    writeFileSync(target, '{"a":1}\nNOT JSON\n{"a":2}\n', 'utf8');
    const r = await readJsonlAll<{ a: number }>(target, (raw) => raw as { a: number });
    expect(r.records).toHaveLength(2);
    expect(r.corruptCount).toBe(1);
  });

  it('rethrows non-ENOENT errors', async () => {
    // Pass a directory path — reading as file yields EISDIR.
    await expect(readJsonlAll(tmp, (r) => r)).rejects.toBeTruthy();
  });
});

describe('rewriteJsonl', () => {
  it('preserves corrupt lines verbatim', async () => {
    const target = path.join(tmp, 'r.jsonl');
    await rewriteJsonl(target, [{ n: 2 }], ['<<< corrupt >>>']);
    const body = readFileSync(target, 'utf8');
    expect(body).toContain('<<< corrupt >>>');
    expect(body).toContain('"n":2');
  });

  it('writes empty output for empty input', async () => {
    const target = path.join(tmp, 'empty.jsonl');
    await rewriteJsonl(target, [], []);
    expect(readFileSync(target, 'utf8')).toBe('');
  });
});

describe('readJsonOrNull', () => {
  it('returns null on ENOENT', async () => {
    const r = await readJsonOrNull(path.join(tmp, 'nope.json'), (raw) => raw);
    expect(r).toBeNull();
  });

  it('parses and passes through schema', async () => {
    const target = path.join(tmp, 'ok.json');
    await fsp.writeFile(target, '{"x":1}');
    const r = await readJsonOrNull<{ x: number }>(target, (raw) => raw as { x: number });
    expect(r).toEqual({ x: 1 });
  });

  it('throws CORRUPT_STATE on malformed JSON', async () => {
    const target = path.join(tmp, 'bad.json');
    await fsp.writeFile(target, '{not json');
    try {
      await readJsonOrNull(target, (raw) => raw);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(McpToolError);
      expect((e as McpToolError).code).toBe(ErrorCodes.CORRUPT_STATE);
    }
  });
});
