/**
 * @fileoverview pact.fmt_check tool implementation
 * @author Developer
 * @description Conservative formatting check for .pact and .repl files.
 *              Read-only — NEVER writes. Detects trailing whitespace, tabs,
 *              excess blank lines, missing final newline, and CRLF endings.
 */

import fs from 'node:fs';
import { z } from 'zod';
import {
  resolveInsideWorkspace,
  McpToolError
} from '@pact-community/mcp-shared';

const MAX_FILES = 100;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

export const FmtCheckInputShape = {
  files: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_FILES)
    .describe('Array of workspace-relative .pact or .repl file paths.')
};

export const FmtCheckInputSchema = z.object(FmtCheckInputShape);

export type FmtIssueKind =
  | 'trailing-whitespace'
  | 'tab-character'
  | 'excess-blank-lines'
  | 'no-trailing-newline'
  | 'crlf-line-ending';

export interface FmtIssue {
  line: number;
  kind: FmtIssueKind;
  detail?: string;
}

export interface FmtCheckFileResult {
  file: string;
  clean: boolean;
  issues: FmtIssue[];
}

export interface FmtCheckResult {
  results: FmtCheckFileResult[];
  summary: {
    total: number;
    clean: number;
    dirty: number;
  };
}

export interface FmtCheckToolConfig {
  workspaceRoot: string;
}

export function createFmtCheckTool(config: FmtCheckToolConfig) {
  return async function fmtCheck(
    args: unknown
  ): Promise<{ content: FmtCheckResult[] }> {
    const input = FmtCheckInputSchema.parse(args);

    if (input.files.length > MAX_FILES) {
      throw new McpToolError(
        'TOO_MANY_FILES',
        `files array length ${input.files.length} exceeds maximum ${MAX_FILES}`,
        false
      );
    }

    // [Developer] Validate every path BEFORE reading any content.
    const resolved: { file: string; path: string }[] = [];
    for (const file of input.files) {
      if (!file.endsWith('.pact') && !file.endsWith('.repl')) {
        throw new McpToolError(
          'INVALID_FILE_TYPE',
          `File must have .pact or .repl extension: ${file}`,
          false
        );
      }
      const p = resolveInsideWorkspace(config.workspaceRoot, file);
      if (!fs.existsSync(p)) {
        throw new McpToolError(
          'FILE_NOT_FOUND',
          `File not found: ${file}`,
          false
        );
      }
      const stat = fs.statSync(p);
      if (stat.size > MAX_SOURCE_BYTES) {
        throw new McpToolError(
          'FILE_TOO_LARGE',
          `File exceeds ${MAX_SOURCE_BYTES} bytes: ${file}`,
          false
        );
      }
      resolved.push({ file, path: p });
    }

    const results: FmtCheckFileResult[] = [];
    for (const { file, path } of resolved) {
      const content = fs.readFileSync(path, 'utf-8');
      const issues = analyzeFormat(content);
      results.push({
        file,
        clean: issues.length === 0,
        issues
      });
    }

    const clean = results.filter((r) => r.clean).length;
    return {
      content: [
        {
          results,
          summary: {
            total: results.length,
            clean,
            dirty: results.length - clean
          }
        }
      ]
    };
  };
}

/**
 * [Developer] Apply the five conservative format rules. Read-only analysis.
 */
export function analyzeFormat(content: string): FmtIssue[] {
  const issues: FmtIssue[] = [];

  // CRLF detection — check BEFORE splitting so we preserve raw signal.
  if (content.includes('\r\n')) {
    issues.push({ line: 0, kind: 'crlf-line-ending' });
  }

  // Missing final newline (only if content is non-empty).
  if (content.length > 0 && !content.endsWith('\n')) {
    // [Developer] Report at the last logical line.
    const lastLine = content.split('\n').length;
    issues.push({ line: lastLine, kind: 'no-trailing-newline' });
  }

  // Normalize for per-line analysis.
  const lines = content.split('\n');
  let blankStreak = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    // Strip a trailing \r introduced by CRLF so we report per-line cleanly.
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const lineNum = i + 1;

    if (/[ \t]+$/.test(line) && line.length > 0) {
      issues.push({ line: lineNum, kind: 'trailing-whitespace' });
    }
    if (line.includes('\t')) {
      issues.push({
        line: lineNum,
        kind: 'tab-character',
        detail: 'use spaces for indentation'
      });
    }

    if (line.trim().length === 0) {
      blankStreak++;
      if (blankStreak === 2) {
        // [Developer] Report once per excess run, at the line where the run
        // first exceeds 1.
        issues.push({
          line: lineNum,
          kind: 'excess-blank-lines',
          detail: 'more than one consecutive blank line'
        });
      }
    } else {
      blankStreak = 0;
    }
  }

  return issues;
}
