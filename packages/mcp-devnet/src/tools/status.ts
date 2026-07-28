/**
 * @fileoverview devnet_status tool — read-only container state query.
 */

import { z } from 'zod';
import {
  sanitizeToolOutput,
  McpToolError,
  type AuditLogger
} from '@pact-community/mcp-shared';

import { AGENT_MAP, AGENT_NAMES, type AgentName } from '../agents.js';
import {
  resolveComposeFile,
  parseComposePs,
  type OverallState,
  type ParsedService
} from '../docker/compose.js';
import { runDocker, timeoutError } from '../docker/spawn.js';

/** Schema exported so server.ts can hash it for the lockfile. */
export const StatusInputShape = {
  agent: z
    .enum(AGENT_NAMES)
    .describe('Agent whose devnet stack to query (Developer|Tester|Security).')
};

export const StatusInputSchema = z.object(StatusInputShape);

export interface StatusResult {
  agent: AgentName;
  composePath: string;
  overall: OverallState;
  services: ParsedService[];
  warning?: string;
  durationMs: number;
}

export interface StatusToolConfig {
  workspaceRoot: string;
  dockerBin: string;
  childEnv: NodeJS.ProcessEnv;
  /** Override in tests; default 30s. */
  timeoutMs?: number;
  auditLog?: AuditLogger;
}

/**
 * Factory returning the status handler.
 */
export function createStatusTool(config: StatusToolConfig) {
  const timeoutMs = config.timeoutMs ?? 30_000;
  return async function status(
    args: unknown
  ): Promise<{ content: StatusResult[] }> {
    const input = StatusInputSchema.parse(args);
    const agent = input.agent;
    const mapping = AGENT_MAP[agent];

    const resolution = resolveComposeFile(config.workspaceRoot, mapping);

    if (resolution.state === 'missing' || !resolution.absolutePath || !resolution.workDir) {
      return {
        content: [
          {
            agent,
            composePath: resolution.attemptedPath,
            overall: 'missing',
            services: [],
            warning: `Compose file not found: ${resolution.attemptedPath}`,
            durationMs: 0
          }
        ]
      };
    }

    const result = await runDocker(
      config.dockerBin,
      ['compose', '-f', resolution.absolutePath, 'ps', '--format', 'json'],
      {
        cwd: resolution.workDir,
        timeoutMs,
        env: config.childEnv
      }
    );

    if (result.endReason === 'timeout') {
      throw timeoutError(result);
    }
    if (result.endReason === 'error') {
      throw new McpToolError(
        'SPAWN_ERROR',
        `docker compose ps failed: ${result.errorMessage ?? 'unknown error'}`,
        true
      );
    }

    const sanitizedStdout = sanitizeToolOutput(result.stdout).text;
    const sanitizedStderr = sanitizeToolOutput(result.stderr).text;

    // Non-zero exit with empty stdout → surface stderr as a warning but still
    // return a structured result (overall: down / missing depending on which
    // failure we're seeing).
    if (result.exitCode !== 0 && sanitizedStdout.trim().length === 0) {
      return {
        content: [
          {
            agent,
            composePath: resolution.absolutePath,
            overall: 'down',
            services: [],
            warning: `docker compose ps exit=${result.exitCode}: ${sanitizedStderr.trim().slice(0, 512)}`,
            durationMs: result.durationMs
          }
        ]
      };
    }

    const parsed = parseComposePs(sanitizedStdout);

    return {
      content: [
        {
          agent,
          composePath: resolution.absolutePath,
          overall: parsed.overall,
          services: parsed.services,
          durationMs: result.durationMs
        }
      ]
    };
  };
}
