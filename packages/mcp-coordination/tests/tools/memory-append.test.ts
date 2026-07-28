import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness, decodeHandlerResult, type Harness } from '../helpers.js';

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(() => h.cleanup());

describe('coord_memory_append', () => {
  it('appends and returns 1-based line numbers per scope', async () => {
    const r1 = decodeHandlerResult(
      await h.handlers.memoryAppend({
        scope: 'Developer',
        key: 'lesson_one',
        topic: 'learning',
        content: 'first',
        addedBy: 'Developer'
      })
    ) as { lineNumber: number };
    const r2 = decodeHandlerResult(
      await h.handlers.memoryAppend({
        scope: 'shared',
        key: 'note_one',
        topic: 'shared note',
        content: 'second',
        addedBy: 'Orchestrator'
      })
    ) as { lineNumber: number };
    const r3 = decodeHandlerResult(
      await h.handlers.memoryAppend({
        scope: 'Developer',
        key: 'lesson_two',
        topic: 'learning',
        content: 'third',
        addedBy: 'Developer'
      })
    ) as { lineNumber: number };
    expect(r1.lineNumber).toBe(1);
    expect(r2.lineNumber).toBe(1);
    expect(r3.lineNumber).toBe(2);
  });

  it('rejects invalid key format', async () => {
    await expect(
      h.handlers.memoryAppend({
        scope: 'Developer',
        key: 'Bad Key!',
        topic: 't',
        content: 'x',
        addedBy: 'Developer'
      })
    ).rejects.toBeTruthy();
  });

  it('rejects invalid scope', async () => {
    await expect(
      h.handlers.memoryAppend({
        scope: 'Bogus' as never,
        key: 'ok_key',
        topic: 't',
        content: 'x',
        addedBy: 'Developer'
      })
    ).rejects.toBeTruthy();
  });
});
