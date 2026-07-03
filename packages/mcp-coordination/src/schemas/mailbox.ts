/**
 * @fileoverview Zod schemas for coord mailbox tools.
 */

import { z } from 'zod';
import { AgentNameSchema } from '../agents.js';
import { MESSAGE_ID_REGEX } from '../ids.js';

export const MessageIdSchema = z
  .string()
  .regex(MESSAGE_ID_REGEX, 'invalid messageId');

export const MessageSchema = z.object({
  messageId: MessageIdSchema,
  from: AgentNameSchema,
  to: AgentNameSchema,
  subject: z.string().min(1).max(200),
  body: z.string().max(131072),
  deliveredAt: z.string().datetime(),
  readAt: z.string().datetime().nullable()
});
export type Message = z.infer<typeof MessageSchema>;

export const MailboxSendInputShape = {
  from: AgentNameSchema,
  to: AgentNameSchema,
  subject: z.string().min(1).max(200),
  body: z.string().max(131072)
};
export const MailboxSendInputSchema = z.object(MailboxSendInputShape);
export type MailboxSendInput = z.infer<typeof MailboxSendInputSchema>;

export const MailboxReadInputShape = {
  agent: AgentNameSchema,
  sinceIso: z.string().datetime().optional(),
  unreadOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(50)
};
export const MailboxReadInputSchema = z.object(MailboxReadInputShape);
export type MailboxReadInput = z.infer<typeof MailboxReadInputSchema>;

export const MailboxAckInputShape = {
  agent: AgentNameSchema,
  messageIds: z.array(MessageIdSchema).min(1).max(200)
};
export const MailboxAckInputSchema = z.object(MailboxAckInputShape);
export type MailboxAckInput = z.infer<typeof MailboxAckInputSchema>;
