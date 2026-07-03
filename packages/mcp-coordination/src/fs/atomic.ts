/**
 * @fileoverview Atomic file primitives: tmp+fsync+rename, O_APPEND JSONL,
 *   tolerant readers, and full-rewrite.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { McpToolError, ErrorCodes } from '@pact-community/mcp-shared';

/**
 * Atomically write a JSON document. The target file is replaced with an
 * fsync'd temp file via `fs.promises.rename` (single syscall, atomic on
 * the same filesystem).
 */
export async function writeJsonAtomic(
  targetPath: string,
  value: unknown
): Promise<void> {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.tmp-${randomBytes(6).toString('hex')}`;
  const payload = JSON.stringify(value, null, 2) + '\n';
  let fh: fsp.FileHandle | null = null;
  try {
    fh = await fsp.open(tmp, 'wx', 0o600);
    await fh.writeFile(payload, 'utf8');
    await fh.sync();
    await fh.close();
    fh = null;
    await fsp.rename(tmp, targetPath);
  } catch (error) {
    if (fh) {
      try {
        await fh.close();
      } catch {
        /* ignore */
      }
    }
    try {
      await fsp.unlink(tmp);
    } catch {
      /* ignore */
    }
    throw error;
  }
}

/**
 * Append a single JSON-encoded record as a line. Uses O_APPEND so concurrent
 * writers are serialized by the kernel for small writes; no file lock is
 * required.
 */
export async function appendJsonl(
  targetPath: string,
  value: unknown
): Promise<void> {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const line = JSON.stringify(value) + '\n';
  const fh = await fsp.open(targetPath, 'a', 0o600);
  try {
    await fh.writeFile(line, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
}

export interface JsonlReadResult<T> {
  records: T[];
  corruptCount: number;
}

/**
 * Read every line, returning successfully-parsed records and a count of
 * corrupt lines. Silently skips blank lines.
 */
export async function readJsonlAll<T>(
  targetPath: string,
  parse: (raw: unknown) => T
): Promise<JsonlReadResult<T>> {
  let content: string;
  try {
    content = await fsp.readFile(targetPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { records: [], corruptCount: 0 };
    }
    throw error;
  }
  const records: T[] = [];
  let corruptCount = 0;
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      records.push(parse(parsed));
    } catch {
      corruptCount += 1;
    }
  }
  return { records, corruptCount };
}

/**
 * Replace the entire file with `records`, preserving originally-corrupt
 * lines verbatim when `corruptLinesRaw` is supplied. Uses tmp+rename.
 */
export async function rewriteJsonl<T>(
  targetPath: string,
  records: T[],
  corruptLinesRaw: string[] = []
): Promise<void> {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.tmp-${randomBytes(6).toString('hex')}`;
  const body =
    [...corruptLinesRaw, ...records.map((r) => JSON.stringify(r))].join(
      '\n'
    ) + (records.length > 0 || corruptLinesRaw.length > 0 ? '\n' : '');
  let fh: fsp.FileHandle | null = null;
  try {
    fh = await fsp.open(tmp, 'wx', 0o600);
    await fh.writeFile(body, 'utf8');
    await fh.sync();
    await fh.close();
    fh = null;
    await fsp.rename(tmp, targetPath);
  } catch (error) {
    if (fh) {
      try {
        await fh.close();
      } catch {
        /* ignore */
      }
    }
    try {
      await fsp.unlink(tmp);
    } catch {
      /* ignore */
    }
    throw error;
  }
}

/**
 * Read and parse a JSON file, mapping ENOENT into `null` and all other
 * failures into a `CORRUPT_STATE` McpToolError with an opaque user-facing
 * message (full detail reserved for the audit log).
 */
export async function readJsonOrNull<T>(
  targetPath: string,
  parse: (raw: unknown) => T
): Promise<T | null> {
  let raw: string;
  try {
    raw = await fsp.readFile(targetPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new McpToolError(
      ErrorCodes.CORRUPT_STATE,
      'failed to read coordination file',
      false
    );
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parse(parsed);
  } catch {
    throw new McpToolError(
      ErrorCodes.CORRUPT_STATE,
      'failed to parse coordination file',
      false
    );
  }
}
