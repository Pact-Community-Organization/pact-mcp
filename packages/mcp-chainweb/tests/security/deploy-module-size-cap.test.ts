/**
 * @fileoverview Security: deploy_module rejects oversize module code.
 *
 * 512KB cap prevents a caller from submitting an arbitrary blob that
 * would waste devnet resources or bypass static analysis.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createChainwebClient } from '../../src/client/fetch.js';
import {
  createDeployModuleTool,
  MAX_MODULE_CODE_BYTES,
  MAX_ENV_DATA_BYTES
} from '../../src/tools/deploy-module.js';
import {
  startMockChainweb,
  type MockHandle
} from '../fixtures/mock-chainweb.js';

const SIGNER_KEY =
  '368820f80c324bbc7c2b0610688a7da43e39f91d118732671cd9c7500ff43cca';

describe('deploy_module: size caps', () => {
  let mock: MockHandle;

  beforeAll(async () => {
    mock = await startMockChainweb();
  });
  afterAll(async () => {
    await mock.close();
  });

  function makeTool() {
    return createDeployModuleTool({
      client: createChainwebClient({
        baseUrl: mock.baseUrl,
        networkId: 'development',
        allowedOrigins: [],
        additionalAllowedOrigins: [mock.origin]
      })
    });
  }

  test('MODULE_CODE_TOO_LARGE when code > 512KB', async () => {
    const big = 'a'.repeat(MAX_MODULE_CODE_BYTES + 1);
    await expect(
      makeTool()({
        chainId: '0',
        module: { code: big },
        signerKey: SIGNER_KEY
      })
    ).rejects.toMatchObject({ code: 'MODULE_CODE_TOO_LARGE' });
  });

  test('MODULE_CODE_TOO_LARGE counts createTableCalls toward the cap', async () => {
    const code = 'a'.repeat(MAX_MODULE_CODE_BYTES - 10);
    const calls = ['bbbbbbbbbbbbbbbbbbbbbbbbbbb']; // more than 10 chars
    await expect(
      makeTool()({
        chainId: '0',
        module: { code },
        createTableCalls: calls,
        signerKey: SIGNER_KEY
      })
    ).rejects.toMatchObject({ code: 'MODULE_CODE_TOO_LARGE' });
  });

  test('ENV_DATA_TOO_LARGE when envData > 64KB', async () => {
    const envData = { blob: 'x'.repeat(MAX_ENV_DATA_BYTES + 1) };
    await expect(
      makeTool()({
        chainId: '0',
        module: { code: '(module demo GOVERNANCE true)' },
        signerKey: SIGNER_KEY,
        envData
      })
    ).rejects.toMatchObject({ code: 'ENV_DATA_TOO_LARGE' });
  });
});
