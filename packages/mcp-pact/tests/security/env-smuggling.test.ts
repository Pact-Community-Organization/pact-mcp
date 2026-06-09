/**
 * @fileoverview Env-smuggling — server must reject/log unknown env vars and
 *                must not forward them to the child pact process.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { safeTempDir, generateToolsLockEntry } from '@pact-community/mcp-shared';
import {
  resolveConfig,
  ALLOWED_ENV,
  SERVER_NAME,
  SERVER_VERSION,
  getToolSchemaObjects
} from '../../src/server.js';

describe('env-smuggling', () => {
  let tempWorkspace: string;
  let tempLock: string;
  let lockContent: string;
  let originalEnv: Record<string, string | undefined>;

  beforeAll(() => {
    const tools = getToolSchemaObjects();
    const entry = (generateToolsLockEntry(
      SERVER_NAME,
      tools,
      SERVER_VERSION,
      '1.18.0'
    ) as Record<string, { tools: Record<string, unknown> }>)[SERVER_NAME]!;
    lockContent = JSON.stringify(
      { version: 1, servers: { [SERVER_NAME]: entry.tools } },
      null,
      2
    );
  });

  beforeEach(() => {
    tempWorkspace = safeTempDir('mcp-pact-env');
    tempLock = path.join(tempWorkspace, 'tools.lock.json');
    fs.writeFileSync(tempLock, lockContent);
    originalEnv = { ...process.env };
    for (const key of Object.keys(process.env)) delete process.env[key];
    process.env['PATH'] = originalEnv['PATH'] ?? '/usr/bin:/bin';
    process.env['HOME'] = originalEnv['HOME'] ?? tempWorkspace;
    process.env['PACT_COMMUNITY_WORKSPACE_ROOT'] = tempWorkspace;
    process.env['PACT_COMMUNITY_PACT_BIN'] = 'pact';
    process.env['PACT_COMMUNITY_TOOLS_LOCKFILE'] = tempLock;
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v !== undefined) process.env[k] = v;
    }
  });

  test('rejects missing PACT_COMMUNITY_WORKSPACE_ROOT', () => {
    delete process.env['PACT_COMMUNITY_WORKSPACE_ROOT'];
    expect(() => resolveConfig()).toThrowError(/WORKSPACE_ROOT/);
  });

  test('rejects non-directory workspace root', () => {
    process.env['PACT_COMMUNITY_WORKSPACE_ROOT'] = '/non/existent/path/xyz';
    expect(() => resolveConfig()).toThrowError(/not a directory/i);
  });

  test('unknown env vars are stripped from child env forwarded to pact', () => {
    process.env['MALICIOUS_ENV'] = 'x';
    process.env['LD_PRELOAD'] = '/evil/lib.so';
    const config = resolveConfig();
    expect(config.childEnv['MALICIOUS_ENV']).toBeUndefined();
    expect(config.childEnv['LD_PRELOAD']).toBeUndefined();
    expect(config.childEnv['PATH']).toBeDefined();
    expect(config.childEnv['PACT_COMMUNITY_WORKSPACE_ROOT']).toBe(tempWorkspace);
  });

  test('child env keys are a subset of ALLOWED_ENV', () => {
    process.env['FOO_BAR'] = 'leak-me';
    const config = resolveConfig();
    expect(config.childEnv['FOO_BAR']).toBeUndefined();
    for (const key of Object.keys(config.childEnv)) {
      expect(ALLOWED_ENV).toContain(key);
    }
  });

  test('pactBin defaults to "pact" when unset', () => {
    delete process.env['PACT_COMMUNITY_PACT_BIN'];
    const config = resolveConfig();
    expect(config.pactBin).toBe('pact');
  });
});
