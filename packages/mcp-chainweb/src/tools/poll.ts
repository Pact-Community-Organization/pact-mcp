/**
 * @fileoverview chainweb.poll - poll /poll endpoint for tx results.
 * @author Developer
 *
 * Uses /poll (NOT /listen) because nginx on devnet enforces a hard 60s
 * upstream timeout, and /listen holds the connection open (504 bug in user
 * memory). /poll is an idempotent "give me anything you have right now"
 * request we call repeatedly until the result appears or timeout.
 */

import { z } from 'zod';
import { McpToolError, sanitizeToolOutput } from '@pact-community/mcp-shared';
import type { ChainwebClient } from '../client/fetch.js';
import { unwrapPactValue, type PactValue } from '../client/unwrap.js';

export const PollInputShape = {
  chainId: z
    .string()
    .regex(/^\d+$/)
    .describe('Chain id (decimal string, e.g. "0").'),
  requestKeys: z
    .array(z.string().min(1))
    .min(1)
    .max(20)
    .describe('Request keys returned by /send.'),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(600_000)
    .optional()
    .describe('Total poll budget (default 120_000, max 600_000).'),
  intervalMs: z
    .number()
    .int()
    .positive()
    .min(250)
    .max(30_000)
    .optional()
    .describe('Delay between /poll calls (default 5000).')
};
export const PollInputSchema = z.object(PollInputShape);

export interface PollResultEntry {
  requestKey: string;
  status: 'success' | 'failure' | 'pending';
  result: PactValue;
  gasUsed: number;
  blockHeight: number;
  blockHash: string;
}

export interface PollResult {
  results: PollResultEntry[];
  /** True iff all requestKeys yielded a terminal status within timeout. */
  complete: boolean;
}

export interface PollToolConfig {
  client: ChainwebClient;
  /** Override sleep — used by tests to drive polling without real delays. */
  sleep?: (ms: number) => Promise<void>;
}

interface RawPollEntry {
  reqKey?: string;
  txId?: number | null;
  result?: { status?: string; data?: unknown; error?: unknown };
  gas?: number;
  logs?: unknown;
  metaData?: {
    blockHeight?: number;
    blockHash?: string;
    blockTime?: number;
    prevBlockHash?: string;
  };
}
type RawPollResponse = Record<string, RawPollEntry>;

const DEFAULT_TIMEOUT = 120_000;
const DEFAULT_INTERVAL = 5_000;

export function createPollTool(config: PollToolConfig) {
  const sleep =
    config.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return async function poll(
    args: unknown
  ): Promise<{ content: PollResult[] }> {
    const input = PollInputSchema.parse(args);
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT;
    const intervalMs = input.intervalMs ?? DEFAULT_INTERVAL;

    const path =
      `/chainweb/0.0/${config.client.networkId}/chain/${input.chainId}` +
      `/pact/api/v1/poll`;
    const deadline = Date.now() + timeoutMs;
    const seen = new Map<string, PollResultEntry>();

    while (Date.now() < deadline && seen.size < input.requestKeys.length) {
      const pending = input.requestKeys.filter((k) => !seen.has(k));
      if (pending.length === 0) break;

      let resp: RawPollResponse;
      try {
        resp = await config.client.postJson<RawPollResponse>(path, {
          requestKeys: pending
        });
      } catch (err) {
        if (err instanceof McpToolError && err.retryable) {
          // Retryable HTTP 5xx — sleep and try again.
          await sleep(intervalMs);
          continue;
        }
        throw err;
      }

      for (const [key, entry] of Object.entries(resp)) {
        if (seen.has(key)) continue;
        const mapped = mapEntry(key, entry);
        if (mapped) seen.set(key, mapped);
      }

      if (seen.size >= input.requestKeys.length) break;
      await sleep(intervalMs);
    }

    // Fill in pending placeholders for unresolved keys.
    const results: PollResultEntry[] = input.requestKeys.map(
      (k) =>
        seen.get(k) ?? {
          requestKey: k,
          status: 'pending',
          result: null,
          gasUsed: 0,
          blockHeight: -1,
          blockHash: ''
        }
    );
    const complete = results.every((r) => r.status !== 'pending');
    return { content: [{ results, complete }] };
  };
}

function mapEntry(
  requestKey: string,
  raw: RawPollEntry
): PollResultEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const status = raw.result?.status;
  if (status !== 'success' && status !== 'failure') {
    // Some node builds return empty {} for pending keys → treat as not seen.
    return null;
  }
  const gasUsed = typeof raw.gas === 'number' ? raw.gas : 0;
  const blockHeight = raw.metaData?.blockHeight ?? -1;
  const blockHash = raw.metaData?.blockHash ?? '';
  if (status === 'success') {
    return {
      requestKey,
      status: 'success',
      result: unwrapPactValue(raw.result?.data ?? null),
      gasUsed,
      blockHeight,
      blockHash
    };
  }
  const unwrappedErr = unwrapPactValue(raw.result?.error ?? null);
  return {
    requestKey,
    status: 'failure',
    result: sanitizeErrorShape(unwrappedErr),
    gasUsed,
    blockHeight,
    blockHash
  };
}

function sanitizeErrorShape(v: PactValue): PactValue {
  if (typeof v === 'string') return sanitizeToolOutput(v).text;
  if (Array.isArray(v)) return v.map(sanitizeErrorShape);
  if (v && typeof v === 'object') {
    const out: Record<string, PactValue> = {};
    for (const [k, val] of Object.entries(v)) out[k] = sanitizeErrorShape(val);
    return out;
  }
  return v;
}
