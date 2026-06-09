/**
 * @fileoverview Network access allowlist for MCP servers
 * @author Developer
 * @description Implements ADR-MCP-001 network security controls
 */

import { McpToolError } from './errors.js';

/**
 * [Developer] Options for createAllowlistedFetch.
 *
 * `additionalAllowedOrigins` is an opt-in extension for in-process test
 * harnesses that need to point the fetch wrapper at an ephemeral-port mock
 * server (e.g. `http://127.0.0.1:{rand}`). Production servers pass only
 * `allowedOrigins`; the extension is supplied programmatically by test code,
 * never from an environment variable.
 */
export interface AllowlistedFetchOptions {
  /** Extra exact-match origins merged with the primary allowlist. */
  additionalAllowedOrigins?: string[];
}

/**
 * [Developer] Create allowlisted fetch wrapper
 * 
 * Validates URL.origin against allowlist before making requests.
 * Defends against subdomain attacks (e.g., localhost.evil.com).
 * 
 * @param allowedOrigins List of allowed origins (exact match)
 * @param options Optional extension for programmatic test overrides
 * @returns Fetch-like function with origin validation
 */
export function createAllowlistedFetch(
  allowedOrigins: string[],
  options?: AllowlistedFetchOptions
): typeof fetch {
  const mergedOrigins = options?.additionalAllowedOrigins
    ? [...allowedOrigins, ...options.additionalAllowedOrigins]
    : allowedOrigins;
  return async function allowlistedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    let url: URL;

    // [Developer] Parse URL from various input types
    if (input instanceof URL) {
      url = input;
    } else if (typeof input === 'string') {
      url = new URL(input);
    } else if (input instanceof Request) {
      url = new URL(input.url);
    } else {
      throw new McpToolError(
        'NETWORK_INVALID_INPUT',
        'Invalid fetch input type',
        false
      );
    }

    // [Developer] Extract origin for exact matching
    const origin = url.origin;

    // [Developer] Check against allowlist (exact match only)
    if (!mergedOrigins.includes(origin)) {
      throw new McpToolError(
        'NETWORK_ALLOWLIST_VIOLATION',
        `Network request to '${origin}' not allowed. Allowed origins: ${mergedOrigins.join(', ')}`,
        false
      );
    }

    // [Developer] Origin approved - proceed with request
    try {
      return await fetch(input, init);
    } catch (error) {
      throw new McpToolError(
        'NETWORK_REQUEST_FAILED', 
        `Network request failed: ${error}`,
        true // Network errors may be retryable
      );
    }
  };
}

/**
 * [Developer] Validate origin against allowlist
 * 
 * Helper function for manual origin checking without making a request.
 * 
 * @param origin Origin to validate (e.g., "https://example.com")
 * @param allowedOrigins List of allowed origins
 * @returns true if origin is allowed
 */
export function validateOrigin(origin: string, allowedOrigins: string[]): boolean {
  return allowedOrigins.includes(origin);
}