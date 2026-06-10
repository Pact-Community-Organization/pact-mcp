/**
 * @fileoverview Shared /local preflight helpers.
 * @author Developer
 *
 * The v0.2 read-only tools (`read_table`, `keys`, `principal_namespace`) and
 * the write tools (`deploy_module`, `continue_pact`) all funnel through
 * `/local?preflight=true`. This module encapsulates the path construction,
 * response unwrapping, and error-shape sanitization so each tool remains
 * a thin wrapper over a consistent core.
 */

import { sanitizeToolOutput } from '@pact-community/mcp-shared';
import type { ChainwebClient } from './fetch.js';
import { unwrapPactValue, type PactValue } from './unwrap.js';

export interface PreflightResponse {
  status: 'success' | 'failure';
  /** Unwrapped success data, or unwrapped+sanitized error shape. */
  result: PactValue;
  gasUsed: number;
  logs: PactValue;
}

interface RawLocalResponse {
  result?:
    | { status?: 'success'; data?: unknown }
    | { status?: 'failure'; error?: unknown };
  gas?: number;
  logs?: unknown;
}

/**
 * [Developer] Build the `/local` URL with the standard MVP query params.
 * `signatureVerification=false` is the correct default for unsigned
 * read-only probes; signed `/send` callers must pass `true` explicitly.
 */
export function buildLocalPath(
  networkId: string,
  chainId: string,
  opts: { preflight?: boolean; signatureVerification?: boolean } = {}
): string {
  const preflight = opts.preflight ?? true;
  const sigVerification = opts.signatureVerification ?? false;
  return (
    `/chainweb/0.0/${networkId}/chain/${chainId}` +
    `/pact/api/v1/local?preflight=${preflight}` +
    `&signatureVerification=${sigVerification}`
  );
}

/**
 * [Developer] POST a prepared transaction (signed or unsigned) to `/local`,
 * unwrap the Pact value tree, and surface failures through the standard
 * {@link sanitizeToolOutput} chain. Does NOT throw on Pact-level failures;
 * the caller inspects `response.status`.
 */
export async function runLocalPreflight(
  client: ChainwebClient,
  chainId: string,
  tx: unknown,
  opts: { preflight?: boolean; signatureVerification?: boolean } = {}
): Promise<PreflightResponse> {
  const path = buildLocalPath(client.networkId, chainId, {
    preflight: opts.preflight ?? true,
    signatureVerification: opts.signatureVerification ?? false
  });
  const raw = await client.postJson<RawLocalResponse>(path, tx);
  const gasUsed = typeof raw.gas === 'number' ? raw.gas : 0;
  const logs = unwrapPactValue(raw.logs ?? null);
  const result = raw.result;
  if (result && (result as { status?: string }).status === 'success') {
    return {
      status: 'success',
      result: unwrapPactValue((result as { data?: unknown }).data ?? null),
      gasUsed,
      logs
    };
  }
  const errRaw =
    (result as { error?: unknown } | undefined)?.error ?? result ?? null;
  return {
    status: 'failure',
    result: sanitizeErrorShape(unwrapPactValue(errRaw)),
    gasUsed,
    logs
  };
}

/**
 * [Developer] Walk a Pact-value tree and run every string through the
 * injection-marker sanitizer. Chainweb node error strings can echo
 * user-submitted tx data — attacker-controllable.
 */
export function sanitizeErrorShape(v: PactValue): PactValue {
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

/**
 * [Developer] Extract a short, sanitized human string from a preflight
 * failure's `result` field for error messages.
 */
export function extractErrorMessage(result: PactValue): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const msg = (result as Record<string, PactValue>)['message'];
    if (typeof msg === 'string') return msg;
  }
  return JSON.stringify(result);
}
