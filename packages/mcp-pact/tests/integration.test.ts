/**
 * @fileoverview End-to-end integration test — spawns dist/bin.js via
 *               StdioClientTransport and exercises tools/list + tools/call +
 *               resources/list + resources/read.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import {
  generateToolsLockEntry
} from '@pact-community/mcp-shared';
import {
  SERVER_NAME,
  SERVER_VERSION,
  getToolSchemaObjects
} from '../src/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.resolve(here, '../dist/bin.js');
const fixtures = path.resolve(here, 'fixtures');
const mockPact = path.join(fixtures, 'mock-pact.sh');

// A fresh tools.lock.json is written into a temp dir so the server accepts
// whatever schemas our source currently exposes (no drift).
function buildLockfile(): string {
  const lockDir = fs.mkdtempSync(
    path.join(process.env['TMPDIR'] ?? '/tmp', 'mcp-pact-intg-')
  );
  const lockPath = path.join(lockDir, 'tools.lock.json');
  const tools = getToolSchemaObjects();
  const entry = (generateToolsLockEntry(
    SERVER_NAME,
    tools,
    SERVER_VERSION,
    '1.18.0'
  ) as Record<string, { tools: Record<string, unknown> }>)[SERVER_NAME]!;
  fs.writeFileSync(
    lockPath,
    JSON.stringify(
      { version: 1, servers: { [SERVER_NAME]: entry.tools } },
      null,
      2
    )
  );
  return lockPath;
}

describe('MCP pact server — integration', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    if (!fs.existsSync(binPath)) {
      throw new Error(
        `Binary not built: ${binPath}. Run 'pnpm --filter @pact-community/mcp-pact build' first.`
      );
    }
    if (!fs.existsSync(mockPact)) {
      throw new Error(`Mock pact not found: ${mockPact}`);
    }
    fs.chmodSync(mockPact, 0o755);

    const lockPath = buildLockfile();

    transport = new StdioClientTransport({
      command: 'node',
      args: [binPath],
      env: {
        PATH: process.env['PATH'] ?? '/usr/bin:/bin',
        HOME: process.env['HOME'] ?? '/tmp',
        NODE_ENV: 'test',
        PACT_COMMUNITY_WORKSPACE_ROOT: fixtures,
        PACT_COMMUNITY_PACT_BIN: mockPact,
        PACT_COMMUNITY_TOOLS_LOCKFILE: lockPath
      }
    });

    client = new Client(
      { name: 'test-client', version: '0.0.0' },
      { capabilities: {} }
    );
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    if (client) await client.close();
  });

  test('tools/list returns all six registered tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'pact_fmt_check',
      'pact_gas_estimate',
      'pact_interface_diff',
      'pact_module_scan',
      'pact_repl_run',
      'pact_repl_run_many'
    ]);
    for (const t of tools) {
      expect(t.inputSchema).toBeDefined();
      expect(t.description).toBeTruthy();
    }
  });

  test('resources/list returns pact://traps', async () => {
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain('pact://traps');
  });

  test('resources/read pact://traps returns a JSON catalog', async () => {
    const { contents } = await client.readResource({ uri: 'pact://traps' });
    expect(contents).toHaveLength(1);
    expect(contents[0]!.mimeType).toBe('application/json');
    const parsed = JSON.parse(contents[0]!.text as string);
    expect(Array.isArray(parsed.traps)).toBe(true);
    expect(parsed.traps.length).toBe(5);
  });

  test('tools/call pact_repl_run on simple.repl succeeds', async () => {
    const result = await client.callTool({
      name: 'pact_repl_run',
      arguments: { file: 'simple.repl' }
    });
    expect(result.isError).toBeFalsy();
    const content = (result.content as Array<{ type: string; text: string }>)[0]!;
    expect(content.type).toBe('text');
    const payload = JSON.parse(content.text);
    expect(payload.file).toBe('simple.repl');
    expect(payload.success).toBe(true);
    expect(payload.loadStatus).toBe('success');
    expect(payload.exitCode).toBe(0);
  });

  test('tools/call pact_repl_run on broken.repl reports load failure', async () => {
    const result = await client.callTool({
      name: 'pact_repl_run',
      arguments: { file: 'broken.repl' }
    });
    expect(result.isError).toBe(true);
    const content = (result.content as Array<{ type: string; text: string }>)[0]!;
    const payload = JSON.parse(content.text);
    expect(payload.loadStatus).toBe('failed');
    expect(payload.success).toBe(false);
    expect(payload.exitCode).toBe(1);
  });

  test('tools/call pact_module_scan on a clean module passes', async () => {
    const result = await client.callTool({
      name: 'pact_module_scan',
      arguments: { file: 'module-clean.pact' }
    });
    expect(result.isError).toBeFalsy();
    const content = (result.content as Array<{ type: string; text: string }>)[0]!;
    const payload = JSON.parse(content.text);
    expect(payload.passed).toBe(true);
    expect(payload.trapCount).toBe(0);
  });

  test('tools/call pact_module_scan on a trap module reports critical', async () => {
    const result = await client.callTool({
      name: 'pact_module_scan',
      arguments: { file: 'module-trap-plus.pact' }
    });
    expect(result.isError).toBe(true);
    const content = (result.content as Array<{ type: string; text: string }>)[0]!;
    const payload = JSON.parse(content.text);
    expect(payload.hasCritical).toBe(true);
    expect(payload.traps.some((t: { kind: string }) => t.kind === 'NON_BINARY_PLUS')).toBe(true);
  });

  test('tools/call pact_repl_run on ../ escape is rejected', async () => {
    const result = await client.callTool({
      name: 'pact_repl_run',
      arguments: { file: '../../../etc/passwd' }
    });
    expect(result.isError).toBe(true);
    const content = (result.content as Array<{ type: string; text: string }>)[0]!;
    expect(content.text).toMatch(/extension|workspace|outside/i);
  });

  test('tools/call pact_repl_run_many runs a batch sequentially', async () => {
    const result = await client.callTool({
      name: 'pact_repl_run_many',
      arguments: { files: ['batch-1.repl', 'batch-2.repl'] }
    });
    expect(result.isError).toBeFalsy();
    const content = (result.content as Array<{ type: string; text: string }>)[0]!;
    const payload = JSON.parse(content.text);
    expect(payload.results).toHaveLength(2);
    expect(payload.summary.passed).toBe(2);
    expect(payload.summary.failed).toBe(0);
  });

  test('tools/call pact_repl_run_many with failFast stops early', async () => {
    const result = await client.callTool({
      name: 'pact_repl_run_many',
      arguments: {
        files: ['batch-1.repl', 'batch-fail.repl', 'batch-2.repl'],
        failFast: true
      }
    });
    expect(result.isError).toBe(true);
    const content = (result.content as Array<{ type: string; text: string }>)[0]!;
    const payload = JSON.parse(content.text);
    expect(payload.aborted).toBe(true);
    expect(payload.results.length).toBeLessThan(3);
  });

  test('tools/call pact_gas_estimate parses probe output', async () => {
    const result = await client.callTool({
      name: 'pact_gas_estimate',
      arguments: { file: 'gas-probe.repl' }
    });
    expect(result.isError).toBeFalsy();
    const content = (result.content as Array<{ type: string; text: string }>)[0]!;
    const payload = JSON.parse(content.text);
    expect(payload.measurements.length).toBeGreaterThan(0);
    expect(payload.totalGas).toBeGreaterThan(0);
  });

  test('tools/call pact_gas_estimate warns on missing probes', async () => {
    const result = await client.callTool({
      name: 'pact_gas_estimate',
      arguments: { file: 'gas-no-probe.repl' }
    });
    const content = (result.content as Array<{ type: string; text: string }>)[0]!;
    const payload = JSON.parse(content.text);
    expect(payload.measurements).toEqual([]);
    expect(payload.warning).toMatch(/no gas probes/i);
  });

  test('tools/call pact_interface_diff reports breaking change', async () => {
    const result = await client.callTool({
      name: 'pact_interface_diff',
      arguments: {
        before: 'iface-before.pact',
        after: 'iface-after.pact'
      }
    });
    expect(result.isError).toBeFalsy();
    const content = (result.content as Array<{ type: string; text: string }>)[0]!;
    const payload = JSON.parse(content.text);
    expect(payload.breakingChange).toBe(true);
    expect(payload.added.length).toBeGreaterThan(0);
    expect(payload.removed.length).toBeGreaterThan(0);
    expect(payload.changed.length).toBeGreaterThan(0);
  });

  test('tools/call pact_fmt_check reports clean and dirty files', async () => {
    const result = await client.callTool({
      name: 'pact_fmt_check',
      arguments: { files: ['fmt-clean.pact', 'fmt-dirty.pact'] }
    });
    expect(result.isError).toBeFalsy();
    const content = (result.content as Array<{ type: string; text: string }>)[0]!;
    const payload = JSON.parse(content.text);
    expect(payload.summary.total).toBe(2);
    expect(payload.summary.clean).toBe(1);
    expect(payload.summary.dirty).toBe(1);
  });
});
