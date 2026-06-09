/**
 * @fileoverview Stdout size cap — 500KB of output must be truncated to ≤200KB
 *                with an explicit marker.
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

describe('stdout size cap', () => {
  beforeEach(() => vi.clearAllMocks());

  test('500KB stdout truncates to ≤200KB with marker', async () => {
    const big = 'x'.repeat(500 * 1024);
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Load successful\n' + big,
      stderr: '',
      exitCode: 0
    });
    const replRun = createReplRunTool({
      workspaceRoot: fixtures,
      pactBin: 'pact'
    });
    const res = await replRun({ file: 'simple.repl' });
    const payload = res.content[0]!;
    expect(payload.truncated).toBe(true);
    expect(payload.output).toContain('[truncated at 200KB]');
    expect(payload.output.length).toBeLessThanOrEqual(200 * 1024 + 64);
  });

  test('stderr is truncated independently', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Load successful',
      stderr: 'y'.repeat(500 * 1024),
      exitCode: 0
    });
    const replRun = createReplRunTool({
      workspaceRoot: fixtures,
      pactBin: 'pact'
    });
    const res = await replRun({ file: 'simple.repl' });
    const payload = res.content[0]!;
    expect(payload.truncated).toBe(true);
    expect(payload.stderr).toContain('[truncated at 200KB]');
    expect(payload.stderr.length).toBeLessThanOrEqual(200 * 1024 + 64);
  });

  test('output under the cap is untouched', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Load successful\nshort output',
      stderr: '',
      exitCode: 0
    });
    const replRun = createReplRunTool({
      workspaceRoot: fixtures,
      pactBin: 'pact'
    });
    const res = await replRun({ file: 'simple.repl' });
    const payload = res.content[0]!;
    expect(payload.truncated).toBe(false);
    expect(payload.output).not.toContain('[truncated at 200KB]');
  });
});
