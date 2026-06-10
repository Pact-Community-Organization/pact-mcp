import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { generateToolsLockEntry } from '@pact-community/mcp-shared';
import { SERVER_NAME, SERVER_VERSION, getToolSchemaObjects } from '../src/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.resolve(here, '..', 'dist', 'bin.js');

function buildLockfile(): string {
  const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-smoke-'));
  const lockPath = path.join(lockDir, 'tools.lock.json');
  const tools = getToolSchemaObjects();
  const entry = (
    generateToolsLockEntry(SERVER_NAME, tools, SERVER_VERSION, '1.18.0') as Record<
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

describe('smoke: coordination binary', () => {
  let client: Client;
  let workspaceRoot = '';

  beforeAll(async () => {
    if (!fs.existsSync(binPath)) {
      throw new Error(`Binary not built: ${binPath}`);
    }

    const lockPath = buildLockfile();
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-smoke-ws-'));
    fs.mkdirSync(path.join(workspaceRoot, 'coordination'), { recursive: true });

    const transport = new StdioClientTransport({
      command: 'node',
      args: [binPath],
      env: {
        PATH: process.env['PATH'] ?? '/usr/bin:/bin',
        HOME: process.env['HOME'] ?? '/tmp',
        NODE_ENV: 'test',
        PACT_COMMUNITY_WORKSPACE_ROOT: workspaceRoot,
        PACT_COMMUNITY_TOOLS_LOCKFILE: lockPath
      }
    });

    client = new Client({ name: 'smoke-client', version: '0.0.0' }, { capabilities: {} });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    if (client) await client.close();
    if (workspaceRoot) fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  test('registers coord.task_list and returns structured task list', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('coord.task_list');

    const result = await client.callTool({
      name: 'coord.task_list',
      arguments: { assignee: 'Developer' }
    });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(Array.isArray(payload.tasks)).toBe(true);
  });
});
