/**
 * @fileoverview devnet.up tool — GATED. Start a devnet stack.
 * @author Developer
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
import {
  assertLifecycleAllowed,
  type LifecycleFlags
} from '../gating.js';
import { createStatusTool, type StatusResult } from './status.js';

/** Only keep the tail of compose output — 200 lines is informative. */
const UP_OUTPUT_TAIL_LINES = 200;
const UP_TIMEOUT_MS = 120_000;

export const UpInputShape = {
  agent: z
    .enum(AGENT_NAMES)
    .describe('Agent whose devnet stack to start.'),
  forceRecreate: z
    .boolean()
    .default(false)
    .describe('Pass --force-recreate to docker compose up.')
};

export const UpInputSchema = z.object(UpInputShape);

export interface UpResult {
  agent: AgentName;
  started: boolean;
  forceRecreate: boolean;
  services: StatusResult;
  spawnDurationMs: number;
  tailOutput: string;
  truncated: boolean;
}

export interface UpToolConfig {
  workspaceRoot: string;
  dockerBin: string;
  childEnv: NodeJS.ProcessEnv;
  flags: LifecycleFlags;
  timeoutMs?: number;
  auditLog?: AuditLogger;
}

export function createUpTool(config: UpToolConfig) {
  const timeoutMs = config.timeoutMs ?? UP_TIMEOUT_MS;
  const status = createStatusTool({
    workspaceRoot: config.workspaceRoot,
    dockerBin: config.dockerBin,
    childEnv: config.childEnv
  });

  return async function up(args: unknown): Promise<{ content: UpResult[] }> {
    // Gate check first — before parsing / any disk access.
    assertLifecycleAllowed(config.flags);

    const input = UpInputSchema.parse(args);
    const agent = input.agent;
    const mapping = AGENT_MAP[agent];

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
      'up',
      '-d'
    ];
    if (input.forceRecreate) argv.push('--force-recreate');

    const spawnResult = await runDocker(config.dockerBin, argv, {
      cwd: resolution.workDir,
      timeoutMs,
      env: config.childEnv
    });

    if (spawnResult.endReason === 'timeout') {
      throw timeoutError(spawnResult);
    }
    if (spawnResult.endReason === 'error') {
      throw new McpToolError(
        'SPAWN_ERROR',
        `docker compose up failed: ${spawnResult.errorMessage ?? 'unknown error'}`,
        true
      );
    }

    const combined =
      spawnResult.stderr.length > 0
        ? `${spawnResult.stdout}${spawnResult.stdout.length > 0 ? '\n' : ''}${spawnResult.stderr}`
        : spawnResult.stdout;
    const sanitized = sanitizeToolOutput(combined).text;
    const tail = tailLines(sanitized, UP_OUTPUT_TAIL_LINES);

    // Always query status afterwards so callers get a structured snapshot.
    const statusContent = await status({ agent });

    return {
      content: [
        {
          agent,
          started: spawnResult.exitCode === 0,
          forceRecreate: input.forceRecreate,
          services: statusContent.content[0]!,
          spawnDurationMs: spawnResult.durationMs,
          tailOutput: tail.text,
          truncated: tail.truncated || spawnResult.truncated
        }
      ]
    };
  };
}

export function tailLines(
  text: string,
  max: number
): { text: string; truncated: boolean } {
  if (text.length === 0) return { text, truncated: false };
  const lines = text.split(/\r?\n/);
  if (lines.length <= max) return { text, truncated: false };
  return {
    text: lines.slice(-max).join('\n'),
    truncated: true
  };
}
