/**
 * @fileoverview Unit tests for pact_module_scan tool
 */

import { describe, test, expect } from 'vitest';
import path from 'node:path';
import { createModuleScanTool } from '../../src/tools/module-scan.js';

const fixtures = path.resolve(import.meta.dirname, '../fixtures');
const scan = createModuleScanTool({ workspaceRoot: fixtures });

describe('pact_module_scan', () => {
  test('passes a clean module with no traps', async () => {
    const result = await scan({ file: 'module-clean.pact' });
    const payload = result.content[0]!;
    expect(payload.passed).toBe(true);
    expect(payload.hasCritical).toBe(false);
    expect(payload.trapCount).toBe(0);
    expect(payload.traps).toHaveLength(0);
  });

  test('detects NON_BINARY_PLUS', async () => {
    const result = await scan({ file: 'module-trap-plus.pact' });
    const payload = result.content[0]!;
    expect(payload.hasCritical).toBe(true);
    const trap = payload.traps.find((t) => t.kind === 'NON_BINARY_PLUS');
    expect(trap).toBeDefined();
    expect(trap!.severity).toBe('critical');
    expect(trap!.line).toBeGreaterThan(0);
    expect(trap!.fix).toContain('(+ a (+ b c))');
  });

  test('detects TRY_DML', async () => {
    const result = await scan({ file: 'module-trap-try-dml.pact' });
    const payload = result.content[0]!;
    expect(payload.hasCritical).toBe(true);
    const trap = payload.traps.find((t) => t.kind === 'TRY_DML');
    expect(trap).toBeDefined();
    expect(trap!.severity).toBe('critical');
    expect(trap!.message).toContain('write');
  });

  test('detects ENFORCE_DB_READ', async () => {
    const result = await scan({ file: 'module-trap-enforce-read.pact' });
    const payload = result.content[0]!;
    expect(payload.hasCritical).toBe(true);
    const trap = payload.traps.find((t) => t.kind === 'ENFORCE_DB_READ');
    expect(trap).toBeDefined();
    expect(trap!.severity).toBe('critical');
    expect(trap!.fix).toContain('let');
  });

  test('detects BUILTIN_SHADOW', async () => {
    const result = await scan({ file: 'module-trap-shadow.pact' });
    const payload = result.content[0]!;
    expect(payload.hasCritical).toBe(true);
    const trap = payload.traps.find((t) => t.kind === 'BUILTIN_SHADOW');
    expect(trap).toBeDefined();
    expect(trap!.severity).toBe('critical');
    expect(trap!.message).toContain('shadows');
  });

  test('detects BARE_PACT_ID', async () => {
    const result = await scan({ file: 'module-trap-bare-pact-id.pact' });
    const payload = result.content[0]!;
    const trap = payload.traps.find((t) => t.kind === 'BARE_PACT_ID');
    expect(trap).toBeDefined();
    expect(trap!.severity).toBe('high');
  });

  test('sorts traps by 1-based line number', async () => {
    const result = await scan({ file: 'module-trap-mixed.pact' });
    const payload = result.content[0]!;
    expect(payload.trapCount).toBeGreaterThan(1);
    for (let i = 1; i < payload.traps.length; i++) {
      expect(payload.traps[i]!.line).toBeGreaterThanOrEqual(
        payload.traps[i - 1]!.line
      );
    }
  });

  test('rejects non-.pact extensions', async () => {
    await expect(scan({ file: 'simple.repl' })).rejects.toMatchObject({
      code: 'INVALID_FILE_TYPE'
    });
  });

  test('rejects missing files', async () => {
    await expect(scan({ file: 'missing.pact' })).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND'
    });
  });

  test('rejects invalid input', async () => {
    await expect(scan({})).rejects.toThrow();
    await expect(scan({ file: 123 })).rejects.toThrow();
  });
});
