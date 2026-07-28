/**
 * @fileoverview End-to-end integration test — spawns the built bin.js as a
 *               stdio MCP server and exercises it via the official SDK
 *               StdioClientTransport.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

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

let tempWorkspace = '';
let fakeDockerBin = '';
let client: Client | undefined;
let transport: StdioClientTransport | undefined;

beforeAll(async () => {
  // Ensure the server is built.
  if (!fs.existsSync(binPath)) {
    throw new Error(`Server bin not built: ${binPath}`);
  }
  if (!fs.existsSync(lockfilePath)) {
    throw new Error(`Lockfile missing: ${lockfilePath}`);
  }

  tempWorkspace = createTempWorkspace({
    'pact-examples/docker-compose.forge.yml': VALID_COMPOSE_CONTENT
  });
  fakeDockerBin = createFakeDocker({
    stdout: JSON.stringify({
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
      PACT_COMMUNITY_WORKSPACE_ROOT: tempWorkspace,
      PACT_COMMUNITY_DEVNET_MODE: 'devnet',
      PACT_COMMUNITY_DEVNET_DOCKER_BIN: fakeDockerBin,
      PACT_COMMUNITY_TOOLS_LOCKFILE: lockfilePath
    }
  });

  client = new Client(
    { name: 'devnet-test-client', version: '0.0.1' },
    { capabilities: {} }
  );
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
  if (tempWorkspace) cleanupTempWorkspace(tempWorkspace);
});

describe('[integration] stdio transport end-to-end', () => {
  it('lists all 6 devnet tools', async () => {
    const result = await client!.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ['devnet_down', 'devnet_health', 'devnet_logs', 'devnet_reset', 'devnet_status', 'devnet_up'].sort()
    );
  });

  it('marks mutating tools with destructiveHint:true', async () => {
    const result = await client!.listTools();
    const byName = Object.fromEntries(result.tools.map((t) => [t.name, t]));
    expect(byName['devnet_up']!.annotations?.destructiveHint).toBe(true);
    expect(byName['devnet_down']!.annotations?.destructiveHint).toBe(true);
    expect(byName['devnet_reset']!.annotations?.destructiveHint).toBe(true);
    expect(byName['devnet_status']!.annotations?.readOnlyHint).toBe(true);
    expect(byName['devnet_health']!.annotations?.readOnlyHint).toBe(true);
    expect(byName['devnet_logs']!.annotations?.readOnlyHint).toBe(true);
  });

  it('devnet_status returns structured JSON content via stdio', async () => {
    const r = await client!.callTool({
      name: 'devnet_status',
      arguments: { agent: 'Developer' }
    });
    expect(r.isError).toBeFalsy();
    const text = (r.content as Array<{ type: string; text: string }>)[0]!.text;
    const parsed = JSON.parse(text) as { overall: string };
    expect(parsed.overall).toBe('up');
  });

  it('devnet_up is rejected as LIFECYCLE_FORBIDDEN when flag is off', async () => {
    const r = await client!.callTool({
      name: 'devnet_up',
      arguments: { agent: 'Developer' }
    });
    // Error is communicated via isError:true (SDK protocol).
    expect(r.isError).toBe(true);
    const text = (r.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toMatch(/PACT_COMMUNITY_DEVNET_ALLOW_LIFECYCLE/);
  });

  it('invalid argv (unknown agent) is rejected with a protocol error', async () => {
    // MCP SDK >=1.29.0: input validation errors return isError:true (not rejection)
    const r = await client!.callTool({
      name: 'devnet_status',
      arguments: { agent: 'Rogue' }
    });
    expect(r.isError).toBe(true);
    const text = (r.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toMatch(/Invalid arguments/);
  });
});
