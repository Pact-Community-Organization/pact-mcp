/**
 * @fileoverview In-process mock chainweb HTTP server for tests.
 * @author Developer
 *
 * Uses node:http bound to 127.0.0.1 on an ephemeral port. Callers get back
 * the `origin` (e.g. `http://127.0.0.1:43517`) which they pass to the
 * chainweb client as `additionalAllowedOrigins` to satisfy the strict
 * origin allowlist without loosening production config.
 *
 * Routes handled:
 *   GET  /info
 *   GET  /chainweb/0.0/{net}/cut
 *   GET  /chainweb/0.0/{net}/chain/{id}/header/{hash}    (Accept:
 *        application/json;blockheader-encoding=object → JSON; default →
 *        binary-ish body to prove the client opted in correctly)
 *   POST /chainweb/0.0/{net}/chain/{id}/pact/api/v1/local
 *        Mock distinguishes `exec` vs `cont` payload and picks the
 *        appropriate response when both are configured.
 *   POST /chainweb/0.0/{net}/chain/{id}/pact/api/v1/send
 *   POST /chainweb/0.0/{net}/chain/{id}/pact/api/v1/poll
 *   POST /chainweb/0.0/{net}/chain/{id}/pact/spv           (v0.2)
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockResponses {
  info?: unknown;
  infoStatus?: number;
  cut?: unknown;
  header?: unknown;
  headerStatus?: number;
  local?: unknown;
  localStatus?: number;
  /** Optional /local response used when the submitted tx is a continuation. */
  localCont?: unknown;
  localContStatus?: number;
  send?: unknown;
  sendStatus?: number;
  poll?: unknown;
  pollStatus?: number;
  /** /chain/<id>/pact/spv response — string (proof) or object. */
  spv?: unknown;
  spvStatus?: number;
  /** Set non-empty to simulate Content-Type: text/plain replies from /spv. */
  spvContentType?: string;
}

export interface MockHandle {
  origin: string;
  /** e.g. `http://127.0.0.1:43517` same as origin. */
  baseUrl: string;
  /** Array of all recorded request entries for assertion. */
  requests: MockRequest[];
  /** Replace current responses. */
  setResponses(r: MockResponses): void;
  /** Replace a single route's response. */
  patch<K extends keyof MockResponses>(k: K, v: MockResponses[K]): void;
  close(): Promise<void>;
}

export interface MockRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

const DEFAULT_INFO = {
  nodeVersion: 'development',
  nodeApiVersion: 'pact5',
  nodeApiVersionWithPatch: 'pact5',
  nodeChains: Array.from({ length: 20 }, (_, i) => String(i)),
  nodeNumberOfChains: 20,
  networkId: 'development',
  chainwebVersion: 'development'
};

const DEFAULT_CUT = {
  hashes: Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [
      String(i),
      { height: 100 + i, hash: `hash-chain-${i}`, creationTime: 1_700_000_000_000_000 + i * 1_000_000 }
    ])
  )
};

const DEFAULT_HEADER = {
  creationTime: 1_700_000_000_000_000,
  height: 100,
  hash: 'hash-chain-0',
  chainId: 0
};

const DEFAULT_LOCAL = {
  reqKey: 'mock-reqkey',
  result: { status: 'success', data: { int: '42' } },
  gas: 123,
  logs: 'mock-log-hash',
  txId: null
};

const DEFAULT_SEND = { requestKeys: ['mock-request-key-0'] };

const DEFAULT_POLL_FACTORY = (keys: string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    out[k] = {
      reqKey: k,
      txId: 42,
      result: { status: 'success', data: { int: '7' } },
      gas: 100,
      logs: 'log-hash',
      metaData: {
        blockHeight: 200,
        blockHash: 'block-hash-mock',
        blockTime: 1_700_000_100_000_000,
        prevBlockHash: 'prev-hash'
      }
    };
  }
  return out;
};

/** Start a mock chainweb server on an ephemeral 127.0.0.1 port. */
export async function startMockChainweb(
  initial: MockResponses = {}
): Promise<MockHandle> {
  const state: MockResponses = { ...initial };
  const requests: MockRequest[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');
      requests.push({
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: req.headers as Record<string, string | string[] | undefined>,
        body
      });
      try {
        handle(req, res, body, state);
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${addr.port}`;

  return {
    origin,
    baseUrl: origin,
    requests,
    setResponses(r) {
      for (const k of Object.keys(state) as (keyof MockResponses)[]) {
        delete state[k];
      }
      Object.assign(state, r);
    },
    patch(k, v) {
      state[k] = v;
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  };
}

function send(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  contentType = 'application/json'
): void {
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  // [Developer] For application/json responses, always JSON.stringify so
  // the body is valid JSON (including `"quoted-strings"`). Callers that
  // want to simulate plain-text bodies pass a non-JSON contentType.
  if (contentType === 'application/json') {
    res.end(typeof body === 'string' || Buffer.isBuffer(body)
      ? JSON.stringify(body)
      : JSON.stringify(body));
    return;
  }
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    res.end(body);
  } else {
    res.end(JSON.stringify(body));
  }
}

function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: string,
  state: MockResponses
): void {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  if (method === 'GET' && url === '/info') {
    send(res, state.infoStatus ?? 200, state.info ?? DEFAULT_INFO);
    return;
  }

  const cutMatch = /^\/chainweb\/0\.0\/[^/]+\/cut$/.exec(url);
  if (method === 'GET' && cutMatch) {
    send(res, 200, state.cut ?? DEFAULT_CUT);
    return;
  }

  const headerMatch =
    /^\/chainweb\/0\.0\/[^/]+\/chain\/(\d+)\/header\/([^?]+)/.exec(url);
  if (method === 'GET' && headerMatch) {
    const accept = String(req.headers['accept'] ?? '');
    if (!accept.includes('blockheader-encoding=object')) {
      // Simulate the base64-binary default response.
      send(
        res,
        200,
        'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
        'application/octet-stream'
      );
      return;
    }
    send(res, state.headerStatus ?? 200, state.header ?? DEFAULT_HEADER);
    return;
  }

  const localMatch =
    /^\/chainweb\/0\.0\/[^/]+\/chain\/\d+\/pact\/api\/v1\/local/.exec(url);
  if (method === 'POST' && localMatch) {
    // [Developer] Distinguish exec vs cont payload so tests can configure
    // distinct responses for deploy_module vs continue_pact scenarios.
    const isCont = isContinuationPayload(body);
    const selected = isCont && state.localCont !== undefined
      ? state.localCont
      : state.local ?? DEFAULT_LOCAL;
    const status =
      isCont && state.localContStatus !== undefined
        ? state.localContStatus
        : state.localStatus ?? 200;
    send(res, status, selected);
    return;
  }

  const sendMatch =
    /^\/chainweb\/0\.0\/[^/]+\/chain\/\d+\/pact\/api\/v1\/send$/.exec(url);
  if (method === 'POST' && sendMatch) {
    send(res, state.sendStatus ?? 200, state.send ?? DEFAULT_SEND);
    return;
  }

  const pollMatch =
    /^\/chainweb\/0\.0\/[^/]+\/chain\/\d+\/pact\/api\/v1\/poll$/.exec(url);
  if (method === 'POST' && pollMatch) {
    if (state.poll !== undefined) {
      send(res, state.pollStatus ?? 200, state.poll);
      return;
    }
    let requestKeys: string[] = [];
    try {
      const parsed = JSON.parse(body) as { requestKeys?: string[] };
      requestKeys = parsed.requestKeys ?? [];
    } catch {
      requestKeys = [];
    }
    send(res, 200, DEFAULT_POLL_FACTORY(requestKeys));
    return;
  }

  const spvMatch = /^\/chainweb\/0\.0\/[^/]+\/chain\/\d+\/pact\/spv$/.exec(
    url
  );
  if (method === 'POST' && spvMatch) {
    const status = state.spvStatus ?? 200;
    const contentType = state.spvContentType ?? 'application/json';
    const payload =
      state.spv !== undefined
        ? state.spv
        : 'eyJzdWJqZWN0IjoibW9jayIsInByb29mIjoiYmFzZTY0In0=';
    send(res, status, payload, contentType);
    return;
  }

  send(res, 404, { error: `No mock route for ${method} ${url}` });
}

/** Detect a continuation payload string in the Pact cmd body. */
function isContinuationPayload(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as { cmd?: unknown };
    if (typeof parsed.cmd !== 'string') return false;
    const inner = JSON.parse(parsed.cmd) as {
      payload?: { cont?: unknown; exec?: unknown };
    };
    return !!inner.payload && typeof inner.payload.cont === 'object';
  } catch {
    return false;
  }
}
