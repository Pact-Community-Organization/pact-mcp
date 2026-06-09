/**
 * @fileoverview Symlink escape — symlinks resolving outside the workspace
 *                 must be rejected.
 */

import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { safeTempDir } from '@pact-community/mcp-shared';
import { createReplRunTool } from '../../src/tools/repl-run.js';
import { createModuleScanTool } from '../../src/tools/module-scan.js';

describe('symlink escape', () => {
  test('repl_run rejects a symlink pointing to /etc/passwd', () => {
    const workspace = safeTempDir('mcp-pact-symlink-repl');
    const link = path.join(workspace, 'evil.repl');
    try {
      fs.symlinkSync('/etc/passwd', link);
    } catch {
      // Environment cannot create symlinks — nothing to test.
      return;
    }
    const replRun = createReplRunTool({
      workspaceRoot: workspace,
      pactBin: 'pact'
    });
    return expect(replRun({ file: 'evil.repl' })).rejects.toMatchObject({
      code: 'FILE_OUTSIDE_WORKSPACE'
    });
  });

  test('module_scan rejects a symlink directory escape', () => {
    const workspace = safeTempDir('mcp-pact-symlink-dir');
    const link = path.join(workspace, 'evil');
    try {
      fs.symlinkSync('/etc', link);
    } catch {
      return;
    }
    const scan = createModuleScanTool({ workspaceRoot: workspace });
    return expect(scan({ file: 'evil/hosts.pact' })).rejects.toMatchObject({
      code: expect.stringMatching(
        /FILE_OUTSIDE_WORKSPACE|FILE_NOT_FOUND|FILE_PATH_INVALID/
      )
    });
  });

  test('an in-workspace symlink to an in-workspace file is accepted', async () => {
    const workspace = safeTempDir('mcp-pact-symlink-ok');
    const target = path.join(workspace, 'real.pact');
    fs.writeFileSync(target, '(module m GOVERNANCE (defcap GOVERNANCE () true))');
    const link = path.join(workspace, 'link.pact');
    try {
      fs.symlinkSync(target, link);
    } catch {
      return;
    }
    const scan = createModuleScanTool({ workspaceRoot: workspace });
    const result = await scan({ file: 'link.pact' });
    expect(result.content[0]!.file).toBe('link.pact');
  });
});
