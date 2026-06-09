/**
 * @fileoverview coord.task_create — create a new task.
 * @author Developer
 */

import path from 'node:path';
import {
  TaskCreateInputShape,
  TaskCreateInputSchema,
  TaskSchema,
  type Task
} from '../schemas/task.js';
import { generateTaskId } from '../ids.js';
import { writeJsonAtomic } from '../fs/atomic.js';
import type { CoordPaths } from '../fs/paths.js';
import { sanitizeFields } from '../sanitize.js';

export { TaskCreateInputShape };

export interface TaskCreateDeps {
  paths: CoordPaths;
  workspaceRoot: string;
  now?: () => Date;
  idGen?: () => string;
}

export function createTaskCreateTool(deps: TaskCreateDeps) {
  const now = deps.now ?? (() => new Date());
  const idGen = deps.idGen ?? generateTaskId;
  return async (args: unknown): Promise<{ content: unknown[] }> => {
    const input = TaskCreateInputSchema.parse(args);
    const taskId = idGen();
    const nowIso = now().toISOString();
    const task: Task = TaskSchema.parse({
      taskId,
      title: input.title,
      description: input.description,
      createdBy: input.createdBy,
      assignee: input.assignee,
      priority: input.priority,
      status: 'pending',
      createdAt: nowIso,
      updatedAt: nowIso,
      tags: input.tags,
      notes: '',
      artifacts: [],
      history: [
        {
          at: nowIso,
          by: input.createdBy,
          kind: 'created'
        }
      ]
    });
    const target = deps.paths.taskFile(taskId);
    await writeJsonAtomic(target, task);
    const rel = path.relative(deps.workspaceRoot, target);
    const payload = {
      taskId,
      path: rel,
      task: sanitizeFields(task, [
        'title',
        'description',
        'notes',
        'note'
      ])
    };
    return { content: [payload] };
  };
}
