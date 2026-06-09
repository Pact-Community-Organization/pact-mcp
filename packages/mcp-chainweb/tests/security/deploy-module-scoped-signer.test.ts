/**
 * @fileoverview Security: deploy_module enforces UNSCOPED signer.
 *
 * Memory lesson (devnet-deploy-patterns.md): scoped signers CANNOT satisfy
 * `enforce-keyset` / `enforce-guard(keyset-ref-guard(...))` on-chain — which
 * is exactly what module-deploy governance evaluates.
 *
 * The tool MUST build a command whose first signer has NO `clist`
 * (capability list). This test parses the preflight-built cmd JSON and
 * asserts `signers[0].clist === undefined` (or an empty array, since
 * @kadena/client may omit vs. emit `[]` by version).
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
const MODULE = '(module demo GOVERNANCE (defcap GOVERNANCE () true))';

describe('deploy_module: UNSCOPED signer enforcement', () => {
  let mock: MockHandle;

  beforeAll(async () => {
    mock = await startMockChainweb();
  });
  afterAll(async () => {
    await mock.close();
  });

  test('built cmd has no clist on the deploy signer', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: { status: 'success', data: 'Loaded' },
      gas: 1_000
    });
    const client = createChainwebClient({
      baseUrl: mock.baseUrl,
      networkId: 'development',
      allowedOrigins: [],
      additionalAllowedOrigins: [mock.origin]
    });
    const before = mock.requests.length;
    const tool = createDeployModuleTool({ client });
    await tool({
      chainId: '0',
      module: { code: MODULE },
      signerKey: SIGNER_KEY
    });

    const localReq = mock.requests
      .slice(before)
      .find((r) => /\/local/.test(r.url));
    expect(localReq).toBeDefined();
    const parsed = JSON.parse(localReq!.body) as { cmd: string };
    const inner = JSON.parse(parsed.cmd) as {
      signers: Array<{ pubKey: string; clist?: unknown[] }>;
    };
    expect(inner.signers).toHaveLength(1);
    expect(inner.signers[0]!.pubKey).toBe(SIGNER_KEY);
    // clist must either be missing OR an empty array — no capabilities.
    const clist = inner.signers[0]!.clist;
    expect(clist === undefined || (Array.isArray(clist) && clist.length === 0))
      .toBe(true);
  });
});
