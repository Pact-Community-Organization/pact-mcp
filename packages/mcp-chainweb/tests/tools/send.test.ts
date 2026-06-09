/**
 * @fileoverview Tests for chainweb.send tool (preflight-then-send).
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createChainwebClient } from '../../src/client/fetch.js';
import { createSendTool } from '../../src/tools/send.js';
import {
  startMockChainweb,
  type MockHandle
} from '../fixtures/mock-chainweb.js';

const SIGNED_TX = {
  cmd: '{"networkId":"development","payload":{"exec":{"code":"(+ 1 2)","data":{}}},"signers":[],"meta":{"chainId":"0","gasLimit":150000,"gasPrice":1e-7,"sender":"sender00","ttl":600,"creationTime":1700000000},"nonce":"n"}',
  hash: 'mock-hash',
  sigs: [{ sig: 'a'.repeat(128) }]
};

describe('chainweb.send', () => {
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

  test('happy path — preflight ok → returns requestKey', async () => {
    mock.patch('local', {
      reqKey: 'pre',
      result: { status: 'success', data: { int: '1' } },
      gas: 77
    });
    mock.patch('send', { requestKeys: ['rk-happy'] });
    const tool = createSendTool({ client: makeClient() });
    const { content } = await tool({ chainId: '0', signedTx: SIGNED_TX });
    expect(content[0]!.requestKey).toBe('rk-happy');
    expect(content[0]!.preflight).toEqual({ ok: true, gasUsed: 77 });
  });

  test('refuses /send when preflight returns status=failure', async () => {
    mock.patch('local', {
      reqKey: 'pre',
      result: { status: 'failure', error: { message: 'bad' } },
      gas: 0
    });
    const before = mock.requests.length;
    const tool = createSendTool({ client: makeClient() });
    await expect(
      tool({ chainId: '0', signedTx: SIGNED_TX })
    ).rejects.toMatchObject({
      code: 'PREFLIGHT_FAILED'
    });
    // Verify NO /send request was made.
    const after = mock.requests.slice(before);
    expect(after.some((r) => /\/send$/.test(r.url))).toBe(false);
    mock.patch('local', undefined);
  });

  test('fails loudly when /send returns no requestKey', async () => {
    mock.patch('local', {
      reqKey: 'pre',
      result: { status: 'success', data: null },
      gas: 1
    });
    mock.patch('send', { requestKeys: [] });
    const tool = createSendTool({ client: makeClient() });
    await expect(
      tool({ chainId: '0', signedTx: SIGNED_TX })
    ).rejects.toMatchObject({ code: 'SEND_NO_REQUEST_KEY' });
    mock.patch('send', undefined);
    mock.patch('local', undefined);
  });
});
