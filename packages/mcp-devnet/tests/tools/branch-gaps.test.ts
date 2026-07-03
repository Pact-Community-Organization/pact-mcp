/**
 * @fileoverview Branch-coverage tests for lifecycle tool error paths that the
 *               happy-path suites don't reach: missing compose files, spawn
 *               timeout/error handling, custom reset timeouts, logs
 *               since/service arguments, and health probe fallbacks.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { McpToolError, createAllowlistedFetch } from '@pact-community/mcp-shared';

import { createUpTool } from '../../src/tools/up.js';
import { createDownTool } from '../../src/tools/down.js';
import { createResetTool } from '../../src/tools/reset.js';
import { createLogsTool } from '../../src/tools/logs.js';
import { createHealthTool } from '../../src/tools/health.js';
import {
  createFakeDocker,
  cleanupFakeDocker,
  createTempWorkspace,
  cleanupTempWorkspace,
  VALID_COMPOSE_CONTENT
} from '../fixtures/fake-docker.js';

const FLAGS_ALL = { lifecycle: true, volumeWipe: true } as const;
const CHILD_ENV = { PATH: process.env['PATH'] ?? '' };

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function workspaceWithCompose(): string {
  const ws = createTempWorkspace({
    'pact-examples/docker-compose.forge.yml': VALID_COMPOSE_CONTENT
  });
  cleanups.push(() => cleanupTempWorkspace(ws));
  return ws;
}

function emptyWorkspace(): string {
  const ws = createTempWorkspace({});
  cleanups.push(() => cleanupTempWorkspace(ws));
  return ws;
}

function fakeDocker(spec: Parameters<typeof createFakeDocker>[0] = {}): string {
  const bin = createFakeDocker(spec);
  cleanups.push(() => cleanupFakeDocker(bin));
  return bin;
}

describe('missing compose file', () => {
  it('up throws COMPOSE_FILE_MISSING', async () => {
    const up = createUpTool({
      workspaceRoot: emptyWorkspace(),
      dockerBin: fakeDocker(),
      childEnv: CHILD_ENV,
      flags: FLAGS_ALL
    });
    await expect(up({ agent: 'Developer' })).rejects.toThrow(/not found/);
  });

  it('down throws COMPOSE_FILE_MISSING', async () => {
    const down = createDownTool({
      workspaceRoot: emptyWorkspace(),
      dockerBin: fakeDocker(),
      childEnv: CHILD_ENV,
      flags: FLAGS_ALL
    });
    await expect(down({ agent: 'Developer' })).rejects.toThrow(/not found/);
  });
});

describe('spawn failure handling', () => {
  it('up maps a hung docker to a timeout error', async () => {
    const up = createUpTool({
      workspaceRoot: workspaceWithCompose(),
      dockerBin: fakeDocker({ stdout: 'late', delayMs: 2_000 }),
      childEnv: CHILD_ENV,
      flags: FLAGS_ALL,
      timeoutMs: 150
    });
    await expect(up({ agent: 'Developer' })).rejects.toThrow(McpToolError);
  });

  it('up maps a missing docker binary to SPAWN_ERROR', async () => {
    const up = createUpTool({
      workspaceRoot: workspaceWithCompose(),
      dockerBin: '/definitely/not/docker',
      childEnv: CHILD_ENV,
      flags: FLAGS_ALL
    });
    await expect(up({ agent: 'Developer' })).rejects.toThrow(/failed/);
  });

  it('down maps a hung docker to a timeout error', async () => {
    const down = createDownTool({
      workspaceRoot: workspaceWithCompose(),
      dockerBin: fakeDocker({ stdout: 'late', delayMs: 2_000 }),
      childEnv: CHILD_ENV,
      flags: FLAGS_ALL,
      timeoutMs: 150
    });
    await expect(down({ agent: 'Developer' })).rejects.toThrow(McpToolError);
  });

  it('logs maps a hung docker to a timeout error', async () => {
    const logs = createLogsTool({
      workspaceRoot: workspaceWithCompose(),
      dockerBin: fakeDocker({ stdout: 'late', delayMs: 2_000 }),
      childEnv: CHILD_ENV,
      timeoutMs: 150
    });
    await expect(logs({ agent: 'Developer' })).rejects.toThrow(McpToolError);
  });
});

describe('logs argument branches', () => {
  it('passes since and service through to docker compose', async () => {
    const logs = createLogsTool({
      workspaceRoot: workspaceWithCompose(),
      dockerBin: fakeDocker({ stdout: 'line-1\nline-2\n' }),
      childEnv: CHILD_ENV
    });
    const { content } = await logs({
      agent: 'Developer',
      since: '5m',
      service: 'bootstrap-node',
      tail: 100
    });
    expect(content[0]!.truncated).toBe(false);
  });

  it('flags truncation when output exceeds the 1 MB stream cap', async () => {
    const line = 'x'.repeat(1023) + '\n';
    const oversized = line.repeat(1100); // ~1.1 MB
    const logs = createLogsTool({
      workspaceRoot: workspaceWithCompose(),
      dockerBin: fakeDocker({ stdout: oversized }),
      childEnv: CHILD_ENV
    });
    const { content } = await logs({ agent: 'Developer', tail: 10_000 });
    expect(content[0]!.truncated).toBe(true);
  });
});

describe('reset with custom step timeouts', () => {
  it('honors downTimeoutMs and upTimeoutMs overrides', async () => {
    const reset = createResetTool({
      workspaceRoot: workspaceWithCompose(),
      dockerBin: fakeDocker({ stdout: '' }),
      childEnv: CHILD_ENV,
      flags: FLAGS_ALL,
      downTimeoutMs: 5_000,
      upTimeoutMs: 5_000
    });
    const { content } = await reset({ agent: 'Developer' });
    expect(content[0]!.agent).toBe('Developer');
  });
});

describe('health fallback branches', () => {
  it('uses the default per-agent base URL and reports unreachable nodes', async () => {
    // No server listens on the Tester port in tests, so the default
    // baseUrlFor branch plus the errno extraction path are exercised.
    const health = createHealthTool({
      fetchImpl: createAllowlistedFetch([
        'http://localhost:8081',
        'http://localhost:8082',
        'http://localhost:8083'
      ]) as typeof fetch
    });
    const { content } = await health({ agent: 'Tester' });
    expect(content[0]!.agent).toBe('Tester');
    expect(content[0]!.reachable).toBe(false);
  });
});
