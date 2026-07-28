/**
 * @fileoverview devnet_logs tool — tail container logs (read-only).
 */

import { z } from 'zod';
import {
  sanitizeToolOutput,
  McpToolError,
  type AuditLogger
} from '@pact-community/mcp-shared';

import { AGENT_MAP, AGENT_NAMES, type AgentName } from '../agents.js';
import { resolveComposeFile } from '../docker/compose.js';
import { runDocker, timeoutError } from '../docker/spawn.js';

/** Allowed service name pattern — belt-and-suspenders (spawn-guard also filters). */
const SERVICE_NAME_REGEX = /^[a-z][a-z0-9-]{0,63}$/;
/** Permitted `--since` values: positive duration OR ISO-8601 timestamp. */
const SINCE_DURATION_REGEX = /^[1-9][0-9]{0,4}[smhd]$/;
const SINCE_ISO_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export const LogsInputShape = {
  agent: z
    .enum(AGENT_NAMES)
    .describe('Agent whose devnet logs to read.'),
  service: z
    .string()
    .regex(SERVICE_NAME_REGEX, 'invalid service name')
    .optional()
    .describe('Optional compose service (e.g. "bootstrap-node").'),
  tail: z
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(500)
    .describe('Number of log lines to return (1..10000).'),
  since: z
    .string()
    .optional()
    .describe(
      'Optional --since value. Duration like "10m" or ISO-8601 timestamp.'
    )
};

export const LogsInputSchema = z.object(LogsInputShape);

export interface LogsResult {
  agent: AgentName;
  service?: string;
  lines: number;
  bytes: number;
  truncated: boolean;
  content: string;
  durationMs: number;
}

export interface LogsToolConfig {
  workspaceRoot: string;
  dockerBin: string;
  childEnv: NodeJS.ProcessEnv;
  timeoutMs?: number;
  auditLog?: AuditLogger;
}

export function createLogsTool(config: LogsToolConfig) {
  const timeoutMs = config.timeoutMs ?? 60_000;

  return async function logs(
    args: unknown
  ): Promise<{ content: LogsResult[] }> {
    const input = LogsInputSchema.parse(args);
    const agent = input.agent;
    const mapping = AGENT_MAP[agent];

    // Validate `since` separately (regex unions are awkward in zod).
    if (input.since !== undefined) {
      if (
        !SINCE_DURATION_REGEX.test(input.since) &&
        !SINCE_ISO_REGEX.test(input.since)
      ) {
        throw new McpToolError(
          'INVALID_INPUT',
          `Invalid 'since' value: expected duration like '10m' or ISO-8601 timestamp`,
          false
        );
      }
    }

    const resolution = resolveComposeFile(config.workspaceRoot, mapping);
    if (resolution.state === 'missing' || !resolution.absolutePath || !resolution.workDir) {
      throw new McpToolError(
        'COMPOSE_FILE_MISSING',
        `Compose file not found: ${resolution.attemptedPath}`,
        false
      );
    }

    const argv: string[] = [
      'compose',
      '-f',
      resolution.absolutePath,
      'logs',
      '--tail',
      String(input.tail),
      '--no-color'
    ];
    if (input.since !== undefined) {
      argv.push('--since', input.since);
    }
    if (input.service !== undefined) {
      argv.push(input.service);
    }

    const result = await runDocker(config.dockerBin, argv, {
      cwd: resolution.workDir,
      timeoutMs,
      env: config.childEnv
    });

    if (result.endReason === 'timeout') {
      throw timeoutError(result);
    }
    if (result.endReason === 'error') {
      throw new McpToolError(
        'SPAWN_ERROR',
        `docker compose logs failed: ${result.errorMessage ?? 'unknown error'}`,
        true
      );
    }

    // Compose logs writes output to stdout. Stderr may contain the
    // "no containers for project" hint.
    const combined =
      result.stdout.length > 0
        ? result.stdout
        : result.stderr;
    const sanitized = sanitizeToolOutput(combined).text;
    const lines = sanitized.length === 0 ? 0 : sanitized.split(/\r?\n/).length;

    const payload: LogsResult = {
      agent,
      lines,
      bytes: Buffer.byteLength(sanitized, 'utf-8'),
      truncated: result.truncated,
      content: sanitized,
      durationMs: result.durationMs
    };
    if (input.service !== undefined) payload.service = input.service;

    return { content: [payload] };
  };
}
