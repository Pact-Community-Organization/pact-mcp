/**
 * @fileoverview coord.task_complete — finalize a task, verify artifacts.
 * @author Developer
 */

import { promises as fsp } from 'node:fs';
import {
  TaskCompleteInputShape,
  TaskCompleteInputSchema,
  TaskSchema,
  type Task,
  type TaskHistoryEntry
} from '../schemas/task.js';
import { writeJsonAtomic } from '../fs/atomic.js';
import { withLock } from '../fs/lock.js';
import {
  type CoordPaths,
  resolveInsideWorkspace
} from '../fs/paths.js';
import {
  McpToolError,
  ErrorCodes,
  type AuditLogger
} from '@pact-community/mcp-shared';
import {
  __updateInternal,
  computeMonotonic
} from './task-update.js';
import { sanitizeFields } from '../sanitize.js';

export { TaskCompleteInputShape };

export interface TaskCompleteDeps {
  paths: CoordPaths;
  workspaceRoot: string;
  audit: AuditLogger;
  now?: () => Date;
}

export function createTaskCompleteTool(deps: TaskCompleteDeps) {
  const now = deps.now ?? (() => new Date());
  return async (args: unknown): Promise<{ content: unknown[] }> => {
    const input = TaskCompleteInputSchema.parse(args);
    // Pre-validate artifacts BEFORE acquiring the lock so we fail fast.
    const resolvedArtifacts: string[] = [];
    const missing: string[] = [];
    for (const a of input.artifacts) {
      let resolved: string;
      try {
        resolved = await resolveInsideWorkspace(deps.workspaceRoot, a);
      } catch (error) {
        if (error instanceof McpToolError) throw error;
        throw error;
      }
      try {
        await fsp.stat(resolved);
        resolvedArtifacts.push(a);
      } catch {
        missing.push(a);
      }
    }
    if (missing.length > 0) {
      throw new McpToolError(
        ErrorCodes.ARTIFACT_NOT_FOUND,
        `artifacts not found: ${missing.join(', ')}`,
        false
      );
    }
    const target = deps.paths.taskFile(input.taskId);
    const result = await withLock(target, async () => {
      const task = await __updateInternal.loadTask(target);
      const nowIso = computeMonotonic(
        task.history.map((h) => h.at),
        now().toISOString()
      );
      task.status = 'done';
      task.completedAt = nowIso;
      task.updatedAt = nowIso;
      const merged = mergeUnique(task.artifacts, resolvedArtifacts);
      task.artifacts = merged;
      const entry: TaskHistoryEntry = {
        at: nowIso,
        by: input.completedBy,
        kind: 'completed'
      };
      if (input.note !== undefined) entry.note = input.note;
      task.history.push(entry);
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

function mergeUnique(existing: string[], add: string[]): string[] {
  const set = new Set(existing);
  const out: string[] = [...existing];
  for (const a of add) {
    if (!set.has(a)) {
      set.add(a);
      out.push(a);
    }
  }
  return out;
}
