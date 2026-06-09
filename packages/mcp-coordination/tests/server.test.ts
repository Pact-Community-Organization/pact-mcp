import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveConfig, SERVER_NAME, SERVER_VERSION, getToolSchemaObjects } from '../src/server.js';

const envBackup = { ...process.env };
const REAL_LOCKFILE = path.resolve(__dirname, '..', '..', '..', 'tools.lock.json');
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'srv-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  for (const k of Object.keys(process.env)) {
    if (!(k in envBackup)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(envBackup)) {
    process.env[k] = v;
  }
});

describe('server metadata', () => {
  it('exposes stable name and version', () => {
    expect(SERVER_NAME).toBe('pact-community-coordination');
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('returns all 10 tools from getToolSchemaObjects', () => {
    const tools = getToolSchemaObjects();
    expect(Object.keys(tools)).toHaveLength(10);
    expect(Object.keys(tools)).toContain('coord.task_create');
    expect(Object.keys(tools)).toContain('coord.memory_append');
  });
});

describe('resolveConfig', () => {
  it('returns config when env is valid', () => {
    mkdirSync(path.join(tmp, 'coordination'), { recursive: true });
    process.env.SMARTPACTS_WORKSPACE_ROOT = tmp;
    process.env.SMARTPACTS_TOOLS_LOCKFILE = REAL_LOCKFILE;
    delete process.env.SMARTPACTS_COORDINATION_ROOT;
    const c = resolveConfig();
    expect(c.workspaceRoot).toBe(tmp);
    expect(c.coordinationRoot).toBe(path.join(tmp, 'coordination'));
  });

  it('throws when SMARTPACTS_WORKSPACE_ROOT is missing', () => {
    delete process.env.SMARTPACTS_WORKSPACE_ROOT;
    expect(() => resolveConfig()).toThrow();
  });

  it('throws when SMARTPACTS_WORKSPACE_ROOT is not absolute', () => {
    process.env.SMARTPACTS_WORKSPACE_ROOT = 'relative/path';
    expect(() => resolveConfig()).toThrow();
  });

  it('accepts explicit SMARTPACTS_COORDINATION_ROOT under workspace root', () => {
    const coord = path.join(tmp, 'custom-coord');
    mkdirSync(coord, { recursive: true });
    process.env.SMARTPACTS_WORKSPACE_ROOT = tmp;
    process.env.SMARTPACTS_COORDINATION_ROOT = coord;
    process.env.SMARTPACTS_TOOLS_LOCKFILE = REAL_LOCKFILE;
    const c = resolveConfig();
    expect(c.coordinationRoot).toBe(coord);
  });
});
