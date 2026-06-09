/**
 * @fileoverview Cooperative file locks using O_EXCL|O_CREAT lockfiles.
 * @author Developer
 *
 * A lock file lives at `<target>.lock` and contains `{pid, hostname,
 * acquiredAtMs}` as JSON. The owner retains the lock for the duration
 * of the callback; stale locks (> 30s old) are stolen on the next
 * acquire attempt.
 */

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpToolError, ErrorCodes } from '@pact-community/mcp-shared';

export const LOCK_STALE_MS = 30_000;
export const LOCK_RETRY_COUNT = 100;
// [Developer] Replaced constant delay with jittered exponential backoff
// to prevent thundering herd under high contention (10+ parallel acquirers).
// Budget: ~8s worst case with 100 retries.

export interface LockPayload {
  pid: number;
  hostname: string;
  acquiredAtMs: number;
}

/**
 * Acquire the lock for `absTarget` or throw `LOCK_HELD`. Returns a
 * `release` function that should be called in a finally block.
 */
export async function acquireLock(absTarget: string): Promise<() => Promise<void>> {
  const lockPath = `${absTarget}.lock`;
  await fsp.mkdir(path.dirname(lockPath), { recursive: true });
  const payload: LockPayload = {
    pid: process.pid,
    hostname: os.hostname(),
    acquiredAtMs: Date.now()
  };
  const body = JSON.stringify(payload);

  let attempt = 0;
  let stolenOnce = false;
  // [Developer] Jittered exponential backoff: base 5ms, 1.5× growth, max 200ms per retry, random jitter [0.5, 1.5]×
  // Total budget: ~8s worst case (100 retries). Prevents thundering herd when 10+ parallel acquirers contend.
  while (attempt <= LOCK_RETRY_COUNT) {
    try {
      const fh = await fsp.open(lockPath, 'wx', 0o600);
      try {
        await fh.writeFile(body, 'utf8');
        await fh.sync();
      } finally {
        await fh.close();
      }
      return async () => {
        try {
          await fsp.unlink(lockPath);
        } catch {
          /* ignore — lock may have been stolen */
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
      // Lock exists — check age.
      if (!stolenOnce && (await tryStealStale(lockPath))) {
        stolenOnce = true;
        continue;
      }
      attempt += 1;
      if (attempt > LOCK_RETRY_COUNT) break;
      // Jittered exponential backoff: base 5ms, grows by 1.5× each attempt, capped at 200ms
      const baseDelay = Math.min(5 * Math.pow(1.5, attempt), 200);
      const jitteredDelay = baseDelay * (0.5 + Math.random()); // [0.5, 1.5] × baseDelay
      await delay(jitteredDelay);
    }
  }
  throw new McpToolError(
    ErrorCodes.LOCK_HELD,
    `resource is locked by another writer: ${path.basename(absTarget)}`,
    true
  );
}

/** Convenience: acquire + run + release, always releasing on error. */
export async function withLock<T>(
  absTarget: string,
  fn: () => Promise<T>
): Promise<T> {
  const release = await acquireLock(absTarget);
  try {
    return await fn();
  } finally {
    await release();
  }
}

async function tryStealStale(lockPath: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await fsp.readFile(lockPath, 'utf8');
  } catch {
    return false;
  }
  let payload: LockPayload | null = null;
  try {
    payload = JSON.parse(raw) as LockPayload;
  } catch {
    payload = null;
  }
  const acquiredAt = payload?.acquiredAtMs ?? 0;
  if (Date.now() - acquiredAt < LOCK_STALE_MS) {
    return false;
  }
  try {
    await fsp.unlink(lockPath);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
