import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHarness, decodeHandlerResult, type Harness } from '../helpers.js';
import { TASK_ID_REGEX } from '../../src/ids.js';

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(() => h.cleanup());

describe('coord_task_create', () => {
  it('creates a task with a fresh T_ id and writes the file', async () => {
    const r = await h.handlers.taskCreate({
      title: 'Ship feature',
      description: 'Build X',
      createdBy: 'Product',
      assignee: 'Developer',
      priority: 'normal',
      tags: ['sprint-1']
    });
    const body = decodeHandlerResult(r) as {
      taskId: string;
      path: string;
      task: { status: string; history: unknown[]; assignee: string };
    };
    expect(TASK_ID_REGEX.test(body.taskId)).toBe(true);
    expect(body.task.status).toBe('pending');
    expect(body.task.assignee).toBe('Developer');
    expect(body.task.history).toHaveLength(1);
    expect(existsSync(path.join(h.workspaceRoot, body.path))).toBe(true);
  });

  it('rejects unknown agent names', async () => {
    await expect(
      h.handlers.taskCreate({
        title: 't',
        description: '',
        createdBy: 'Martian',
        assignee: 'Developer'
      })
    ).rejects.toBeTruthy();
  });

  it('rejects oversized title', async () => {
    await expect(
      h.handlers.taskCreate({
        title: 'x'.repeat(201),
        description: '',
        createdBy: 'Product',
        assignee: 'Developer'
      })
    ).rejects.toBeTruthy();
  });
});
