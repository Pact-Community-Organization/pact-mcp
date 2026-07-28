/**
 * @fileoverview In-process tests for server.ts (resolveConfig + buildMcpServer).
 *               The integration test exercises these end-to-end in a subprocess
 *               (no instrumentation), so we duplicate critical paths here for
 *               coverage.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  safeTempDir,
  generateToolsLockEntry,
  TOOL_NAME_PATTERN
} from '@pact-community/mcp-shared';
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
      'pact_fmt_check',
      'pact_gas_estimate',
      'pact_interface_diff',
      'pact_module_scan',
      'pact_repl_run',
      'pact_repl_run_many'
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
            'pact_repl_run': { schema: '{}', hash: 'sha256:deadbeef' },
            'pact_module_scan': { schema: '{}', hash: 'sha256:deadbeef' }
          }
        }
      })
    );
    expect(() => resolveConfig()).toThrowError(/drift|hash/i);
  });

  test('resolveConfig falls back to the packaged lockfile when env var unset', () => {
    delete process.env['PACT_COMMUNITY_TOOLS_LOCKFILE'];
    // The package ships its own tools.lock.json, so startup succeeds from
    // any working directory and resolves to that packaged file.
    const config = resolveConfig();
    expect(config.lockfilePath.endsWith('tools.lock.json')).toBe(true);
    expect(path.isAbsolute(config.lockfilePath)).toBe(true);
  });

  describe('tool names (regression: #50)', () => {
    test('every registered tool name is accepted by the Anthropic API', () => {
      const names = Object.keys(getToolSchemaObjects());
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        expect(
          TOOL_NAME_PATTERN.test(name),
          `tool '${name}' violates ${TOOL_NAME_PATTERN.source}`
        ).toBe(true);
      }
    });

    test('no tool name contains a dot', () => {
      // 0.2.x shipped 'pact.repl_run' etc. The API rejects the whole tools/list,
      // so a single dot made every tool on the server invisible to the client.
      for (const name of Object.keys(getToolSchemaObjects())) {
        expect(name).not.toContain('.');
      }
    });
  });

  describe('child locale (regression: #51)', () => {
    test('forces C.UTF-8 when the parent env carries no locale at all', () => {
      // beforeEach already strips the environment down to PATH/HOME plus the
      // server's own vars — the same minimal env an MCP client hands the server.
      expect(process.env['LC_ALL']).toBeUndefined();
      expect(process.env['LANG']).toBeUndefined();

      const { childEnv } = resolveConfig();
      expect(childEnv['LC_ALL']).toBe('C.UTF-8');
      expect(childEnv['LANG']).toBe('C.UTF-8');
    });

    test('replaces a non-UTF-8 locale rather than inheriting it', () => {
      process.env['LC_ALL'] = 'C';
      const { childEnv } = resolveConfig();
      expect(childEnv['LC_ALL']).toBe('C.UTF-8');
    });

    test('honours a locale the caller already set to UTF-8', () => {
      process.env['LANG'] = 'en_US.UTF-8';
      const { childEnv } = resolveConfig();
      expect(childEnv['LANG']).toBe('en_US.UTF-8');
      expect(childEnv['LC_ALL']).toBeUndefined();
    });
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

describe('server.json registry manifest', () => {
  // server.json ships inside the published tarball and is what the MCP registry
  // reads. It carries the version in two places and nothing regenerates it, so
  // it silently kept pointing at the previous release until this test existed.
  test('declares the same version as package.json, in both places', () => {
    const pkg = JSON.parse(
      fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as { version: string };
    const manifest = JSON.parse(
      fs.readFileSync(new URL('../server.json', import.meta.url), 'utf8')
    ) as { version: string; packages: { version: string }[] };

    expect(manifest.version).toBe(pkg.version);
    expect(manifest.packages[0]!.version).toBe(pkg.version);
  });
});
