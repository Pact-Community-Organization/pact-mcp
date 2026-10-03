/**
 * @fileoverview Tests for the shared /local response parser.
 *
 * The four bodies below are what a chainweb-node 3.2 actually answered on
 * mainnet01 (captured 2026-10-03; the account and its key are replaced by
 * placeholders, long fields are shortened). They are kept verbatim in SHAPE
 * on purpose: the parser used to be tested only against a hand-written mock
 * that answered every /local call with the bare command result, so it was
 * green while every preflight=true call failed against a real node.
 */

import { describe, test, expect } from 'vitest';
import { parseLocalResponse } from '../../src/client/preflight.js';

const ACCOUNT = `k:${'a'.repeat(64)}`;

// POST /local?preflight=false  — code `(+ 1 2)`
const EVAL_SUCCESS = {
  gas: 1,
  result: { status: 'success', data: { int: 3 } },
  reqKey: '9PWUnrhXLDImUHbVkN3DhLLhg2NagsJ6qskyWmJG9dI',
  logs: 'DldRwCblQ7Loqy6wYJnaodHl30d3j3eH-qtFzfEv46g',
  metaData: {
    blockHeight: 7283948,
    blockTime: 1791058910852665,
    prevBlockHash: 'e1jwJXctSKJRkmgMiTjdbjLEgCInqMIBOzYwGe_AIAA',
    publicMeta: {
      chainId: '0',
      creationTime: 1791058915,
      gasLimit: 150000,
      gasPrice: 1.0e-7,
      sender: 'sender00',
      ttl: 28800
    }
  },
  continuation: null,
  txId: 572391238
};

// POST /local?preflight=false  — a read of a row that does not exist
const EVAL_FAILURE = {
  gas: 150000,
  result: {
    status: 'failure',
    error: {
      callStack: [],
      type: 'TxFailure',
      message: 'No value found in table example_accounts for key: nobody',
      info: 'example.get-balance:668'
    }
  },
  reqKey: '2uxRB8Cj6ggEXuC4x-Mog1_mkRkkomtYFKTiLGww7qk',
  logs: null,
  metaData: null,
  continuation: null,
  txId: null
};

// POST /local?preflight=true  — sender exists and is listed as a signer
const PREFLIGHT_SUCCESS = {
  preflightResult: {
    gas: 97,
    result: { status: 'success', data: { int: 3 } },
    reqKey: 'ez7jJwKxtniqvpSwgKUrkX9LX1n-W9ii8GYUMhWkFjU',
    logs: 'if-P7LRXIVRS7C4OcdQ5OTbSHoCe_0sJhUJJnXwPFKI',
    events: [
      {
        params: [ACCOUNT, 'NoMiner', 9.7e-7],
        name: 'TRANSFER',
        module: { namespace: null, name: 'coin' },
        moduleHash: 'klFkrLfpyLW-M3xjVPSdqXEMgxPPJibRt_D6qiBws6s'
      }
    ],
    metaData: {
      blockHeight: 7283963,
      blockTime: 1791059347841363,
      prevBlockHash: '1msokfqTrq9eiSdkctiOIyo_x_Sgc0nunHHbKilCbjc',
      publicMeta: {
        chainId: '0',
        creationTime: 1791059341,
        gasLimit: 1000,
        gasPrice: 1.0e-8,
        sender: ACCOUNT,
        ttl: 28800
      }
    },
    continuation: null,
    txId: 572391622
  },
  preflightWarnings: []
};

// POST /local?preflight=true  — nobody listed as a signer for the sender
const PREFLIGHT_FAILURE = {
  preflightResult: {
    gas: 150000,
    result: {
      status: 'failure',
      error: {
        callStack: [],
        type: 'EvalError',
        message:
          '"LkL_QzMtGQytpQ4JcWBud9EzJ4RfjxbJ3xsHZZZZ33A" Failed to buy gas: Keyset failure (keys-all): [368820f8...]',
        info: '<toplevel>:0'
      }
    },
    reqKey: 'LkL_QzMtGQytpQ4JcWBud9EzJ4RfjxbJ3xsHZZZZ33A',
    logs: null,
    metaData: null,
    continuation: null,
    txId: null
  },
  preflightWarnings: []
};

describe('parseLocalResponse — real node shapes', () => {
  test('preflight=false success', () => {
    expect(parseLocalResponse(EVAL_SUCCESS)).toEqual({
      status: 'success',
      result: 3,
      gasUsed: 1,
      logs: 'DldRwCblQ7Loqy6wYJnaodHl30d3j3eH-qtFzfEv46g',
      warnings: []
    });
  });

  test('preflight=false failure keeps the node message', () => {
    const r = parseLocalResponse(EVAL_FAILURE);
    expect(r.status).toBe('failure');
    expect(r.gasUsed).toBe(150000);
    expect((r.result as { message: string }).message).toBe(
      'No value found in table example_accounts for key: nobody'
    );
  });

  test('preflight=true success is read from under preflightResult', () => {
    expect(parseLocalResponse(PREFLIGHT_SUCCESS)).toEqual({
      status: 'success',
      result: 3,
      gasUsed: 97,
      logs: 'if-P7LRXIVRS7C4OcdQ5OTbSHoCe_0sJhUJJnXwPFKI',
      warnings: []
    });
  });

  test('preflight=true failure keeps the node message and gas', () => {
    const r = parseLocalResponse(PREFLIGHT_FAILURE);
    expect(r.status).toBe('failure');
    expect(r.gasUsed).toBe(150000);
    expect((r.result as { message: string }).message).toContain(
      'Failed to buy gas: Keyset failure'
    );
  });

  test('preflight warnings are surfaced as strings', () => {
    const r = parseLocalResponse({
      ...PREFLIGHT_SUCCESS,
      preflightWarnings: ['Decimal precision is silently truncated']
    });
    expect(r.warnings).toEqual(['Decimal precision is silently truncated']);
  });

  test('a body with no result at all is a failure, never a success', () => {
    const r = parseLocalResponse({});
    expect(r.status).toBe('failure');
    expect(r.result).toBeNull();
  });
});
