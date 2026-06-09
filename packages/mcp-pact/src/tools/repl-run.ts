/**
 * @fileoverview pact.repl_run tool implementation
 * @author Developer
 * @description Run a single .repl file via the pact binary and parse results.
 *              Local-only. No network I/O. No shell interpretation.
 */

import fs from 'node:fs';
import { z } from 'zod';
import {
  resolveInsideWorkspace,
  spawnWithOutput,
  sanitizeToolOutput,
  McpToolError
} from '@pact-community/mcp-shared';

// [Developer] Stdout cap prevents memory blow-ups from pathological pact output.
const STDOUT_SIZE_CAP = 200 * 1024;
const STDOUT_TRUNCATION_MARKER = '\n…[truncated at 200KB]';

/**
 * [Developer] Zod inputSchema for pact.repl_run.
 *
 * Exported as a ZodRawShape so it can be handed to `McpServer.registerTool`
 * AND hashed canonically for tools.lock.json.
 */
export const ReplRunInputShape = {
  file: z
    .string()
    .min(1)
    .describe('Path to a .repl file, relative to the workspace root.')
};

export const ReplRunInputSchema = z.object(ReplRunInputShape);

/**
 * [Developer] Structured output returned to callers.
 */
export interface ReplRunResult {
  file: string;
  success: boolean;
  loadStatus: 'success' | 'failed' | 'error';
  output: string;
  truncated: boolean;
  exitCode: number | null;
  durationMs: number;
  gasUsed: number | null;
  expectations: ReplExpectation[];
  failures: string[];
  stderr: string;
}

export interface ReplExpectation {
  type: 'expect' | 'expect-failure' | 'expect-that';
  description: string;
  result: 'pass' | 'fail';
}

export interface ReplRunToolConfig {
  workspaceRoot: string;
  pactBin: string;
  /** Optional child-process spawn timeout (ms). Default 30_000. */
  timeoutMs?: number;
  /** Optional env for child process (allowlisted). */
  childEnv?: NodeJS.ProcessEnv;
}

/**
 * [Developer] Factory for the repl-run tool handler.
 *
 * Contract:
 *  - validates input with zod
 *  - resolves the path inside the workspace (blocks traversal/symlink escape)
 *  - confirms the file exists and has a .repl extension
 *  - spawns the pact binary with NO shell, argv as string array
 *  - caps stdout at 200KB with explicit truncation marker
 *  - parses Load successful / Load failed, gas, and expect outcomes
 */
export function createReplRunTool(config: ReplRunToolConfig) {
  return async function replRun(
    args: unknown
  ): Promise<{ content: ReplRunResult[] }> {
    const input = ReplRunInputSchema.parse(args);

    if (!input.file.endsWith('.repl')) {
      throw new McpToolError(
        'INVALID_FILE_TYPE',
        'File must have .repl extension',
        false
      );
    }

    const resolvedPath = resolveInsideWorkspace(
      config.workspaceRoot,
      input.file
    );

    if (!fs.existsSync(resolvedPath)) {
      throw new McpToolError(
        'FILE_NOT_FOUND',
        `REPL file not found: ${input.file}`,
        false
      );
    }

    const startedAt = Date.now();
    let exitCode: number | null = null;
    let rawStdout = '';
    let rawStderr = '';

    try {
      const spawnOpts: Parameters<typeof spawnWithOutput>[2] = {
        cwd: config.workspaceRoot,
        timeout: config.timeoutMs ?? 30_000
      };
      if (config.childEnv) {
        spawnOpts.env = config.childEnv;
      }
      const result = await spawnWithOutput(
        config.pactBin,
        [resolvedPath],
        spawnOpts
      );
      exitCode = result.exitCode;
      rawStdout = result.stdout ?? '';
      rawStderr = result.stderr ?? '';
    } catch (error) {
      if (error instanceof McpToolError) {
        throw error;
      }
      throw new McpToolError(
        'EXECUTION_ERROR',
        `Failed to execute pact: ${(error as Error).message ?? String(error)}`,
        true
      );
    }

    const durationMs = Date.now() - startedAt;

    const { text: truncatedStdout, truncated: stdoutTruncated } = capSize(
      rawStdout
    );
    const { text: truncatedStderr, truncated: stderrTruncated } = capSize(
      rawStderr
    );

    const sanitizedStdout = sanitizeToolOutput(truncatedStdout).text;
    const sanitizedStderr = sanitizeToolOutput(truncatedStderr).text;

    const loadStatus: ReplRunResult['loadStatus'] = sanitizedStdout.includes(
      'Load successful'
    )
      ? 'success'
      : sanitizedStdout.includes('Load failed') ||
          sanitizedStderr.includes('Load failed')
        ? 'failed'
        : 'error';

    const expectations = parseExpectations(sanitizedStdout);
    const gasUsed = parseGas(sanitizedStdout);
    const failures = parseFailures(sanitizedStdout);

    const success =
      loadStatus === 'success' &&
      exitCode === 0 &&
      expectations.every((e) => e.result === 'pass') &&
      failures.length === 0;

    return {
      content: [
        {
          file: input.file,
          success,
          loadStatus,
          output: sanitizedStdout,
          truncated: stdoutTruncated || stderrTruncated,
          exitCode,
          durationMs,
          gasUsed,
          expectations,
          failures,
          stderr: sanitizedStderr
        }
      ]
    };
  };
}

function capSize(text: string): { text: string; truncated: boolean } {
  if (text.length <= STDOUT_SIZE_CAP) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, STDOUT_SIZE_CAP) + STDOUT_TRUNCATION_MARKER,
    truncated: true
  };
}

function parseExpectations(output: string): ReplExpectation[] {
  const expectations: ReplExpectation[] = [];
  for (const line of output.split('\n')) {
    const match = line.match(
      /^(expect(?:-failure|-that)?):\s*(.+?):\s*(PASS|FAIL)\s*$/
    );
    if (match && match[1] && match[2] && match[3]) {
      expectations.push({
        type: match[1] as ReplExpectation['type'],
        description: match[2],
        result: match[3] === 'PASS' ? 'pass' : 'fail'
      });
      continue;
    }
    const aggregate = line.match(
      /^(expect(?:-failure|-that)?):\s*(passed|failed)\s+(\d+)\s+tests?\s*$/i
    );
    if (aggregate && aggregate[1] && aggregate[2] && aggregate[3]) {
      expectations.push({
        type: aggregate[1] as ReplExpectation['type'],
        description: `${aggregate[2]} ${aggregate[3]} tests`,
        result: aggregate[2].toLowerCase() === 'passed' ? 'pass' : 'fail'
      });
    }
  }
  return expectations;
}

function parseGas(output: string): number | null {
  const match = output.match(/Gas:\s*(\d+)/);
  if (match && match[1]) {
    return Number.parseInt(match[1], 10);
  }
  return null;
}

function parseFailures(output: string): string[] {
  const failures: string[] = [];
  for (const line of output.split('\n')) {
    if (/\bFAIL\b/.test(line) || /^Load failed/.test(line)) {
      failures.push(line.trim());
    }
  }
  return failures;
}
