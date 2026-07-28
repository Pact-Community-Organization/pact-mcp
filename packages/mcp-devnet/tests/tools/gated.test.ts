/**
 * @fileoverview Unit tests — src/tools/up.ts, down.ts, reset.ts (GATED).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, afterEach } from 'vitest';

import { createUpTool } from '../../src/tools/up.js';
import { createDownTool } from '../../src/tools/down.js';
import { createResetTool } from '../../src/tools/reset.js';
import type { LifecycleFlags } from '../../src/gating.js';
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

const OPEN: LifecycleFlags = { lifecycle: true, volumeWipe: true };
const LIFECYCLE_ONLY: LifecycleFlags = { lifecycle: true, volumeWipe: false };
const CLOSED: LifecycleFlags = { lifecycle: false, volumeWipe: false };

function seed(): { ws: string; bin: (spec: Parameters<typeof createFakeDocker>[0]) => string } {
  const ws = createTempWorkspace({
    'pact-examples/docker-compose.forge.yml': VALID_COMPOSE_CONTENT
  });
  workspaces.push(ws);
  return {
    ws,
    bin: (spec) => {
      const p = createFakeDocker(spec);
      fakes.push(p);
      return p;
    }
  };
}

describe('devnet_up (GATED)', () => {
  it('throws LIFECYCLE_FORBIDDEN when lifecycle flag is false', async () => {
    const { ws, bin } = seed();
    const tool = createUpTool({
      workspaceRoot: ws,
      dockerBin: bin({ stdout: '' }),
      childEnv: { PATH: process.env.PATH ?? "" },
      flags: CLOSED
    });
    await expect(tool({ agent: 'Developer' })).rejects.toMatchObject({
      code: 'LIFECYCLE_FORBIDDEN'
    });
  });

  it('invokes docker compose up -d when gated open', async () => {
    const { ws, bin } = seed();
    const argvFile = path.join(os.tmpdir(), `up-argv-${Date.now()}.json`);
    // Single fake doubles as `up` and `ps` (since status runs after up)
    const fakeBin = bin({
      stdout: '[]',
      exitCode: 0,
      argvCaptureFile: argvFile
    });
    const tool = createUpTool({
      workspaceRoot: ws,
      dockerBin: fakeBin,
      childEnv: { PATH: process.env.PATH ?? "" },
      flags: LIFECYCLE_ONLY
    });
    const { content } = await tool({ agent: 'Developer' });
    expect(content[0]!.started).toBe(true);
    // argvFile only captures the LAST invocation (ps) — inspect it.
    const argv = JSON.parse(fs.readFileSync(argvFile, 'utf-8')) as string[];
    fs.unlinkSync(argvFile);
    expect(argv).toContain('ps');
  });

  it('adds --force-recreate when requested', async () => {
    const { ws, bin } = seed();
    // Script that echoes its argv as stdout so the up-step inspects it
    const script = path.join(os.tmpdir(), `fake-up-${Date.now()}`);
    const src = `#!/usr/bin/env node
const a = process.argv.slice(2).join(' ');
process.stdout.write(a + '\\n');
process.exit(0);
`;
    fs.writeFileSync(script, src, { mode: 0o755 });
    fakes.push(script);
    const tool = createUpTool({
      workspaceRoot: ws,
      dockerBin: script,
      childEnv: { PATH: process.env.PATH ?? "" },
      flags: LIFECYCLE_ONLY
    });
    const { content } = await tool({
      agent: 'Developer',
      forceRecreate: true
    });
    expect(content[0]!.tailOutput).toContain('--force-recreate');
    // appease unused binding
    void bin;
  });
});

describe('devnet_down (GATED)', () => {
  it('throws LIFECYCLE_FORBIDDEN when lifecycle flag is false', async () => {
    const { ws, bin } = seed();
    const tool = createDownTool({
      workspaceRoot: ws,
      dockerBin: bin({ stdout: '' }),
      childEnv: { PATH: process.env.PATH ?? "" },
      flags: CLOSED
    });
    await expect(tool({ agent: 'Developer' })).rejects.toMatchObject({
      code: 'LIFECYCLE_FORBIDDEN'
    });
  });

  it('throws VOLUME_WIPE_FORBIDDEN when wipeVolumes:true without the flag', async () => {
    const { ws, bin } = seed();
    const tool = createDownTool({
      workspaceRoot: ws,
      dockerBin: bin({ stdout: '' }),
      childEnv: { PATH: process.env.PATH ?? "" },
      flags: LIFECYCLE_ONLY
    });
    await expect(
      tool({ agent: 'Developer', wipeVolumes: true })
    ).rejects.toMatchObject({ code: 'VOLUME_WIPE_FORBIDDEN' });
  });

  it('invokes down -v when both flags are set and wipeVolumes:true', async () => {
    const { ws } = seed();
    const script = path.join(os.tmpdir(), `fake-down-${Date.now()}`);
    const src = `#!/usr/bin/env node
process.stdout.write(process.argv.slice(2).join(' ') + '\\n');
process.exit(0);
`;
    fs.writeFileSync(script, src, { mode: 0o755 });
    fakes.push(script);
    const tool = createDownTool({
      workspaceRoot: ws,
      dockerBin: script,
      childEnv: { PATH: process.env.PATH ?? "" },
      flags: OPEN
    });
    const { content } = await tool({ agent: 'Developer', wipeVolumes: true });
    expect(content[0]!.stopped).toBe(true);
    expect(content[0]!.volumesWiped).toBe(true);
    expect(content[0]!.tailOutput).toContain('-v');
  });

  it('does NOT pass -v when wipeVolumes:false', async () => {
    const { ws } = seed();
    const script = path.join(os.tmpdir(), `fake-down2-${Date.now()}`);
    const src = `#!/usr/bin/env node
process.stdout.write(process.argv.slice(2).join(' ') + '\\n');
process.exit(0);
`;
    fs.writeFileSync(script, src, { mode: 0o755 });
    fakes.push(script);
    const tool = createDownTool({
      workspaceRoot: ws,
      dockerBin: script,
      childEnv: { PATH: process.env.PATH ?? "" },
      flags: OPEN
    });
    const { content } = await tool({ agent: 'Developer' });
    expect(content[0]!.volumesWiped).toBe(false);
    expect(content[0]!.tailOutput).not.toMatch(/\s-v(\s|$)/);
  });
});

describe('devnet_reset (GATED)', () => {
  it('throws LIFECYCLE_FORBIDDEN when lifecycle is off', async () => {
    const { ws, bin } = seed();
    const tool = createResetTool({
      workspaceRoot: ws,
      dockerBin: bin({ stdout: '' }),
      childEnv: { PATH: process.env.PATH ?? "" },
      flags: CLOSED
    });
    await expect(tool({ agent: 'Developer' })).rejects.toMatchObject({
      code: 'LIFECYCLE_FORBIDDEN'
    });
  });

  it('throws VOLUME_WIPE_FORBIDDEN when only lifecycle is on', async () => {
    const { ws, bin } = seed();
    const tool = createResetTool({
      workspaceRoot: ws,
      dockerBin: bin({ stdout: '' }),
      childEnv: { PATH: process.env.PATH ?? "" },
      flags: LIFECYCLE_ONLY
    });
    await expect(tool({ agent: 'Developer' })).rejects.toMatchObject({
      code: 'VOLUME_WIPE_FORBIDDEN'
    });
  });

  it('runs down -v then up --force-recreate on success', async () => {
    const { ws } = seed();
    const script = path.join(os.tmpdir(), `fake-reset-${Date.now()}`);
    const src = `#!/usr/bin/env node
process.stdout.write(process.argv.slice(2).join(' ') + '\\n');
process.exit(0);
`;
    fs.writeFileSync(script, src, { mode: 0o755 });
    fakes.push(script);
    const tool = createResetTool({
      workspaceRoot: ws,
      dockerBin: script,
      childEnv: { PATH: process.env.PATH ?? "" },
      flags: OPEN
    });
    const { content } = await tool({ agent: 'Developer' });
    expect(content[0]!.reset).toBe(true);
    expect(content[0]!.tailOutput).toContain('-v');
    expect(content[0]!.tailOutput).toContain('--force-recreate');
  });

  it('aborts up-step if down-step fails', async () => {
    const { ws } = seed();
    const script = path.join(os.tmpdir(), `fake-reset-fail-${Date.now()}`);
    const src = `#!/usr/bin/env node
process.stderr.write('boom\\n');
process.exit(1);
`;
    fs.writeFileSync(script, src, { mode: 0o755 });
    fakes.push(script);
    const tool = createResetTool({
      workspaceRoot: ws,
      dockerBin: script,
      childEnv: { PATH: process.env.PATH ?? "" },
      flags: OPEN
    });
    const { content } = await tool({ agent: 'Developer' });
    expect(content[0]!.reset).toBe(false);
    expect(content[0]!.downStep.stopped).toBe(false);
    expect(content[0]!.upStep.started).toBe(false);
  });
});
