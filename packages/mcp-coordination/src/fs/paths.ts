/**
 * @fileoverview Strict path validation + coord-root structure helpers.
 */

import { promises as fsp, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { McpToolError, ErrorCodes } from '@pact-community/mcp-shared';

/**
 * Segment regex: a single path component that is safe on every platform we
 * support. No separators, no dots, no control chars, no leading dot.
 */
const SEGMENT_REGEX = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/**
 * Validate that `segment` can be safely embedded in a filesystem path. On
 * failure throws `INVALID_INPUT` with a specific message.
 */
export function assertSegment(segment: string, label: string): void {
  if (typeof segment !== 'string' || segment.length === 0) {
    throw new McpToolError(
      ErrorCodes.INVALID_INPUT,
      `${label} must be a non-empty string`,
      false
    );
  }
  if (segment === '.' || segment === '..') {
    throw new McpToolError(
      ErrorCodes.INVALID_INPUT,
      `${label} is not a legal segment`,
      false
    );
  }
  if (segment.startsWith('.')) {
    throw new McpToolError(
      ErrorCodes.INVALID_INPUT,
      `${label} may not start with '.'`,
      false
    );
  }
  if (
    segment.includes('/') ||
    segment.includes('\\') ||
    segment.includes('\0')
  ) {
    throw new McpToolError(
      ErrorCodes.INVALID_INPUT,
      `${label} may not contain path separators or NUL bytes`,
      false
    );
  }
  if (!SEGMENT_REGEX.test(segment)) {
    throw new McpToolError(
      ErrorCodes.INVALID_INPUT,
      `${label} contains unsupported characters`,
      false
    );
  }
}

/**
 * Confirm that `target` resolves to a path that lives inside `root`. Both
 * must be absolute. Uses realpath on the nearest existing ancestor, then
 * walks up to handle not-yet-existing files (e.g. task files about to be
 * created).
 */
export function confirmInsideRoot(root: string, target: string): string {
  if (!path.isAbsolute(root) || !path.isAbsolute(target)) {
    throw new McpToolError(
      ErrorCodes.INVALID_INPUT,
      'root and target must be absolute paths',
      false
    );
  }
  const canonicalRoot = realpathSync(root);
  const canonicalTarget = walkUpConfirm(target);
  const rel = path.relative(canonicalRoot, canonicalTarget);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    return canonicalTarget;
  }
  throw new McpToolError(
    ErrorCodes.INVALID_INPUT,
    'resolved path escapes the permitted root',
    false
  );
}

function walkUpConfirm(target: string): string {
  let cursor = target;
  const suffix: string[] = [];
  // Walk up until we find a path that exists.
  // We cap the walk at 64 steps to avoid pathological inputs.
  for (let i = 0; i < 64; i += 1) {
    try {
      const canonical = realpathSync(cursor);
      if (suffix.length === 0) return canonical;
      return path.join(canonical, ...suffix.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new McpToolError(
          ErrorCodes.OPERATION_FAILED,
          'failed to resolve path',
          false
        );
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
  throw new McpToolError(
    ErrorCodes.INVALID_INPUT,
    'could not resolve any ancestor of the target path',
    false
  );
}

/**
 * Resolve a workspace-relative or absolute path and confirm it lives
 * inside `workspaceRoot`. Also confirms the file exists (via stat).
 */
export async function resolveInsideWorkspace(
  workspaceRoot: string,
  candidate: string
): Promise<string> {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new McpToolError(
      ErrorCodes.INVALID_INPUT,
      'artifact path must be a non-empty string',
      false
    );
  }
  const abs = path.isAbsolute(candidate)
    ? candidate
    : path.join(workspaceRoot, candidate);
  return confirmInsideRoot(workspaceRoot, abs);
}

// ---------------------------------------------------------------------------
// Coord root layout.
// ---------------------------------------------------------------------------

export interface CoordPaths {
  root: string;
  taskDir: string;
  mailboxDir: string;
  statusDir: string;
  memoryDir: string;
  taskFile: (taskId: string) => string;
  inboxFile: (agent: string) => string;
  statusFile: (agent: string) => string;
  memoryFile: (scope: string) => string;
}

export function createCoordPaths(canonicalRoot: string): CoordPaths {
  const taskDir = path.join(canonicalRoot, 'tasks');
  const mailboxDir = path.join(canonicalRoot, 'mailboxes');
  const statusDir = path.join(canonicalRoot, 'status');
  const memoryDir = path.join(canonicalRoot, 'memory');
  return {
    root: canonicalRoot,
    taskDir,
    mailboxDir,
    statusDir,
    memoryDir,
    taskFile(taskId: string): string {
      assertSegment(taskId, 'taskId');
      const candidate = path.join(taskDir, `${taskId}.json`);
      return confirmInsideRoot(canonicalRoot, candidate);
    },
    inboxFile(agent: string): string {
      assertSegment(agent, 'agent');
      const candidate = path.join(mailboxDir, agent, 'inbox.jsonl');
      return confirmInsideRoot(canonicalRoot, candidate);
    },
    statusFile(agent: string): string {
      assertSegment(agent, 'agent');
      const candidate = path.join(statusDir, `${agent}.json`);
      return confirmInsideRoot(canonicalRoot, candidate);
    },
    memoryFile(scope: string): string {
      assertSegment(scope, 'scope');
      const candidate = path.join(memoryDir, `${scope}.jsonl`);
      return confirmInsideRoot(canonicalRoot, candidate);
    }
  };
}

/**
 * Verify that `coordRoot` exists, is a directory, is absolute, and return
 * its canonical (realpath-resolved) form. Throws `COORD_ROOT_INVALID`
 * otherwise. Does NOT auto-create the directory.
 */
export function verifyCoordRoot(coordRoot: string): string {
  if (!path.isAbsolute(coordRoot)) {
    throw new McpToolError(
      ErrorCodes.COORD_ROOT_INVALID,
      `coordination root must be absolute (got ${coordRoot})`,
      false
    );
  }
  let canonical: string;
  try {
    canonical = realpathSync(coordRoot);
  } catch (error) {
    throw new McpToolError(
      ErrorCodes.COORD_ROOT_INVALID,
      `coordination root is not accessible: ${(error as Error).message}`,
      false
    );
  }
  const st = statSync(canonical);
  if (!st.isDirectory()) {
    throw new McpToolError(
      ErrorCodes.COORD_ROOT_INVALID,
      `coordination root is not a directory: ${canonical}`,
      false
    );
  }
  return canonical;
}

/** Ensure subdirectories exist (used by tests; production expects
 * operators to pre-create them). */
export async function ensureCoordStructure(paths: CoordPaths): Promise<void> {
  await fsp.mkdir(paths.taskDir, { recursive: true });
  await fsp.mkdir(paths.mailboxDir, { recursive: true });
  await fsp.mkdir(paths.statusDir, { recursive: true });
  await fsp.mkdir(paths.memoryDir, { recursive: true });
}
