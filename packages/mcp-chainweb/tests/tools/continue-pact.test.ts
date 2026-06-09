/**
 * @fileoverview Tests for chainweb.continue_pact.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createChainwebClient } from '../../src/client/fetch.js';
import { createContinuePactTool } from '../../src/tools/continue-pact.js';
import {
  startMockChainweb,
  type MockHandle
} from '../fixtures/mock-chainweb.js';

const SIGNER_KEY =
  '368820f80c324bbc7c2b0610688a7da43e39f91d118732671cd9c7500ff43cca';

describe('chainweb.continue_pact', () => {
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

  test('preflight-only (no sigs) returns unsignedTx + submitted=false', async () => {
    mock.patch('localCont', {
      reqKey: 'rk',
      result: { status: 'success', data: 'step 1 ok' },
      gas: 8_000
    });
    const tool = createContinuePactTool({ client: makeClient() });
    const { content } = await tool({
      pactId: 'pact-id-abc',
      step: 1,
      rollback: false,
      targetChainId: '1',
      proof: 'eyJwcm9vZiI6ImJhc2U2NCJ9',
      signerKey: SIGNER_KEY
    });
    expect(content[0]!.submitted).toBe(false);
    expect(content[0]!.preflight.ok).toBe(true);
    expect(content[0]!.preflight.gasUsed).toBe(8_000);
    expect(content[0]!.unsignedTx).toBeDefined();
    expect(content[0]!.targetChainId).toBe('1');
  });

  test('with sigs: submits and returns requestKey', async () => {
    mock.patch('localCont', {
      reqKey: 'rk',
      result: { status: 'success', data: 'step 1 ok' },
      gas: 8_000
    });
    mock.patch('send', { requestKeys: ['cont-req-key'] });
    const tool = createContinuePactTool({ client: makeClient() });
    const { content } = await tool({
      pactId: 'pact-id-abc',
      step: 1,
      targetChainId: '1',
      proof: 'eyJwcm9vZiI6ImJhc2U2NCJ9',
      signerKey: SIGNER_KEY,
      sigs: [{ sig: 'a'.repeat(128) }]
    });
    expect(content[0]!.submitted).toBe(true);
    expect(content[0]!.requestKey).toBe('cont-req-key');
    mock.patch('send', undefined);
  });

  test('preflight failure → submitted=false, NO /send', async () => {
    mock.patch('localCont', {
      reqKey: 'rk',
      result: {
        status: 'failure',
        error: { message: 'step already executed' }
      },
      gas: 100
    });
    const before = mock.requests.length;
    const tool = createContinuePactTool({ client: makeClient() });
    const { content } = await tool({
      pactId: 'pact-id-abc',
      step: 1,
      targetChainId: '1',
      signerKey: SIGNER_KEY,
      sigs: [{ sig: 'a'.repeat(128) }]
    });
    expect(content[0]!.submitted).toBe(false);
    expect(content[0]!.preflight.ok).toBe(false);
    const after = mock.requests.slice(before);
    expect(after.some((r) => /\/send$/.test(r.url))).toBe(false);
  });

  test('SCOPED signer — clist present in built cmd', async () => {
    mock.patch('localCont', {
      reqKey: 'rk',
      result: { status: 'success', data: 'ok' },
      gas: 1
    });
    const before = mock.requests.length;
    const tool = createContinuePactTool({ client: makeClient() });
    await tool({
      pactId: 'pact-id-abc',
      step: 0,
      targetChainId: '2',
      signerKey: SIGNER_KEY,
      signerCapabilities: [
        { name: 'coin.GAS', args: [] },
        { name: 'coin.TRANSFER', args: ['alice', 'bob', { decimal: '1.0' }] }
      ]
    });
    const last = mock.requests.slice(before).find((r) =>
      /\/local/.test(r.url)
    );
    const parsed = JSON.parse(last!.body) as { cmd: string };
    const inner = JSON.parse(parsed.cmd) as {
      signers: Array<{ clist?: unknown[]; pubKey: string }>;
      payload: { cont?: unknown };
    };
    expect(inner.signers[0]!.clist).toBeDefined();
    expect(inner.signers[0]!.clist!.length).toBe(2);
    expect(inner.payload.cont).toBeDefined();
  });

  test('PROOF_TOO_LARGE rejects >2MB proofs', async () => {
    const huge = 'a'.repeat(2 * 1024 * 1024 + 1);
    const tool = createContinuePactTool({ client: makeClient() });
    await expect(
      tool({
        pactId: 'pact-id-abc',
        step: 1,
        targetChainId: '1',
        proof: huge,
        signerKey: SIGNER_KEY
      })
    ).rejects.toMatchObject({ code: 'PROOF_TOO_LARGE' });
  });
});
