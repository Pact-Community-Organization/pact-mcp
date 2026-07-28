/**
 * @fileoverview In-process server invocation via InMemoryTransport for
 *               coverage of the buildMcpServer() tool wrappers: read-only
 *               tools succeed against a fake docker + mock devnet, gated
 *               tools surface LIFECYCLE_FORBIDDEN when flags are off.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { buildMcpServer } from '../src/server.js';
import {
  createFakeDocker,
  cleanupFakeDocker,
  createTempWorkspace,
  cleanupTempWorkspace,
  VALID_COMPOSE_CONTENT
} from './fixtures/fake-docker.js';
import { startMockDevnet, type MockDevnetHandle } from './fixtures/mock-devnet.js';

const PS_LINE =
  JSON.stringify({
    Service: 'bootstrap-node',
    State: 'running',
    Status: 'Up 1m',
    Publishers: [{ TargetPort: 8081, PublishedPort: 8081, Protocol: 'tcp' }]
  }) + '\n';

describe('server in-process tool wrapper coverage', () => {
  let workspace = '';
  let fakeDocker = '';
  let mockDevnet: MockDevnetHandle;
  let mcpClient: Client;

  beforeAll(async () => {
    workspace = createTempWorkspace({
      'pact-examples/docker-compose.forge.yml': VALID_COMPOSE_CONTENT,
      'pact-examples/docker-compose.tester.yml': VALID_COMPOSE_CONTENT,
      'pact-examples/docker-compose.security.yml': VALID_COMPOSE_CONTENT
    });
    fakeDocker = createFakeDocker({ stdout: PS_LINE, exitCode: 0 });
    mockDevnet = await startMockDevnet();

    const server = buildMcpServer({
      workspaceRoot: workspace,
      dockerBin: fakeDocker,
      lockfilePath: './tools.lock.json',
      flags: { lifecycle: false, volumeWipe: false },
      childEnv: { PATH: process.env['PATH'] ?? '' },
      allowedOrigins: [],
      additionalAllowedOrigins: [mockDevnet.origin],
      testAgentBaseUrls: { Developer: mockDevnet.origin }
    });

    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await (
      server as unknown as { connect: (t: unknown) => Promise<void> }
    ).connect(serverT);

    mcpClient = new Client({ name: 'inproc', version: '0' }, { capabilities: {} });
    await mcpClient.connect(clientT);
  });

  afterAll(async () => {
    if (mcpClient) await mcpClient.close();
    if (mockDevnet) await mockDevnet.close();
    cleanupFakeDocker(fakeDocker);
    cleanupTempWorkspace(workspace);
  });

  function parsePayload(res: unknown): Record<string, unknown> {
    return JSON.parse(
      ((res as { content: Array<{ text: string }> }).content)[0]!.text
    ) as Record<string, unknown>;
  }

  test('tools/list returns all 6 tools', async () => {
    const { tools } = await mcpClient.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'devnet_down',
      'devnet_health',
      'devnet_logs',
      'devnet_reset',
      'devnet_status',
      'devnet_up'
    ]);
  });

  test('devnet_status reports container state from docker compose ps', async () => {
    const res = await mcpClient.callTool({
      name: 'devnet_status',
      arguments: { agent: 'Developer' }
    });
    expect(res.isError).toBeFalsy();
    const payload = parsePayload(res);
    expect(payload['agent']).toBe('Developer');
  });

  test('devnet_logs returns captured output', async () => {
    const res = await mcpClient.callTool({
      name: 'devnet_logs',
      arguments: { agent: 'Developer' }
    });
    expect(res.isError).toBeFalsy();
  });

  test('devnet_health probes the devnet HTTP endpoints', async () => {
    const res = await mcpClient.callTool({
      name: 'devnet_health',
      arguments: { agent: 'Developer' }
    });
    expect(res.isError).toBeFalsy();
    const payload = parsePayload(res);
    expect(payload['agent']).toBe('Developer');
  });

  test.each(['devnet_up', 'devnet_down', 'devnet_reset'])(
    '%s is refused while lifecycle gating is off',
    async (name) => {
      const res = await mcpClient.callTool({
        name,
        arguments: { agent: 'Developer' }
      });
      expect(res.isError).toBe(true);
      const text = (res.content as Array<{ text: string }>)[0]!.text;
      expect(text).toMatch(/lifecycle|forbidden|disabled/i);
    }
  );
});

describe('lifecycle-enabled server exercises the gated branches', () => {
  let workspace = '';
  let fakeDocker = '';
  let mcpClient: Client;

  async function connectWithFlags(flags: {
    lifecycle: boolean;
    volumeWipe: boolean;
  }): Promise<Client> {
    const server = buildMcpServer({
      workspaceRoot: workspace,
      dockerBin: fakeDocker,
      lockfilePath: './tools.lock.json',
      flags,
      childEnv: { PATH: process.env['PATH'] ?? '' },
      allowedOrigins: [],
      additionalAllowedOrigins: [],
      testAgentBaseUrls: {}
    });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await (
      server as unknown as { connect: (t: unknown) => Promise<void> }
    ).connect(serverT);
    const client = new Client(
      { name: 'inproc-lifecycle', version: '0' },
      { capabilities: {} }
    );
    await client.connect(clientT);
    return client;
  }

  beforeAll(async () => {
    workspace = createTempWorkspace({
      'pact-examples/docker-compose.forge.yml': VALID_COMPOSE_CONTENT
    });
    fakeDocker = createFakeDocker({ stdout: PS_LINE, exitCode: 0 });
    mcpClient = await connectWithFlags({ lifecycle: true, volumeWipe: false });
  });

  afterAll(async () => {
    if (mcpClient) await mcpClient.close();
    cleanupFakeDocker(fakeDocker);
    cleanupTempWorkspace(workspace);
  });

  test('devnet_up succeeds, with and without forceRecreate', async () => {
    for (const forceRecreate of [false, true]) {
      const res = await mcpClient.callTool({
        name: 'devnet_up',
        arguments: { agent: 'Developer', forceRecreate }
      });
      expect(res.isError).toBeFalsy();
    }
  });

  test('devnet_down without volume wipe succeeds', async () => {
    const res = await mcpClient.callTool({
      name: 'devnet_down',
      arguments: { agent: 'Developer', wipeVolumes: false }
    });
    expect(res.isError).toBeFalsy();
  });

  test('devnet_down with wipeVolumes is refused without the wipe flag', async () => {
    const res = await mcpClient.callTool({
      name: 'devnet_down',
      arguments: { agent: 'Developer', wipeVolumes: true }
    });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ text: string }>)[0]!.text;
    expect(text).toMatch(/volume wipe/i);
  });

  test('devnet_reset is refused without the wipe flag', async () => {
    const res = await mcpClient.callTool({
      name: 'devnet_reset',
      arguments: { agent: 'Developer' }
    });
    expect(res.isError).toBe(true);
  });

  test('devnet_reset succeeds when both flags are on', async () => {
    const client = await connectWithFlags({ lifecycle: true, volumeWipe: true });
    try {
      const res = await client.callTool({
        name: 'devnet_reset',
        arguments: { agent: 'Developer' }
      });
      expect(res.isError).toBeFalsy();
      const down = await client.callTool({
        name: 'devnet_down',
        arguments: { agent: 'Developer', wipeVolumes: true }
      });
      expect(down.isError).toBeFalsy();
    } finally {
      await client.close();
    }
  });
});
