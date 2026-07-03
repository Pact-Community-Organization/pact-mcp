/**
 * @fileoverview coord.task_get — fetch a single task.
 */

import {
  TaskGetInputShape,
  TaskGetInputSchema,
  TaskSchema,
  type Task
} from '../schemas/task.js';
import { readJsonOrNull } from '../fs/atomic.js';
import type { CoordPaths } from '../fs/paths.js';
import { McpToolError, ErrorCodes, type AuditLogger } from '@pact-community/mcp-shared';
import { sanitizeFields } from '../sanitize.js';

export { TaskGetInputShape };

export interface TaskGetDeps {
  paths: CoordPaths;
  audit: AuditLogger;
}

export function createTaskGetTool(deps: TaskGetDeps) {
  return async (args: unknown): Promise<{ content: unknown[] }> => {
    const input = TaskGetInputSchema.parse(args);
    const target = deps.paths.taskFile(input.taskId);
    let task: Task | null;
    try {
      task = await readJsonOrNull<Task>(target, (raw) => TaskSchema.parse(raw));
    } catch (error) {
      if (error instanceof McpToolError && error.code === ErrorCodes.CORRUPT_STATE) {
        deps.audit.log({
          tool: 'coord.task_get',
          inputHash: `taskId:${input.taskId}`,
          exitStatus: ErrorCodes.CORRUPT_STATE,
          durationMs: 0
        });
      }
      throw error;
    }
    if (!task) {
      throw new McpToolError(
        ErrorCodes.NOT_FOUND,
        `task not found: ${input.taskId}`,
        false
      );
    }
    return {
      content: [
        {
          task: sanitizeFields(task, [
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
