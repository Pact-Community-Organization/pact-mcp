import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness, decodeHandlerResult, type Harness } from '../helpers.js';

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(() => h.cleanup());

describe('coord.task_update', () => {
  it('mutates status and appends history', async () => {
    const c = decodeHandlerResult(
      await h.handlers.taskCreate({
        title: 'x', description: '', createdBy: 'Product', assignee: 'Developer'
      })
    ) as { taskId: string };
    const r = decodeHandlerResult(
      await h.handlers.taskUpdate({
        taskId: c.taskId,
        updatedBy: 'Developer',
        status: 'in_progress',
        note: 'started'
      })
    ) as { task: { status: string; history: unknown[] } };
    expect(r.task.status).toBe('in_progress');
    expect(r.task.history).toHaveLength(2);
  });

  it('rejects when taskId missing', async () => {
    const bogus = 'T_' + '0'.repeat(26);
    await expect(
      h.handlers.taskUpdate({ taskId: bogus, updatedBy: 'Developer', status: 'done' })
    ).rejects.toBeTruthy();
  });
});
