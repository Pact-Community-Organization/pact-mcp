/**
 * @fileoverview End-to-end integration test — spawns dist/bin.js via
 *               StdioClientTransport and exercises tools/list + tools/call.
 */

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
  const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-intg-'));
  const lockPath = path.join(lockDir, 'tools.lock.json');
  const tools = getToolSchemaObjects();
  const entry = (generateToolsLockEntry(
    SERVER_NAME, tools, SERVER_VERSION, '1.18.0'
  ) as Record<string, { tools: Record<string, unknown> }>)[SERVER_NAME]!;
  fs.writeFileSync(
    lockPath,
    JSON.stringify({ version: 1, servers: { [SERVER_NAME]: entry.tools } }, null, 2)
  );
  return lockPath;
}

function makeWorkspace(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-ws-'));
  fs.mkdirSync(path.join(ws, 'coordination'), { recursive: true });
  return ws;
}

function parseTextResult(
  result: { content: unknown; isError?: boolean }
): Record<string, unknown> {
  const content = result.content as Array<{ type: string; text: string }>;
  expect(content[0]!.type).toBe('text');
  return JSON.parse(content[0]!.text) as Record<string, unknown>;
}

describe('MCP coordination server — integration (stdio)', () => {
  let client: Client;
  let transport: StdioClientTransport;
  let workspaceRoot: string;

  beforeAll(async () => {
    if (!fs.existsSync(binPath)) {
      throw new Error(
        `Binary not built: ${binPath}. Run 'pnpm --filter @pact-community/mcp-coordination build' first.`
      );
    }
    const lockPath = buildLockfile();
    workspaceRoot = makeWorkspace();

    transport = new StdioClientTransport({
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

    client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    if (client) await client.close();
    if (workspaceRoot) fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  test('tools/list returns all 10 coord tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'coord.mailbox_ack',
      'coord.mailbox_read',
      'coord.mailbox_send',
      'coord.memory_append',
      'coord.status_set',
      'coord.task_complete',
      'coord.task_create',
      'coord.task_get',
      'coord.task_list',
      'coord.task_update'
    ]);
    for (const t of tools) {
      expect(t.inputSchema).toBeDefined();
      expect(t.description).toBeTruthy();
    }
  });

  test('full lifecycle: create → list → get → update → complete → send → read → ack → status_set → memory_append', async () => {
    // Create artifact file the completion will reference.
    const artifactRel = 'out.txt';
    fs.writeFileSync(path.join(workspaceRoot, artifactRel), 'hello');

    const createRes = await client.callTool({
      name: 'coord.task_create',
      arguments: {
        title: 'Ship feature',
        description: 'End to end test',
        createdBy: 'Product',
        assignee: 'Developer',
        priority: 'high',
        tags: ['integration']
      }
    });
    const created = parseTextResult(createRes);
    const taskId = created.taskId as string;
    expect(taskId).toMatch(/^T_/);

    const listRes = await client.callTool({
      name: 'coord.task_list',
      arguments: { assignee: 'Developer' }
    });
    const listed = parseTextResult(listRes);
    expect((listed.tasks as Array<{ taskId: string }>).some((t) => t.taskId === taskId)).toBe(true);

    const getRes = await client.callTool({
      name: 'coord.task_get',
      arguments: { taskId }
    });
    const got = parseTextResult(getRes);
    expect((got.task as { taskId: string }).taskId).toBe(taskId);

    const updateRes = await client.callTool({
      name: 'coord.task_update',
      arguments: { taskId, updatedBy: 'Developer', status: 'in_progress', note: 'work' }
    });
    parseTextResult(updateRes);

    const completeRes = await client.callTool({
      name: 'coord.task_complete',
      arguments: {
        taskId,
        completedBy: 'Developer',
        artifacts: [artifactRel],
        note: 'done'
      }
    });
    const completed = parseTextResult(completeRes);
    expect((completed.task as { status: string }).status).toBe('done');

    const sendRes = await client.callTool({
      name: 'coord.mailbox_send',
      arguments: {
        from: 'Developer', to: 'Tester', subject: 'ready', body: 'please review'
      }
    });
    const sent = parseTextResult(sendRes);
    const messageId = sent.messageId as string;
    expect(messageId).toMatch(/^M_/);

    const readRes = await client.callTool({
      name: 'coord.mailbox_read',
      arguments: { agent: 'Tester' }
    });
    const readRead = parseTextResult(readRes);
    expect((readRead.messages as unknown[]).length).toBe(1);

    const ackRes = await client.callTool({
      name: 'coord.mailbox_ack',
      arguments: { agent: 'Tester', messageIds: [messageId] }
    });
    const acked = parseTextResult(ackRes);
    expect(acked.acknowledged).toBe(1);

    const statusRes = await client.callTool({
      name: 'coord.status_set',
      arguments: { agent: 'Developer', state: 'idle', note: 'wrapping up' }
    });
    parseTextResult(statusRes);

    const memRes = await client.callTool({
      name: 'coord.memory_append',
      arguments: {
        scope: 'Developer',
        key: 'integration_pass',
        topic: 'milestone',
        content: 'E2E passed',
        addedBy: 'Developer'
      }
    });
    const mem = parseTextResult(memRes);
    expect(mem.lineNumber).toBe(1);
  }, 30_000);

  test('invalid input raises a structured protocol error', async () => {
    // MCP SDK >=1.29.0: input validation errors return isError:true (not rejection)
    const r = await client.callTool({
      name: 'coord.task_create',
      arguments: { title: 't', description: '', createdBy: 'Ghost', assignee: 'Developer' }
    });
    expect(r.isError).toBe(true);
    const text = (r.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toMatch(/Invalid arguments/);
  });
});
