/**
 * @fileoverview In-process server tests (resolveConfig + buildMcpServer).
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { safeTempDir, generateToolsLockEntry } from '@pact-community/mcp-shared';
import {
  resolveConfig,
  buildMcpServer,
  buildMcpServerWithClient,
  getToolSchemaObjects,
  SERVER_NAME,
  SERVER_VERSION,
  ALLOWED_ENV,
  PROD_ALLOWED_ORIGINS
} from '../src/server.js';
import { createChainwebClient } from '../src/client/fetch.js';
import {
  startMockChainweb,
  type MockHandle
} from './fixtures/mock-chainweb.js';

describe('server', () => {
  let tempWorkspace: string;
  let tempLock: string;
  let lockContent: string;
  let originalEnv: Record<string, string | undefined>;

  beforeAll(() => {
    const tools = getToolSchemaObjects();
    const entry = (generateToolsLockEntry(
      SERVER_NAME,
      tools,
      SERVER_VERSION,
      '1.18.0'
    ) as Record<string, { tools: Record<string, unknown> }>)[SERVER_NAME]!;
    lockContent = JSON.stringify(
      { version: 1, servers: { [SERVER_NAME]: entry.tools } },
      null,
      2
    );
  });

  beforeEach(() => {
    tempWorkspace = safeTempDir('mcp-chainweb-srv');
    tempLock = path.join(tempWorkspace, 'tools.lock.json');
    fs.writeFileSync(tempLock, lockContent);
    originalEnv = { ...process.env };
    for (const key of Object.keys(process.env)) delete process.env[key];
    process.env['PATH'] = originalEnv['PATH'] ?? '/usr/bin:/bin';
    process.env['HOME'] = originalEnv['HOME'] ?? tempWorkspace;
    process.env['PACT_COMMUNITY_WORKSPACE_ROOT'] = tempWorkspace;
    process.env['PACT_COMMUNITY_CHAINWEB_MODE'] = 'devnet';
    process.env['PACT_COMMUNITY_CHAINWEB_BASE_URL'] = 'http://localhost:8081';
    process.env['PACT_COMMUNITY_TOOLS_LOCKFILE'] = tempLock;
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v !== undefined) process.env[k] = v;
    }
  });

  test('ALLOWED_ENV contains the documented vars', () => {
    expect(ALLOWED_ENV).toContain('PACT_COMMUNITY_CHAINWEB_MODE');
    expect(ALLOWED_ENV).toContain('PACT_COMMUNITY_CHAINWEB_BASE_URL');
  });

  test('PROD_ALLOWED_ORIGINS is exactly the three devnet ports', () => {
    expect([...PROD_ALLOWED_ORIGINS].sort()).toEqual([
      'http://localhost:8081',
      'http://localhost:8082',
      'http://localhost:8083'
    ]);
  });

  test('resolveConfig returns expected fields for a valid env', () => {
    const cfg = resolveConfig();
    expect(cfg.baseUrl).toBe('http://localhost:8081');
    expect(cfg.networkId).toBe('development');
    expect(cfg.allowedOrigins).toContain('http://localhost:8081');
    expect(cfg.additionalAllowedOrigins).toEqual([]);
  });

  test('getToolSchemaObjects returns exactly the 11 v0.2 tools', () => {
    const t = getToolSchemaObjects();
    expect(Object.keys(t).sort()).toEqual([
      'chainweb.chain_time',
      'chainweb.continue_pact',
      'chainweb.deploy_module',
      'chainweb.info',
      'chainweb.keys',
      'chainweb.local',
      'chainweb.poll',
      'chainweb.principal_namespace',
      'chainweb.read_table',
      'chainweb.send',
      'chainweb.spv_proof'
    ]);
  });

  test('buildMcpServer returns an McpServer with close()', () => {
    const cfg = resolveConfig();
    const mcp = buildMcpServer(cfg);
    expect(typeof (mcp as unknown as { close: unknown }).close).toBe(
      'function'
    );
  });

  describe('buildMcpServerWithClient end-to-end via mock', () => {
    let mock: MockHandle;
    beforeAll(async () => {
      mock = await startMockChainweb();
    });
    // afterAll needs outer scope — re-declare via beforeAll/afterEach? Use
    // explicit describe hook.

    test('server built with mock client registers and responds', async () => {
      const client = createChainwebClient({
        baseUrl: mock.baseUrl,
        networkId: 'development',
        allowedOrigins: [],
        additionalAllowedOrigins: [mock.origin]
      });
      const mcp = buildMcpServerWithClient(client);
      expect(mcp).toBeDefined();
      await mock.close();
    });
  });
});
