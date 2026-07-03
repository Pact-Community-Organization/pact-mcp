/**
 * @fileoverview chainweb.spv_proof - fetch an SPV proof for a cross-chain tx.
 *
 * Calls `POST /chain/<source>/pact/spv` with `{ requestKey, targetChainId }`.
 * The proof is a base64 string passed through to `chainweb.continue_pact`.
 *
 * When the proof is not yet ready (tx still in mempool or awaiting cut
 * confirmation), chainweb responds with a short status string. We surface
 * that as `ready: false` — callers poll, they do not treat it as an error.
 */

import { z } from 'zod';
import { McpToolError, sanitizeToolOutput } from '@pact-community/mcp-shared';
import type { ChainwebClient } from '../client/fetch.js';

const CHAIN_ID_REGEX = /^(1?[0-9])$/;
const REQUEST_KEY_REGEX = /^[A-Za-z0-9_\-]{1,256}$/;

export const SpvProofInputShape = {
  sourceChainId: z
    .string()
    .regex(CHAIN_ID_REGEX)
    .describe('Chain id where the originating tx landed.'),
  targetChainId: z
    .string()
    .regex(CHAIN_ID_REGEX)
    .describe('Chain id where the continuation will execute.'),
  requestKey: z
    .string()
    .regex(REQUEST_KEY_REGEX)
    .describe('Request key of the originating cross-chain tx.'),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(30_000)
    .default(30_000)
    .describe('Per-request timeout (default 30s). Caller handles retry.')
};
export const SpvProofInputSchema = z.object(SpvProofInputShape);

export interface SpvProofResult {
  ready: boolean;
  proof?: string;
  message?: string;
  sourceChainId: string;
  targetChainId: string;
}

export interface SpvProofToolConfig {
  client: ChainwebClient;
}

const NOT_READY_PATTERNS =
  /proof.*not.*ready|still.*pending|awaiting|not.*yet|tx not yet|no tx/i;

export function createSpvProofTool(config: SpvProofToolConfig) {
  return async function spvProof(
    args: unknown
  ): Promise<{ content: SpvProofResult[] }> {
    const input = SpvProofInputSchema.parse(args);
    if (input.sourceChainId === input.targetChainId) {
      throw new McpToolError(
        'SPV_SAME_CHAIN',
        'sourceChainId and targetChainId must differ for cross-chain SPV.',
        false
      );
    }

    const path = `/chainweb/0.0/${config.client.networkId}/chain/${input.sourceChainId}/pact/spv`;
    const body = {
      requestKey: input.requestKey,
      targetChainId: input.targetChainId
    };

    try {
      // Chainweb /spv returns either a JSON-encoded base64
      // string proof OR a text status like "SPV proof not ready". Both
      // paths come back through the allowlisted fetch.
      const proof = await config.client.postJson<unknown>(path, body, {
        signal: AbortSignal.timeout(input.timeoutMs)
      });
      if (typeof proof === 'string' && proof.length > 0) {
        return {
          content: [
            {
              ready: true,
              proof,
              sourceChainId: input.sourceChainId,
              targetChainId: input.targetChainId
            }
          ]
        };
      }
      // Unexpected shape — surface raw (sanitized) for diagnostics.
      return {
        content: [
          {
            ready: false,
            message: sanitizeToolOutput(
              `Unexpected SPV response shape: ${JSON.stringify(proof).slice(0, 200)}`
            ).text,
            sourceChainId: input.sourceChainId,
            targetChainId: input.targetChainId
          }
        ]
      };
    } catch (err) {
      if (err instanceof McpToolError && err.code === 'CHAINWEB_HTTP_ERROR') {
        const msg = err.message;
        if (NOT_READY_PATTERNS.test(msg)) {
          return {
            content: [
              {
                ready: false,
                message: sanitizeToolOutput(msg).text.slice(0, 500),
                sourceChainId: input.sourceChainId,
                targetChainId: input.targetChainId
              }
            ]
          };
        }
      }
      if (err instanceof McpToolError && err.code === 'CHAINWEB_INVALID_JSON') {
        // Chainweb sometimes returns plain text for "not ready".
        const msg = err.message;
        if (NOT_READY_PATTERNS.test(msg)) {
          return {
            content: [
              {
                ready: false,
                message: sanitizeToolOutput(msg).text.slice(0, 500),
                sourceChainId: input.sourceChainId,
                targetChainId: input.targetChainId
              }
            ]
          };
        }
      }
      throw err;
    }
  };
}
