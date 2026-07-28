/**
 * @fileoverview pact_repl_run_many tool implementation
 * @description Sequentially runs multiple .repl files. Validates every path
 *              upfront, enforces a total wall-clock budget, and supports
 *              fail-fast semantics. Local-only. No network I/O. No shell.
 */

import fs from 'node:fs';
import { z } from 'zod';
import {
  resolveInsideWorkspace,
  spawnWithOutput,
  sanitizeToolOutput,
  McpToolError
} from '@pact-community/mcp-shared';

// Per-file stdout cap (matches repl_run).
const STDOUT_SIZE_CAP = 200 * 1024;
const STDOUT_TRUNCATION_MARKER = '\n…[truncated at 200KB]';

// Wall-clock budget across all files combined. Spec: 5 minutes.
const DEFAULT_TOTAL_BUDGET_MS = 5 * 60 * 1000;

// Max number of files per call.
const MAX_FILES = 50;

export const ReplRunManyInputShape = {
  files: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_FILES)
    .describe(
      'Array of workspace-relative .repl file paths to run sequentially.'
    ),
  failFast: z
    .boolean()
    .default(false)
    .describe('Abort on first non-zero exit and return partial results.')
};

export const ReplRunManyInputSchema = z.object(ReplRunManyInputShape);

export interface ReplRunManyFileResult {
  file: string;
  exitCode: number | null;
  ok: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
}

export interface ReplRunManyResult {
  results: ReplRunManyFileResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    totalDurationMs: number;
  };
  aborted?: boolean;
  timedOut?: boolean;
}

export interface ReplRunManyToolConfig {
  workspaceRoot: string;
  pactBin: string;
  /** Per-file spawn timeout (default 60_000). */
  perFileTimeoutMs?: number;
  /** Total wall-clock budget across all files (default 300_000). */
  totalBudgetMs?: number;
  /** Filtered env for child processes. */
  childEnv?: NodeJS.ProcessEnv;
}

/**
 * Factory for the repl_run_many handler.
 *
 * Contract:
 *  - Validate every path BEFORE spawning anything (fail-fast on bad inputs)
 *  - Deduplicate nothing — caller controls ordering
 *  - Run files sequentially (no parallelism — Pact can share on-disk state)
 *  - Each file gets a per-file timeout; the batch gets a total wall budget
 *  - failFast=true stops on first non-zero exit; otherwise we run all
 */
export function createReplRunManyTool(config: ReplRunManyToolConfig) {
  return async function replRunMany(
    args: unknown
  ): Promise<{ content: ReplRunManyResult[] }> {
    const input = ReplRunManyInputSchema.parse(args);

    if (input.files.length > MAX_FILES) {
      throw new McpToolError(
        'TOO_MANY_FILES',
        `files array length ${input.files.length} exceeds maximum ${MAX_FILES}`,
        false
      );
    }

    // Validate ALL paths upfront; no side effects until every
    // path is known-good.
    const resolved: { file: string; path: string }[] = [];
    for (const file of input.files) {
      if (!file.endsWith('.repl')) {
        throw new McpToolError(
          'INVALID_FILE_TYPE',
          `File must have .repl extension: ${file}`,
          false
        );
      }
      const p = resolveInsideWorkspace(config.workspaceRoot, file);
      if (!fs.existsSync(p)) {
        throw new McpToolError(
          'FILE_NOT_FOUND',
          `REPL file not found: ${file}`,
          false
        );
      }
      resolved.push({ file, path: p });
    }

    const totalBudgetMs = config.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS;
    const perFileTimeoutMs = config.perFileTimeoutMs ?? 60_000;

    const results: ReplRunManyFileResult[] = [];
    const batchStart = Date.now();
    let aborted = false;
    let timedOut = false;

    for (const { file, path } of resolved) {
      const elapsed = Date.now() - batchStart;
      if (elapsed >= totalBudgetMs) {
        timedOut = true;
        break;
      }

      const remaining = totalBudgetMs - elapsed;
      const thisTimeout = Math.min(perFileTimeoutMs, remaining);

      const fileStart = Date.now();
      let exitCode: number | null = null;
      let rawStdout = '';
      let rawStderr = '';

      try {
        const spawnOpts: Parameters<typeof spawnWithOutput>[2] = {
          cwd: config.workspaceRoot,
          timeout: thisTimeout
        };
        if (config.childEnv) {
          spawnOpts.env = config.childEnv;
        }
        const r = await spawnWithOutput(config.pactBin, [path], spawnOpts);
        exitCode = r.exitCode;
        rawStdout = r.stdout ?? '';
        rawStderr = r.stderr ?? '';
      } catch (error) {
        // Record the failure but don't throw — batch should
        // continue unless failFast.
        rawStderr = `spawn-error: ${(error as Error).message ?? String(error)}`;
        exitCode = null;
      }

      const durationMs = Date.now() - fileStart;
      const { text: stdout, truncated: st } = capSize(rawStdout);
      const { text: stderr, truncated: se } = capSize(rawStderr);
      const sanStdout = sanitizeToolOutput(stdout).text;
      const sanStderr = sanitizeToolOutput(stderr).text;

      const ok =
        exitCode === 0 &&
        sanStdout.includes('Load successful') &&
        !sanStdout.includes('Load failed') &&
        !sanStderr.includes('Load failed');

      results.push({
        file,
        exitCode,
        ok,
        stdout: sanStdout,
        stderr: sanStderr,
        durationMs,
        truncated: st || se
      });

      if (input.failFast && !ok) {
        aborted = true;
        break;
      }
    }

    const totalDurationMs = Date.now() - batchStart;
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;

    const payload: ReplRunManyResult = {
      results,
      summary: {
        total: input.files.length,
        passed,
        failed,
        totalDurationMs
      }
    };
    if (aborted) payload.aborted = true;
    if (timedOut) payload.timedOut = true;

    return { content: [payload] };
  };
}

function capSize(text: string): { text: string; truncated: boolean } {
  if (text.length <= STDOUT_SIZE_CAP) return { text, truncated: false };
  return {
    text: text.slice(0, STDOUT_SIZE_CAP) + STDOUT_TRUNCATION_MARKER,
    truncated: true
  };
}
