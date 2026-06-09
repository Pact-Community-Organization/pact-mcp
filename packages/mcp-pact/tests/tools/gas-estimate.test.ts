/**
 * @fileoverview Unit tests for pact.gas_estimate tool
 * @author Developer
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';
import { createGasEstimateTool } from '../../src/tools/gas-estimate.js';

vi.mock('@pact-community/mcp-shared', async () => {
  const actual = await vi.importActual<
    typeof import('@pact-community/mcp-shared')
  >('@pact-community/mcp-shared');
  return { ...actual, spawnWithOutput: vi.fn() };
});

import { spawnWithOutput } from '@pact-community/mcp-shared';
const mockSpawn = vi.mocked(spawnWithOutput);

const fixtures = path.resolve(import.meta.dirname, '../fixtures');
const gas = createGasEstimateTool({ workspaceRoot: fixtures, pactBin: 'pact' });

describe('pact.gas_estimate', () => {
  beforeEach(() => vi.clearAllMocks());

  test('parses explicit Gas: lines', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Load successful\nGas: 150\nGas: 300\n',
      stderr: '',
      exitCode: 0
    });
    const r = await gas({ file: 'gas-probe.repl' });
    const p = r.content[0]!;
    expect(p.exitCode).toBe(0);
    expect(p.measurements).toEqual([
      { gas: 150, lineNumber: 2 },
      { gas: 300, lineNumber: 3 }
    ]);
    expect(p.totalGas).toBe(450);
    expect(p.warning).toBeUndefined();
  });

  test('parses labeled probes (LABEL: Gas: N)', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Load successful\ntransfer: Gas: 500\nclaim: Gas: 700\n',
      stderr: '',
      exitCode: 0
    });
    const r = await gas({ file: 'gas-probe.repl' });
    const p = r.content[0]!;
    expect(p.measurements[0]).toMatchObject({ label: 'transfer', gas: 500 });
    expect(p.measurements[1]).toMatchObject({ label: 'claim', gas: 700 });
  });

  test('parses gas-probe harness form', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Load successful\ngas-probe: deploy = 12345\n',
      stderr: '',
      exitCode: 0
    });
    const r = await gas({ file: 'gas-probe.repl' });
    expect(r.content[0]!.measurements[0]).toMatchObject({
      label: 'deploy',
      gas: 12345
    });
  });

  test('emits warning when no gas probes found', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Load successful\nnothing interesting here\n',
      stderr: '',
      exitCode: 0
    });
    const r = await gas({ file: 'gas-no-probe.repl' });
    const p = r.content[0]!;
    expect(p.measurements).toEqual([]);
    expect(p.warning).toMatch(/no gas probes/i);
    expect(p.totalGas).toBeUndefined();
  });

  test('skips malformed gas lines (no false positives)', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Load successful\nGas: not-a-number\nGas: 42 extra\nGas:\nGas: 7\n',
      stderr: '',
      exitCode: 0
    });
    const r = await gas({ file: 'gas-probe.repl' });
    const p = r.content[0]!;
    expect(p.measurements).toEqual([{ gas: 7, lineNumber: 5 }]);
  });

  test('rejects non-.repl extensions', async () => {
    await expect(gas({ file: 'notes.txt' })).rejects.toMatchObject({
      code: 'INVALID_FILE_TYPE'
    });
  });

  test('rejects missing files', async () => {
    await expect(gas({ file: 'missing.repl' })).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND'
    });
  });

  test('rejects gasLimit above 150_000', async () => {
    await expect(
      gas({ file: 'gas-probe.repl', gasLimit: 200_000 })
    ).rejects.toThrow();
  });

  test('accepts explicit gasLimit within range', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Load successful\nGas: 100\n',
      stderr: '',
      exitCode: 0
    });
    const r = await gas({ file: 'gas-probe.repl', gasLimit: 50_000 });
    expect(r.content[0]!.exitCode).toBe(0);
  });

  test('wraps non-McpToolError spawn failures as EXECUTION_ERROR', async () => {
    mockSpawn.mockRejectedValueOnce(new Error('boom'));
    await expect(gas({ file: 'gas-probe.repl' })).rejects.toMatchObject({
      code: 'EXECUTION_ERROR'
    });
  });

  test('truncates large outputs and still parses leading probes', async () => {
    const big = 'A'.repeat(500 * 1024);
    mockSpawn.mockResolvedValueOnce({
      stdout: `Load successful\nGas: 11\n${big}`,
      stderr: '',
      exitCode: 0
    });
    const r = await gas({ file: 'gas-probe.repl' });
    expect(r.content[0]!.truncated).toBe(true);
    expect(r.content[0]!.measurements[0]!.gas).toBe(11);
  });
});
