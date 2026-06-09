import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHarness, decodeHandlerResult, type Harness } from '../helpers.js';
import { McpToolError, ErrorCodes } from '@pact-community/mcp-shared';

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(() => h.cleanup());

describe('coord.task_complete', () => {
  it('marks done and records artifact paths', async () => {
    const c = decodeHandlerResult(
      await h.handlers.taskCreate({
        title: 'x', description: '', createdBy: 'Product', assignee: 'Developer'
      })
    ) as { taskId: string };
    const artifactPath = 'out.txt';
    writeFileSync(path.join(h.workspaceRoot, artifactPath), 'hello');
    const r = decodeHandlerResult(
      await h.handlers.taskComplete({
        taskId: c.taskId,
        completedBy: 'Developer',
        artifacts: [artifactPath],
        note: 'done'
      })
    ) as { task: { status: string; artifacts: string[]; completedAt?: string } };
    expect(r.task.status).toBe('done');
    expect(r.task.artifacts).toContain(artifactPath);
    expect(r.task.completedAt).toBeDefined();
  });

  it('throws ARTIFACT_NOT_FOUND when artifact missing', async () => {
    const c = decodeHandlerResult(
      await h.handlers.taskCreate({
        title: 'x', description: '', createdBy: 'Product', assignee: 'Developer'
      })
    ) as { taskId: string };
    try {
      await h.handlers.taskComplete({
        taskId: c.taskId,
        completedBy: 'Developer',
        artifacts: ['nonexistent.txt']
      });
      throw new Error('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(McpToolError);
      expect((e as McpToolError).code).toBe(ErrorCodes.ARTIFACT_NOT_FOUND);
    }
  });
});
