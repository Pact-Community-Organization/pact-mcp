/**
 * @fileoverview Unit tests — src/docker/spawn.ts
 * @author Developer
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';

import {
  runDocker,
  timeoutError,
  STREAM_CAP_BYTES
} from '../../src/docker/spawn.js';
import { McpToolError, McpSpawnError } from '@pact-community/mcp-shared';
import { createFakeDocker, cleanupFakeDocker } from '../fixtures/fake-docker.js';

const fixtures: string[] = [];
function fake(spec: Parameters<typeof createFakeDocker>[0]): string {
  const p = createFakeDocker(spec);
  fixtures.push(p);
  return p;
}
afterEach(() => {
  while (fixtures.length > 0) {
    const f = fixtures.pop();
    if (f) cleanupFakeDocker(f);
  }
});

describe('runDocker', () => {
  const cwd = os.tmpdir();

  it('captures stdout and exit code 0', async () => {
    const bin = fake({ stdout: 'hello world\n', exitCode: 0 });
    const r = await runDocker(bin, ['ps'], { cwd, timeoutMs: 5000, env: { PATH: process.env.PATH ?? "" } });
    expect(r.endReason).toBe('exit');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('hello world\n');
    expect(r.stderr).toBe('');
    expect(r.truncated).toBe(false);
  });

  it('captures stderr and non-zero exit code without throwing', async () => {
    const bin = fake({ stderr: 'boom\n', exitCode: 2 });
    const r = await runDocker(bin, ['ps'], { cwd, timeoutMs: 5000, env: { PATH: process.env.PATH ?? "" } });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toBe('boom\n');
  });

  it('truncates stdout at STREAM_CAP_BYTES and sets truncated:true', async () => {
    // 1.5MB of "a" → exceeds 1MB cap
    const big = 'a'.repeat(STREAM_CAP_BYTES + 512_000);
    const bin = fake({ stdout: big, exitCode: 0 });
    const r = await runDocker(bin, ['ps'], { cwd, timeoutMs: 10_000, env: { PATH: process.env.PATH ?? "" } });
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(r.stdout, 'utf-8')).toBeLessThanOrEqual(
      STREAM_CAP_BYTES
    );
  });

  it('kills a hung process on timeout', async () => {
    const bin = fake({ stdout: 'late', exitCode: 0, delayMs: 5_000 });
    const r = await runDocker(bin, ['ps'], {
      cwd,
      timeoutMs: 200,
      env: { PATH: process.env.PATH ?? "" }
    });
    expect(r.endReason).toBe('timeout');
    // durationMs should be close to the timeout, not the 5s delay
    expect(r.durationMs).toBeLessThan(4_000);
  });

  it('returns endReason:error when the binary does not exist', async () => {
    const missing = path.join(os.tmpdir(), 'mcp-devnet-missing-bin-xyz');
    if (fs.existsSync(missing)) fs.unlinkSync(missing);
    const r = await runDocker(missing, ['ps'], {
      cwd,
      timeoutMs: 2_000,
      env: { PATH: process.env.PATH ?? "" }
    });
    expect(r.endReason).toBe('error');
    expect(r.errorMessage).toBeDefined();
  });

  it('captures argv passed to the binary', async () => {
    const tmp = path.join(os.tmpdir(), `argv-capture-${Date.now()}.json`);
    const bin = fake({ stdout: '', exitCode: 0, argvCaptureFile: tmp });
    await runDocker(
      bin,
      ['compose', '-f', '/abs/path/docker-compose.yml', 'ps', '--format', 'json'],
      { cwd, timeoutMs: 5_000, env: { PATH: process.env.PATH ?? "" } }
    );
    const recorded = JSON.parse(fs.readFileSync(tmp, 'utf-8')) as string[];
    fs.unlinkSync(tmp);
    expect(recorded).toEqual([
      'compose',
      '-f',
      '/abs/path/docker-compose.yml',
      'ps',
      '--format',
      'json'
    ]);
  });

  it('throws McpSpawnError when argv contains shell metacharacters', async () => {
    const bin = fake({});
    await expect(
      runDocker(bin, ['ps;rm', '-rf', '/'], { cwd, timeoutMs: 1_000, env: { PATH: process.env.PATH ?? "" } })
    ).rejects.toBeInstanceOf(McpSpawnError);
  });

  it('timeoutError maps to SPAWN_TIMEOUT McpToolError (retryable)', () => {
    const err = timeoutError({
      exitCode: null,
      stdout: '',
      stderr: '',
      truncated: false,
      durationMs: 1234,
      endReason: 'timeout'
    });
    expect(err).toBeInstanceOf(McpToolError);
    expect(err.code).toBe('SPAWN_TIMEOUT');
    expect(err.retryable).toBe(true);
  });
});
