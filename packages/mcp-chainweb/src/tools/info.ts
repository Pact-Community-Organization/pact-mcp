/**
 * @fileoverview chainweb.info - read node metadata + chain list.
 *
 * Security invariant: refuses loudly if `networkId !== "development"` — this
 * server is devnet-only for the v1 MVP.
 */

import { z } from 'zod';
import { McpToolError, sanitizeToolOutput } from '@pact-community/mcp-shared';
import type { ChainwebClient } from '../client/fetch.js';

export const InfoInputShape = {};
export const InfoInputSchema = z.object(InfoInputShape);

export interface InfoResult {
  networkId: string;
  nodeVersion: string;
  apiVersion: string;
  chainIds: string[];
  /** Present iff /cut was reachable. Missing entries are omitted per-chain. */
  chainTimestamps?: Record<string, number>;
}

export interface InfoToolConfig {
  client: ChainwebClient;
  /** Expected network id — defaults to `development` (devnet-only guarantee). */
  expectedNetworkId?: string;
}

interface RawInfo {
  nodeVersion?: string;
  nodeApiVersion?: string;
  nodeApiVersionWithPatch?: string;
  nodeChains?: string[];
  nodeNumberOfChains?: number;
  // chainweb-node exposes `nodeVersion` + `nodeApiVersion`; the devnet
  // response additionally includes the networkId under `nodeVersion` or
  // a separate field depending on version.
  networkId?: string;
  chainwebVersion?: string;
}

interface RawCut {
  hashes?: Record<string, { height: number; hash: string; creationTime?: number } | undefined>;
}

/**
 * Factory for the info tool. Returns a handler compatible with
 * McpServer.registerTool's callback signature (receives `args: unknown`).
 */
export function createInfoTool(config: InfoToolConfig) {
  const expected = config.expectedNetworkId ?? 'development';
  return async function info(
    args: unknown
  ): Promise<{ content: InfoResult[] }> {
    InfoInputSchema.parse(args ?? {});

    const raw = await config.client.getJson<RawInfo>('/info');

    // chainweb-node devnet uses `nodeVersion` for e.g. "development"; some
    // builds put the network id under `networkId` or `chainwebVersion`.
    const networkId =
      raw.networkId ?? raw.chainwebVersion ?? raw.nodeVersion ?? '';
    if (networkId !== expected) {
      throw new McpToolError(
        'NETWORK_ID_MISMATCH',
        sanitizeToolOutput(
          `Refusing to operate on non-devnet network. Expected '${expected}', got '${networkId}'.`
        ).text,
        false
      );
    }

    const chainIds = Array.isArray(raw.nodeChains)
      ? raw.nodeChains.map((c) => String(c))
      : typeof raw.nodeNumberOfChains === 'number'
        ? Array.from({ length: raw.nodeNumberOfChains }, (_, i) => String(i))
        : [];

    // Best-effort /cut — if unreachable, omit chainTimestamps (not a failure).
    let chainTimestamps: Record<string, number> | undefined;
    try {
      const cut = await config.client.getJson<RawCut>(
        `/chainweb/0.0/${networkId}/cut`
      );
      if (cut.hashes && typeof cut.hashes === 'object') {
        chainTimestamps = {};
        for (const [cid, entry] of Object.entries(cut.hashes)) {
          if (entry && typeof entry.creationTime === 'number') {
            // cut entries (when populated) also give microseconds.
            chainTimestamps[cid] = Math.floor(entry.creationTime / 1_000_000);
          }
        }
      }
    } catch {
      // Silent: /cut is not critical for info.
    }

    const result: InfoResult = {
      networkId,
      nodeVersion: String(
        raw.nodeApiVersionWithPatch ?? raw.nodeVersion ?? ''
      ),
      apiVersion: String(raw.nodeApiVersion ?? ''),
      chainIds
    };
    if (chainTimestamps) result.chainTimestamps = chainTimestamps;
    return { content: [result] };
  };
}
