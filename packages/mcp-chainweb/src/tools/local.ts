/**
 * @fileoverview chainweb_local - local preflight execution of arbitrary Pact.
 *
 * Side-effect-free: executes against the node's local read-only pact service.
 * The server returns whatever Pact result the node computed, with all Pact
 * JSON-boundary types unwrapped via {@link unwrapPactValue}.
 *
 * Query params on /local:
 *   preflight=true             → run full validation (gas, signer caps, etc)
 *   signatureVerification=false → caller does not need to sign for local reads
 */

import { z } from 'zod';
import { Pact } from '@kadena/client';
import { sanitizeToolOutput } from '@pact-community/mcp-shared';
import type { ChainwebClient } from '../client/fetch.js';
import { unwrapPactValue, type PactValue } from '../client/unwrap.js';

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
    .describe('Sender account for gas accounting (default: sender00).'),
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
    .describe('Optional signer list for capability scoping in preflight.'),
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
    .describe('Whether to run full preflight checks (default: true).')
};
export const LocalInputSchema = z.object(LocalInputShape);

export interface LocalResult {
  status: 'success' | 'failure';
  /** Unwrapped Pact result value, or unwrapped error object. */
  result: PactValue;
  gasUsed: number;
  /** Raw pact log entries, if present. */
  logs: PactValue;
}

export interface LocalToolConfig {
  client: ChainwebClient;
  /** Default sender account used if input.sender is omitted. */
  defaultSender?: string;
  /** Default gas price in KDA. */
  gasPrice?: number;
}

interface RawLocalResponse {
  result?:
    | { status?: 'success'; data?: unknown }
    | { status?: 'failure'; error?: unknown };
  gas?: number;
  logs?: unknown;
  txId?: unknown;
  reqKey?: string;
  preflightWarnings?: unknown[];
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

    const preflight = input.preflight ?? true;
    const path =
      `/chainweb/0.0/${config.client.networkId}/chain/${input.chainId}` +
      `/pact/api/v1/local?preflight=${preflight}&signatureVerification=false`;
    const raw = await config.client.postJson<RawLocalResponse>(path, tx);

    const gasUsed = typeof raw.gas === 'number' ? raw.gas : 0;
    const logs = unwrapPactValue(raw.logs ?? null);

    const result = raw.result;
    if (result && (result as { status?: string }).status === 'success') {
      return {
        content: [
          {
            status: 'success',
            result: unwrapPactValue(
              (result as { data?: unknown }).data ?? null
            ),
            gasUsed,
            logs
          }
        ]
      };
    }

    const errRaw = (result as { error?: unknown } | undefined)?.error ?? result;
    const unwrappedErr = unwrapPactValue(errRaw ?? null);
    // Sanitize string fields within the error.
    const sanitized = sanitizeErrorShape(unwrappedErr);
    return {
      content: [
        {
          status: 'failure',
          result: sanitized,
          gasUsed,
          logs
        }
      ]
    };
  };
}

/**
 * Walk a Pact-value tree and run every string through the
 * injection-marker sanitizer. Chainweb node error strings can echo
 * user-submitted tx data — attacker-controllable.
 */
function sanitizeErrorShape(v: PactValue): PactValue {
  if (typeof v === 'string') {
    return sanitizeToolOutput(v).text;
  }
  if (Array.isArray(v)) {
    return v.map(sanitizeErrorShape);
  }
  if (v && typeof v === 'object') {
    const out: Record<string, PactValue> = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = sanitizeErrorShape(val);
    }
    return out;
  }
  return v;
}
