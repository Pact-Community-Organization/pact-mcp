import { describe, it, expect, afterEach } from 'vitest';
import { withLock } from '../../src/fs/lock.js';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('lock contention stress test', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      try {
        await fsp.rm(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore cleanup failures */
      }
    }
  });

  it('20 parallel withLock calls all succeed with counter increment', async () => {
    // This test exercises the jittered exponential backoff under heavy contention.
    // 20 parallel calls increment a shared counter — all must succeed without LOCK_HELD errors.
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lock-test-'));
    const counterFile = path.join(tmpDir, 'counter.json');
    
    // Initialize counter file
    await fsp.writeFile(counterFile, JSON.stringify({ count: 0 }), 'utf8');

    // Single scenario focused on the lock mechanism
    let successCount = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        try {
          await withLock(counterFile, async () => {
            // Read, increment, write - all within the lock
            const raw = await fsp.readFile(counterFile, 'utf8');
            const data = JSON.parse(raw);
            data.count += 1;
            await fsp.writeFile(counterFile, JSON.stringify(data), 'utf8');
            // Brief delay to create contention
            await new Promise(resolve => setTimeout(resolve, 2));
          });
          successCount++;
          return `success-${i}`;
        } catch (error) {
          return `error-${i}: ${error.message}`;
        }
      })
    );

    // All 20 calls should succeed (no LOCK_HELD errors)
    expect(successCount).toBe(20);
    expect(results).toHaveLength(20);
    // Verify no error results
    const errorResults = results.filter(r => r.startsWith('error-'));
    expect(errorResults).toEqual([]);

    // Counter should be exactly 20
    const finalData = JSON.parse(await fsp.readFile(counterFile, 'utf8'));
    expect(finalData.count).toBe(20);
  });
});