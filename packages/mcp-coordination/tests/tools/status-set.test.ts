import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness, decodeHandlerResult, type Harness } from '../helpers.js';

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(() => h.cleanup());

describe('coord_status_set', () => {
  it('writes agent status file', async () => {
    const r = decodeHandlerResult(
      await h.handlers.statusSet({ agent: 'Developer', state: 'working', note: 'n' })
    ) as { path: string; status: { state: string; note: { text: string } } };
    expect(r.status.state).toBe('working');
    expect(r.status.note.text).toBe('n');
  });

  it('rejects invalid state', async () => {
    await expect(
      h.handlers.statusSet({ agent: 'Developer', state: 'bogus' as never })
    ).rejects.toBeTruthy();
  });
});
