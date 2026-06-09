/**
 * @fileoverview Zod schemas for coord task tools.
 * @author Developer
 */

import { z } from 'zod';
import { AgentNameSchema } from '../agents.js';
import { TASK_ID_REGEX } from '../ids.js';

export const PrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export type Priority = z.infer<typeof PrioritySchema>;

export const TaskStatusSchema = z.enum([
  'pending',
  'in_progress',
  'blocked',
  'done',
  'cancelled'
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskIdSchema = z.string().regex(TASK_ID_REGEX, 'invalid taskId');

export const TaskHistoryEntrySchema = z.object({
  at: z.string().datetime(),
  by: AgentNameSchema,
  kind: z.enum(['created', 'updated', 'completed']),
  note: z.string().max(1000).optional()
});
export type TaskHistoryEntry = z.infer<typeof TaskHistoryEntrySchema>;

export const TaskSchema = z.object({
  taskId: TaskIdSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(8192),
  createdBy: AgentNameSchema,
  assignee: AgentNameSchema,
  priority: PrioritySchema,
  status: TaskStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  tags: z.array(z.string().max(40)).max(16).default([]),
  notes: z.string().max(4000).default(''),
  artifacts: z.array(z.string().max(512)).max(32).default([]),
  history: z.array(TaskHistoryEntrySchema).default([])
});
export type Task = z.infer<typeof TaskSchema>;

// -------- tool input shapes --------

export const TaskCreateInputShape = {
  title: z.string().min(1).max(200),
  description: z.string().max(8192),
  createdBy: AgentNameSchema,
  assignee: AgentNameSchema,
  priority: PrioritySchema.default('normal'),
  tags: z.array(z.string().max(40)).max(16).default([])
};
export const TaskCreateInputSchema = z.object(TaskCreateInputShape);
export type TaskCreateInput = z.infer<typeof TaskCreateInputSchema>;

export const TaskListInputShape = {
  assignee: AgentNameSchema.optional(),
  createdBy: AgentNameSchema.optional(),
  status: TaskStatusSchema.optional(),
  priority: PrioritySchema.optional(),
  limit: z.number().int().min(1).max(500).default(100)
};
export const TaskListInputSchema = z.object(TaskListInputShape);
export type TaskListInput = z.infer<typeof TaskListInputSchema>;

export const TaskGetInputShape = {
  taskId: TaskIdSchema
};
export const TaskGetInputSchema = z.object(TaskGetInputShape);
export type TaskGetInput = z.infer<typeof TaskGetInputSchema>;

export const TaskUpdateInputShape = {
  taskId: TaskIdSchema,
  updatedBy: AgentNameSchema,
  status: TaskStatusSchema.optional(),
  assignee: AgentNameSchema.optional(),
  priority: PrioritySchema.optional(),
  notes: z.string().max(4000).optional(),
  note: z.string().max(1000).optional()
};
export const TaskUpdateInputSchema = z.object(TaskUpdateInputShape);
export type TaskUpdateInput = z.infer<typeof TaskUpdateInputSchema>;

export const TaskCompleteInputShape = {
  taskId: TaskIdSchema,
  completedBy: AgentNameSchema,
  artifacts: z.array(z.string().max(512)).max(32).default([]),
  note: z.string().max(1000).optional()
};
export const TaskCompleteInputSchema = z.object(TaskCompleteInputShape);
export type TaskCompleteInput = z.infer<typeof TaskCompleteInputSchema>;
