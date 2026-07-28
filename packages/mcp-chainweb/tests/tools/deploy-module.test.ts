/**
 * @fileoverview Tests for chainweb_deploy_module.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createChainwebClient } from '../../src/client/fetch.js';
import { createDeployModuleTool } from '../../src/tools/deploy-module.js';
import {
  startMockChainweb,
  type MockHandle
} from '../fixtures/mock-chainweb.js';

const SIGNER_KEY =
  '368820f80c324bbc7c2b0610688a7da43e39f91d118732671cd9c7500ff43cca';
const SMALL_MODULE = `(module demo GOVERNANCE
  (defcap GOVERNANCE () true)
  (defun hello () "world"))`;

describe('chainweb_deploy_module', () => {
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

  test('preflight-only (no sigs) returns unsignedTx + deployed=false', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: { status: 'success', data: 'Loaded module demo' },
      gas: 12_000
    });
    const tool = createDeployModuleTool({ client: makeClient() });
    const { content } = await tool({
      chainId: '0',
      module: { code: SMALL_MODULE },
      signerKey: SIGNER_KEY
    });
    expect(content[0]!.deployed).toBe(false);
    expect(content[0]!.preflight.ok).toBe(true);
    expect(content[0]!.preflight.gasUsed).toBe(12_000);
    expect(content[0]!.unsignedTx).toBeDefined();
    expect(typeof content[0]!.unsignedTx!.cmd).toBe('string');
    expect(typeof content[0]!.unsignedTx!.hash).toBe('string');
    expect(content[0]!.requestKey).toBeUndefined();
  });

  test('with sigs: submits to /send and returns requestKey', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: { status: 'success', data: 'Loaded module demo' },
      gas: 11_500
    });
    mock.patch('send', { requestKeys: ['deploy-req-key-abc'] });
    const tool = createDeployModuleTool({ client: makeClient() });
    const { content } = await tool({
      chainId: '0',
      module: { code: SMALL_MODULE },
      signerKey: SIGNER_KEY,
      sigs: [{ sig: 'a'.repeat(128) }]
    });
    expect(content[0]!.deployed).toBe(true);
    expect(content[0]!.requestKey).toBe('deploy-req-key-abc');
    expect(content[0]!.preflight.ok).toBe(true);
    mock.patch('send', undefined);
  });

  test('preflight failure → deployed=false, NO /send call', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: {
        status: 'failure',
        error: { message: 'governance check failed' }
      },
      gas: 5_000
    });
    const before = mock.requests.length;
    const tool = createDeployModuleTool({ client: makeClient() });
    const { content } = await tool({
      chainId: '0',
      module: { code: SMALL_MODULE },
      signerKey: SIGNER_KEY,
      sigs: [{ sig: 'a'.repeat(128) }]
    });
    expect(content[0]!.deployed).toBe(false);
    expect(content[0]!.preflight.ok).toBe(false);
    expect(content[0]!.preflight.error).toContain('governance check failed');
    const after = mock.requests.slice(before);
    expect(after.some((r) => /\/send$/.test(r.url))).toBe(false);
  });

  test('appends createTableCalls inside the SAME tx', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: { status: 'success', data: 'Loaded' },
      gas: 100
    });
    const before = mock.requests.length;
    const tool = createDeployModuleTool({ client: makeClient() });
    await tool({
      chainId: '0',
      module: { code: SMALL_MODULE },
      signerKey: SIGNER_KEY,
      createTableCalls: [
        '(create-table demo.accounts)',
        '(create-table demo.votes)'
      ]
    });
    const last = mock.requests.slice(before).find((r) =>
      /\/local/.test(r.url)
    );
    const parsed = JSON.parse(last!.body) as { cmd: string };
    const inner = JSON.parse(parsed.cmd) as {
      payload: { exec: { code: string } };
    };
    expect(inner.payload.exec.code).toContain('(create-table demo.accounts)');
    expect(inner.payload.exec.code).toContain('(create-table demo.votes)');
    expect(inner.payload.exec.code).toContain('(module demo GOVERNANCE');
  });

  test('envData is attached to the tx', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: { status: 'success', data: 'Loaded' },
      gas: 100
    });
    const before = mock.requests.length;
    const tool = createDeployModuleTool({ client: makeClient() });
    await tool({
      chainId: '0',
      module: { code: SMALL_MODULE },
      signerKey: SIGNER_KEY,
      envData: { ns: 'n_abc', foo: 'bar' }
    });
    const last = mock.requests.slice(before).find((r) =>
      /\/local/.test(r.url)
    );
    const parsed = JSON.parse(last!.body) as { cmd: string };
    const inner = JSON.parse(parsed.cmd) as {
      payload: { exec: { data: Record<string, unknown> } };
    };
    expect(inner.payload.exec.data.ns).toBe('n_abc');
    expect(inner.payload.exec.data.foo).toBe('bar');
  });
});
