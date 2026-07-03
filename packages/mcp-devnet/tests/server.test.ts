/**
 * @fileoverview Server unit tests — buildMcpServer, resolveDockerBinary,
 *               and schema drift hash inputs.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  buildMcpServer,
  getToolSchemaObjects,
  resolveDockerBinary,
  SERVER_NAME,
  SERVER_VERSION
} from '../src/server.js';

describe('getToolSchemaObjects', () => {
  it('exposes exactly 6 tool schemas', () => {
    const schemas = getToolSchemaObjects();
    expect(Object.keys(schemas).sort()).toEqual(
      ['devnet.down', 'devnet.health', 'devnet.logs', 'devnet.reset', 'devnet.status', 'devnet.up'].sort()
    );
  });
});

describe('resolveDockerBinary (happy path)', () => {
  it('honors an absolute override that exists', () => {
    // Create a throwaway fake binary
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-bin-'));
    const bin = path.join(dir, 'docker');
    fs.writeFileSync(bin, '#!/usr/bin/env node\nprocess.exit(0);\n', {
      mode: 0o755
    });
    try {
      expect(resolveDockerBinary(bin, undefined)).toBe(bin);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildMcpServer', () => {
  it('constructs an McpServer with the expected name + version', () => {
    const mcp = buildMcpServer({
      workspaceRoot: os.tmpdir(),
      dockerBin: '/usr/bin/docker',
      lockfilePath: './tools.lock.json',
      flags: { lifecycle: false, volumeWipe: false },
      childEnv: { PATH: process.env.PATH ?? "" },
      allowedOrigins: ['http://localhost:8081'],
      additionalAllowedOrigins: [],
      testAgentBaseUrls: {}
    });
    // High-level McpServer does not expose name/version directly, but we
    // exported the constants for lockfile drift. Just prove we can build.
    expect(mcp).toBeDefined();
    expect(SERVER_NAME).toBe('pact-community-devnet');
    // Assert against package.json rather than a hardcoded literal so a
    // version bump doesn't require touching this test.
    const pkgVersion = JSON.parse(
      fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ).version;
    expect(SERVER_VERSION).toBe(pkgVersion);
  });
});
