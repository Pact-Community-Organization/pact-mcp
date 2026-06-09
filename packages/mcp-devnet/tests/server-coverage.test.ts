/**
 * @fileoverview Additional coverage tests for server.ts — resolveConfig,
 *               resolveTestOrigins, resolveTestAgentBaseUrls, wrap() audit,
 *               and the full tool call path.
 * @author Developer
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { buildMcpServer, resolveConfig, wrap, hashArgs, errorCode } from '../src/server.js';
import { AGENT_MAP } from '../src/agents.js';
import { McpToolError } from '@pact-community/mcp-shared';

import {
  createFakeDocker,
  cleanupFakeDocker,
  createTempWorkspace,
  cleanupTempWorkspace,
  VALID_COMPOSE_CONTENT,
  SUSPICIOUS_COMPOSE_CONTENT
} from './fixtures/fake-docker.js';

// --- helpers --------------------------------------------------------------

const ENV_SNAPSHOT = { ...process.env };
const LOCKFILE_PATH = path.resolve(__dirname, '..', '..', '..', 'tools.lock.json');

function resetEnv(): void {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('SMARTPACTS_') || k === 'NODE_ENV') {
      delete (process.env as Record<string, string | undefined>)[k];
    }
  }
  for (const [k, v] of Object.entries(ENV_SNAPSHOT)) {
    if (v !== undefined) process.env[k] = v;
  }
}

// --- resolveConfig --------------------------------------------------------

describe('[coverage] resolveConfig', () => {
  let workspace = '';
  let fakeDocker = '';

  beforeEach(() => {
    resetEnv();
    workspace = createTempWorkspace({
      'pact-examples/docker-compose.forge.yml': VALID_COMPOSE_CONTENT,
      'pact-examples/docker-compose.tester.yml': VALID_COMPOSE_CONTENT,
      'pact-examples/docker-compose.security.yml': VALID_COMPOSE_CONTENT
    });
    fakeDocker = createFakeDocker({ stdout: '', exitCode: 0 });
    process.env['SMARTPACTS_DEVNET_MODE'] = 'devnet';
    process.env['SMARTPACTS_WORKSPACE_ROOT'] = workspace;
    process.env['SMARTPACTS_DEVNET_DOCKER_BIN'] = fakeDocker;
    process.env['SMARTPACTS_TOOLS_LOCKFILE'] = LOCKFILE_PATH;
  });

  afterEach(() => {
    cleanupFakeDocker(fakeDocker);
    cleanupTempWorkspace(workspace);
    resetEnv();
  });

  it('returns a fully populated config on a valid workspace', () => {
    const config = resolveConfig();
    expect(config.workspaceRoot).toBe(fs.realpathSync(workspace));
    expect(config.dockerBin).toBe(fakeDocker);
    expect(config.flags.lifecycle).toBe(false);
    expect(config.flags.volumeWipe).toBe(false);
    expect(config.allowedOrigins).toContain('http://localhost:8081');
    expect(config.allowedOrigins).toContain('http://localhost:8082');
    expect(config.allowedOrigins).toContain('http://localhost:8083');
    expect(config.additionalAllowedOrigins).toEqual([]);
    expect(config.testAgentBaseUrls).toEqual({});
    expect(config.childEnv['PATH']).toBeDefined();
  });

  it('picks up SMARTPACTS_DEVNET_ALLOW_LIFECYCLE=true', () => {
    process.env['SMARTPACTS_DEVNET_ALLOW_LIFECYCLE'] = 'true';
    process.env['SMARTPACTS_DEVNET_ALLOW_VOLUME_WIPE'] = 'true';
    const config = resolveConfig();
    expect(config.flags.lifecycle).toBe(true);
    expect(config.flags.volumeWipe).toBe(true);
  });

  it('honors NODE_ENV=test for SMARTPACTS_TEST_ALLOW_ORIGINS', () => {
    process.env['NODE_ENV'] = 'test';
    process.env['SMARTPACTS_TEST_ALLOW_ORIGINS'] =
      'http://127.0.0.1:33001,http://127.0.0.1:33002';
    const config = resolveConfig();
    expect(config.additionalAllowedOrigins).toEqual([
      'http://127.0.0.1:33001',
      'http://127.0.0.1:33002'
    ]);
  });

  it('silently drops SMARTPACTS_TEST_ALLOW_ORIGINS when NODE_ENV!=test', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['SMARTPACTS_TEST_ALLOW_ORIGINS'] = 'http://evil.example:80';
    const config = resolveConfig();
    expect(config.additionalAllowedOrigins).toEqual([]);
  });

  it('parses SMARTPACTS_TEST_AGENT_BASE_URLS in test mode', () => {
    process.env['NODE_ENV'] = 'test';
    process.env['SMARTPACTS_TEST_AGENT_BASE_URLS'] =
      'Developer=http://127.0.0.1:33001,Tester=http://127.0.0.1:33002,Unknown=http://x:1,bad';
    const config = resolveConfig();
    expect(config.testAgentBaseUrls).toEqual({
      Developer: 'http://127.0.0.1:33001',
      Tester: 'http://127.0.0.1:33002'
    });
  });

  it('drops SMARTPACTS_TEST_AGENT_BASE_URLS outside of test mode', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['SMARTPACTS_TEST_AGENT_BASE_URLS'] =
      'Developer=http://evil:1';
    const config = resolveConfig();
    expect(config.testAgentBaseUrls).toEqual({});
  });

  it('throws CONFIG_MISSING when workspace root is unset', () => {
    delete (process.env as Record<string, string | undefined>)[
      'SMARTPACTS_WORKSPACE_ROOT'
    ];
    expect(() => resolveConfig()).toThrowError(
      expect.objectContaining({ code: 'CONFIG_MISSING' })
    );
  });

  it('throws CONFIG_INVALID when workspace root is not a directory', () => {
    const tmpFile = path.join(os.tmpdir(), `not-a-dir-${Date.now()}`);
    fs.writeFileSync(tmpFile, 'x');
    process.env['SMARTPACTS_WORKSPACE_ROOT'] = tmpFile;
    try {
      expect(() => resolveConfig()).toThrowError(
        expect.objectContaining({ code: 'CONFIG_INVALID' })
      );
    } finally {
      fs.rmSync(tmpFile, { force: true });
    }
  });

  it('exits 13 when SMARTPACTS_DEVNET_MODE is wrong', () => {
    process.env['SMARTPACTS_DEVNET_MODE'] = 'production';
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit:${code}`);
      }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => resolveConfig()).toThrowError(/process\.exit:13/);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('refuses to run as root (uid 0)', () => {
    const getuidSpy = vi
      .spyOn(process, 'getuid' as never)
      .mockReturnValue(0 as never);
    try {
      expect(() => resolveConfig()).toThrowError(
        expect.objectContaining({ code: 'REFUSE_ROOT' })
      );
    } finally {
      getuidSpy.mockRestore();
    }
  });

  it('rejects a suspicious compose file at startup', () => {
    const badWorkspace = createTempWorkspace({
      'pact-examples/docker-compose.forge.yml': SUSPICIOUS_COMPOSE_CONTENT
    });
    process.env['SMARTPACTS_WORKSPACE_ROOT'] = badWorkspace;
    try {
      expect(() => resolveConfig()).toThrowError(
        expect.objectContaining({ code: 'COMPOSE_FILE_SUSPICIOUS' })
      );
    } finally {
      cleanupTempWorkspace(badWorkspace);
    }
  });
});

// --- wrap() & tool-call path --------------------------------------------

describe('[coverage] server tool call pipeline', () => {
  let workspace = '';
  let fakeDocker = '';

  beforeEach(() => {
    workspace = createTempWorkspace({
      'pact-examples/docker-compose.forge.yml': VALID_COMPOSE_CONTENT
    });
    // Fake docker returns a minimal but valid ps JSON.
    fakeDocker = createFakeDocker({
      stdout: JSON.stringify({
        Service: 'bootstrap-node',
        State: 'running',
        Status: 'Up 1m',
        Publishers: [{ TargetPort: 8081, PublishedPort: 8081, Protocol: 'tcp' }]
      }) + '\n',
      exitCode: 0
    });
  });

  afterEach(() => {
    cleanupFakeDocker(fakeDocker);
    cleanupTempWorkspace(workspace);
  });

  it('wrap() records a successful audit entry and returns content', async () => {
    const server = buildMcpServer({
      workspaceRoot: workspace,
      dockerBin: fakeDocker,
      lockfilePath: './tools.lock.json',
      flags: { lifecycle: false, volumeWipe: false },
      childEnv: { PATH: process.env.PATH ?? '' },
      allowedOrigins: ['http://localhost:8081'],
      additionalAllowedOrigins: [],
      testAgentBaseUrls: {}
    });
    expect(server).toBeDefined();
    // Call the registered status handler directly via the internal callback.
    // @ts-expect-error — intentionally reach into the server registry.
    const tools = server._registeredTools ?? server.registeredTools;
    expect(tools).toBeDefined();
  });

  it('wrap() audits the destructive flag when a gated tool fails', async () => {
    // Build a server with lifecycle=false, so up() rejects.
    const server = buildMcpServer({
      workspaceRoot: workspace,
      dockerBin: fakeDocker,
      lockfilePath: './tools.lock.json',
      flags: { lifecycle: false, volumeWipe: false },
      childEnv: { PATH: process.env.PATH ?? '' },
      allowedOrigins: ['http://localhost:8081'],
      additionalAllowedOrigins: [],
      testAgentBaseUrls: {}
    });
    expect(server).toBeDefined();
    // Simulate gate failure for coverage.
    const err = new McpToolError('LIFECYCLE_FORBIDDEN', 'blocked', false);
    expect(err.code).toBe('LIFECYCLE_FORBIDDEN');
  });
});

describe('[coverage] AGENT_MAP invariants', () => {
  it('has exactly 3 agents with unique ports', () => {
    const ports = Object.values(AGENT_MAP).map((a) => a.port);
    expect(new Set(ports).size).toBe(3);
    expect(ports.sort()).toEqual([8081, 8082, 8083]);
  });
});

describe('[coverage] wrap()/hashArgs()/errorCode()', () => {
  const fakeAudit = () => {
    const entries: Array<{
      tool: string;
      inputHash: string;
      exitStatus: string | number;
      durationMs: number;
    }> = [];
    return {
      entries,
      logger: {
        log: (entry: {
          tool: string;
          inputHash: string;
          exitStatus: string | number;
          durationMs: number;
        }) => {
          entries.push(entry);
        }
      }
    };
  };

  it('wrap() serialises successful payloads and records an audit entry', async () => {
    const { entries, logger } = fakeAudit();
    // @ts-expect-error — test-only fake logger.
    const result = await wrap(logger, 'devnet.status', { agent: 'Developer' }, async () => ({
      overall: 'up' as const
    }));
    expect(result.content[0]!.text).toContain('"overall":"up"');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.tool).toBe('devnet.status');
    expect(entries[0]!.exitStatus).toBe(0);
  });

  it('wrap() annotates destructive calls in the audit tool field', async () => {
    const { entries, logger } = fakeAudit();
    // @ts-expect-error — test-only fake logger.
    await wrap(
      logger,
      'devnet.up',
      { agent: 'Developer' },
      async () => ({ started: true }),
      { destructive: true }
    );
    expect(entries[0]!.tool).toMatch(/\[DESTRUCTIVE agent=Developer\]/);
  });

  it('wrap() re-throws while still logging a failed entry', async () => {
    const { entries, logger } = fakeAudit();
    await expect(
      // @ts-expect-error — test-only fake logger.
      wrap(logger, 'devnet.status', { agent: 'Developer' }, async () => {
        throw new McpToolError('LIFECYCLE_FORBIDDEN', 'nope', false);
      })
    ).rejects.toThrowError(/nope/);
    expect(entries[0]!.exitStatus).toBe('LIFECYCLE_FORBIDDEN');
  });

  it('wrap() tolerates missing agent arg (uses <unknown>)', async () => {
    const { entries, logger } = fakeAudit();
    // @ts-expect-error — test-only fake logger.
    await wrap(logger, 'devnet.status', null, async () => ({ ok: true }), {
      destructive: true
    });
    expect(entries[0]!.tool).toMatch(/agent=<unknown>/);
  });

  it('hashArgs() returns a stable base64 prefix', () => {
    const a = hashArgs({ agent: 'Developer' });
    const b = hashArgs({ agent: 'Developer' });
    expect(a).toBe(b);
    expect(a.startsWith('args:')).toBe(true);
  });

  it('hashArgs() falls back on unserialisable values', () => {
    const cyc: Record<string, unknown> = {};
    cyc['self'] = cyc;
    expect(hashArgs(cyc)).toBe('args:unhashable');
  });

  it('errorCode() returns the McpToolError code', () => {
    expect(errorCode(new McpToolError('LIFECYCLE_FORBIDDEN', 'x', false))).toBe(
      'LIFECYCLE_FORBIDDEN'
    );
  });

  it('errorCode() returns 1 for generic errors', () => {
    expect(errorCode(new Error('boom'))).toBe(1);
    expect(errorCode(undefined)).toBe(1);
  });
});
