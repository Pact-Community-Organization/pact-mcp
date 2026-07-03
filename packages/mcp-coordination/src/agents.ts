/**
 * @fileoverview Canonical Pact Community agent registry.
 */

import { z } from 'zod';

export const AGENT_NAMES = [
  'Intake',
  'Orchestrator',
  'Architect',
  'Developer',
  'Tester',
  'Security',
  'DevOps',
  'Product',
  'Docs',
  'Support'
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

export const AgentNameSchema = z.enum(AGENT_NAMES);

/** Memory scope: either a known agent or the shared log. */
export const MemoryScopeSchema = z.union([
  AgentNameSchema,
  z.literal('shared')
]);

export type MemoryScope = z.infer<typeof MemoryScopeSchema>;
