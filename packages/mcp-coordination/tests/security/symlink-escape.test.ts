import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { createHarness, decodeHandlerResult, type Harness } from '../helpers.js';
import { McpToolError } from '@pact-community/mcp-shared';

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(() => h.cleanup());

describe('symlink escape rejection', () => {
  it('rejects artifact whose realpath leaves the workspace', async () => {
    const c = decodeHandlerResult(
      await h.handlers.taskCreate({
        title: 't', description: '', createdBy: 'Product', assignee: 'Developer'
      })
    ) as { taskId: string };
    // Create a file OUTSIDE the workspace and symlink INSIDE pointing at it.
    const outsideDir = await fsp.mkdtemp('/tmp/outside-');
    const outsideFile = path.join(outsideDir, 'secret.txt');
    await fsp.writeFile(outsideFile, 'secret');
    const linkName = 'escape-link';
    const insideLink = path.join(h.workspaceRoot, linkName);
    await fsp.symlink(outsideFile, insideLink);
    try {
      await h.handlers.taskComplete({
        taskId: c.taskId,
        completedBy: 'Developer',
        artifacts: [linkName]
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(McpToolError);
    } finally {
      await fsp.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
