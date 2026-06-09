/**
 * @fileoverview Test fixture — ephemeral HTTP server mocking the Chainweb API
 *               for devnet.health tests.
 * @author Developer
 */

import http from 'node:http';

export interface MockDevnetSpec {
  /** Response for GET /info. Set to null to 500. */
  info?: unknown | null;
  /** Response for GET /chainweb/0.0/{net}/cut. Set to null to 500. */
  cut?: unknown | null;
  /** If true, the server never responds (for timeout tests). */
  hang?: boolean;
}

export interface MockDevnetHandle {
  url: string;
  origin: string;
  port: number;
  close: () => Promise<void>;
  setSpec: (spec: MockDevnetSpec) => void;
}

/**
 * [Developer] Start an ephemeral devnet mock on 127.0.0.1:{random}. Returns
 * the bound origin so tests can wire it through `SMARTPACTS_TEST_ALLOW_ORIGINS`
 * or pass it directly to `createHealthTool({ baseUrlFor })`.
 */
export async function startMockDevnet(
  initial: MockDevnetSpec = {}
): Promise<MockDevnetHandle> {
  let spec: MockDevnetSpec = initial;

  const server = http.createServer((req, res) => {
    if (spec.hang) {
      // never respond
      return;
    }
    const url = req.url ?? '';
    if (url.startsWith('/info')) {
      reply(res, spec.info);
      return;
    }
    if (url.includes('/cut')) {
      reply(res, spec.cut);
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind mock devnet');
  }
  const port = address.port;
  const origin = `http://127.0.0.1:${port}`;

  return {
    url: origin,
    origin,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
    setSpec: (next) => {
      spec = next;
    }
  };
}

function reply(res: http.ServerResponse, body: unknown | null | undefined): void {
  if (body === null) {
    res.statusCode = 500;
    res.end('mock 500');
    return;
  }
  if (body === undefined) {
    res.statusCode = 404;
    res.end('mock 404');
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/** Default `/info` payload shaped like a real Chainweb response. */
export const DEFAULT_INFO = {
  networkId: 'development',
  nodeVersion: 'chainweb-node-2.21.0-test',
  nodeApiVersion: '0.0',
  nodeChains: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
};

/**
 * [Developer] Build a /cut response whose chain-0 creationTime is
 * `wallSec` seconds (wall clock). `offsetSec` shifts it earlier (positive =
 * lag) to simulate the genesis-catchup delay.
 */
export function makeCut(
  wallSecNow: number,
  offsetSec = 0
): {
  hashes: Record<string, { height: number; hash: string; creationTime: number }>;
} {
  const creationTime = (wallSecNow - offsetSec) * 1_000_000;
  return {
    hashes: {
      '0': { height: 1, hash: 'a'.repeat(43), creationTime }
    }
  };
}
