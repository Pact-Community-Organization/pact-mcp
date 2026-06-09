/**
 * @fileoverview Security — repl_run_many must reject path traversal in ANY
 *               element of the files array BEFORE spawning the pact binary.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import { createReplRunManyTool } from '../../src/tools/repl-run-many.js';

vi.mock('@pact-community/mcp-shared', async () => {
  const actual = await vi.importActual<
    typeof import('@pact-community/mcp-shared')
  >('@pact-community/mcp-shared');
  return { ...actual, spawnWithOutput: vi.fn() };
});
import { spawnWithOutput } from '@pact-community/mcp-shared';
const mockSpawn = vi.mocked(spawnWithOutput);

const fixtures = path.resolve(import.meta.dirname, '../fixtures');
const run = createReplRunManyTool({
  workspaceRoot: fixtures,
  pactBin: 'pact'
});

describe('repl_run_many path traversal', () => {
  beforeEach(() => vi.clearAllMocks());

  test.each([
    '../../../etc/passwd',
    '/etc/shadow',
    '../../../../bin/sh',
    '..\\..\\..\\windows\\cmd.exe'
  ])('rejects escape %s and never spawns', async (evil) => {
    await expect(
      run({ files: ['batch-1.repl', evil] })
    ).rejects.toMatchObject({
      code: expect.stringMatching(
        /FILE_OUTSIDE_WORKSPACE|INVALID_FILE_TYPE|FILE_PATH_INVALID|FILE_NOT_FOUND/
      )
    });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  test('rejects escape even when it is the ONLY file', async () => {
    await expect(
      run({ files: ['../../../etc/passwd'] })
    ).rejects.toBeDefined();
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
