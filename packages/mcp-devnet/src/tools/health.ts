/**
 * @fileoverview devnet.health tool — HTTP health probe against the devnet
 *               Pact API endpoint (deeper than container state).
 * @author Developer
 */

import { z } from 'zod';
import { McpToolError, type AuditLogger } from '@pact-community/mcp-shared';

import { AGENT_MAP, AGENT_NAMES, type AgentName } from '../agents.js';

export const HealthInputShape = {
  agent: z
    .enum(AGENT_NAMES)
    .describe('Agent whose devnet HTTP endpoint to probe.')
};

export const HealthInputSchema = z.object(HealthInputShape);

export interface HealthResult {
  agent: AgentName;
  port: number;
  reachable: boolean;
  networkId?: string;
  nodeVersion?: string;
  apiVersion?: string;
  chainCount?: number;
  /**
   * True iff the latest block on chain 0 is within GENESIS_CATCHUP_WINDOW_SEC
   * of the wall clock. Genesis blocks carry 2019 timestamps until the mining
   * client catches up.
   */
  genesisCaughtUp: boolean;
  latencyMs: number;
  error?: string;
}

const GENESIS_CATCHUP_WINDOW_SEC = 10 * 60; // 10 minutes
const REQUEST_TIMEOUT_MS = 10_000;

export interface HealthToolConfig {
  /** Allowlisted fetch from mcp-shared, restricted to 8081/8082/8083. */
  fetchImpl: typeof fetch;
  /** Clock abstraction for testability. */
  now?: () => number;
  /**
   * Optional override for the base URL per agent. Used exclusively by the
   * test harness to point the tool at an ephemeral 127.0.0.1 port that has
   * been added to the allowlist via PACT_COMMUNITY_TEST_ALLOW_ORIGINS. Production
   * uses the default `http://localhost:{port}`.
   */
  baseUrlFor?: (agent: AgentName) => string;
  auditLog?: AuditLogger;
}

/**
 * [Developer] Factory for the health tool. Never throws on network failure —
 * returns a structured result with `reachable: false`.
 */
export function createHealthTool(config: HealthToolConfig) {
  const nowFn = config.now ?? Date.now;
  const baseUrlFor =
    config.baseUrlFor ??
    ((agent: AgentName) => `http://localhost:${AGENT_MAP[agent].port}`);

  return async function health(
    args: unknown
  ): Promise<{ content: HealthResult[] }> {
    const input = HealthInputSchema.parse(args);
    const agent = input.agent;
    const port = AGENT_MAP[agent].port;
    const start = nowFn();
    const base = baseUrlFor(agent);

    let info: InfoResponse | null = null;
    let errorMessage: string | undefined;

    try {
      info = await fetchJson<InfoResponse>(
        config.fetchImpl,
        `${base}/info`,
        REQUEST_TIMEOUT_MS
      );
    } catch (error) {
      if (error instanceof McpToolError && error.code === 'NETWORK_ALLOWLIST_VIOLATION') {
        // Programmer error — surface rather than hide.
        throw error;
      }
      errorMessage = extractError(error);
    }

    if (!info) {
      return {
        content: [
          {
            agent,
            port,
            reachable: false,
            genesisCaughtUp: false,
            latencyMs: nowFn() - start,
            error: errorMessage ?? 'unknown'
          }
        ]
      };
    }

    const chainIds = Array.isArray(info.nodeChains) ? info.nodeChains : [];
    const chainCount = chainIds.length;

    let genesisCaughtUp = false;
    try {
      const firstChain = chainIds[0] ?? '0';
      const networkId = typeof info.networkId === 'string' ? info.networkId : 'development';
      const cutUrl = `${base}/chainweb/0.0/${encodeURIComponent(networkId)}/cut`;
      const cut = await fetchJson<CutResponse>(
        config.fetchImpl,
        cutUrl,
        REQUEST_TIMEOUT_MS
      );
      const entry = cut?.hashes?.[firstChain];
      if (entry && typeof entry.creationTime === 'number') {
        // creationTime is in microseconds per Chainweb convention.
        const chainTimeSec = Math.floor(entry.creationTime / 1_000_000);
        const wallSec = Math.floor(nowFn() / 1_000);
        if (Math.abs(wallSec - chainTimeSec) <= GENESIS_CATCHUP_WINDOW_SEC) {
          genesisCaughtUp = true;
        }
      }
    } catch {
      // Treat a /cut failure as "not caught up" — info is still reachable.
      genesisCaughtUp = false;
    }

    const result: HealthResult = {
      agent,
      port,
      reachable: true,
      genesisCaughtUp,
      latencyMs: nowFn() - start,
      chainCount
    };
    if (typeof info.networkId === 'string') result.networkId = info.networkId;
    if (typeof info.nodeVersion === 'string') result.nodeVersion = info.nodeVersion;
    if (typeof info.nodeApiVersion === 'string') result.apiVersion = info.nodeApiVersion;

    return { content: [result] };
  };
}

// ---------------------------------------------------------------------------

interface InfoResponse {
  networkId?: string;
  nodeVersion?: string;
  nodeApiVersion?: string;
  nodeChains?: string[];
}

interface CutResponse {
  hashes?: Record<string, { height?: number; hash?: string; creationTime?: number }>;
}

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function extractError(error: unknown): string {
  if (error instanceof McpToolError) return `[${error.code}] ${error.message}`;
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code) return code;
    if (error.name === 'AbortError') return 'TIMEOUT';
    return error.message;
  }
  return String(error);
}
