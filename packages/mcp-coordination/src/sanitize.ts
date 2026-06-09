/**
 * @fileoverview Whitelisted-field sanitization wrapper for tool responses.
 * @author Developer
 *
 * Raw content is preserved on disk; this module sanitizes on the response
 * boundary so downstream LLMs never see unfiltered user text.
 */

import { sanitizeToolOutput } from '@pact-community/mcp-shared';

/**
 * Return a deep copy of `input` where every string leaf whose parent key
 * matches a `fieldList` entry has been passed through `sanitizeToolOutput`.
 * Non-matching fields are left untouched.
 */
export function sanitizeFields<T>(input: T, fieldList: string[]): T {
  const fields = new Set(fieldList);
  return walk(input, fields) as T;
}

function walk(value: unknown, fields: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => walk(v, fields));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string' && fields.has(k)) {
        out[k] = sanitizeToolOutput(v);
      } else {
        out[k] = walk(v, fields);
      }
    }
    return out;
  }
  return value;
}
