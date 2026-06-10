import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import {
  createFakeDocker,
  cleanupFakeDocker,
  createTempWorkspace,
  cleanupTempWorkspace,
  VALID_COMPOSE_CONTENT
} from './fixtures/fake-docker.js';

const packageDir = path.resolve(__dirname, '..');
const binPath = path.join(packageDir, 'dist', 'bin.js');
const repoRoot = path.resolve(packageDir, '..', '..');
const lockfilePath = path.join(repoRoot, 'tools.lock.json');

describe('smoke: devnet binary', () => {
  let workspaceRoot = '';
  let fakeDockerBin = '';
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    if (!fs.existsSync(binPath)) {
      throw new Error(`Server bin not built: ${binPath}`);
    }
    if (!fs.existsSync(lockfilePath)) {
      throw new Error(`Lockfile missing: ${lockfilePath}`);
    }

    workspaceRoot = createTempWorkspace({
      'pact-examples/docker-compose.forge.yml': VALID_COMPOSE_CONTENT
    });
    fakeDockerBin = createFakeDocker({
      stdout:
        JSON.stringify({
          Service: 'bootstrap-node',
          State: 'running',
          Status: 'Up 1m',
          Publishers: [{ TargetPort: 8081, PublishedPort: 8081, Protocol: 'tcp' }]
        }) + '\n',
      exitCode: 0
    });

    transport = new StdioClientTransport({
      command: process.execPath,
      args: [binPath],
      env: {
        PATH: process.env['PATH'] ?? '/usr/bin',
        HOME: process.env['HOME'] ?? os.tmpdir(),
        NODE_ENV: 'test',
        PACT_COMMUNITY_WORKSPACE_ROOT: workspaceRoot,
        PACT_COMMUNITY_DEVNET_MODE: 'devnet',
        PACT_COMMUNITY_DEVNET_DOCKER_BIN: fakeDockerBin,
        PACT_COMMUNITY_TOOLS_LOCKFILE: lockfilePath
      }
    });

    client = new Client({ name: 'devnet-smoke-client', version: '0.0.1' }, { capabilities: {} });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    try {
      await client?.close();
    } catch {
      // ignore
    }
    try {
      await transport?.close();
    } catch {
      // ignore
    }
    if (fakeDockerBin) cleanupFakeDocker(fakeDockerBin);
    if (workspaceRoot) cleanupTempWorkspace(workspaceRoot);
  });

  test('registers devnet.status and returns structured status payload', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('devnet.status');

    const result = await client.callTool({
      name: 'devnet.status',
      arguments: { agent: 'Developer' }
    });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(typeof payload.overall).toBe('string');
    expect(Array.isArray(payload.services)).toBe(true);
  });
});
