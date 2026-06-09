/**
 * @fileoverview chainweb.chain_time - read the latest block header's time.
 * @author Developer
 *
 * The chainweb-node REST API has no single "latest header" endpoint. The
 * documented pattern is:
 *   1. GET /chainweb/0.0/{net}/cut      → { hashes: { "{chainId}": { height, hash } } }
 *   2. GET /chainweb/0.0/{net}/chain/{id}/header/{hash}
 *      Accept: application/json;blockheader-encoding=object
 *      → { creationTime (μs), height, hash, ... }
 *
 * creationTime in the header is microseconds; we divide by 1_000_000 to
 * return seconds-since-epoch. This eliminates the documented devnet fresh-
 * container trap (genesis blocks have 2019 timestamps; chain catches up to
 * wall-clock within ~10-20 s of mining).
 */

import { z } from 'zod';
import { McpToolError } from '@pact-community/mcp-shared';
import type { ChainwebClient } from '../client/fetch.js';

export const ChainTimeInputShape = {
  chainId: z
    .string()
    .regex(/^\d+$/)
    .describe('Chain id (e.g. "0"..."19") as a decimal string.')
};
export const ChainTimeInputSchema = z.object(ChainTimeInputShape);

export interface ChainTimeResult {
  chainId: string;
  creationTimeSec: number;
  blockHeight: number;
  blockHash: string;
}

export interface ChainTimeToolConfig {
  client: ChainwebClient;
}

interface RawCut {
  hashes?: Record<string, { height?: number; hash?: string } | undefined>;
}

interface RawHeader {
  creationTime?: number;
  height?: number;
  hash?: string;
}

export function createChainTimeTool(config: ChainTimeToolConfig) {
  return async function chainTime(
    args: unknown
  ): Promise<{ content: ChainTimeResult[] }> {
    const input = ChainTimeInputSchema.parse(args);

    const cut = await config.client.getJson<RawCut>(
      `/chainweb/0.0/${config.client.networkId}/cut`
    );
    const entry = cut.hashes?.[input.chainId];
    if (!entry || typeof entry.hash !== 'string') {
      throw new McpToolError(
        'CHAIN_NOT_FOUND',
        `Chain id '${input.chainId}' not present in /cut response.`,
        false
      );
    }
    const hash = entry.hash;

    const header = await config.client.getBlockHeader<RawHeader>(
      input.chainId,
      hash
    );
    if (typeof header.creationTime !== 'number') {
      throw new McpToolError(
        'HEADER_MISSING_CREATION_TIME',
        'Block header missing creationTime (did the Accept header opt into JSON object encoding?).',
        false
      );
    }
    // [Developer] creationTime is microseconds — /1_000_000 → seconds.
    const creationTimeSec = Math.floor(header.creationTime / 1_000_000);
    const blockHeight =
      typeof header.height === 'number'
        ? header.height
        : typeof entry.height === 'number'
          ? entry.height
          : -1;
    const blockHash = typeof header.hash === 'string' ? header.hash : hash;

    return {
      content: [
        {
          chainId: input.chainId,
          creationTimeSec,
          blockHeight,
          blockHash
        }
      ]
    };
  };
}
