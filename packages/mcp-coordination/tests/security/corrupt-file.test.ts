import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHarness, decodeHandlerResult, type Harness } from '../helpers.js';

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(() => h.cleanup());

describe('corrupt storage tolerance', () => {
  it('task_list skips corrupt task files and counts them', async () => {
    writeFileSync(path.join(h.paths.taskDir, 'T_BAD1.json'), '}{ not json', 'utf8');
    writeFileSync(path.join(h.paths.taskDir, 'T_BAD2.json'), '{"a":"missing-required-fields"}', 'utf8');
    const c = decodeHandlerResult(
      await h.handlers.taskCreate({
        title: 't', description: '', createdBy: 'Product', assignee: 'Developer'
      })
    ) as { taskId: string };
    const r = decodeHandlerResult(await h.handlers.taskList({})) as {
      tasks: Array<{ taskId: string }>;
      corruptCount: number;
    };
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0]!.taskId).toBe(c.taskId);
    expect(r.corruptCount).toBe(2);
  });

  it('mailbox_read preserves corrupt lines verbatim across reads', async () => {
    const inbox = path.join(h.paths.mailboxDir, 'Developer', 'inbox.jsonl');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(path.dirname(inbox), { recursive: true });
    writeFileSync(inbox, 'garbage\n', 'utf8');
    await h.handlers.mailboxSend({
      from: 'Orchestrator', to: 'Developer', subject: 's', body: 'b'
    });
    const r = decodeHandlerResult(
      await h.handlers.mailboxRead({ agent: 'Developer' })
    ) as { messages: unknown[]; corruptCount: number };
    expect(r.messages).toHaveLength(1);
    expect(r.corruptCount).toBe(1);
  });
});
