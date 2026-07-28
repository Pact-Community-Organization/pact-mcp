/**
 * @fileoverview coord_mailbox_ack — set readAt on selected messages.
 */

import { promises as fsp } from 'node:fs';
import {
  MailboxAckInputShape,
  MailboxAckInputSchema,
  MessageSchema,
  type Message
} from '../schemas/mailbox.js';
import { rewriteJsonl } from '../fs/atomic.js';
import { withLock } from '../fs/lock.js';
import type { CoordPaths } from '../fs/paths.js';
import type { AuditLogger } from '@pact-community/mcp-shared';

export { MailboxAckInputShape };

export interface MailboxAckDeps {
  paths: CoordPaths;
  audit: AuditLogger;
  now?: () => Date;
}

export function createMailboxAckTool(deps: MailboxAckDeps) {
  const now = deps.now ?? (() => new Date());
  return async (args: unknown): Promise<{ content: unknown[] }> => {
    const input = MailboxAckInputSchema.parse(args);
    const target = deps.paths.inboxFile(input.agent);
    const requested = new Set(input.messageIds);
    const result = await withLock(target, async () => {
      let raw: string;
      try {
        raw = await fsp.readFile(target, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return {
            acknowledged: 0,
            alreadyRead: 0,
            notFound: input.messageIds.length
          };
        }
        throw error;
      }
      const messages: Message[] = [];
      const corruptLines: string[] = [];
      for (const rawLine of raw.split('\n')) {
        const line = rawLine.trim();
        if (line.length === 0) continue;
        try {
          const parsed: unknown = JSON.parse(line);
          const res = MessageSchema.safeParse(parsed);
          if (!res.success) {
            corruptLines.push(line);
            continue;
          }
          messages.push(res.data);
        } catch {
          corruptLines.push(line);
        }
      }

      let acknowledged = 0;
      let alreadyRead = 0;
      const seen = new Set<string>();
      const nowIso = now().toISOString();
      for (const m of messages) {
        if (m.to !== input.agent) continue;
        if (!requested.has(m.messageId)) continue;
        seen.add(m.messageId);
        if (m.readAt !== null) {
          alreadyRead += 1;
          continue;
        }
        m.readAt = nowIso;
        acknowledged += 1;
      }
      const notFound = input.messageIds.filter((id) => !seen.has(id)).length;
      await rewriteJsonl(target, messages, corruptLines);
      return { acknowledged, alreadyRead, notFound };
    });
    return { content: [result] };
  };
}
