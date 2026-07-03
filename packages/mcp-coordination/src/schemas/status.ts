/**
 * @fileoverview Zod schema for the per-agent status record.
 */

import { z } from 'zod';
import { AgentNameSchema } from '../agents.js';

export const AgentStateSchema = z.enum([
  'idle',
  'working',
  'blocked',
  'offline'
]);
export type AgentState = z.infer<typeof AgentStateSchema>;

export const StatusSchema = z.object({
  agent: AgentNameSchema,
  state: AgentStateSchema,
  note: z.string().max(1000).default(''),
  updatedAt: z.string().datetime()
});
export type Status = z.infer<typeof StatusSchema>;

export const StatusSetInputShape = {
  agent: AgentNameSchema,
  state: AgentStateSchema,
  note: z.string().max(1000).default('')
};
export const StatusSetInputSchema = z.object(StatusSetInputShape);
export type StatusSetInput = z.infer<typeof StatusSetInputSchema>;
