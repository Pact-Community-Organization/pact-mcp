/**
 * @fileoverview Security: principal_namespace rejects malformed results.
 *
 * The tool MUST validate that chainweb's response matches the principal
 * namespace regex `n_<40 lowercase hex>`. Otherwise a hostile or broken
 * node could return arbitrary strings that downstream tools would treat
 * as trusted namespace names.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createChainwebClient } from '../../src/client/fetch.js';
import {
  createPrincipalNamespaceTool,
  PRINCIPAL_NS_REGEX
} from '../../src/tools/principal-namespace.js';
import {
  startMockChainweb,
  type MockHandle
} from '../fixtures/mock-chainweb.js';

const KEY =
  '368820f80c324bbc7c2b0610688a7da43e39f91d118732671cd9c7500ff43cca';

describe('principal_namespace: MALFORMED_PRINCIPAL', () => {
  let mock: MockHandle;

  beforeAll(async () => {
    mock = await startMockChainweb();
  });
  afterAll(async () => {
    await mock.close();
  });

  function makeTool() {
    return createPrincipalNamespaceTool({
      client: createChainwebClient({
        baseUrl: mock.baseUrl,
        networkId: 'development',
        allowedOrigins: [],
        additionalAllowedOrigins: [mock.origin]
      })
    });
  }

  const badResults = [
    'not-a-principal',
    'n_tooshort',
    'n_' + 'z'.repeat(40), // non-hex
    'n_' + 'A'.repeat(40), // uppercase not allowed
    'free-namespace-name',
    'n_' + '0'.repeat(39), // 39 hex chars
    'n_' + '0'.repeat(41) // 41 hex chars
  ];

  for (const bad of badResults) {
    test(`rejects "${bad}"`, async () => {
      mock.patch('local', {
        reqKey: 'rk',
        result: { status: 'success', data: bad },
        gas: 1
      });
      await expect(
        makeTool()({
          chainId: '0',
          keyset: { keys: [KEY] }
        })
      ).rejects.toMatchObject({ code: 'MALFORMED_PRINCIPAL' });
    });
  }

  test('regex exported matches the spec format', () => {
    expect(PRINCIPAL_NS_REGEX.source).toBe('^n_[a-f0-9]{40}$');
  });

  test('accepts a well-formed principal namespace', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: {
        status: 'success',
        data: 'n_0123456789abcdef0123456789abcdef01234567'
      },
      gas: 1
    });
    const { content } = await makeTool()({
      chainId: '0',
      keyset: { keys: [KEY] }
    });
    expect(content[0]!.namespace).toMatch(PRINCIPAL_NS_REGEX);
  });
});
