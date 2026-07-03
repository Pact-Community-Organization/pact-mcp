/**
 * @fileoverview Zod schema for per-scope memory append log.
 */

import { z } from 'zod';
import { AgentNameSchema, MemoryScopeSchema } from '../agents.js';

export const MemoryKeySchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'invalid memory key');

export const MemoryEntrySchema = z.object({
  key: MemoryKeySchema,
  topic: z.string().min(1).max(200),
  content: z.string().max(8192),
  addedBy: AgentNameSchema,
  addedAt: z.string().datetime()
});
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

export const MemoryAppendInputShape = {
  scope: MemoryScopeSchema,
  key: MemoryKeySchema,
  topic: z.string().min(1).max(200),
  content: z.string().max(8192),
  addedBy: AgentNameSchema
};
export const MemoryAppendInputSchema = z.object(MemoryAppendInputShape);
export type MemoryAppendInput = z.infer<typeof MemoryAppendInputSchema>;
