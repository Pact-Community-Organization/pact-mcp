import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { generateToolsLockEntry } from '@pact-community/mcp-shared';
import { SERVER_NAME, SERVER_VERSION, getToolSchemaObjects } from '../src/server.js';
import { startMockChainweb, type MockHandle } from './fixtures/mock-chainweb.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.resolve(here, '../dist/bin.js');

function buildLockfile(): string {
  const lockDir = fs.mkdtempSync(path.join(process.env['TMPDIR'] ?? '/tmp', 'mcp-chainweb-smoke-'));
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

describe('smoke: chainweb binary', () => {
  let client: Client;
  let mock: MockHandle;

  beforeAll(async () => {
    if (!fs.existsSync(binPath)) {
      throw new Error(`Binary not built: ${binPath}`);
    }

    mock = await startMockChainweb();
    const lockPath = buildLockfile();
    const workspaceRoot = fs.mkdtempSync(path.join(process.env['TMPDIR'] ?? '/tmp', 'mcp-chainweb-smoke-root-'));
    const transport = new StdioClientTransport({
      command: 'node',
      args: [binPath],
      env: {
        PATH: process.env['PATH'] ?? '/usr/bin:/bin',
        HOME: process.env['HOME'] ?? '/tmp',
        NODE_ENV: 'test',
        PACT_COMMUNITY_WORKSPACE_ROOT: workspaceRoot,
        PACT_COMMUNITY_CHAINWEB_MODE: 'devnet',
        PACT_COMMUNITY_CHAINWEB_PROFILE: 'devnet',
        PACT_COMMUNITY_CHAINWEB_BASE_URL: mock.baseUrl,
        PACT_COMMUNITY_CHAINWEB_NETWORK_ID: 'development',
        PACT_COMMUNITY_TOOLS_LOCKFILE: lockPath,
        PACT_COMMUNITY_TEST_ALLOW_ORIGINS: mock.origin
      }
    });

    client = new Client({ name: 'smoke-client', version: '0.0.0' }, { capabilities: {} });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    if (client) await client.close();
    if (mock) await mock.close();
  });

  test('registers chainweb_info and returns structured info payload', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('chainweb_info');

    const result = await client.callTool({ name: 'chainweb_info', arguments: {} });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(payload.networkId).toBe('development');
    expect(Array.isArray(payload.chainIds)).toBe(true);
  });
});
