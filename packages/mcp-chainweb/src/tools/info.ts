/**
 * @fileoverview chainweb_info - read node metadata + chain list.
 *
 * Security invariant: refuses loudly if the node's network id differs from
 * the one the server was configured for (the profile default, or
 * `PACT_COMMUNITY_CHAINWEB_NETWORK_ID`).
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
  /** Latest block height per chain. Present iff /cut was reachable. */
  chainHeights?: Record<string, number>;
  /**
   * Present iff /cut was reachable. Filled only for cut entries that carry
   * a `creationTime` — chainweb-node 3.2 sends height and hash only, so
   * this is empty there; use `chainweb_chain_time` for block times.
   */
  chainTimestamps?: Record<string, number>;
}

export interface InfoToolConfig {
  client: ChainwebClient;
  /** Expected network id — defaults to the client's configured network id. */
  expectedNetworkId?: string;
}

interface RawInfo {
  // chainweb-node 3.2 `/info` (measured on mainnet01 and devnet): the network
  // id is `nodeVersion`; the node software version is `nodePackageVersion`.
  nodeVersion?: string;
  nodePackageVersion?: string;
  nodeApiVersion?: string;
  nodeChains?: string[];
  nodeNumberOfChains?: number;
  // Not sent by 3.2; honoured first if a node build does send them.
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
  const expected = config.expectedNetworkId ?? config.client.networkId;
  return async function info(
    args: unknown
  ): Promise<{ content: InfoResult[] }> {
    InfoInputSchema.parse(args ?? {});

    const raw = await config.client.getJson<RawInfo>('/info');

    const networkId =
      raw.networkId ?? raw.chainwebVersion ?? raw.nodeVersion ?? '';
    if (networkId !== expected) {
      throw new McpToolError(
        'NETWORK_ID_MISMATCH',
        sanitizeToolOutput(
          `Refusing to operate: the node is on a different network than configured. Expected '${expected}', got '${networkId}'.`
        ).text,
        false
      );
    }

    const chainIds = Array.isArray(raw.nodeChains)
      ? raw.nodeChains.map((c) => String(c))
      : typeof raw.nodeNumberOfChains === 'number'
        ? Array.from({ length: raw.nodeNumberOfChains }, (_, i) => String(i))
        : [];

    // Best-effort /cut — if unreachable, omit the per-chain fields (not a failure).
    let chainTimestamps: Record<string, number> | undefined;
    let chainHeights: Record<string, number> | undefined;
    try {
      const cut = await config.client.getJson<RawCut>(
        `/chainweb/0.0/${networkId}/cut`
      );
      if (cut.hashes && typeof cut.hashes === 'object') {
        chainTimestamps = {};
        chainHeights = {};
        for (const [cid, entry] of Object.entries(cut.hashes)) {
          if (entry && typeof entry.height === 'number') {
            chainHeights[cid] = entry.height;
          }
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
      nodeVersion: String(raw.nodePackageVersion ?? ''),
      apiVersion: String(raw.nodeApiVersion ?? ''),
      chainIds
    };
    if (chainHeights) result.chainHeights = chainHeights;
    if (chainTimestamps) result.chainTimestamps = chainTimestamps;
    return { content: [result] };
  };
}
