import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHarness, decodeHandlerResult, type Harness } from '../helpers.js';

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(() => h.cleanup());

describe('coord_task_list', () => {
  it('lists and filters tasks', async () => {
    const a = decodeHandlerResult(
      await h.handlers.taskCreate({
        title: 'A', description: '', createdBy: 'Product', assignee: 'Developer'
      })
    ) as { taskId: string };
    await h.handlers.taskCreate({
      title: 'B', description: '', createdBy: 'Product', assignee: 'Tester'
    });
    const all = decodeHandlerResult(await h.handlers.taskList({})) as {
      tasks: Array<{ taskId: string; assignee: string }>;
      corruptCount: number;
    };
    expect(all.tasks).toHaveLength(2);
    expect(all.corruptCount).toBe(0);
    const onlyDev = decodeHandlerResult(
      await h.handlers.taskList({ assignee: 'Developer' })
    ) as { tasks: Array<{ taskId: string }> };
    expect(onlyDev.tasks).toHaveLength(1);
    expect(onlyDev.tasks[0]!.taskId).toBe(a.taskId);
  });

  it('counts corrupt files and skips them', async () => {
    writeFileSync(path.join(h.paths.taskDir, 'T_BOGUS.json'), 'not json', 'utf8');
    writeFileSync(path.join(h.paths.taskDir, 'T_WRONG_SCHEMA.json'), '{"a":1}', 'utf8');
    await h.handlers.taskCreate({
      title: 'good', description: '', createdBy: 'Product', assignee: 'Developer'
    });
    const r = decodeHandlerResult(await h.handlers.taskList({})) as {
      tasks: unknown[];
      corruptCount: number;
    };
    expect(r.tasks).toHaveLength(1);
    expect(r.corruptCount).toBe(2);
  });

  it('returns empty when taskDir is missing', async () => {
    const { rmSync } = await import('node:fs');
    rmSync(h.paths.taskDir, { recursive: true });
    const r = decodeHandlerResult(await h.handlers.taskList({})) as {
      tasks: unknown[];
      corruptCount: number;
    };
    expect(r.tasks).toEqual([]);
    expect(r.corruptCount).toBe(0);
  });
});
