/**
 * @fileoverview Branch-coverage tests for error and filter paths that the
 *               main suites don't reach: ULID same-millisecond bumping,
 *               segment/root validation failures, corrupt-state mapping,
 *               and task_list filtering.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fsp } from 'node:fs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { McpToolError } from '@pact-community/mcp-shared';

import {
  generateTaskId,
  generateMessageId,
  TASK_ID_REGEX,
  MESSAGE_ID_REGEX
} from '../src/ids.js';
import {
  assertSegment,
  confirmInsideRoot,
  verifyCoordRoot
} from '../src/fs/paths.js';
import { readJsonOrNull, writeJsonAtomic } from '../src/fs/atomic.js';
import { createHarness, type Harness, decodeHandlerResult } from './helpers.js';

describe('ids', () => {
  it('stays unique and well-formed when generated within one millisecond', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const id = generateTaskId();
      expect(id).toMatch(TASK_ID_REGEX);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(generateMessageId()).toMatch(MESSAGE_ID_REGEX);
  });
});

describe('paths validation branches', () => {
  it.each([
    ['', 'empty'],
    ['.', 'dot'],
    ['..', 'dotdot'],
    ['.hidden', 'leading dot'],
    ['a/b', 'slash'],
    ['a\\b', 'backslash'],
    ['a\0b', 'NUL byte'],
    ['spa ce', 'unsupported characters']
  ])('assertSegment rejects %j (%s)', (segment) => {
    expect(() => assertSegment(segment as string, 'seg')).toThrow(McpToolError);
  });

  it('confirmInsideRoot rejects escapes above the root', async () => {
    const h = await createHarness();
    try {
      expect(() =>
        confirmInsideRoot(h.coordRoot, path.join(h.coordRoot, '..', 'outside'))
      ).toThrow(McpToolError);
    } finally {
      h.cleanup();
    }
  });

  it('verifyCoordRoot rejects relative, missing, and non-directory roots', async () => {
    expect(() => verifyCoordRoot('relative/coordination')).toThrow(/absolute/);
    expect(() => verifyCoordRoot('/definitely/not/a/real/dir-xyz')).toThrow(
      /not accessible/
    );
    const h = await createHarness();
    try {
      const filePath = path.join(h.coordRoot, 'a-file.txt');
      writeFileSync(filePath, 'x');
      expect(() => verifyCoordRoot(filePath)).toThrow(/not a directory/);
    } finally {
      h.cleanup();
    }
  });
});

describe('atomic error branches', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => {
    h.cleanup();
  });

  it('readJsonOrNull returns null on ENOENT', async () => {
    const out = await readJsonOrNull(
      path.join(h.coordRoot, 'nope.json'),
      (raw) => raw
    );
    expect(out).toBeNull();
  });

  it('readJsonOrNull maps unreadable targets to CORRUPT_STATE', async () => {
    await expect(
      readJsonOrNull(h.coordRoot, (raw) => raw) // a directory, not a file
    ).rejects.toThrow(/failed to read/);
  });

  it('readJsonOrNull maps invalid JSON to CORRUPT_STATE', async () => {
    const target = path.join(h.coordRoot, 'garbage.json');
    writeFileSync(target, '{ not json');
    await expect(readJsonOrNull(target, (raw) => raw)).rejects.toThrow(
      McpToolError
    );
  });

  it('writeJsonAtomic surfaces failures and cleans up its temp file', async () => {
    const lockedDir = path.join(h.coordRoot, 'locked');
    await fsp.mkdir(lockedDir);
    await fsp.chmod(lockedDir, 0o500); // no write permission
    const target = path.join(lockedDir, 'x.json');
    try {
      await expect(writeJsonAtomic(target, { a: 1 })).rejects.toThrow();
      const leftovers = await fsp.readdir(lockedDir);
      expect(leftovers).toHaveLength(0);
    } finally {
      await fsp.chmod(lockedDir, 0o700);
    }
  });
});

describe('tool error and filter branches', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => {
    h.cleanup();
  });

  it('task_get maps a corrupt task file to CORRUPT_STATE', async () => {
    const taskId = generateTaskId();
    writeFileSync(h.paths.taskFile(taskId), '{ definitely not json');
    await expect(h.handlers.taskGet({ taskId })).rejects.toThrow(McpToolError);
  });

  it('task_list applies assignee/createdBy/status/priority filters', async () => {
    await h.handlers.taskCreate({
      title: 'for dev',
      description: 'd',
      createdBy: 'Orchestrator',
      assignee: 'Developer',
      priority: 'high'
    });
    await h.handlers.taskCreate({
      title: 'for tester',
      description: 'd',
      createdBy: 'Product',
      assignee: 'Tester'
    });

    const byAssignee = decodeHandlerResult(
      await h.handlers.taskList({ assignee: 'Developer' })
    ) as { tasks: Array<{ assignee: string }> };
    expect(byAssignee.tasks).toHaveLength(1);
    expect(byAssignee.tasks[0]!.assignee).toBe('Developer');

    const byCreator = decodeHandlerResult(
      await h.handlers.taskList({ createdBy: 'Product' })
    ) as { tasks: unknown[] };
    expect(byCreator.tasks).toHaveLength(1);

    const byStatus = decodeHandlerResult(
      await h.handlers.taskList({ status: 'done' })
    ) as { tasks: unknown[] };
    expect(byStatus.tasks).toHaveLength(0);

    const byPriority = decodeHandlerResult(
      await h.handlers.taskList({ priority: 'high' })
    ) as { tasks: unknown[] };
    expect(byPriority.tasks).toHaveLength(1);
  });
});
