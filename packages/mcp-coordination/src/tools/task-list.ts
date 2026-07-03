/**
 * @fileoverview coord.task_list — list task summaries under filters.
 */

import { promises as fsp } from 'node:fs';
import {
  TaskListInputShape,
  TaskListInputSchema,
  TaskSchema,
  type Task
} from '../schemas/task.js';
import type { CoordPaths } from '../fs/paths.js';
import type { AuditLogger } from '@pact-community/mcp-shared';
import { sanitizeFields } from '../sanitize.js';

export { TaskListInputShape };

export interface TaskListDeps {
  paths: CoordPaths;
  audit: AuditLogger;
}

export function createTaskListTool(deps: TaskListDeps) {
  return async (args: unknown): Promise<{ content: unknown[] }> => {
    const input = TaskListInputSchema.parse(args);
    let entries: string[];
    try {
      entries = await fsp.readdir(deps.paths.taskDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { content: [{ tasks: [], corruptCount: 0 }] };
      }
      throw error;
    }

    const tasks: Task[] = [];
    let corruptCount = 0;
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const full = `${deps.paths.taskDir}/${entry}`;
      let raw: string;
      try {
        raw = await fsp.readFile(full, 'utf8');
      } catch {
        corruptCount += 1;
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        corruptCount += 1;
        deps.audit.log({
          tool: 'coord.task_list',
          inputHash: `corrupt:${entry}`,
          exitStatus: 'CORRUPT_STATE',
          durationMs: 0
        });
        continue;
      }
      const result = TaskSchema.safeParse(parsed);
      if (!result.success) {
        corruptCount += 1;
        deps.audit.log({
          tool: 'coord.task_list',
          inputHash: `schema-fail:${entry}`,
          exitStatus: 'CORRUPT_STATE',
          durationMs: 0
        });
        continue;
      }
      const t = result.data;
      if (input.assignee && t.assignee !== input.assignee) continue;
      if (input.createdBy && t.createdBy !== input.createdBy) continue;
      if (input.status && t.status !== input.status) continue;
      if (input.priority && t.priority !== input.priority) continue;
      tasks.push(t);
    }

    tasks.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    const limited = tasks.slice(0, input.limit);
    const summaries = limited.map((t) => ({
      taskId: t.taskId,
      title: t.title,
      assignee: t.assignee,
      createdBy: t.createdBy,
      status: t.status,
      priority: t.priority,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt
    }));
    const sanitized = sanitizeFields(summaries, ['title']);
    return {
      content: [
        {
          tasks: sanitized,
          corruptCount,
          hasMore: tasks.length > input.limit
        }
      ]
    };
  };
}
