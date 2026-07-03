/**
 * @fileoverview coord.task_update — atomic task mutation under a file lock.
 */

import {
  TaskUpdateInputShape,
  TaskUpdateInputSchema,
  TaskSchema,
  type Task,
  type TaskHistoryEntry
} from '../schemas/task.js';
import { readJsonOrNull, writeJsonAtomic } from '../fs/atomic.js';
import { withLock } from '../fs/lock.js';
import type { CoordPaths } from '../fs/paths.js';
import {
  McpToolError,
  ErrorCodes,
  type AuditLogger
} from '@pact-community/mcp-shared';
import { sanitizeFields } from '../sanitize.js';

export { TaskUpdateInputShape };

export interface TaskUpdateDeps {
  paths: CoordPaths;
  audit: AuditLogger;
  now?: () => Date;
}

async function loadTask(target: string): Promise<Task> {
  const t = await readJsonOrNull<Task>(target, (raw) => TaskSchema.parse(raw));
  if (!t) {
    throw new McpToolError(ErrorCodes.NOT_FOUND, 'task not found', false);
  }
  return t;
}

export function computeMonotonic(
  historyAts: string[],
  nowIso: string
): string {
  if (historyAts.length === 0) return nowIso;
  const last = historyAts[historyAts.length - 1]!;
  if (nowIso > last) return nowIso;
  const bumped = new Date(new Date(last).getTime() + 1).toISOString();
  return bumped;
}

export function createTaskUpdateTool(deps: TaskUpdateDeps) {
  const now = deps.now ?? (() => new Date());
  return async (args: unknown): Promise<{ content: unknown[] }> => {
    const input = TaskUpdateInputSchema.parse(args);
    const target = deps.paths.taskFile(input.taskId);
    const result = await withLock(target, async () => {
      const task = await loadTask(target);
      const nowIso = computeMonotonic(
        task.history.map((h) => h.at),
        now().toISOString()
      );
      if (input.status !== undefined) task.status = input.status;
      if (input.assignee !== undefined) task.assignee = input.assignee;
      if (input.priority !== undefined) task.priority = input.priority;
      if (input.notes !== undefined) task.notes = input.notes;
      const history: TaskHistoryEntry = {
        at: nowIso,
        by: input.updatedBy,
        kind: 'updated'
      };
      if (input.note !== undefined) history.note = input.note;
      task.history.push(history);
      task.updatedAt = nowIso;
      const next = TaskSchema.parse(task);
      await writeJsonAtomic(target, next);
      return next;
    });
    return {
      content: [
        {
          task: sanitizeFields(result, [
            'title',
            'description',
            'notes',
            'note'
          ])
        }
      ]
    };
  };
}

/** Internal helpers re-exported for task-complete reuse. */
export const __updateInternal = { loadTask };
