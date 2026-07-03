/**
 * @fileoverview coord.mailbox_read — non-mutating inbox read.
 */

import {
  MailboxReadInputShape,
  MailboxReadInputSchema,
  MessageSchema,
  type Message
} from '../schemas/mailbox.js';
import { readJsonlAll } from '../fs/atomic.js';
import type { CoordPaths } from '../fs/paths.js';
import type { AuditLogger } from '@pact-community/mcp-shared';
import { sanitizeFields } from '../sanitize.js';

export { MailboxReadInputShape };

export interface MailboxReadDeps {
  paths: CoordPaths;
  audit: AuditLogger;
}

export function createMailboxReadTool(deps: MailboxReadDeps) {
  return async (args: unknown): Promise<{ content: unknown[] }> => {
    const input = MailboxReadInputSchema.parse(args);
    const target = deps.paths.inboxFile(input.agent);
    const { records, corruptCount } = await readJsonlAll<Message>(
      target,
      (raw) => MessageSchema.parse(raw)
    );
    if (corruptCount > 0) {
      deps.audit.log({
        tool: 'coord.mailbox_read',
        inputHash: `agent:${input.agent}`,
        exitStatus: `CORRUPT_LINES:${corruptCount}`,
        durationMs: 0
      });
    }
    const since = input.sinceIso;
    const filtered = records.filter((m) => {
      if (since !== undefined && !(m.deliveredAt > since)) return false;
      if (input.unreadOnly && m.readAt !== null) return false;
      return true;
    });
    filtered.sort((a, b) => (a.deliveredAt < b.deliveredAt ? -1 : a.deliveredAt > b.deliveredAt ? 1 : 0));
    const hasMore = filtered.length > input.limit;
    const limited = filtered.slice(0, input.limit);
    const sanitized = limited.map((m) =>
      sanitizeFields(m, ['subject', 'body'])
    );
    return {
      content: [
        {
          messages: sanitized,
          corruptCount,
          hasMore
        }
      ]
    };
  };
}
