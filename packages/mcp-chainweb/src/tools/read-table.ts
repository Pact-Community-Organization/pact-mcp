/**
 * @fileoverview chainweb_read_table - read a single Pact table row via /local.
 *
 * Thin wrapper over the `/local` preflight machinery that executes
 *   `(read <module>.<table> "<key>")`
 * with a tight zod validator on the table and key arguments (no string
 * escaping shenanigans — the key must be a safe literal).
 *
 * Returns `{ row, keyFound, gasUsed, chainId }` with the row auto-unwrapped
 * through {@link unwrapPactValue}. A missing key surfaces as
 * `keyFound: false, row: null` — callers do NOT need to pattern-match
 * "row not found" error strings.
 */

import { z } from 'zod';
import { Pact } from '@kadena/client';
import { McpToolError } from '@pact-community/mcp-shared';
import type { ChainwebClient } from '../client/fetch.js';
import type { PactValue } from '../client/unwrap.js';
import {
  runLocalPreflight,
  extractErrorMessage
} from '../client/preflight.js';

const CHAIN_ID_REGEX = /^(1?[0-9])$/;
const MODULE_REGEX = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/;
const TABLE_REGEX = /^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/;
// Keys must not contain `"` or `\` — prevents Pact code
// injection via the composed `(read module.table "key")` expression.
// Principals, hex, k:/w: accounts, dots, dashes, numerics are all allowed.
const KEY_UNSAFE_CHARS = /["\\]/;

export const ReadTableInputShape = {
  chainId: z
    .string()
    .regex(CHAIN_ID_REGEX)
    .describe('Chain id 0..19 as a decimal string.'),
  module: z
    .string()
    .min(1)
    .max(128)
    .regex(MODULE_REGEX)
    .describe('Fully qualified module name, e.g. "namespace.module-name".'),
  table: z
    .string()
    .min(1)
    .max(64)
    .regex(TABLE_REGEX)
    .describe('Unqualified table name (letters, digits, underscores, dashes).'),
  key: z
    .string()
    .min(1)
    .max(512)
    .refine((s) => !KEY_UNSAFE_CHARS.test(s), {
      message:
        'Key contains unsafe chars (" or \\). Reject — prevents Pact code injection.'
    })
    .describe(
      'Table row key. Cannot contain double-quote or backslash characters.'
    )
};
export const ReadTableInputSchema = z.object(ReadTableInputShape);

export interface ReadTableResult {
  row: PactValue;
  keyFound: boolean;
  gasUsed: number;
  chainId: string;
  /** True iff the row JSON exceeded the 1MB safety cap and was truncated. */
  truncated: boolean;
}

export interface ReadTableToolConfig {
  client: ChainwebClient;
  defaultSender?: string;
  gasPrice?: number;
}

/** 1MB post-unwrap row JSON cap. */
const ROW_JSON_CAP = 1_048_576;

/**
 * Heuristic "row not found" detection. Pact emits messages
 * matching /row not found/i when `read` fails due to a missing key. We do
 * NOT rely on an exact string — we defensively match common substrings.
 */
function isRowNotFound(result: PactValue): boolean {
  const msg = extractErrorMessage(result).toLowerCase();
  return /row not found|no value found|key does not exist/.test(msg);
}

export function createReadTableTool(config: ReadTableToolConfig) {
  const defaultSender = config.defaultSender ?? 'sender00';
  const gasPrice = config.gasPrice ?? 1e-7;
  return async function readTable(
    args: unknown
  ): Promise<{ content: ReadTableResult[] }> {
    const input = ReadTableInputSchema.parse(args);

    // Key is validated at the zod layer to contain no `"` or
    // `\`, so direct interpolation into Pact source is safe.
    const code = `(read ${input.module}.${input.table} "${input.key}")`;
    const tx = Pact.builder
      .execution(code)
      .setMeta({
        chainId: input.chainId as never,
        gasLimit: 150_000,
        gasPrice,
        senderAccount: defaultSender
      })
      .setNetworkId(config.client.networkId)
      .createTransaction();

    const pre = await runLocalPreflight(config.client, input.chainId, tx);

    if (pre.status === 'failure') {
      if (isRowNotFound(pre.result)) {
        return {
          content: [
            {
              row: null,
              keyFound: false,
              gasUsed: pre.gasUsed,
              chainId: input.chainId,
              truncated: false
            }
          ]
        };
      }
      throw new McpToolError(
        'READ_TABLE_FAILED',
        `read-table failed: ${extractErrorMessage(pre.result).slice(0, 500)}`,
        false
      );
    }

    // Size guard.
    const asString = JSON.stringify(pre.result ?? null);
    if (asString.length > ROW_JSON_CAP) {
      return {
        content: [
          {
            row: null,
            keyFound: true,
            gasUsed: pre.gasUsed,
            chainId: input.chainId,
            truncated: true
          }
        ]
      };
    }

    return {
      content: [
        {
          row: pre.result,
          keyFound: true,
          gasUsed: pre.gasUsed,
          chainId: input.chainId,
          truncated: false
        }
      ]
    };
  };
}
