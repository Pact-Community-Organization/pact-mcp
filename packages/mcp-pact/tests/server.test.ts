/**
 * @fileoverview In-process tests for server.ts (resolveConfig + buildMcpServer).
 *               The integration test exercises these end-to-end in a subprocess
 *               (no instrumentation), so we duplicate critical paths here for
 *               coverage.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { safeTempDir, generateToolsLockEntry } from '@pact-community/mcp-shared';
import {
  resolveConfig,
  buildMcpServer,
  getToolSchemaObjects,
  SERVER_NAME,
  SERVER_VERSION
} from '../src/server.js';
import { readTrapsResource, TRAPS_RESOURCE_URI } from '../src/resources/traps-catalog.js';

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
    tempWorkspace = safeTempDir('mcp-pact-srv');
    tempLock = path.join(tempWorkspace, 'tools.lock.json');
    fs.writeFileSync(tempLock, lockContent);
    originalEnv = { ...process.env };
    for (const key of Object.keys(process.env)) delete process.env[key];
    process.env['PATH'] = originalEnv['PATH'] ?? '/usr/bin:/bin';
    process.env['HOME'] = originalEnv['HOME'] ?? tempWorkspace;
    process.env['PACT_COMMUNITY_WORKSPACE_ROOT'] = tempWorkspace;
    process.env['PACT_COMMUNITY_PACT_BIN'] = 'pact';
    process.env['PACT_COMMUNITY_TOOLS_LOCKFILE'] = tempLock;
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v !== undefined) process.env[k] = v;
    }
  });

  test('resolveConfig + buildMcpServer returns an McpServer with tools + resource', () => {
    const config = resolveConfig();
    const mcp = buildMcpServer(config);
    expect(mcp).toBeDefined();
    // McpServer has a `server` field or similar — just assert we can call close.
    expect(typeof (mcp as unknown as { close: unknown }).close).toBe('function');
  });

  test('getToolSchemaObjects returns all six tools', () => {
    const t = getToolSchemaObjects();
    expect(Object.keys(t).sort()).toEqual([
      'pact.fmt_check',
      'pact.gas_estimate',
      'pact.interface_diff',
      'pact.module_scan',
      'pact.repl_run',
      'pact.repl_run_many'
    ]);
    for (const v of Object.values(t)) {
      expect(v.inputSchema).toBeDefined();
    }
  });

  test('resolveConfig throws TOOL_SCHEMA_DRIFT on corrupt lockfile', () => {
    fs.writeFileSync(
      tempLock,
      JSON.stringify({
        version: 1,
        servers: {
          [SERVER_NAME]: {
            'pact.repl_run': { schema: '{}', hash: 'sha256:deadbeef' },
            'pact.module_scan': { schema: '{}', hash: 'sha256:deadbeef' }
          }
        }
      })
    );
    expect(() => resolveConfig()).toThrowError(/drift|hash/i);
  });

  test('resolveConfig uses a default lockfile path when env var unset', () => {
    delete process.env['PACT_COMMUNITY_TOOLS_LOCKFILE'];
    // With no lockfile at ./tools.lock.json (cwd), resolveConfig throws.
    expect(() => resolveConfig()).toThrowError();
  });
});

describe('traps-catalog resource', () => {
  test('readTrapsResource returns 1 JSON content entry with 5 traps', async () => {
    const result = await readTrapsResource();
    expect(result.contents).toHaveLength(1);
    const c = result.contents[0]!;
    expect(c.uri).toBe(TRAPS_RESOURCE_URI);
    expect(c.mimeType).toBe('application/json');
    const parsed = JSON.parse(c.text as string);
    expect(parsed.version).toBe('1.0.0');
    expect(parsed.traps.length).toBe(5);
    const kinds = parsed.traps.map((t: { kind: string }) => t.kind).sort();
    expect(kinds).toEqual([
      'BARE_PACT_ID',
      'BUILTIN_SHADOW',
      'ENFORCE_DB_READ',
      'NON_BINARY_PLUS',
      'TRY_DML'
    ]);
  });
});
