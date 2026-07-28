/**
 * @fileoverview devnet_reset tool — GATED + DANGER. down -v + up --force-recreate.
 */

import { z } from 'zod';
import { type AuditLogger } from '@pact-community/mcp-shared';

import { AGENT_NAMES, type AgentName } from '../agents.js';
import {
  assertLifecycleAllowed,
  assertVolumeWipeAllowed,
  type LifecycleFlags
} from '../gating.js';
import { createDownTool, type DownResult } from './down.js';
import { createUpTool, type UpResult } from './up.js';

export const ResetInputShape = {
  agent: z
    .enum(AGENT_NAMES)
    .describe('Agent whose devnet stack to reset (DATA LOSS).')
};

export const ResetInputSchema = z.object(ResetInputShape);

export interface ResetResult {
  agent: AgentName;
  reset: boolean;
  downStep: { stopped: boolean; volumesWiped: boolean };
  upStep: { started: boolean; services: UpResult['services'] };
  totalDurationMs: number;
  tailOutput: string;
  truncated: boolean;
}

export interface ResetToolConfig {
  workspaceRoot: string;
  dockerBin: string;
  childEnv: NodeJS.ProcessEnv;
  flags: LifecycleFlags;
  downTimeoutMs?: number;
  upTimeoutMs?: number;
  auditLog?: AuditLogger;
}

export function createResetTool(config: ResetToolConfig) {
  const down = createDownTool({
    workspaceRoot: config.workspaceRoot,
    dockerBin: config.dockerBin,
    childEnv: config.childEnv,
    flags: config.flags,
    ...(config.downTimeoutMs !== undefined ? { timeoutMs: config.downTimeoutMs } : {})
  });
  const up = createUpTool({
    workspaceRoot: config.workspaceRoot,
    dockerBin: config.dockerBin,
    childEnv: config.childEnv,
    flags: config.flags,
    ...(config.upTimeoutMs !== undefined ? { timeoutMs: config.upTimeoutMs } : {})
  });

  return async function reset(
    args: unknown
  ): Promise<{ content: ResetResult[] }> {
    // Gate up front — fail fast before any subprocess.
    assertLifecycleAllowed(config.flags);
    assertVolumeWipeAllowed(config.flags);

    const input = ResetInputSchema.parse(args);
    const agent = input.agent;
    const start = Date.now();

    const downResult = await down({ agent, wipeVolumes: true });
    const downPayload: DownResult = downResult.content[0]!;

    if (!downPayload.stopped) {
      return {
        content: [
          {
            agent,
            reset: false,
            downStep: { stopped: false, volumesWiped: downPayload.volumesWiped },
            upStep: {
              started: false,
              services: {
                agent,
                composePath: '',
                overall: 'down',
                services: [],
                durationMs: 0
              }
            },
            totalDurationMs: Date.now() - start,
            tailOutput: downPayload.tailOutput,
            truncated: downPayload.truncated
          }
        ]
      };
    }

    const upResult = await up({ agent, forceRecreate: true });
    const upPayload: UpResult = upResult.content[0]!;

    return {
      content: [
        {
          agent,
          reset: upPayload.started,
          downStep: {
            stopped: downPayload.stopped,
            volumesWiped: downPayload.volumesWiped
          },
          upStep: {
            started: upPayload.started,
            services: upPayload.services
          },
          totalDurationMs: Date.now() - start,
          tailOutput: `${downPayload.tailOutput}\n---\n${upPayload.tailOutput}`.trim(),
          truncated: downPayload.truncated || upPayload.truncated
        }
      ]
    };
  };
}
