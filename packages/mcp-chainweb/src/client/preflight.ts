/**
 * @fileoverview Shared /local helpers.
 *
 * Every tool that talks to `/local` funnels through this module, which owns
 * the path construction, the response parsing, and the error-shape
 * sanitization.
 *
 * Two modes, and they are NOT interchangeable:
 *  - `preflight=false` evaluates the code only. This is what a READ wants
 *    (`local`, `read_table`, `keys`, `principal_namespace`): no gas is
 *    bought, so the sender does not have to exist or sign.
 *  - `preflight=true` simulates the whole transaction, gas purchase
 *    included, so it fails ("Failed to buy gas: Keyset failure") unless the
 *    sender exists and its key is among the signers. This is what a WRITE
 *    wants before `/send` (`send`, `deploy_module`, `continue_pact`).
 *
 * The node answers the two modes with DIFFERENT shapes — see
 * {@link parseLocalResponse}.
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
  /** Node warnings; only a `preflight=true` response carries any. */
  warnings: string[];
}

interface RawCommandResult {
  result?:
    | { status?: 'success'; data?: unknown }
    | { status?: 'failure'; error?: unknown };
  gas?: number;
  logs?: unknown;
}

/**
 * Body of a `/local` response. `preflight=false` returns the command result
 * itself; `preflight=true` returns it under `preflightResult`, next to
 * `preflightWarnings` (measured on chainweb-node 3.2, mainnet01 and devnet).
 * A parser that reads `result` off the top level sees nothing on a preflight
 * response and reports every transaction as failed.
 */
export interface RawLocalResponse extends RawCommandResult {
  preflightResult?: RawCommandResult;
  preflightWarnings?: unknown;
}

/**
 * Turn either `/local` response shape into a {@link PreflightResponse}.
 * Does NOT throw on Pact-level failures; the caller inspects `status`.
 */
export function parseLocalResponse(raw: RawLocalResponse): PreflightResponse {
  const cmd: RawCommandResult =
    raw.preflightResult && typeof raw.preflightResult === 'object'
      ? raw.preflightResult
      : raw;
  const warnings = Array.isArray(raw.preflightWarnings)
    ? raw.preflightWarnings.map((w) => sanitizeToolOutput(String(w)).text)
    : [];
  const gasUsed = typeof cmd.gas === 'number' ? cmd.gas : 0;
  const logs = unwrapPactValue(cmd.logs ?? null);
  const result = cmd.result;
  if (result && (result as { status?: string }).status === 'success') {
    return {
      status: 'success',
      result: unwrapPactValue((result as { data?: unknown }).data ?? null),
      gasUsed,
      logs,
      warnings
    };
  }
  const errRaw =
    (result as { error?: unknown } | undefined)?.error ?? result ?? null;
  return {
    status: 'failure',
    result: sanitizeErrorShape(unwrapPactValue(errRaw)),
    gasUsed,
    logs,
    warnings
  };
}

/**
 * Build the `/local` URL with the standard MVP query params.
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
 * POST a prepared transaction (signed or unsigned) to `/local`,
 * unwrap the Pact value tree, and surface failures through the standard
 * {@link sanitizeToolOutput} chain. Does NOT throw on Pact-level failures;
 * the caller inspects `response.status`.
 *
 * `preflight` defaults to `true` (the write-path mode); read-only callers
 * pass `preflight: false` explicitly.
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
  const raw = await client.postJson<RawLocalResponse>(path, withoutEmptySigs(tx));
  return parseLocalResponse(raw);
}

/**
 * `createTransaction()` leaves one `undefined` slot in `sigs` per signer,
 * which serializes to `null`; a real node rejects that body outright
 * (HTTP 400 "parsing UserSig failed, expected Object, but encountered
 * Null"). An unsigned simulation must send the missing signatures as
 * absent, not as null. Supplied signatures are passed through untouched.
 */
function withoutEmptySigs(tx: unknown): unknown {
  if (!tx || typeof tx !== 'object' || Array.isArray(tx)) return tx;
  const sigs = (tx as { sigs?: unknown }).sigs;
  if (!Array.isArray(sigs)) return tx;
  return { ...tx, sigs: sigs.filter((s) => s !== null && s !== undefined) };
}

/**
 * Walk a Pact-value tree and run every string through the
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
 * Extract a short, sanitized human string from a preflight
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
