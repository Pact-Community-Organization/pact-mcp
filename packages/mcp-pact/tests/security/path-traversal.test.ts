/**
 * @fileoverview Path-traversal security — both tools must reject ../ escapes.
 */

import { describe, test, expect } from 'vitest';
import path from 'node:path';
import { createReplRunTool } from '../../src/tools/repl-run.js';
import { createModuleScanTool } from '../../src/tools/module-scan.js';

const workspaceRoot = path.resolve(import.meta.dirname, '../fixtures');
const replRun = createReplRunTool({ workspaceRoot, pactBin: 'pact' });
const scan = createModuleScanTool({ workspaceRoot });

describe('path traversal', () => {
  test.each([
    '../../../etc/passwd',
    '../../../../home',
    '/etc/passwd',
    '..\\..\\..\\windows\\system32\\cmd.exe'
  ])('repl_run rejects escape: %s', async (p) => {
    await expect(replRun({ file: p })).rejects.toMatchObject({
      code: expect.stringMatching(
        /FILE_OUTSIDE_WORKSPACE|INVALID_FILE_TYPE|FILE_PATH_INVALID|FILE_NOT_FOUND/
      )
    });
  });

  test.each([
    '../../../etc/hosts',
    '/etc/hosts',
    '../../../../bin/sh'
  ])('module_scan rejects escape: %s', async (p) => {
    await expect(scan({ file: p })).rejects.toMatchObject({
      code: expect.stringMatching(
        /FILE_OUTSIDE_WORKSPACE|INVALID_FILE_TYPE|FILE_PATH_INVALID|FILE_NOT_FOUND/
      )
    });
  });

  test('legitimate relative path is accepted', async () => {
    const result = await scan({ file: 'module-clean.pact' });
    expect(result.content[0]!.passed).toBe(true);
  });
});
