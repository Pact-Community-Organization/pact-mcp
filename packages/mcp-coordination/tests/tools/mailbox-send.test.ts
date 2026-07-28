import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHarness, decodeHandlerResult, type Harness } from '../helpers.js';

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(() => h.cleanup());

describe('coord_mailbox_send', () => {
  it('appends a message to recipient inbox', async () => {
    const r = decodeHandlerResult(
      await h.handlers.mailboxSend({
        from: 'Orchestrator', to: 'Developer', subject: 's', body: 'b'
      })
    ) as { messageId: string; path: string };
    expect(r.messageId).toMatch(/^M_/);
    const line = readFileSync(`${h.paths.mailboxDir}/Developer/inbox.jsonl`, 'utf8').trim();
    const m = JSON.parse(line);
    // On-disk content is the unsanitized source.
    expect(m.subject).toBe('s');
    expect(m.readAt).toBeNull();
  });

  it('rejects body exceeding 131072 bytes', async () => {
    await expect(
      h.handlers.mailboxSend({
        from: 'Orchestrator',
        to: 'Developer',
        subject: 's',
        body: 'x'.repeat(131073)
      })
    ).rejects.toBeTruthy();
  });
});
