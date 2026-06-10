/**
 * @fileoverview Tests for chainweb.principal_namespace.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createChainwebClient } from '../../src/client/fetch.js';
import { createPrincipalNamespaceTool } from '../../src/tools/principal-namespace.js';
import {
  startMockChainweb,
  type MockHandle
} from '../fixtures/mock-chainweb.js';

const KEY_A =
  '368820f80c324bbc7c2b0610688a7da43e39f91d118732671cd9c7500ff43cca';

describe('chainweb.principal_namespace', () => {
  let mock: MockHandle;

  beforeAll(async () => {
    mock = await startMockChainweb();
  });
  afterAll(async () => {
    await mock.close();
  });

  function makeClient() {
    return createChainwebClient({
      baseUrl: mock.baseUrl,
      networkId: 'development',
      allowedOrigins: [],
      additionalAllowedOrigins: [mock.origin]
    });
  }

  test('returns the principal namespace string', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: {
        status: 'success',
        data: 'n_0123456789abcdef0123456789abcdef01234567'
      },
      gas: 100
    });
    const tool = createPrincipalNamespaceTool({ client: makeClient() });
    const { content } = await tool({
      chainId: '0',
      keyset: { keys: [KEY_A], pred: 'keys-all' }
    });
    expect(content[0]!.namespace).toBe('n_0123456789abcdef0123456789abcdef01234567');
    expect(content[0]!.gasUsed).toBe(100);
  });

  test('passes keyset via envData { ks: { keys, pred } }', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: {
        status: 'success',
        data: 'n_0123456789abcdef0123456789abcdef01234567'
      },
      gas: 10
    });
    const before = mock.requests.length;
    const tool = createPrincipalNamespaceTool({ client: makeClient() });
    await tool({
      chainId: '0',
      keyset: { keys: [KEY_A], pred: 'keys-all' }
    });
    const last = mock.requests.slice(before).find((r) =>
      /\/local/.test(r.url)
    );
    const parsed = JSON.parse(last!.body) as { cmd: string };
    const innerCmd = JSON.parse(parsed.cmd) as {
      payload: { exec: { code: string; data: { ks?: unknown } } };
    };
    expect(innerCmd.payload.exec.code).toContain(
      '(ns.create-principal-namespace (read-keyset "ks"))'
    );
    expect(innerCmd.payload.exec.data.ks).toEqual({
      keys: [KEY_A],
      pred: 'keys-all'
    });
  });

  test('MALFORMED_PRINCIPAL when result is not n_<40hex>', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: { status: 'success', data: 'not-a-principal' },
      gas: 1
    });
    const tool = createPrincipalNamespaceTool({ client: makeClient() });
    await expect(
      tool({
        chainId: '0',
        keyset: { keys: [KEY_A] }
      })
    ).rejects.toMatchObject({ code: 'MALFORMED_PRINCIPAL' });
  });

  test('default pred is keys-all', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: {
        status: 'success',
        data: 'n_0123456789abcdef0123456789abcdef01234567'
      },
      gas: 10
    });
    const before = mock.requests.length;
    const tool = createPrincipalNamespaceTool({ client: makeClient() });
    await tool({
      chainId: '0',
      keyset: { keys: [KEY_A] }
    });
    const last = mock.requests.slice(before).find((r) =>
      /\/local/.test(r.url)
    );
    const parsed = JSON.parse(last!.body) as { cmd: string };
    const innerCmd = JSON.parse(parsed.cmd) as {
      payload: { exec: { data: { ks: { pred: string } } } };
    };
    expect(innerCmd.payload.exec.data.ks.pred).toBe('keys-all');
  });
});
