/**
 * @fileoverview coord_memory_append — append an entry to a scoped log.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  MemoryAppendInputShape,
  MemoryAppendInputSchema,
  MemoryEntrySchema,
  type MemoryEntry
} from '../schemas/memory.js';
import { appendJsonl } from '../fs/atomic.js';
import type { CoordPaths } from '../fs/paths.js';
import { sanitizeFields } from '../sanitize.js';

export { MemoryAppendInputShape };

export interface MemoryAppendDeps {
  paths: CoordPaths;
  workspaceRoot: string;
  now?: () => Date;
}

export function createMemoryAppendTool(deps: MemoryAppendDeps) {
  const now = deps.now ?? (() => new Date());
  return async (args: unknown): Promise<{ content: unknown[] }> => {
    const input = MemoryAppendInputSchema.parse(args);
    const target = deps.paths.memoryFile(input.scope);
    const nowIso = now().toISOString();
    const entry: MemoryEntry = MemoryEntrySchema.parse({
      key: input.key,
      topic: input.topic,
      content: input.content,
      addedBy: input.addedBy,
      addedAt: nowIso
    });
    // Count existing lines so we can report a 1-based lineNumber.
    let existing = 0;
    try {
      const raw = await fsp.readFile(target, 'utf8');
      existing = raw.split('\n').filter((l) => l.trim().length > 0).length;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await appendJsonl(target, entry);
    const rel = path.relative(deps.workspaceRoot, target);
    return {
      content: [
        {
          scope: input.scope,
          lineNumber: existing + 1,
          path: rel,
          entry: sanitizeFields(entry, ['topic', 'content'])
        }
      ]
    };
  };
}
