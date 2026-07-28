import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness, decodeHandlerResult, type Harness } from '../helpers.js';
import { McpToolError, ErrorCodes } from '@pact-community/mcp-shared';

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(() => h.cleanup());

describe('coord_task_get', () => {
  it('fetches a task', async () => {
    const c = decodeHandlerResult(
      await h.handlers.taskCreate({
        title: 'x', description: '', createdBy: 'Product', assignee: 'Developer'
      })
    ) as { taskId: string };
    const r = decodeHandlerResult(
      await h.handlers.taskGet({ taskId: c.taskId })
    ) as { task: { taskId: string } };
    expect(r.task.taskId).toBe(c.taskId);
  });

  it('throws NOT_FOUND for missing task', async () => {
    const bogus = 'T_' + '0'.repeat(26);
    try {
      await h.handlers.taskGet({ taskId: bogus });
      throw new Error('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(McpToolError);
      expect((e as McpToolError).code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('rejects malformed taskId', async () => {
    await expect(h.handlers.taskGet({ taskId: 'not-a-task' })).rejects.toBeTruthy();
  });
});
