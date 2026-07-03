/**
 * @fileoverview In-process server invocation via InMemoryTransport for
 *               coverage of the buildMcpServer() tool wrappers and the
 *               traps-catalog resource callback.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { buildMcpServer, type ResolvedConfig } from '../src/server.js';
import { TRAPS_RESOURCE_URI } from '../src/resources/traps-catalog.js';

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures'
);
const mockPact = path.join(fixturesDir, 'mock-pact.sh');

function textPayload(r: unknown): Record<string, unknown> {
  const content = (r as { content: Array<{ type: string; text: string }> })
    .content[0]!;
  return JSON.parse(content.text) as Record<string, unknown>;
}

describe('server in-process tool wrapper coverage', () => {
  let mcpClient: Client;

  beforeAll(async () => {
    fs.chmodSync(mockPact, 0o755);
    const config: ResolvedConfig = {
      workspaceRoot: fixturesDir,
      pactBin: mockPact,
      lockfilePath: path.join(fixturesDir, 'unused-tools.lock.json'),
      childEnv: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' }
    };
    const server = buildMcpServer(config);

    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await (
      server as unknown as { connect: (t: unknown) => Promise<void> }
    ).connect(serverT);

    mcpClient = new Client({ name: 'inproc', version: '0' }, { capabilities: {} });
    await mcpClient.connect(clientT);
  });

  afterAll(async () => {
    if (mcpClient) await mcpClient.close();
  });

  test('tools/list returns all 6 tools', async () => {
    const { tools } = await mcpClient.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'pact.fmt_check',
      'pact.gas_estimate',
      'pact.interface_diff',
      'pact.module_scan',
      'pact.repl_run',
      'pact.repl_run_many'
    ]);
  });

  test('pact.repl_run succeeds on a passing fixture', async () => {
    const r = await mcpClient.callTool({
      name: 'pact.repl_run',
      arguments: { file: 'simple.repl' }
    });
    const payload = textPayload(r);
    expect(payload['success']).toBe(true);
    expect(r.isError ?? false).toBe(false);
  });

  test('pact.repl_run surfaces tool errors for a missing file', async () => {
    // SDK >=1.29 catches handler throws and returns isError:true results.
    const r = await mcpClient.callTool({
      name: 'pact.repl_run',
      arguments: { file: 'does-not-exist.repl' }
    });
    expect(r.isError).toBe(true);
  });

  test('pact.repl_run_many aggregates batch results', async () => {
    const r = await mcpClient.callTool({
      name: 'pact.repl_run_many',
      arguments: { files: ['batch-1.repl', 'batch-2.repl'] }
    });
    const payload = textPayload(r) as {
      summary: { total: number; passed: number };
    };
    expect(payload.summary.total).toBe(2);
    expect(payload.summary.passed).toBe(2);
  });

  test('pact.module_scan passes on a clean module', async () => {
    const r = await mcpClient.callTool({
      name: 'pact.module_scan',
      arguments: { file: 'module-clean.pact' }
    });
    const payload = textPayload(r);
    expect(payload['passed']).toBe(true);
    expect(r.isError ?? false).toBe(false);
  });

  test('pact.module_scan flags a trapped module as isError', async () => {
    const r = await mcpClient.callTool({
      name: 'pact.module_scan',
      arguments: { file: 'module-trap-mixed.pact' }
    });
    const payload = textPayload(r);
    expect(payload['hasCritical']).toBe(true);
    expect(r.isError).toBe(true);
  });

  test('pact.gas_estimate reads gas probes', async () => {
    const r = await mcpClient.callTool({
      name: 'pact.gas_estimate',
      arguments: { file: 'gas-probe.repl' }
    });
    const payload = textPayload(r);
    expect(r.isError ?? false).toBe(false);
    expect(payload['file']).toBe('gas-probe.repl');
  });

  test('pact.interface_diff compares two files', async () => {
    const r = await mcpClient.callTool({
      name: 'pact.interface_diff',
      arguments: { before: 'iface-before.pact', after: 'iface-after.pact' }
    });
    const payload = textPayload(r);
    expect(r.isError ?? false).toBe(false);
    expect(payload).toHaveProperty('breakingChange');
  });

  test('pact.fmt_check reports clean and dirty files', async () => {
    const r = await mcpClient.callTool({
      name: 'pact.fmt_check',
      arguments: { files: ['fmt-clean.pact', 'fmt-dirty.pact'] }
    });
    const payload = textPayload(r) as {
      summary: { total: number; dirty: number };
    };
    expect(payload.summary.total).toBe(2);
    expect(payload.summary.dirty).toBeGreaterThan(0);
  });

  test('resources/read serves the traps catalog', async () => {
    const r = await mcpClient.readResource({ uri: TRAPS_RESOURCE_URI });
    const first = r.contents[0] as { text: string };
    const catalog = JSON.parse(first.text) as { traps: unknown[] };
    expect(Array.isArray(catalog.traps)).toBe(true);
    expect(catalog.traps.length).toBeGreaterThanOrEqual(5);
  });
});
