/**
 * @fileoverview Unit tests — src/tools/logs.ts
 * @author Developer
 */

import { describe, it, expect, afterEach } from 'vitest';

import { createLogsTool } from '../../src/tools/logs.js';
import {
  createFakeDocker,
  cleanupFakeDocker,
  createTempWorkspace,
  cleanupTempWorkspace,
  VALID_COMPOSE_CONTENT
} from '../fixtures/fake-docker.js';
import { McpToolError } from '@pact-community/mcp-shared';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const fakes: string[] = [];
const workspaces: string[] = [];
afterEach(() => {
  while (fakes.length > 0) cleanupFakeDocker(fakes.pop()!);
  while (workspaces.length > 0) cleanupTempWorkspace(workspaces.pop()!);
});

describe('devnet.logs tool', () => {
  it('tails compose logs with default tail=500 and no service', async () => {
    const ws = createTempWorkspace({
      'pact-examples/docker-compose.forge.yml': VALID_COMPOSE_CONTENT
    });
    workspaces.push(ws);
    const argvFile = path.join(os.tmpdir(), `logs-argv-${Date.now()}.json`);
    const bin = createFakeDocker({
      stdout: 'line1\nline2\nline3\n',
      exitCode: 0,
      argvCaptureFile: argvFile
    });
    fakes.push(bin);
    const tool = createLogsTool({
      workspaceRoot: ws,
      dockerBin: bin,
      childEnv: { PATH: process.env.PATH ?? "" }
    });
    const { content } = await tool({ agent: 'Developer' });
    expect(content[0]!.content).toContain('line1');
    expect(content[0]!.lines).toBeGreaterThanOrEqual(3);
    const argv = JSON.parse(fs.readFileSync(argvFile, 'utf-8')) as string[];
    fs.unlinkSync(argvFile);
    expect(argv).toContain('logs');
    expect(argv).toContain('--tail');
    expect(argv).toContain('500');
    expect(argv).toContain('--no-color');
  });

  it('passes --since when provided (duration)', async () => {
    const ws = createTempWorkspace({
      'pact-examples/docker-compose.forge.yml': VALID_COMPOSE_CONTENT
    });
    workspaces.push(ws);
    const argvFile = path.join(os.tmpdir(), `logs-argv-${Date.now()}-2.json`);
    const bin = createFakeDocker({
      stdout: '',
      exitCode: 0,
      argvCaptureFile: argvFile
    });
    fakes.push(bin);
    const tool = createLogsTool({
      workspaceRoot: ws,
      dockerBin: bin,
      childEnv: { PATH: process.env.PATH ?? "" }
    });
    await tool({ agent: 'Developer', since: '10m', tail: 100 });
    const argv = JSON.parse(fs.readFileSync(argvFile, 'utf-8')) as string[];
    fs.unlinkSync(argvFile);
    expect(argv).toContain('--since');
    expect(argv).toContain('10m');
    expect(argv).toContain('100');
  });

  it('rejects invalid `since` values', async () => {
    const ws = createTempWorkspace({
      'pact-examples/docker-compose.forge.yml': VALID_COMPOSE_CONTENT
    });
    workspaces.push(ws);
    const bin = createFakeDocker({ stdout: '', exitCode: 0 });
    fakes.push(bin);
    const tool = createLogsTool({
      workspaceRoot: ws,
      dockerBin: bin,
      childEnv: { PATH: process.env.PATH ?? "" }
    });
    await expect(
      tool({ agent: 'Developer', since: 'nonsense; rm -rf /' })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rejects invalid service names via zod regex', async () => {
    const ws = createTempWorkspace({
      'pact-examples/docker-compose.forge.yml': VALID_COMPOSE_CONTENT
    });
    workspaces.push(ws);
    const bin = createFakeDocker({ stdout: '', exitCode: 0 });
    fakes.push(bin);
    const tool = createLogsTool({
      workspaceRoot: ws,
      dockerBin: bin,
      childEnv: { PATH: process.env.PATH ?? "" }
    });
    await expect(
      tool({ agent: 'Developer', service: 'Bad;Name' })
    ).rejects.toThrow();
  });

  it('throws COMPOSE_FILE_MISSING when compose file absent', async () => {
    const ws = createTempWorkspace();
    workspaces.push(ws);
    const bin = createFakeDocker({ stdout: '', exitCode: 0 });
    fakes.push(bin);
    const tool = createLogsTool({
      workspaceRoot: ws,
      dockerBin: bin,
      childEnv: { PATH: process.env.PATH ?? "" }
    });
    await expect(tool({ agent: 'Developer' })).rejects.toMatchObject({
      code: 'COMPOSE_FILE_MISSING'
    });
  });

  it('enforces 1MB output cap via truncated:true', async () => {
    const ws = createTempWorkspace({
      'pact-examples/docker-compose.forge.yml': VALID_COMPOSE_CONTENT
    });
    workspaces.push(ws);
    const huge = 'x'.repeat(2 * 1024 * 1024);
    const bin = createFakeDocker({ stdout: huge, exitCode: 0 });
    fakes.push(bin);
    const tool = createLogsTool({
      workspaceRoot: ws,
      dockerBin: bin,
      childEnv: { PATH: process.env.PATH ?? "" }
    });
    const { content } = await tool({ agent: 'Developer' });
    expect(content[0]!.truncated).toBe(true);
    expect(content[0]!.bytes).toBeLessThanOrEqual(1024 * 1024);
  });

  it('accepts an ISO-8601 `since` value', async () => {
    const ws = createTempWorkspace({
      'pact-examples/docker-compose.forge.yml': VALID_COMPOSE_CONTENT
    });
    workspaces.push(ws);
    const bin = createFakeDocker({ stdout: '', exitCode: 0 });
    fakes.push(bin);
    const tool = createLogsTool({
      workspaceRoot: ws,
      dockerBin: bin,
      childEnv: { PATH: process.env.PATH ?? "" }
    });
    await expect(
      tool({ agent: 'Developer', since: '2026-04-20T12:34:56Z' })
    ).resolves.toBeDefined();
  });
});

// Keep import usage
void McpToolError;
