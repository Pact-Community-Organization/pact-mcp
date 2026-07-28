/**
 * @fileoverview chainweb_continue_pact - continue a cross-chain defpact step.
 *
 * Builds a continuation command (`cmd.payload.cont = { pactId, step,
 * rollback, proof, data }`), routes it to the target chain, runs `/local`
 * preflight, and — iff signatures are supplied — POSTs to `/send`.
 *
 * Signer is SCOPED by default (caller supplies `signerCapabilities`,
 * typically including `coin.GAS`). This differs from `deploy_module` which
 * uses an unscoped signer — see user-memory devnet-deploy-patterns.md.
 *
 * Known limitation (memory: continuation transitive deps bug): the
 * continuation tx's JSON may need to explicitly reference all transitive
 * modules. This tool does NOT auto-inject dependencies — callers must
 * construct `envData` accordingly. See README.
 */

import { z } from 'zod';
import { Pact } from '@kadena/client';
import { McpToolError } from '@pact-community/mcp-shared';
import type { ChainwebClient } from '../client/fetch.js';
import {
  runLocalPreflight,
  extractErrorMessage,
  type PreflightResponse
} from '../client/preflight.js';

const CHAIN_ID_REGEX = /^(1?[0-9])$/;
const PUBKEY_REGEX = /^[0-9a-fA-F]{64}$/;
const PACT_ID_REGEX = /^[A-Za-z0-9_\-./]{1,256}$/;
const CAP_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_.-]{0,127}$/;

/** 64KB envData cap. */
export const MAX_ENV_DATA_BYTES = 64 * 1024;
/** 2MB proof cap — SPV proofs are typically a few KB. */
export const MAX_PROOF_BYTES = 2 * 1024 * 1024;

export const ContinuePactInputShape = {
  pactId: z
    .string()
    .regex(PACT_ID_REGEX)
    .describe('Defpact id from the originating transaction.'),
  step: z.number().int().min(0).max(1024).describe('Step index to continue.'),
  rollback: z.boolean().default(false).describe('Run the rollback branch.'),
  targetChainId: z
    .string()
    .regex(CHAIN_ID_REGEX)
    .describe('Chain id where the continuation executes (0..19).'),
  proof: z
    .string()
    .optional()
    .describe(
      'Base64 SPV proof. Required when the continuation spans chains. Fetch via `chainweb_spv_proof`.'
    ),
  envData: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Optional env-data for the continuation step.'),
  signerKey: z
    .string()
    .regex(PUBKEY_REGEX)
    .describe("Signer's public key (hex, 64 chars)."),
  signerCapabilities: z
    .array(
      z.object({
        name: z.string().regex(CAP_NAME_REGEX),
        args: z.array(z.unknown()).default([])
      })
    )
    .min(1)
    .max(16)
    .optional()
    .describe(
      'Signer capabilities (scoped). Default: [{ name: "coin.GAS", args: [] }].'
    ),
  gasLimit: z
    .number()
    .int()
    .min(1)
    .max(150_000)
    .default(50_000)
    .describe('Gas limit (≤150_000).'),
  sender: z
    .string()
    .min(1)
    .max(256)
    .optional()
    .describe('Sender account (default: sender00).'),
  sigs: z
    .array(z.object({ sig: z.string().min(1) }))
    .optional()
    .describe(
      'Optional signatures. When provided the server submits to /send; otherwise returns the unsigned envelope.'
    )
};
export const ContinuePactInputSchema = z.object(ContinuePactInputShape);

export interface ContinuePactResult {
  targetChainId: string;
  preflight: {
    ok: boolean;
    gasUsed: number;
    error?: string;
  };
  submitted: boolean;
  requestKey?: string;
  unsignedTx?: { cmd: string; hash: string };
}

export interface ContinuePactToolConfig {
  client: ChainwebClient;
  defaultSender?: string;
  gasPrice?: number;
}

interface RawSendResponse {
  requestKeys?: string[];
}

export function createContinuePactTool(config: ContinuePactToolConfig) {
  const defaultSender = config.defaultSender ?? 'sender00';
  const gasPrice = config.gasPrice ?? 1e-7;
  return async function continuePact(
    args: unknown
  ): Promise<{ content: ContinuePactResult[] }> {
    const input = ContinuePactInputSchema.parse(args);

    if (input.envData !== undefined) {
      const bytes = Buffer.byteLength(JSON.stringify(input.envData), 'utf-8');
      if (bytes > MAX_ENV_DATA_BYTES) {
        throw new McpToolError(
          'ENV_DATA_TOO_LARGE',
          `envData exceeds ${MAX_ENV_DATA_BYTES} bytes.`,
          false
        );
      }
    }
    if (input.proof !== undefined) {
      if (Buffer.byteLength(input.proof, 'utf-8') > MAX_PROOF_BYTES) {
        throw new McpToolError(
          'PROOF_TOO_LARGE',
          `proof exceeds ${MAX_PROOF_BYTES} bytes.`,
          false
        );
      }
    }

    const caps = input.signerCapabilities ?? [
      { name: 'coin.GAS', args: [] as unknown[] }
    ];

    // Continuation builder. Proof is optional for same-chain
    // continuations; required for cross-chain. We pass `null` when absent
    // (Pact's `read-continuation-proof` accepts null for same-chain).
    let builder = Pact.builder.continuation({
      pactId: input.pactId,
      step: input.step,
      rollback: input.rollback,
      ...(input.proof !== undefined ? { proof: input.proof } : {})
    });

    // SCOPED signer — continuations benefit from
    // capability scoping (memory: scoped signers are correct for
    // defpact continuations; unscoped is only for module deploys).
    builder = builder.addSigner(input.signerKey, (withCap) =>
      caps.map((c) => withCap(c.name as never, ...(c.args as never[])))
    );

    builder = builder
      .setMeta({
        chainId: input.targetChainId as never,
        gasLimit: input.gasLimit,
        gasPrice,
        senderAccount: input.sender ?? defaultSender
      })
      .setNetworkId(config.client.networkId);

    if (input.envData) {
      for (const [k, v] of Object.entries(input.envData)) {
        builder = builder.addData(k, v as never);
      }
    }

    const unsigned = builder.createTransaction();
    const hasSigs = Array.isArray(input.sigs) && input.sigs.length > 0;
    const txForLocal = hasSigs
      ? { cmd: unsigned.cmd, hash: unsigned.hash, sigs: input.sigs }
      : unsigned;

    let pre: PreflightResponse;
    try {
      pre = await runLocalPreflight(
        config.client,
        input.targetChainId,
        txForLocal,
        { signatureVerification: hasSigs }
      );
    } catch (err) {
      if (err instanceof McpToolError) throw err;
      throw new McpToolError(
        'CONTINUE_PREFLIGHT_ERROR',
        `Preflight transport error: ${String(err).slice(0, 500)}`,
        false
      );
    }

    if (pre.status === 'failure') {
      return {
        content: [
          {
            targetChainId: input.targetChainId,
            preflight: {
              ok: false,
              gasUsed: pre.gasUsed,
              error: extractErrorMessage(pre.result).slice(0, 500)
            },
            submitted: false
          }
        ]
      };
    }

    if (!hasSigs) {
      return {
        content: [
          {
            targetChainId: input.targetChainId,
            preflight: { ok: true, gasUsed: pre.gasUsed },
            submitted: false,
            unsignedTx: { cmd: unsigned.cmd, hash: unsigned.hash }
          }
        ]
      };
    }

    const sendPath = `/chainweb/0.0/${config.client.networkId}/chain/${input.targetChainId}/pact/api/v1/send`;
    const sendResp = await config.client.postJson<RawSendResponse>(sendPath, {
      cmds: [{ cmd: unsigned.cmd, hash: unsigned.hash, sigs: input.sigs }]
    });
    const requestKey = sendResp.requestKeys?.[0];
    if (typeof requestKey !== 'string' || requestKey.length === 0) {
      throw new McpToolError(
        'SEND_NO_REQUEST_KEY',
        'Chainweb /send did not return a requestKey.',
        false
      );
    }

    return {
      content: [
        {
          targetChainId: input.targetChainId,
          preflight: { ok: true, gasUsed: pre.gasUsed },
          submitted: true,
          requestKey
        }
      ]
    };
  };
}
