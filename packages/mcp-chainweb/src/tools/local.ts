/**
 * @fileoverview chainweb_local - local execution of arbitrary Pact.
 *
 * Side-effect-free: executes against the node's local read-only pact service.
 * The server returns whatever Pact result the node computed, with all Pact
 * JSON-boundary types unwrapped via {@link unwrapPactValue}.
 *
 * Query params on /local:
 *   preflight=false (default)  → evaluate the code only; what a read wants.
 *   preflight=true             → simulate the whole transaction, gas purchase
 *                                included: `sender` must exist and its key
 *                                must be listed in `signers`, or the node
 *                                answers "Failed to buy gas".
 *   signatureVerification=false → signers are named, never signed for.
 */

import { z } from 'zod';
import { Pact } from '@kadena/client';
import type { ChainwebClient } from '../client/fetch.js';
import type { PactValue } from '../client/unwrap.js';
import { runLocalPreflight } from '../client/preflight.js';

export const LocalInputShape = {
  chainId: z
    .string()
    .regex(/^\d+$/)
    .describe('Chain id (decimal string, e.g. "0").'),
  code: z
    .string()
    .min(1)
    .describe('Pact code to execute in read-only mode.'),
  data: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Optional env-data object passed to the Pact interpreter.'),
  sender: z
    .string()
    .min(1)
    .max(256)
    .optional()
    .describe(
      'Sender account in the transaction metadata (default: sender00). Only checked when preflight is true.'
    ),
  signers: z
    .array(
      z.object({
        publicKey: z
          .string()
          .regex(/^[0-9a-fA-F]{64}$/)
          .describe('ED25519 public key hex (64 chars).'),
        capabilities: z
          .array(
            z.object({
              name: z.string().min(1),
              args: z.array(z.unknown()).default([])
            })
          )
          .optional()
      })
    )
    .optional()
    .describe(
      'Optional signer list (public keys + capabilities). Never signed for; lets keyset and capability checks pass in the simulation.'
    ),
  gasLimit: z
    .number()
    .int()
    .positive()
    .max(150_000)
    .optional()
    .describe('Gas limit (≤150_000, the chainweb hard ceiling).'),
  preflight: z
    .boolean()
    .optional()
    .describe(
      'false (default): evaluate the code only — use this for reads. true: simulate the full transaction including the gas purchase; needs an existing sender whose key is in signers.'
    )
};
export const LocalInputSchema = z.object(LocalInputShape);

export interface LocalResult {
  status: 'success' | 'failure';
  /** Unwrapped Pact result value, or unwrapped error object. */
  result: PactValue;
  gasUsed: number;
  /** Raw pact log entries, if present. */
  logs: PactValue;
  /** Node warnings; present only when a preflight=true run reported any. */
  warnings?: string[];
}

export interface LocalToolConfig {
  client: ChainwebClient;
  /** Default sender account used if input.sender is omitted. */
  defaultSender?: string;
  /** Default gas price in KDA. */
  gasPrice?: number;
}

export function createLocalTool(config: LocalToolConfig) {
  const defaultSender = config.defaultSender ?? 'sender00';
  const gasPrice = config.gasPrice ?? 1e-7;
  return async function local(
    args: unknown
  ): Promise<{ content: LocalResult[] }> {
    const input = LocalInputSchema.parse(args);

    // Build an unsigned transaction via @kadena/client.
    let builder = Pact.builder.execution(input.code);
    if (input.data) {
      for (const [k, v] of Object.entries(input.data)) {
        builder = builder.addData(k, v as never);
      }
    }
    if (input.signers && input.signers.length > 0) {
      for (const s of input.signers) {
        if (s.capabilities && s.capabilities.length > 0) {
          builder = builder.addSigner(s.publicKey, (withCap) =>
            s.capabilities!.map((c) =>
              withCap(c.name, ...(c.args as never[]))
            )
          );
        } else {
          builder = builder.addSigner(s.publicKey);
        }
      }
    }
    const chainId = input.chainId;
    const tx = builder
      .setMeta({
        chainId: chainId as never,
        gasLimit: input.gasLimit ?? 150_000,
        gasPrice,
        senderAccount: input.sender ?? defaultSender
      })
      .setNetworkId(config.client.networkId)
      .createTransaction();

    const pre = await runLocalPreflight(config.client, input.chainId, tx, {
      preflight: input.preflight ?? false
    });
    return {
      content: [
        {
          status: pre.status,
          result: pre.result,
          gasUsed: pre.gasUsed,
          logs: pre.logs,
          ...(pre.warnings.length > 0 ? { warnings: pre.warnings } : {})
        }
      ]
    };
  };
}
