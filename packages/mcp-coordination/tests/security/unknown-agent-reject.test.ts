import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness, type Harness } from '../helpers.js';

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(() => h.cleanup());

describe('unknown agent names are rejected at input schema', () => {
  it('taskCreate rejects unknown assignee', async () => {
    await expect(
      h.handlers.taskCreate({
        title: 't', description: '', createdBy: 'Product', assignee: 'Martian' as never
      })
    ).rejects.toBeTruthy();
  });

  it('mailboxSend rejects unknown recipient', async () => {
    await expect(
      h.handlers.mailboxSend({
        from: 'Developer', to: 'Hacker' as never, subject: 's', body: 'b'
      })
    ).rejects.toBeTruthy();
  });

  it('statusSet rejects unknown agent', async () => {
    await expect(
      h.handlers.statusSet({ agent: 'Ghost' as never, state: 'idle' })
    ).rejects.toBeTruthy();
  });
});
