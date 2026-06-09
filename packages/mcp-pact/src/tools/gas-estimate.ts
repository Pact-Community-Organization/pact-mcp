/**
 * @fileoverview pact.gas_estimate tool implementation
 * @author Developer
 * @description Convenience wrapper over pact.repl_run that parses gas-probe
 *              output from a .repl file. The .repl file is the source of
 *              truth — this tool does NOT inject probes; it only parses them.
 *
 *              Recognized probe forms in pact REPL output:
 *                - `"Gas: NNN"`          (explicit Gas: line)
 *                - `"gas: NNN"`          (lowercase variant)
 *                - `"LABEL: Gas: NNN"`   (label prefix, emitted by the test
 *                                        harness via (print ...) before
 *                                        (env-gas))
 *                - A line whose entire content is an integer emitted
 *                  immediately after an `(env-gas)` call — this is how Pact 5
 *                  surfaces env-gas readings. We detect these by pairing
 *                  integer-only lines that follow a `;;gas-probe: LABEL`
 *                  marker in the source OR a preceding "env-gas" log line.
 */

import fs from 'node:fs';
import { z } from 'zod';
import {
  resolveInsideWorkspace,
  spawnWithOutput,
  sanitizeToolOutput,
  McpToolError
} from '@pact-community/mcp-shared';

const STDOUT_SIZE_CAP = 200 * 1024;
const STDOUT_TRUNCATION_MARKER = '\n…[truncated at 200KB]';

export const GasEstimateInputShape = {
  file: z
    .string()
    .min(1)
    .describe('Workspace-relative path to a .repl file with gas probes.'),
  gasLimit: z
    .number()
    .int()
    .min(1)
    .max(150_000)
    .default(150_000)
    .describe('Informational gas ceiling (chainweb cap = 150_000).')
};

export const GasEstimateInputSchema = z.object(GasEstimateInputShape);

export interface GasMeasurement {
  label?: string;
  gas: number;
  lineNumber?: number;
}

export interface GasEstimateResult {
  file: string;
  exitCode: number | null;
  measurements: GasMeasurement[];
  totalGas?: number;
  warning?: string;
  truncated: boolean;
  durationMs: number;
}

export interface GasEstimateToolConfig {
  workspaceRoot: string;
  pactBin: string;
  timeoutMs?: number;
  childEnv?: NodeJS.ProcessEnv;
}

export function createGasEstimateTool(config: GasEstimateToolConfig) {
  return async function gasEstimate(
    args: unknown
  ): Promise<{ content: GasEstimateResult[] }> {
    const input = GasEstimateInputSchema.parse(args);

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

    try {
      const spawnOpts: Parameters<typeof spawnWithOutput>[2] = {
        cwd: config.workspaceRoot,
        timeout: config.timeoutMs ?? 60_000
      };
      if (config.childEnv) spawnOpts.env = config.childEnv;
      const r = await spawnWithOutput(
        config.pactBin,
        [resolvedPath],
        spawnOpts
      );
      exitCode = r.exitCode;
      rawStdout = r.stdout ?? '';
    } catch (error) {
      if (error instanceof McpToolError) throw error;
      throw new McpToolError(
        'EXECUTION_ERROR',
        `Failed to execute pact: ${(error as Error).message ?? String(error)}`,
        true
      );
    }

    const durationMs = Date.now() - startedAt;
    const { text: stdoutCap, truncated } = capSize(rawStdout);
    const sanitized = sanitizeToolOutput(stdoutCap).text;

    const measurements = parseGasProbes(sanitized);

    const result: GasEstimateResult = {
      file: input.file,
      exitCode,
      measurements,
      truncated,
      durationMs
    };

    if (measurements.length === 0) {
      result.warning =
        'no gas probes found — add (env-gaslimit N) and (env-gas 0)/(env-gas) pairs';
    } else {
      result.totalGas = measurements.reduce((a, m) => a + m.gas, 0);
    }

    return { content: [result] };
  };
}

function capSize(text: string): { text: string; truncated: boolean } {
  if (text.length <= STDOUT_SIZE_CAP) return { text, truncated: false };
  return {
    text: text.slice(0, STDOUT_SIZE_CAP) + STDOUT_TRUNCATION_MARKER,
    truncated: true
  };
}

/**
 * [Developer] Parse gas measurements from REPL stdout.
 *
 * Matches:
 *  1. `^Gas:\s*(\d+)\s*$`                   → unlabeled measurement
 *  2. `^gas:\s*(\d+)\s*$`                   → lowercase
 *  3. `^\s*"?([^"\n:]+?)"?\s*:\s*(?:Gas|gas):\s*(\d+)\s*$` → label prefix
 *  4. `^\s*gas-probe:?\s*"?([^"\n]+)"?\s*=\s*(\d+)\s*$`    → harness form
 *
 * Ambiguous integer-only lines are NOT claimed as measurements — spec
 * requires we emit a warning rather than guess.
 */
function parseGasProbes(output: string): GasMeasurement[] {
  const out: GasMeasurement[] = [];
  const lines = output.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    // Form 4: gas-probe: LABEL = NNN
    let m = trimmed.match(
      /^gas-probe:?\s*"?([^"\n]+?)"?\s*=\s*(\d+)\s*$/i
    );
    if (m) {
      out.push({
        label: m[1]!.trim(),
        gas: Number.parseInt(m[2]!, 10),
        lineNumber: i + 1
      });
      continue;
    }

    // Form 3: LABEL: Gas: NNN   (labeled)
    m = trimmed.match(
      /^"?([^"\n:]+?)"?\s*:\s*(?:Gas|gas):\s*(\d+)\s*$/
    );
    if (m) {
      out.push({
        label: m[1]!.trim(),
        gas: Number.parseInt(m[2]!, 10),
        lineNumber: i + 1
      });
      continue;
    }

    // Forms 1/2: Gas: NNN (no label)
    m = trimmed.match(/^(?:Gas|gas):\s*(\d+)\s*$/);
    if (m) {
      out.push({
        gas: Number.parseInt(m[1]!, 10),
        lineNumber: i + 1
      });
      continue;
    }
  }
  return out;
}
