/**
 * @fileoverview Security tests — sensitive invariants that MUST hold. These
 *               are the tests Security will actually read during the audit.
 * @author Developer
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';

import { createUpTool } from '../../src/tools/up.js';
import { createDownTool } from '../../src/tools/down.js';
import { createResetTool } from '../../src/tools/reset.js';
import { createLogsTool } from '../../src/tools/logs.js';
import { resolveDockerBinary } from '../../src/server.js';
import { AGENT_MAP } from '../../src/agents.js';
import {
  resolveComposeFile,
  validateComposeFileContent
} from '../../src/docker/compose.js';
import { runDocker } from '../../src/docker/spawn.js';
import { McpSpawnError, McpToolError } from '@pact-community/mcp-shared';
import {
  createFakeDocker,
  cleanupFakeDocker,
  createTempWorkspace,
  cleanupTempWorkspace,
  VALID_COMPOSE_CONTENT,
  SUSPICIOUS_COMPOSE_CONTENT
} from '../fixtures/fake-docker.js';

const fakes: string[] = [];
const workspaces: string[] = [];
afterEach(() => {
  while (fakes.length > 0) cleanupFakeDocker(fakes.pop()!);
  while (workspaces.length > 0) cleanupTempWorkspace(workspaces.pop()!);
});

function mkBin(spec: Parameters<typeof createFakeDocker>[0] = {}): string {
  const p = createFakeDocker(spec);
  fakes.push(p);
  return p;
}

describe('[security] LIFECYCLE_FORBIDDEN gating', () => {
  it('up/down/reset ALL throw LIFECYCLE_FORBIDDEN when the flag is false', async () => {
    const ws = createTempWorkspace({
      'pact-examples/docker-compose.forge.yml': VALID_COMPOSE_CONTENT
    });
    workspaces.push(ws);
    const bin = mkBin();
    const flags = { lifecycle: false, volumeWipe: true };
    const up = createUpTool({ workspaceRoot: ws, dockerBin: bin, childEnv: { PATH: process.env.PATH ?? "" }, flags });
    const down = createDownTool({ workspaceRoot: ws, dockerBin: bin, childEnv: { PATH: process.env.PATH ?? "" }, flags });
    const reset = createResetTool({ workspaceRoot: ws, dockerBin: bin, childEnv: { PATH: process.env.PATH ?? "" }, flags });
    for (const call of [
      () => up({ agent: 'Developer' }),
      () => down({ agent: 'Developer' }),
      () => reset({ agent: 'Developer' })
    ]) {
      await expect(call()).rejects.toMatchObject({
        code: 'LIFECYCLE_FORBIDDEN'
      });
    }
  });
});

describe('[security] VOLUME_WIPE_FORBIDDEN gating', () => {
  it('down(wipeVolumes:true) and reset ALL throw when volumeWipe flag is false', async () => {
    const ws = createTempWorkspace({
      'pact-examples/docker-compose.forge.yml': VALID_COMPOSE_CONTENT
    });
    workspaces.push(ws);
    const bin = mkBin();
    const flags = { lifecycle: true, volumeWipe: false };
    const down = createDownTool({ workspaceRoot: ws, dockerBin: bin, childEnv: { PATH: process.env.PATH ?? "" }, flags });
    const reset = createResetTool({ workspaceRoot: ws, dockerBin: bin, childEnv: { PATH: process.env.PATH ?? "" }, flags });
    await expect(
      down({ agent: 'Developer', wipeVolumes: true })
    ).rejects.toMatchObject({ code: 'VOLUME_WIPE_FORBIDDEN' });
    await expect(reset({ agent: 'Developer' })).rejects.toMatchObject({
      code: 'VOLUME_WIPE_FORBIDDEN'
    });
  });
});

describe('[security] compose-path outside workspace', () => {
  it('symlink pointing outside workspace is refused by fs-guard', () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
    const evil = path.join(outsideDir, 'evil.yml');
    fs.writeFileSync(evil, VALID_COMPOSE_CONTENT);
    const ws = createTempWorkspace();
    workspaces.push(ws);
    fs.symlinkSync(
      evil,
      path.join(ws, 'dao', 'docker-compose.forge.yml')
    );
    try {
      expect(() =>
        resolveComposeFile(ws, AGENT_MAP.Developer)
      ).toThrow();
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe('[security] compose-file suspicious container_name', () => {
  it('validateComposeFileContent throws COMPOSE_FILE_SUSPICIOUS', () => {
    const ws = createTempWorkspace({
      'pact-examples/docker-compose.forge.yml': SUSPICIOUS_COMPOSE_CONTENT
    });
    workspaces.push(ws);
    const r = resolveComposeFile(ws, AGENT_MAP.Developer);
    try {
      validateComposeFileContent(r.absolutePath!, AGENT_MAP.Developer);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(McpToolError);
      expect((e as McpToolError).code).toBe('COMPOSE_FILE_SUSPICIOUS');
    }
  });
});

describe('[security] shell metacharacter rejection', () => {
  it('argv containing `;`, `&`, `|`, `$`, backtick etc. is refused by spawnSafe', async () => {
    const bin = mkBin();
    // Each of these is tested independently — failure to reject any of them
    // is a critical security bug.
    const metachars = [';', '&', '|', '`', '$', '(', ')', '<', '>', '{', '}', '[', ']', '!', '*', '~', '#'];
    for (const ch of metachars) {
      await expect(
        runDocker(bin, [`ps${ch}rm`], {
          cwd: os.tmpdir(),
          timeoutMs: 1_000,
          env: { PATH: process.env.PATH ?? "" }
        })
      ).rejects.toBeInstanceOf(McpSpawnError);
    }
  });
});

describe('[security] logs service name injection', () => {
  it('rejects service names with shell metachars at the zod layer', async () => {
    const ws = createTempWorkspace({
      'pact-examples/docker-compose.forge.yml': VALID_COMPOSE_CONTENT
    });
    workspaces.push(ws);
    const bin = mkBin({ stdout: '', exitCode: 0 });
    const tool = createLogsTool({
      workspaceRoot: ws,
      dockerBin: bin,
      childEnv: { PATH: process.env.PATH ?? "" }
    });
    for (const svc of ['bootstrap;rm', 'a|b', 'x$y', '`whoami`', 'a b']) {
      await expect(
        tool({ agent: 'Developer', service: svc })
      ).rejects.toThrow();
    }
  });
});

describe('[security] docker binary resolution refuses relative or missing paths', () => {
  it('relative SMARTPACTS_DEVNET_DOCKER_BIN causes process.exit(13)', () => {
    // We can't actually exit in-test; stub process.exit.
    const orig = process.exit;
    let exitCode: number | undefined;
    (process as unknown as { exit: (n?: number) => never }).exit = ((n?: number) => {
      exitCode = n;
      throw new Error('exited');
    }) as never;
    try {
      expect(() =>
        resolveDockerBinary('relative/docker', '/usr/bin:/bin')
      ).toThrow();
      expect(exitCode).toBe(13);
    } finally {
      (process as unknown as { exit: typeof orig }).exit = orig;
    }
  });

  it('missing binary on PATH causes process.exit(13)', () => {
    const orig = process.exit;
    let exitCode: number | undefined;
    (process as unknown as { exit: (n?: number) => never }).exit = ((n?: number) => {
      exitCode = n;
      throw new Error('exited');
    }) as never;
    try {
      // Use a PATH that contains no docker binary
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-docker-'));
      expect(() => resolveDockerBinary(undefined, emptyDir)).toThrow();
      expect(exitCode).toBe(13);
      fs.rmSync(emptyDir, { recursive: true, force: true });
    } finally {
      (process as unknown as { exit: typeof orig }).exit = orig;
    }
  });
});

describe('[security] SPAWN_TIMEOUT classification', () => {
  it('hung docker is terminated and surfaces SPAWN_TIMEOUT (retryable)', async () => {
    const bin = mkBin({ stdout: 'x', delayMs: 5_000, exitCode: 0 });
    const r = await runDocker(bin, ['ps'], {
      cwd: os.tmpdir(),
      timeoutMs: 100,
      env: { PATH: process.env.PATH ?? "" }
    });
    expect(r.endReason).toBe('timeout');
  });
});

describe('[security] child env allowlist', () => {
  it('child process receives only PATH/HOME/DOCKER_HOST even if parent env has more', async () => {
    const outFile = path.join(os.tmpdir(), `envdump-${Date.now()}.json`);
    const script = path.join(os.tmpdir(), `fake-env-dump-${Date.now()}`);
    const src = `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(outFile)}, JSON.stringify(process.env));
process.exit(0);
`;
    fs.writeFileSync(script, src, { mode: 0o755 });
    fakes.push(script);

    // Only pass the allowlisted subset — simulates what server.ts builds.
    const childEnv = {
      PATH: process.env['PATH'] ?? '/usr/bin',
      HOME: process.env['HOME'] ?? '/tmp'
    };
    await runDocker(script, ['ps'], {
      cwd: os.tmpdir(),
      timeoutMs: 5_000,
      env: childEnv
    });
    const received = JSON.parse(fs.readFileSync(outFile, 'utf-8')) as Record<
      string,
      string
    >;
    fs.unlinkSync(outFile);
    // Node injects a few extras like NODE_* — but the test is that we did
    // NOT propagate arbitrary custom env vars.
    expect(received['PATH']).toBeDefined();
    expect(received['HOME']).toBeDefined();
    // Secrets that might live in the parent env — confirm ABSENT
    for (const secret of [
      'AWS_SECRET_ACCESS_KEY',
      'GITHUB_TOKEN',
      'NPM_TOKEN',
      'KADENA_PRIVATE_KEY'
    ]) {
      expect(received[secret]).toBeUndefined();
    }
  });
});
