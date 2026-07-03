/**
 * @fileoverview Chainweb HTTP client - allowlisted fetch + header-encoding
 *
 * Thin layer over `createAllowlistedFetch` from mcp-shared. Every chainweb
 * HTTP endpoint MUST be accessed through this module so that:
 *   1. origin validation happens exactly once at construction,
 *   2. the binary-vs-JSON header-encoding trap for `/chain/:id/header` is
 *      enforced by routing through {@link getBlockHeader},
 *   3. non-2xx responses surface as McpToolError (not generic exceptions).
 */

import { createAllowlistedFetch, McpToolError } from '@pact-community/mcp-shared';

export interface ChainwebClientConfig {
  /** e.g. `http://localhost:8081` — already validated against the allowlist. */
  baseUrl: string;
  /** Network id (e.g. `development`). */
  networkId: string;
  /** Primary allowlisted origins (production set). */
  allowedOrigins: string[];
  /**
   * Programmatic test-only override that adds extra allowed origins (used to
   * point the client at a 127.0.0.1:{ephemeral} mock server during unit
   * tests). NEVER honored from env variables in production callers.
   */
  additionalAllowedOrigins?: string[];
}

export interface ChainwebClient {
  /** Raw GET — returns parsed JSON on 2xx, throws McpToolError on non-2xx. */
  getJson<T = unknown>(pathAndQuery: string, init?: RequestInit): Promise<T>;
  /** Raw POST (JSON body) — returns parsed JSON on 2xx, throws on non-2xx. */
  postJson<T = unknown>(
    pathAndQuery: string,
    body: unknown,
    init?: RequestInit
  ): Promise<T>;
  /**
   * Fetch a block header with the CORRECT Accept header. The default
   * `application/json` returns base64 binary — documented devnet bug.
   */
  getBlockHeader<T = unknown>(chainId: string, blockHash: string): Promise<T>;
  /** For diagnostics/tests only: inspect the base URL. */
  readonly baseUrl: string;
  readonly networkId: string;
}

/**
 * Construct a chainweb HTTP client with an allowlisted fetch.
 *
 * The base URL origin MUST be present in `allowedOrigins` (or in
 * `additionalAllowedOrigins` when provided by test harness). We re-validate
 * here — defence in depth vs. a caller that forgot to cross-check.
 */
export function createChainwebClient(
  cfg: ChainwebClientConfig
): ChainwebClient {
  const parsedBase = new URL(cfg.baseUrl);
  const merged = [
    ...cfg.allowedOrigins,
    ...(cfg.additionalAllowedOrigins ?? [])
  ];
  if (!merged.includes(parsedBase.origin)) {
    throw new McpToolError(
      'BASE_URL_NOT_ALLOWED',
      `Base URL '${cfg.baseUrl}' (origin '${parsedBase.origin}') not in allowlist: ${merged.join(', ')}`,
      false
    );
  }

  const fetchSafe = createAllowlistedFetch(cfg.allowedOrigins, {
    ...(cfg.additionalAllowedOrigins
      ? { additionalAllowedOrigins: cfg.additionalAllowedOrigins }
      : {})
  });

  async function readJson<T>(resp: Response, url: string): Promise<T> {
    const text = await resp.text();
    if (!resp.ok) {
      throw new McpToolError(
        'CHAINWEB_HTTP_ERROR',
        `HTTP ${resp.status} from ${url}: ${text.slice(0, 500)}`,
        resp.status >= 500 // server errors may be retryable
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new McpToolError(
        'CHAINWEB_INVALID_JSON',
        `Non-JSON response from ${url}: ${text.slice(0, 200)}`,
        false
      );
    }
  }

  function joinUrl(pathAndQuery: string): string {
    const base = cfg.baseUrl.replace(/\/+$/, '');
    const suffix = pathAndQuery.startsWith('/')
      ? pathAndQuery
      : '/' + pathAndQuery;
    return base + suffix;
  }

  return {
    get baseUrl() {
      return cfg.baseUrl;
    },
    get networkId() {
      return cfg.networkId;
    },
    async getJson(pathAndQuery, init) {
      const url = joinUrl(pathAndQuery);
      const resp = await fetchSafe(url, { ...(init ?? {}), method: 'GET' });
      return readJson(resp, url);
    },
    async postJson(pathAndQuery, body, init) {
      const url = joinUrl(pathAndQuery);
      const headers = new Headers(init?.headers);
      headers.set('Content-Type', 'application/json');
      headers.set('Accept', 'application/json');
      const resp = await fetchSafe(url, {
        ...(init ?? {}),
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
      return readJson(resp, url);
    },
    async getBlockHeader(chainId, blockHash) {
      // CRITICAL: without `blockheader-encoding=object` the endpoint returns
      // base64 binary and subsequent `.creationTime` access yields undefined.
      const path = `/chainweb/0.0/${cfg.networkId}/chain/${chainId}/header/${blockHash}`;
      const url = joinUrl(path);
      const resp = await fetchSafe(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json;blockheader-encoding=object'
        }
      });
      return readJson(resp, url);
    }
  };
}
