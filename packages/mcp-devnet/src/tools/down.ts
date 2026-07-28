/**
 * @fileoverview devnet_down tool — GATED + DANGER. Stop + remove containers.
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
  assertVolumeWipeAllowed,
  type LifecycleFlags
} from '../gating.js';
import { tailLines } from './up.js';

const DOWN_TIMEOUT_MS = 60_000;
const DOWN_OUTPUT_TAIL_LINES = 200;

export const DownInputShape = {
  agent: z
    .enum(AGENT_NAMES)
    .describe('Agent whose devnet stack to stop.'),
  wipeVolumes: z
    .boolean()
    .default(false)
    .describe('DATA LOSS — also delete named volumes (docker compose down -v).')
};

export const DownInputSchema = z.object(DownInputShape);

export interface DownResult {
  agent: AgentName;
  stopped: boolean;
  volumesWiped: boolean;
  spawnDurationMs: number;
  tailOutput: string;
  truncated: boolean;
}

export interface DownToolConfig {
  workspaceRoot: string;
  dockerBin: string;
  childEnv: NodeJS.ProcessEnv;
  flags: LifecycleFlags;
  timeoutMs?: number;
  auditLog?: AuditLogger;
}

export function createDownTool(config: DownToolConfig) {
  const timeoutMs = config.timeoutMs ?? DOWN_TIMEOUT_MS;

  return async function down(
    args: unknown
  ): Promise<{ content: DownResult[] }> {
    assertLifecycleAllowed(config.flags);

    const input = DownInputSchema.parse(args);
    if (input.wipeVolumes) {
      assertVolumeWipeAllowed(config.flags);
    }

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

    const argv: string[] = ['compose', '-f', resolution.absolutePath, 'down'];
    if (input.wipeVolumes) argv.push('-v');

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
        `docker compose down failed: ${spawnResult.errorMessage ?? 'unknown error'}`,
        true
      );
    }

    const combined =
      spawnResult.stderr.length > 0
        ? `${spawnResult.stdout}${spawnResult.stdout.length > 0 ? '\n' : ''}${spawnResult.stderr}`
        : spawnResult.stdout;
    const sanitized = sanitizeToolOutput(combined).text;
    const tail = tailLines(sanitized, DOWN_OUTPUT_TAIL_LINES);

    return {
      content: [
        {
          agent,
          stopped: spawnResult.exitCode === 0,
          volumesWiped: input.wipeVolumes && spawnResult.exitCode === 0,
          spawnDurationMs: spawnResult.durationMs,
          tailOutput: tail.text,
          truncated: tail.truncated || spawnResult.truncated
        }
      ]
    };
  };
}
