/**
 * @fileoverview Shared test helpers.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createAuditLogger } from '@pact-community/mcp-shared';
import {
  createCoordPaths,
  ensureCoordStructure
} from '../src/fs/paths.js';
import { buildHandlers, type ToolHandlers } from '../src/server.js';

export interface Harness {
  workspaceRoot: string;
  coordRoot: string;
  paths: ReturnType<typeof createCoordPaths>;
  handlers: ToolHandlers;
  cleanup: () => void;
}

export async function createHarness(): Promise<Harness> {
  const workspaceRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'coord-ws-')));
  const coordRoot = path.join(workspaceRoot, 'coordination');
  await fsp.mkdir(coordRoot, { recursive: true });
  const canonical = realpathSync(coordRoot);
  const paths = createCoordPaths(canonical);
  await ensureCoordStructure(paths);
  const audit = createAuditLogger('pact-community-coordination-test');
  const handlers = buildHandlers(workspaceRoot, paths, audit);
  return {
    workspaceRoot,
    coordRoot: canonical,
    paths,
    handlers,
    cleanup: () => {
      try {
        rmSync(workspaceRoot, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  };
}

export function parseTextContent(result: {
  content: Array<{ type: 'text'; text: string }>;
}): unknown {
  const first = result.content[0];
  if (!first) throw new Error('no content in result');
  return JSON.parse(first.text);
}

export function decodeHandlerResult(raw: { content: unknown[] }): unknown {
  return raw.content[0];
}
