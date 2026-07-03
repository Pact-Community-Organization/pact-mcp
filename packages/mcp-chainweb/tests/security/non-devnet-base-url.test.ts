/**
 * @fileoverview Security tests for profile-aware base URL allowlists and
 *               mode/profile validation.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

import fs from 'node:fs';
import path from 'node:path';
import {
  safeTempDir,
  generateToolsLockEntry
} from '@pact-community/mcp-shared';
import {
  resolveConfig,
  SERVER_NAME,
  SERVER_VERSION,
  getToolSchemaObjects
} from '../../src/server.js';

describe('profile base-url allowlists', () => {
  let originalEnv: Record<string, string | undefined>;
  let tempWorkspace: string;
  let lockPath: string;

  beforeEach(() => {
    originalEnv = { ...process.env };
    for (const key of Object.keys(process.env)) delete process.env[key];
    process.env['PATH'] = originalEnv['PATH'] ?? '/usr/bin:/bin';
    process.env['HOME'] = originalEnv['HOME'] ?? '/tmp';
    tempWorkspace = safeTempDir('mcp-chainweb-baseurl');
    lockPath = path.join(tempWorkspace, 'tools.lock.json');

    const tools = getToolSchemaObjects();
    const entry = (generateToolsLockEntry(
      SERVER_NAME,
      tools,
      SERVER_VERSION,
      '1.18.0'
    ) as Record<string, { tools: Record<string, unknown> }>)[SERVER_NAME]!;
    fs.writeFileSync(
      lockPath,
      JSON.stringify(
        { version: 1, servers: { [SERVER_NAME]: entry.tools } },
        null,
        2
      )
    );
    process.env['PACT_COMMUNITY_TOOLS_LOCKFILE'] = lockPath;
    process.env['PACT_COMMUNITY_WORKSPACE_ROOT'] = tempWorkspace;
    process.env['PACT_COMMUNITY_CHAINWEB_MODE'] = 'devnet';
    process.env['PACT_COMMUNITY_CHAINWEB_PROFILE'] = 'devnet';
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v !== undefined) process.env[k] = v;
    }
    vi.restoreAllMocks();
  });

  test('exits 13 when base URL origin is outside allowlist', () => {
    process.env['PACT_COMMUNITY_CHAINWEB_BASE_URL'] = 'http://evil.com';
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((_code?: number) => {
        throw new Error('__EXIT_MOCK__');
      }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => resolveConfig()).toThrow('__EXIT_MOCK__');
    expect(exitSpy).toHaveBeenCalledWith(13);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('allowlist');
  });

  test('exits 13 when base URL is not a valid URL', () => {
    process.env['PACT_COMMUNITY_CHAINWEB_BASE_URL'] = 'not a url';
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((_code?: number) => {
        throw new Error('__EXIT_MOCK__');
      }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => resolveConfig()).toThrow('__EXIT_MOCK__');
    expect(exitSpy).toHaveBeenCalledWith(13);
  });

  test('exits 13 when PACT_COMMUNITY_CHAINWEB_MODE is missing', () => {
    delete process.env['PACT_COMMUNITY_CHAINWEB_MODE'];
    process.env['PACT_COMMUNITY_CHAINWEB_BASE_URL'] = 'http://localhost:8081';
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((_code?: number) => {
        throw new Error('__EXIT_MOCK__');
      }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => resolveConfig()).toThrow('__EXIT_MOCK__');
    expect(exitSpy).toHaveBeenCalledWith(13);
  });

  test('exits 13 when PACT_COMMUNITY_CHAINWEB_MODE is not "devnet"', () => {
    process.env['PACT_COMMUNITY_CHAINWEB_MODE'] = 'testnet';
    process.env['PACT_COMMUNITY_CHAINWEB_BASE_URL'] = 'http://localhost:8081';
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((_code?: number) => {
        throw new Error('__EXIT_MOCK__');
      }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => resolveConfig()).toThrow('__EXIT_MOCK__');
    expect(exitSpy).toHaveBeenCalledWith(13);
  });

  test('exits 13 when mode/profile mismatch', () => {
    process.env['PACT_COMMUNITY_CHAINWEB_MODE'] = 'devnet';
    process.env['PACT_COMMUNITY_CHAINWEB_PROFILE'] = 'testnet06';
    process.env['PACT_COMMUNITY_CHAINWEB_BASE_URL'] = 'http://localhost:8081';
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((_code?: number) => {
        throw new Error('__EXIT_MOCK__');
      }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => resolveConfig()).toThrow('__EXIT_MOCK__');
    expect(exitSpy).toHaveBeenCalledWith(13);
  });

  test('resolves successfully with an allowlisted base URL + devnet mode', () => {
    process.env['PACT_COMMUNITY_CHAINWEB_BASE_URL'] = 'http://localhost:8082';
    const config = resolveConfig();
    expect(config.profile).toBe('devnet');
    expect(config.baseUrl).toBe('http://localhost:8082');
    expect(config.networkId).toBe('development');
    expect(config.additionalAllowedOrigins).toEqual([]);
  });

  test('resolves testnet06 profile with official API origin', () => {
    process.env['PACT_COMMUNITY_CHAINWEB_MODE'] = 'testnet06';
    process.env['PACT_COMMUNITY_CHAINWEB_PROFILE'] = 'testnet06';
    process.env['PACT_COMMUNITY_CHAINWEB_BASE_URL'] =
      'https://api.testnet.chainweb-community.org';
    process.env['PACT_COMMUNITY_CHAINWEB_NETWORK_ID'] = 'testnet06';

    const config = resolveConfig();
    expect(config.profile).toBe('testnet06');
    expect(config.writesEnabled).toBe(false);
  });

  test('exits 13 when testnet06 profile uses non-allowlisted origin', () => {
    process.env['PACT_COMMUNITY_CHAINWEB_MODE'] = 'testnet06';
    process.env['PACT_COMMUNITY_CHAINWEB_PROFILE'] = 'testnet06';
    process.env['PACT_COMMUNITY_CHAINWEB_BASE_URL'] = 'http://localhost:8081';
    process.env['PACT_COMMUNITY_CHAINWEB_NETWORK_ID'] = 'testnet06';

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((_code?: number) => {
        throw new Error('__EXIT_MOCK__');
      }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => resolveConfig()).toThrow('__EXIT_MOCK__');
    expect(exitSpy).toHaveBeenCalledWith(13);
  });

  test('resolves mainnet profile with official API origin', () => {
    process.env['PACT_COMMUNITY_CHAINWEB_MODE'] = 'mainnet';
    process.env['PACT_COMMUNITY_CHAINWEB_PROFILE'] = 'mainnet';
    process.env['PACT_COMMUNITY_CHAINWEB_BASE_URL'] =
      'https://api.chainweb-community.org';
    process.env['PACT_COMMUNITY_CHAINWEB_NETWORK_ID'] = 'mainnet01';

    const config = resolveConfig();
    expect(config.profile).toBe('mainnet');
    expect(config.writesEnabled).toBe(false);
  });
});
