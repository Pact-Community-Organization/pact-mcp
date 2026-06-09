/**
 * @fileoverview In-process server invocation via InMemoryTransport for
 *               full coverage of server.ts wrap() and registration code.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { buildMcpServerWithPaths } from '../src/server.js';
import { createCoordPaths, ensureCoordStructure } from '../src/fs/paths.js';

describe('server in-process wrap() coverage', () => {
  let workspaceRoot: string;
  let mcpClient: Client;

  beforeAll(async () => {
    workspaceRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'coord-inproc-')));
    const coordRoot = path.join(workspaceRoot, 'coordination');
    mkdirSync(coordRoot, { recursive: true });
    const paths = createCoordPaths(realpathSync(coordRoot));
    await ensureCoordStructure(paths);
    const server = buildMcpServerWithPaths(workspaceRoot, paths);

    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await (server as unknown as {
      connect: (t: unknown) => Promise<void>;
    }).connect(serverT);

    mcpClient = new Client({ name: 'inproc', version: '0' }, { capabilities: {} });
    await mcpClient.connect(clientT);
  });

  afterAll(async () => {
    if (mcpClient) await mcpClient.close();
    if (workspaceRoot) rmSync(workspaceRoot, { recursive: true, force: true });
  });

  test('tools/list returns 10 tools', async () => {
    const { tools } = await mcpClient.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
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
  });

  test('tools/call coord.task_create succeeds', async () => {
    const r = await mcpClient.callTool({
      name: 'coord.task_create',
      arguments: {
        title: 't', description: 'd', createdBy: 'Product', assignee: 'Developer'
      }
    });
    const content = (r.content as Array<{ type: string; text: string }>)[0]!;
    const body = JSON.parse(content.text);
    expect(body.taskId).toMatch(/^T_/);
  });

  test('tools/call with invalid enum raises protocol error', async () => {
    // MCP SDK >=1.29.0: input validation errors return isError:true (not rejection)
    const r = await mcpClient.callTool({
      name: 'coord.task_create',
      arguments: {
        title: 't', description: '', createdBy: 'Ghost', assignee: 'Developer'
      }
    });
    expect(r.isError).toBe(true);
    const text = (r.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toMatch(/Invalid arguments/);
  });

  test('tools/call surfaces domain errors as isError content', async () => {
    const r = await mcpClient.callTool({
      name: 'coord.task_get',
      arguments: { taskId: 'T_' + '0'.repeat(26) }
    });
    expect(r.isError).toBe(true);
    const content = (r.content as Array<{ type: string; text: string }>)[0]!;
    expect(content.text).toContain('task not found');
  });

  test('full chain: create+update+complete+send+read+ack+status+memory via protocol', async () => {
    const cr = await mcpClient.callTool({
      name: 'coord.task_create',
      arguments: {
        title: 'chain', description: '', createdBy: 'Product', assignee: 'Tester'
      }
    });
    const cc = (cr.content as Array<{ text: string }>)[0]!;
    const created = JSON.parse(cc.text);
    const tid = created.taskId as string;

    const ur = await mcpClient.callTool({
      name: 'coord.task_update',
      arguments: { taskId: tid, updatedBy: 'Tester', status: 'in_progress' }
    });
    expect(ur.content).toBeTruthy();

    const artifact = 'a.txt';
    writeFileSync(path.join(workspaceRoot, artifact), 'x');
    const compR = await mcpClient.callTool({
      name: 'coord.task_complete',
      arguments: {
        taskId: tid, completedBy: 'Tester', artifacts: [artifact]
      }
    });
    const compContent = (compR.content as Array<{ text: string }>)[0]!;
    const completed = JSON.parse(compContent.text);
    expect(completed.task.status).toBe('done');

    const sendR = await mcpClient.callTool({
      name: 'coord.mailbox_send',
      arguments: { from: 'Developer', to: 'Tester', subject: 's', body: 'b' }
    });
    const sc = (sendR.content as Array<{ text: string }>)[0]!;
    const sent = JSON.parse(sc.text);
    const mid = sent.messageId as string;

    const readR = await mcpClient.callTool({
      name: 'coord.mailbox_read',
      arguments: { agent: 'Tester' }
    });
    const rc = (readR.content as Array<{ text: string }>)[0]!;
    JSON.parse(rc.text);

    const ackR = await mcpClient.callTool({
      name: 'coord.mailbox_ack',
      arguments: { agent: 'Tester', messageIds: [mid] }
    });
    const ac = (ackR.content as Array<{ text: string }>)[0]!;
    expect(JSON.parse(ac.text).acknowledged).toBe(1);

    const stR = await mcpClient.callTool({
      name: 'coord.status_set',
      arguments: { agent: 'Developer', state: 'working', note: 'n' }
    });
    expect(stR.content).toBeTruthy();

    const memR = await mcpClient.callTool({
      name: 'coord.memory_append',
      arguments: {
        scope: 'Developer', key: 'ok_key', topic: 't', content: 'c', addedBy: 'Developer'
      }
    });
    const mc = (memR.content as Array<{ text: string }>)[0]!;
    expect(JSON.parse(mc.text).lineNumber).toBe(1);

    const listR = await mcpClient.callTool({
      name: 'coord.task_list',
      arguments: { status: 'done' }
    });
    const lc = (listR.content as Array<{ text: string }>)[0]!;
    const list = JSON.parse(lc.text);
    expect(list.tasks.length).toBeGreaterThanOrEqual(1);
  });
});
