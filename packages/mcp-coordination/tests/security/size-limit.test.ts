import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness, type Harness } from '../helpers.js';

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(() => h.cleanup());

describe('size limits are enforced', () => {
  it('mailbox body over 131072 bytes is rejected', async () => {
    await expect(
      h.handlers.mailboxSend({
        from: 'Developer',
        to: 'Tester',
        subject: 's',
        body: 'x'.repeat(131073)
      })
    ).rejects.toBeTruthy();
  });

  it('memory content over 8192 bytes is rejected', async () => {
    await expect(
      h.handlers.memoryAppend({
        scope: 'Developer',
        key: 'big_one',
        topic: 't',
        content: 'x'.repeat(8193),
        addedBy: 'Developer'
      })
    ).rejects.toBeTruthy();
  });

  it('status note over 1000 bytes is rejected', async () => {
    await expect(
      h.handlers.statusSet({
        agent: 'Developer',
        state: 'idle',
        note: 'x'.repeat(1001)
      })
    ).rejects.toBeTruthy();
  });
});
