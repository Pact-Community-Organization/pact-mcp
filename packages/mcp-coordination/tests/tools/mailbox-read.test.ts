import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness, decodeHandlerResult, type Harness } from '../helpers.js';

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(() => h.cleanup());

async function sendN(h: Harness, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = decodeHandlerResult(
      await h.handlers.mailboxSend({
        from: 'Orchestrator', to: 'Developer', subject: `s${i}`, body: `b${i}`
      })
    ) as { messageId: string };
    ids.push(r.messageId);
  }
  return ids;
}

describe('coord_mailbox_read', () => {
  it('returns messages in send order with hasMore flag', async () => {
    await sendN(h, 3);
    const r = decodeHandlerResult(
      await h.handlers.mailboxRead({ agent: 'Developer', limit: 2 })
    ) as { messages: Array<{ subject: { text: string } }>; hasMore: boolean };
    expect(r.messages).toHaveLength(2);
    expect(r.messages[0]!.subject.text).toBe('s0');
    expect(r.hasMore).toBe(true);
  });

  it('is non-mutating (readAt remains null)', async () => {
    await sendN(h, 1);
    await h.handlers.mailboxRead({ agent: 'Developer' });
    const r = decodeHandlerResult(
      await h.handlers.mailboxRead({ agent: 'Developer', unreadOnly: true })
    ) as { messages: unknown[] };
    expect(r.messages).toHaveLength(1);
  });

  it('returns empty for agent with no mailbox', async () => {
    const r = decodeHandlerResult(
      await h.handlers.mailboxRead({ agent: 'Tester' })
    ) as { messages: unknown[]; corruptCount: number };
    expect(r.messages).toEqual([]);
    expect(r.corruptCount).toBe(0);
  });
});
