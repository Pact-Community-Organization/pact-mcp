import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness, decodeHandlerResult, type Harness } from '../helpers.js';
import { McpToolError } from '@pact-community/mcp-shared';

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(() => h.cleanup());

describe('path traversal is rejected on task_complete artifacts', () => {
  it('rejects ../ in artifact path', async () => {
    const c = decodeHandlerResult(
      await h.handlers.taskCreate({
        title: 't', description: '', createdBy: 'Product', assignee: 'Developer'
      })
    ) as { taskId: string };
    try {
      await h.handlers.taskComplete({
        taskId: c.taskId,
        completedBy: 'Developer',
        artifacts: ['../etc/passwd']
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(McpToolError);
      // Must not resolve to a successful completion — the ../ path escaped.
    }
  });

  it('rejects absolute path outside workspace', async () => {
    const c = decodeHandlerResult(
      await h.handlers.taskCreate({
        title: 't', description: '', createdBy: 'Product', assignee: 'Developer'
      })
    ) as { taskId: string };
    try {
      await h.handlers.taskComplete({
        taskId: c.taskId,
        completedBy: 'Developer',
        artifacts: ['/etc/passwd']
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(McpToolError);
    }
  });
});
