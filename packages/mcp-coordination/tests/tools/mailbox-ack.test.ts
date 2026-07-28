import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness, decodeHandlerResult, type Harness } from '../helpers.js';

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(() => h.cleanup());

describe('coord_mailbox_ack', () => {
  it('marks specific messages read without touching others', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = decodeHandlerResult(
        await h.handlers.mailboxSend({
          from: 'Orchestrator', to: 'Developer', subject: `s${i}`, body: 'b'
        })
      ) as { messageId: string };
      ids.push(r.messageId);
    }
    const r = decodeHandlerResult(
      await h.handlers.mailboxAck({ agent: 'Developer', messageIds: [ids[0]!, ids[1]!] })
    ) as { acknowledged: number; alreadyRead: number; notFound: number };
    expect(r.acknowledged).toBe(2);
    expect(r.alreadyRead).toBe(0);
    expect(r.notFound).toBe(0);

    const unread = decodeHandlerResult(
      await h.handlers.mailboxRead({ agent: 'Developer', unreadOnly: true })
    ) as { messages: Array<{ messageId: string }> };
    expect(unread.messages).toHaveLength(1);
    expect(unread.messages[0]!.messageId).toBe(ids[2]);
  });

  it('reports alreadyRead for previously acked ids', async () => {
    const r = decodeHandlerResult(
      await h.handlers.mailboxSend({
        from: 'Orchestrator', to: 'Developer', subject: 's', body: 'b'
      })
    ) as { messageId: string };
    await h.handlers.mailboxAck({ agent: 'Developer', messageIds: [r.messageId] });
    const second = decodeHandlerResult(
      await h.handlers.mailboxAck({ agent: 'Developer', messageIds: [r.messageId] })
    ) as { alreadyRead: number };
    expect(second.alreadyRead).toBe(1);
  });

  it('reports notFound for unknown ids', async () => {
    const fake = 'M_' + '0'.repeat(26);
    const r = decodeHandlerResult(
      await h.handlers.mailboxAck({ agent: 'Developer', messageIds: [fake] })
    ) as { acknowledged: number; notFound: number };
    expect(r.acknowledged).toBe(0);
    expect(r.notFound).toBe(1);
  });
});
