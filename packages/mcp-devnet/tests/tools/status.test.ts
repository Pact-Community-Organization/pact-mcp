/**
 * @fileoverview Unit tests — src/tools/status.ts
 */

import { describe, it, expect, afterEach } from 'vitest';

import { createStatusTool } from '../../src/tools/status.js';
import {
  createFakeDocker,
  cleanupFakeDocker,
  createTempWorkspace,
  cleanupTempWorkspace,
  VALID_COMPOSE_CONTENT
} from '../fixtures/fake-docker.js';

const fakes: string[] = [];
const workspaces: string[] = [];

afterEach(() => {
  while (fakes.length > 0) cleanupFakeDocker(fakes.pop()!);
  while (workspaces.length > 0) cleanupTempWorkspace(workspaces.pop()!);
});

function makeFake(spec: Parameters<typeof createFakeDocker>[0]): string {
  const p = createFakeDocker(spec);
  fakes.push(p);
  return p;
}
function makeWs(files?: Record<string, string>): string {
  const ws = createTempWorkspace(files);
  workspaces.push(ws);
  return ws;
}

describe('devnet_status tool', () => {
  it('returns overall:missing when the compose file is absent', async () => {
    const ws = makeWs();
    const bin = makeFake({});
    const tool = createStatusTool({
      workspaceRoot: ws,
      dockerBin: bin,
      childEnv: { PATH: process.env.PATH ?? "" }
    });
    const { content } = await tool({ agent: 'Developer' });
    expect(content[0]!.overall).toBe('missing');
    expect(content[0]!.warning).toMatch(/not found/);
    expect(content[0]!.services).toEqual([]);
  });

  it('parses compose ps JSON output and reports overall:up', async () => {
    const ws = makeWs({
      'pact-examples/docker-compose.forge.yml': VALID_COMPOSE_CONTENT
    });
    const stdout =
      JSON.stringify({
        Service: 'bootstrap-node',
        State: 'running',
        Status: 'Up',
        Publishers: [{ TargetPort: 8081, PublishedPort: 8081, Protocol: 'tcp' }]
      }) + '\n';
    const bin = makeFake({ stdout, exitCode: 0 });
    const tool = createStatusTool({
      workspaceRoot: ws,
      dockerBin: bin,
      childEnv: { PATH: process.env.PATH ?? "" }
    });
    const { content } = await tool({ agent: 'Developer' });
    expect(content[0]!.overall).toBe('up');
    expect(content[0]!.services).toHaveLength(1);
    expect(content[0]!.composePath.endsWith('docker-compose.forge.yml')).toBe(
      true
    );
  });

  it('surfaces docker exit failure with stderr warning', async () => {
    const ws = makeWs({
      'pact-examples/docker-compose.forge.yml': VALID_COMPOSE_CONTENT
    });
    const bin = makeFake({
      stdout: '',
      stderr: 'cannot connect to docker daemon\n',
      exitCode: 1
    });
    const tool = createStatusTool({
      workspaceRoot: ws,
      dockerBin: bin,
      childEnv: { PATH: process.env.PATH ?? "" }
    });
    const { content } = await tool({ agent: 'Developer' });
    expect(content[0]!.overall).toBe('down');
    expect(content[0]!.warning).toMatch(/docker daemon/);
  });

  it('throws SPAWN_TIMEOUT if docker hangs past the timeout', async () => {
    const ws = makeWs({
      'pact-examples/docker-compose.forge.yml': VALID_COMPOSE_CONTENT
    });
    const bin = makeFake({ stdout: 'late', delayMs: 3_000, exitCode: 0 });
    const tool = createStatusTool({
      workspaceRoot: ws,
      dockerBin: bin,
      childEnv: { PATH: process.env.PATH ?? "" },
      timeoutMs: 100
    });
    await expect(tool({ agent: 'Developer' })).rejects.toThrowError(
      /SPAWN_TIMEOUT|timed out/
    );
  });

  it('rejects unknown agent via schema', async () => {
    const ws = makeWs();
    const bin = makeFake({});
    const tool = createStatusTool({
      workspaceRoot: ws,
      dockerBin: bin,
      childEnv: { PATH: process.env.PATH ?? "" }
    });
    await expect(tool({ agent: 'Rogue' })).rejects.toThrow();
  });
});
