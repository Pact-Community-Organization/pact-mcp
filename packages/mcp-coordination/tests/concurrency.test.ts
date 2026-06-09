import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHarness, decodeHandlerResult, type Harness } from './helpers.js';

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(() => h.cleanup());

const AGENT_ROTATION = [
  'Orchestrator', 'Architect', 'Developer', 'Tester', 'Security',
  'DevOps', 'Product', 'Docs', 'Support', 'Intake'
] as const;

describe('concurrency: task_update under contention', () => {
  it('10 parallel updates all succeed and history is complete with monotonic timestamps', async () => {
    const c = decodeHandlerResult(
      await h.handlers.taskCreate({
        title: 'contended', description: '', createdBy: 'Product', assignee: 'Developer'
      })
    ) as { taskId: string };

    const results = await Promise.all(
      AGENT_ROTATION.map((agent, i) =>
        h.handlers.taskUpdate({
          taskId: c.taskId,
          updatedBy: agent,
          status: i === AGENT_ROTATION.length - 1 ? 'in_progress' : 'in_progress',
          note: `update-${i}`
        })
      )
    );
    expect(results).toHaveLength(10);

    const body = readFileSync(
      path.join(h.paths.taskDir, `${c.taskId}.json`),
      'utf8'
    );
    const task = JSON.parse(body);
    // Initial history entry (created) + 10 updates = 11.
    expect(task.history).toHaveLength(11);

    const stamps = task.history.map((e: { at: string }) => e.at);
    const unique = new Set(stamps);
    expect(unique.size).toBe(stamps.length);

    // Strictly non-decreasing (monotonic).
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i] >= stamps[i - 1]).toBe(true);
    }
  });
});
