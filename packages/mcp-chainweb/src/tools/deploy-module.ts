/**
 * @fileoverview chainweb.deploy_module - build, preflight, and submit a Pact module deploy.
 *
 * Highest-risk tool in the v0.2 set. Guarded by construction:
 *
 *   1. The signer declaration is ALWAYS UNSCOPED — `.addSigner(publicKey)`
 *      with NO capability callback. Memory lesson: scoped signers can't
 *      satisfy `enforce-keyset` / `enforce-guard(keyset-ref-guard(...))`
 *      on-chain, which is exactly what module-deploy governance evaluates.
 *      See user-memory devnet-deploy-patterns.md.
 *
 *   2. `createTableCalls` are appended to the module code inside the SAME
 *      transaction. Memory lesson: a separate `(create-table ...)` tx fails
 *      with "Module admin is necessary for operation". We do not let
 *      callers accidentally split this.
 *
 *   3. Module code size ≤512KB. Typical Pact modules are <50KB; the 10×
 *      buffer catches accidental blob submission.
 *
 *   4. This server NEVER accepts private keys. The caller supplies the
 *      signer's public key, and — if they want the server to submit —
 *      a `sigs` array of the upstream-computed signatures. Without `sigs`
 *      the tool runs preflight only and returns the unsigned envelope for
 *      the caller to sign and re-submit via `chainweb.send`.
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
const NS_REGEX = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/;
const KEYSET_REF_REGEX = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/;

/** 512KB hard cap on the combined module code + create-table calls. */
export const MAX_MODULE_CODE_BYTES = 512 * 1024;
/** 64KB envData cap (same rationale as continue_pact). */
export const MAX_ENV_DATA_BYTES = 64 * 1024;

export const DeployModuleInputShape = {
  chainId: z.string().regex(CHAIN_ID_REGEX).describe('Chain id 0..19.'),
  module: z
    .object({
      code: z.string().min(1).describe('Pact module source code.'),
      ns: z
        .string()
        .regex(NS_REGEX)
        .optional()
        .describe('Optional namespace name (passed via envData as `ns`).'),
      keysetRef: z
        .string()
        .regex(KEYSET_REF_REGEX)
        .optional()
        .describe(
          'Optional keyset reference name for documentation; caller must still put the keyset in envData.'
        )
    })
    .describe('Pact module to deploy.'),
  envData: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Optional env-data. Typically `{ ns: "...", ns-keyset: { keys, pred } }`.'
    ),
  signerKey: z
    .string()
    .regex(PUBKEY_REGEX)
    .describe(
      "Signer's public key (hex, 64 chars). UNSCOPED signer is enforced — no capability list."
    ),
  gasLimit: z
    .number()
    .int()
    .min(1)
    .max(150_000)
    .default(50_000)
    .describe('Gas limit (≤150_000).'),
  createTableCalls: z
    .array(z.string().min(1).max(1024))
    .max(64)
    .optional()
    .describe(
      'Optional `(create-table ...)` expressions appended to the module in the SAME tx. A separate tx for create-table fails with "Module admin is necessary for operation".'
    ),
  sender: z
    .string()
    .min(1)
    .max(256)
    .optional()
    .describe('Sender account for gas accounting (default: sender00).'),
  sigs: z
    .array(z.object({ sig: z.string().min(1) }))
    .optional()
    .describe(
      'Optional signatures for the built command. When provided, the server submits to /send and returns a requestKey. When omitted, the server runs preflight only and returns the unsigned envelope for external signing.'
    )
};
export const DeployModuleInputSchema = z.object(DeployModuleInputShape);

export interface DeployModuleResult {
  chainId: string;
  preflight: {
    ok: boolean;
    gasUsed: number;
    error?: string;
  };
  deployed: boolean;
  /** Present iff `deployed: true`. */
  requestKey?: string;
  /** Present iff `deployed: false` and preflight ok — returned for external signing. */
  unsignedTx?: { cmd: string; hash: string };
}

export interface DeployModuleToolConfig {
  client: ChainwebClient;
  defaultSender?: string;
  gasPrice?: number;
}

interface RawSendResponse {
  requestKeys?: string[];
}

export function createDeployModuleTool(config: DeployModuleToolConfig) {
  const defaultSender = config.defaultSender ?? 'sender00';
  const gasPrice = config.gasPrice ?? 1e-7;
  return async function deployModule(
    args: unknown
  ): Promise<{ content: DeployModuleResult[] }> {
    const input = DeployModuleInputSchema.parse(args);

    // Compose final code: module + create-table calls (same tx).
    const pieces: string[] = [input.module.code];
    if (input.createTableCalls && input.createTableCalls.length > 0) {
      for (const c of input.createTableCalls) pieces.push(c);
    }
    const code = pieces.join('\n');
    if (Buffer.byteLength(code, 'utf-8') > MAX_MODULE_CODE_BYTES) {
      throw new McpToolError(
        'MODULE_CODE_TOO_LARGE',
        `Module code (+ create-table calls) exceeds ${MAX_MODULE_CODE_BYTES} bytes.`,
        false
      );
    }

    if (input.envData !== undefined) {
      const envDataBytes = Buffer.byteLength(
        JSON.stringify(input.envData),
        'utf-8'
      );
      if (envDataBytes > MAX_ENV_DATA_BYTES) {
        throw new McpToolError(
          'ENV_DATA_TOO_LARGE',
          `envData exceeds ${MAX_ENV_DATA_BYTES} bytes.`,
          false
        );
      }
    }

    // UNSCOPED signer — critical. Do NOT add a capability
    // callback here. See user-memory devnet-deploy-patterns.md.
    let builder = Pact.builder
      .execution(code)
      .addSigner(input.signerKey)
      .setMeta({
        chainId: input.chainId as never,
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

    // Preflight — sigs present ⇒ sigVerification=true; else false.
    const hasSigs = Array.isArray(input.sigs) && input.sigs.length > 0;
    const txForLocal = hasSigs
      ? { cmd: unsigned.cmd, hash: unsigned.hash, sigs: input.sigs }
      : unsigned;

    let pre: PreflightResponse;
    try {
      pre = await runLocalPreflight(config.client, input.chainId, txForLocal, {
        signatureVerification: hasSigs
      });
    } catch (err) {
      if (err instanceof McpToolError) throw err;
      throw new McpToolError(
        'DEPLOY_PREFLIGHT_ERROR',
        `Preflight transport error: ${String(err).slice(0, 500)}`,
        false
      );
    }

    if (pre.status === 'failure') {
      return {
        content: [
          {
            chainId: input.chainId,
            preflight: {
              ok: false,
              gasUsed: pre.gasUsed,
              error: extractErrorMessage(pre.result).slice(0, 500)
            },
            deployed: false
          }
        ]
      };
    }

    // Preflight ok.
    if (!hasSigs) {
      return {
        content: [
          {
            chainId: input.chainId,
            preflight: { ok: true, gasUsed: pre.gasUsed },
            deployed: false,
            unsignedTx: { cmd: unsigned.cmd, hash: unsigned.hash }
          }
        ]
      };
    }

    // Submit to /send.
    const sendPath = `/chainweb/0.0/${config.client.networkId}/chain/${input.chainId}/pact/api/v1/send`;
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
          chainId: input.chainId,
          preflight: { ok: true, gasUsed: pre.gasUsed },
          deployed: true,
          requestKey
        }
      ]
    };
  };
}
