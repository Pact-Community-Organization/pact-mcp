/**
 * @fileoverview pact.module_scan tool implementation
 * @description Static analysis for the 5 critical Pact 5 traps.
 */

import fs from 'node:fs';
import { z } from 'zod';
import {
  resolveInsideWorkspace,
  sanitizeToolOutput,
  McpToolError
} from '@pact-community/mcp-shared';
import { analyzeTraps, type DetectedTrap } from '../analysis/traps.js';

const MAX_SOURCE_BYTES = 2 * 1024 * 1024; // 2 MB ceiling on module source

export const ModuleScanInputShape = {
  file: z
    .string()
    .min(1)
    .describe('Path to a .pact file, relative to the workspace root.')
};

export const ModuleScanInputSchema = z.object(ModuleScanInputShape);

export interface ModuleScanResult {
  file: string;
  passed: boolean;
  hasCritical: boolean;
  trapCount: number;
  traps: DetectedTrap[];
}

export interface ModuleScanToolConfig {
  workspaceRoot: string;
}

export function createModuleScanTool(config: ModuleScanToolConfig) {
  return async function moduleScan(
    args: unknown
  ): Promise<{ content: ModuleScanResult[] }> {
    const input = ModuleScanInputSchema.parse(args);

    if (!input.file.endsWith('.pact')) {
      throw new McpToolError(
        'INVALID_FILE_TYPE',
        'File must have .pact extension',
        false
      );
    }

    const resolved = resolveInsideWorkspace(config.workspaceRoot, input.file);

    if (!fs.existsSync(resolved)) {
      throw new McpToolError(
        'FILE_NOT_FOUND',
        `Pact file not found: ${input.file}`,
        false
      );
    }

    const stat = fs.statSync(resolved);
    if (stat.size > MAX_SOURCE_BYTES) {
      throw new McpToolError(
        'FILE_TOO_LARGE',
        `Pact file exceeds ${MAX_SOURCE_BYTES} bytes`,
        false
      );
    }

    const source = fs.readFileSync(resolved, 'utf-8');
    const analysis = analyzeTraps(source);

    const sanitizedTraps: DetectedTrap[] = analysis.traps.map((t) => ({
      kind: t.kind,
      severity: t.severity,
      line: t.line,
      snippet: sanitizeToolOutput(t.snippet).text,
      message: sanitizeToolOutput(t.message).text,
      fix: sanitizeToolOutput(t.fix).text
    }));

    return {
      content: [
        {
          file: input.file,
          passed: !analysis.hasCritical,
          hasCritical: analysis.hasCritical,
          trapCount: sanitizedTraps.length,
          traps: sanitizedTraps
        }
      ]
    };
  };
}
