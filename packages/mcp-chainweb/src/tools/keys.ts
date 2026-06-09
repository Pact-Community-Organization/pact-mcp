/**
 * @fileoverview chainweb.keys - list keys of a Pact table via /local.
 * @author Developer
 */

import { z } from 'zod';
import { Pact } from '@kadena/client';
import { McpToolError } from '@pact-community/mcp-shared';
import type { ChainwebClient } from '../client/fetch.js';
import {
  runLocalPreflight,
  extractErrorMessage
} from '../client/preflight.js';

const CHAIN_ID_REGEX = /^(1?[0-9])$/;
const MODULE_REGEX = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/;
const TABLE_REGEX = /^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/;

export const KeysInputShape = {
  chainId: z
    .string()
    .regex(CHAIN_ID_REGEX)
    .describe('Chain id 0..19 as a decimal string.'),
  module: z
    .string()
    .min(1)
    .max(128)
    .regex(MODULE_REGEX)
    .describe('Fully qualified module name, e.g. "namespace.module-name".'),
  table: z
    .string()
    .min(1)
    .max(64)
    .regex(TABLE_REGEX)
    .describe('Unqualified table name.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(1000)
    .describe(
      'Maximum keys to return. >1000 is warned: (keys table) is O(n) on-chain and may exceed the 150k gas ceiling.'
    )
};
export const KeysInputSchema = z.object(KeysInputShape);

export interface KeysResult {
  keys: string[];
  count: number;
  hasMore: boolean;
  gasUsed: number;
  chainId: string;
}

export interface KeysToolConfig {
  client: ChainwebClient;
  defaultSender?: string;
  gasPrice?: number;
}

export function createKeysTool(config: KeysToolConfig) {
  const defaultSender = config.defaultSender ?? 'sender00';
  const gasPrice = config.gasPrice ?? 1e-7;
  return async function keys(
    args: unknown
  ): Promise<{ content: KeysResult[] }> {
    const input = KeysInputSchema.parse(args);

    // [Developer] `(take limit (keys m.t))` truncates at the interpreter
    // level so big tables don't overflow the response.
    const code = `(take ${input.limit} (keys ${input.module}.${input.table}))`;
    const tx = Pact.builder
      .execution(code)
      .setMeta({
        chainId: input.chainId as never,
        gasLimit: 150_000,
        gasPrice,
        senderAccount: defaultSender
      })
      .setNetworkId(config.client.networkId)
      .createTransaction();

    const pre = await runLocalPreflight(config.client, input.chainId, tx);
    if (pre.status === 'failure') {
      throw new McpToolError(
        'KEYS_FAILED',
        `keys lookup failed: ${extractErrorMessage(pre.result).slice(0, 500)}`,
        false
      );
    }

    const arr = Array.isArray(pre.result) ? pre.result : [];
    const keysOut: string[] = [];
    for (const item of arr) {
      if (typeof item === 'string') keysOut.push(item);
      else keysOut.push(String(item));
    }
    const hasMore = keysOut.length >= input.limit;

    return {
      content: [
        {
          keys: keysOut,
          count: keysOut.length,
          hasMore,
          gasUsed: pre.gasUsed,
          chainId: input.chainId
        }
      ]
    };
  };
}
