/**
 * @fileoverview Tests for network allowlist controls
 * @author Developer
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAllowlistedFetch, validateOrigin } from '../src/network-allowlist.js';
import { McpToolError } from '../src/errors.js';

// [Developer] Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue(new Response('OK'));
});

describe('network-allowlist', () => {
  describe('createAllowlistedFetch', () => {
    const allowedOrigins = [
      'http://localhost:8081',
      'https://api.testnet.chainweb.com',
      'https://api.chainweb-community.org'
    ];

    it('should allow requests to allowlisted origins', async () => {
      const allowlistedFetch = createAllowlistedFetch(allowedOrigins);

      await allowlistedFetch('http://localhost:8081/api/test');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8081/api/test',
        undefined
      );
    });

    it('should reject requests to non-allowlisted origins', async () => {
      const allowlistedFetch = createAllowlistedFetch(allowedOrigins);

      await expect(
        allowlistedFetch('https://evil.com/api/test')
      ).rejects.toThrow(McpToolError);

      try {
        await allowlistedFetch('https://evil.com/api/test');
      } catch (error) {
        expect(error).toBeInstanceOf(McpToolError);
        expect((error as McpToolError).code).toBe('NETWORK_ALLOWLIST_VIOLATION');
        expect((error as McpToolError).message).toContain('https://evil.com');
      }
    });

    it('should prevent subdomain attacks', async () => {
      const allowlistedFetch = createAllowlistedFetch(['http://localhost:8081']);

      // [Developer] localhost.evil.com should be rejected
      await expect(
        allowlistedFetch('http://localhost.evil.com:8081/api/test')
      ).rejects.toThrow(McpToolError);

      // [Developer] evil.com/localhost should be rejected  
      await expect(
        allowlistedFetch('https://evil.com/localhost:8081/api/test')
      ).rejects.toThrow(McpToolError);
    });

    it('should handle URL objects as input', async () => {
      const allowlistedFetch = createAllowlistedFetch(allowedOrigins);
      const url = new URL('http://localhost:8081/api/test');

      await allowlistedFetch(url);

      expect(mockFetch).toHaveBeenCalledWith(url, undefined);
    });

    it('should handle Request objects as input', async () => {
      const allowlistedFetch = createAllowlistedFetch(allowedOrigins);
      const request = new Request('http://localhost:8081/api/test');

      await allowlistedFetch(request);

      expect(mockFetch).toHaveBeenCalledWith(request, undefined);
    });

    it('should pass through init options', async () => {
      const allowlistedFetch = createAllowlistedFetch(allowedOrigins);
      const init = { method: 'POST', body: 'test' };

      await allowlistedFetch('http://localhost:8081/api/test', init);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8081/api/test',
        init
      );
    });

    it('should throw NETWORK_INVALID_INPUT for invalid input types', async () => {
      const allowlistedFetch = createAllowlistedFetch(allowedOrigins);

      await expect(
        allowlistedFetch(null as any)
      ).rejects.toThrow(McpToolError);

      try {
        await allowlistedFetch(null as any);
      } catch (error) {
        expect((error as McpToolError).code).toBe('NETWORK_INVALID_INPUT');
      }
    });

    it('should wrap network errors as McpToolError', async () => {
      mockFetch.mockRejectedValue(new Error('Network failure'));
      const allowlistedFetch = createAllowlistedFetch(allowedOrigins);

      await expect(
        allowlistedFetch('http://localhost:8081/api/test')
      ).rejects.toThrow(McpToolError);

      try {
        await allowlistedFetch('http://localhost:8081/api/test');
      } catch (error) {
        expect((error as McpToolError).code).toBe('NETWORK_REQUEST_FAILED');
        expect((error as McpToolError).retryable).toBe(true);
      }
    });

    it('should handle different URL schemes correctly', async () => {
      const allowlistedFetch = createAllowlistedFetch([
        'http://localhost:8081',
        'https://api.example.com'
      ]);

      // [Developer] HTTP should work
      await allowlistedFetch('http://localhost:8081/api');
      expect(mockFetch).toHaveBeenCalled();

      mockFetch.mockClear();

      // [Developer] HTTPS should work
      await allowlistedFetch('https://api.example.com/api');
      expect(mockFetch).toHaveBeenCalled();

      // [Developer] Wrong scheme should fail
      await expect(
        allowlistedFetch('https://localhost:8081/api') // HTTPS not allowed for localhost
      ).rejects.toThrow(McpToolError);
    });

    it('should handle port numbers correctly', async () => {
      const allowlistedFetch = createAllowlistedFetch([
        'http://localhost:8081',
        'http://localhost:8082'
      ]);

      // [Developer] Correct port should work
      await allowlistedFetch('http://localhost:8081/api');
      expect(mockFetch).toHaveBeenCalled();

      // [Developer] Wrong port should fail
      await expect(
        allowlistedFetch('http://localhost:9999/api')
      ).rejects.toThrow(McpToolError);
    });
  });

  describe('validateOrigin', () => {
    const allowedOrigins = [
      'http://localhost:8081',
      'https://api.chainweb-community.org'
    ];

    it('should return true for allowed origins', () => {
      expect(validateOrigin('http://localhost:8081', allowedOrigins)).toBe(true);
      expect(validateOrigin('https://api.chainweb-community.org', allowedOrigins)).toBe(true);
    });

    it('should return false for disallowed origins', () => {
      expect(validateOrigin('https://evil.com', allowedOrigins)).toBe(false);
      expect(validateOrigin('http://localhost:9999', allowedOrigins)).toBe(false);
    });

    it('should be case sensitive', () => {
      expect(validateOrigin('HTTP://LOCALHOST:8081', allowedOrigins)).toBe(false);
      expect(validateOrigin('http://LOCALHOST:8081', allowedOrigins)).toBe(false);
    });

    it('should handle empty allowlist', () => {
      expect(validateOrigin('http://localhost:8081', [])).toBe(false);
    });
  });
});