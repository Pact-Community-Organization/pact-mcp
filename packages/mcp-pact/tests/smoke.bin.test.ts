import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { generateToolsLockEntry } from '@pact-community/mcp-shared';
import { SERVER_NAME, SERVER_VERSION, getToolSchemaObjects } from '../src/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.resolve(here, '../dist/bin.js');
const fixtures = path.resolve(here, 'fixtures');
const mockPact = path.join(fixtures, 'mock-pact.sh');

function buildLockfile(): string {
  const lockDir = fs.mkdtempSync(path.join(process.env['TMPDIR'] ?? '/tmp', 'mcp-pact-smoke-'));
  const lockPath = path.join(lockDir, 'tools.lock.json');
  const entry = (
    generateToolsLockEntry(SERVER_NAME, getToolSchemaObjects(), SERVER_VERSION, '1.18.0') as Record<
      string,
      { tools: Record<string, unknown> }
    >
  )[SERVER_NAME]!;

  fs.writeFileSync(
    lockPath,
    JSON.stringify({ version: 1, servers: { [SERVER_NAME]: entry.tools } }, null, 2)
  );

  return lockPath;
}

describe('smoke: pact binary', () => {
  let client: Client;

  beforeAll(async () => {
    if (!fs.existsSync(binPath)) {
      throw new Error(`Binary not built: ${binPath}`);
    }
    if (!fs.existsSync(mockPact)) {
      throw new Error(`Missing fixture: ${mockPact}`);
    }
    fs.chmodSync(mockPact, 0o755);

    const lockPath = buildLockfile();
    const transport = new StdioClientTransport({
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

    client = new Client({ name: 'smoke-client', version: '0.0.0' }, { capabilities: {} });
    await client.connect(transport);
  });

  afterAll(async () => {
    if (client) await client.close();
  });

  test('registers pact tools and returns structured repl_run response', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('pact.repl_run');

    const result = await client.callTool({
      name: 'pact.repl_run',
      arguments: { file: 'simple.repl' }
    });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(payload.success).toBe(true);
    expect(payload.file).toBe('simple.repl');
  });
});
