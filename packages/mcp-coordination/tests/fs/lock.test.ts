/**
 * @fileoverview tests for src/fs/lock.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireLock, withLock } from '../../src/fs/lock.js';
import { McpToolError, ErrorCodes } from '@pact-community/mcp-shared';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'lock-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('acquireLock', () => {
  it('acquires and releases', async () => {
    const target = path.join(tmp, 'a');
    const release = await acquireLock(target);
    expect(existsSync(`${target}.lock`)).toBe(true);
    await release();
    expect(existsSync(`${target}.lock`)).toBe(false);
  });

  it('blocks a concurrent writer with LOCK_HELD', async () => {
    const target = path.join(tmp, 'b');
    const release = await acquireLock(target);
    try {
      await acquireLock(target);
      throw new Error('should not acquire');
    } catch (e) {
      expect(e).toBeInstanceOf(McpToolError);
      expect((e as McpToolError).code).toBe(ErrorCodes.LOCK_HELD);
    } finally {
      await release();
    }
  });

  it('steals a stale lock (>30s old)', async () => {
    const target = path.join(tmp, 'c');
    const lockPath = `${target}.lock`;
    const oldPayload = JSON.stringify({
      pid: 1,
      hostname: 'stale',
      acquiredAtMs: Date.now() - 60_000
    });
    writeFileSync(lockPath, oldPayload);
    const release = await acquireLock(target);
    await release();
  });

  it('steals a malformed lock file only once its mtime is stale', async () => {
    const target = path.join(tmp, 'd');
    const lockPath = `${target}.lock`;
    // A malformed payload must NOT be treated as acquiredAtMs=0 (that would
    // let contenders steal a live lock mid-write). Staleness falls back to
    // the file mtime, so backdate it past LOCK_STALE_MS.
    writeFileSync(lockPath, 'not json');
    const past = (Date.now() - 60_000) / 1000;
    utimesSync(lockPath, past, past);
    const release = await acquireLock(target);
    await release();
  });
});

describe('withLock', () => {
  it('runs callback and releases', async () => {
    const target = path.join(tmp, 'w');
    const r = await withLock(target, async () => 42);
    expect(r).toBe(42);
    expect(existsSync(`${target}.lock`)).toBe(false);
  });

  it('releases on exception', async () => {
    const target = path.join(tmp, 'x');
    await expect(
      withLock(target, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(existsSync(`${target}.lock`)).toBe(false);
  });
});
