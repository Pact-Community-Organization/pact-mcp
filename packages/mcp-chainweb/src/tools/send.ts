/**
 * @fileoverview chainweb.send - POST a pre-signed transaction after preflight.
 * @author Developer
 *
 * Security invariant: the server NEVER accepts private keys. The caller must
 * provide a `{cmd, hash, sigs}` tuple produced by their signing toolchain.
 * The server runs a local preflight and refuses to POST /send if the
 * preflight returns `status: "failure"`.
 */

import { z } from 'zod';
import { McpToolError } from '@pact-community/mcp-shared';
import type { ChainwebClient } from '../client/fetch.js';

export const SendInputShape = {
  chainId: z
    .string()
    .regex(/^\d+$/)
    .describe('Chain id (decimal string, e.g. "0").'),
  signedTx: z
    .object({
      cmd: z.string().min(1),
      hash: z.string().min(1),
      sigs: z.array(
        z.object({ sig: z.string().min(1) })
      )
    })
    .describe(
      'Pre-signed chainweb transaction. Produce via @kadena/client createTransaction+sign.'
    )
};
export const SendInputSchema = z.object(SendInputShape);

export interface SendResult {
  requestKey: string;
  preflight: {
    ok: boolean;
    gasUsed: number;
  };
}

export interface SendToolConfig {
  client: ChainwebClient;
}

interface RawLocalResponse {
  result?: { status?: string };
  gas?: number;
}

interface RawSendResponse {
  requestKeys?: string[];
}

export function createSendTool(config: SendToolConfig) {
  return async function send(
    args: unknown
  ): Promise<{ content: SendResult[] }> {
    const input = SendInputSchema.parse(args);

    const netId = config.client.networkId;
    const chainId = input.chainId;
    const base = `/chainweb/0.0/${netId}/chain/${chainId}/pact/api/v1`;

    // [Developer] Preflight FIRST. Signed tx → signatureVerification=true.
    const localPath = `${base}/local?preflight=true&signatureVerification=true`;
    const preflight = await config.client.postJson<RawLocalResponse>(
      localPath,
      input.signedTx
    );
    const gasUsed = typeof preflight.gas === 'number' ? preflight.gas : 0;
    const status = preflight.result?.status;
    if (status !== 'success') {
      throw new McpToolError(
        'PREFLIGHT_FAILED',
        `Preflight returned status='${status}' — refusing to /send. gas=${gasUsed}`,
        false
      );
    }

    // Preflight OK — submit.
    const sendPath = `${base}/send`;
    // chainweb /send expects { cmds: [tx] }
    const sendResp = await config.client.postJson<RawSendResponse>(sendPath, {
      cmds: [input.signedTx]
    });
    const requestKey = sendResp.requestKeys?.[0];
    if (typeof requestKey !== 'string' || requestKey.length === 0) {
      throw new McpToolError(
        'SEND_NO_REQUEST_KEY',
        'Chainweb /send response did not contain a requestKey.',
        false
      );
    }

    return {
      content: [
        {
          requestKey,
          preflight: { ok: true, gasUsed }
        }
      ]
    };
  };
}
