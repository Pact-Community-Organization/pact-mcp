/**
 * @fileoverview chainweb_principal_namespace - compute `n_<40 hex>` via /local.
 *
 * Uses `(ns.create-principal-namespace (read-keyset "ks"))` to derive the
 * deterministic principal namespace name from a keyset. The keyset is
 * passed via envData so callers never build Pact literal syntax.
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
const PUBKEY_REGEX = /^[0-9a-fA-F]{64}$/;
const PRED_REGEX = /^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/;
export const PRINCIPAL_NS_REGEX = /^n_[a-f0-9]{40}$/;

export const PrincipalNamespaceInputShape = {
  chainId: z
    .string()
    .regex(CHAIN_ID_REGEX)
    .describe('Chain id 0..19.'),
  keyset: z
    .object({
      keys: z
        .array(z.string().regex(PUBKEY_REGEX))
        .min(1)
        .max(32),
      pred: z.string().regex(PRED_REGEX).default('keys-all')
    })
    .describe('Keyset to derive the principal namespace from.')
};
export const PrincipalNamespaceInputSchema = z.object(
  PrincipalNamespaceInputShape
);

export interface PrincipalNamespaceResult {
  namespace: string;
  gasUsed: number;
  chainId: string;
}

export interface PrincipalNamespaceToolConfig {
  client: ChainwebClient;
  defaultSender?: string;
  gasPrice?: number;
}

export function createPrincipalNamespaceTool(
  config: PrincipalNamespaceToolConfig
) {
  const defaultSender = config.defaultSender ?? 'sender00';
  const gasPrice = config.gasPrice ?? 1e-7;
  return async function principalNamespace(
    args: unknown
  ): Promise<{ content: PrincipalNamespaceResult[] }> {
    const input = PrincipalNamespaceInputSchema.parse(args);

    const code = '(ns.create-principal-namespace (read-keyset "ks"))';
    const tx = Pact.builder
      .execution(code)
      .addData('ks', { keys: input.keyset.keys, pred: input.keyset.pred })
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
        'PRINCIPAL_NS_FAILED',
        `principal-namespace lookup failed: ${extractErrorMessage(pre.result).slice(0, 500)}`,
        false
      );
    }

    const value = pre.result;
    if (typeof value !== 'string' || !PRINCIPAL_NS_REGEX.test(value)) {
      throw new McpToolError(
        'MALFORMED_PRINCIPAL',
        `Chainweb returned malformed principal namespace: ${JSON.stringify(value).slice(0, 200)}`,
        false
      );
    }

    return {
      content: [
        {
          namespace: value,
          gasUsed: pre.gasUsed,
          chainId: input.chainId
        }
      ]
    };
  };
}
