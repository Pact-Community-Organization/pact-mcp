/**
 * @fileoverview coord_mailbox_send — append a message to an inbox.
 */

import {
  MailboxSendInputShape,
  MailboxSendInputSchema,
  MessageSchema,
  type Message
} from '../schemas/mailbox.js';
import { appendJsonl } from '../fs/atomic.js';
import { generateMessageId } from '../ids.js';
import type { CoordPaths } from '../fs/paths.js';
import { sanitizeFields } from '../sanitize.js';

export { MailboxSendInputShape };

export interface MailboxSendDeps {
  paths: CoordPaths;
  now?: () => Date;
  idGen?: () => string;
}

export function createMailboxSendTool(deps: MailboxSendDeps) {
  const now = deps.now ?? (() => new Date());
  const idGen = deps.idGen ?? generateMessageId;
  return async (args: unknown): Promise<{ content: unknown[] }> => {
    const input = MailboxSendInputSchema.parse(args);
    const messageId = idGen();
    const nowIso = now().toISOString();
    const message: Message = MessageSchema.parse({
      messageId,
      from: input.from,
      to: input.to,
      subject: input.subject,
      body: input.body,
      deliveredAt: nowIso,
      readAt: null
    });
    const target = deps.paths.inboxFile(input.to);
    await appendJsonl(target, message);
    return {
      content: [
        {
          messageId,
          deliveredAt: nowIso,
          message: sanitizeFields(message, ['subject', 'body'])
        }
      ]
    };
  };
}
