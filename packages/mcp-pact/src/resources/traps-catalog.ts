/**
 * @fileoverview pact://traps resource handler
 * @author Developer
 * @description JSON catalog of the 5 critical Pact 5 traps.
 */

import { sanitizeToolOutput } from '@pact-community/mcp-shared';
import { getTrapsCatalog } from '../analysis/traps.js';

export const TRAPS_RESOURCE_URI = 'pact://traps';

export function readTrapsResource(): {
  contents: Array<{ uri: string; mimeType: string; text: string }>;
} {
  const catalog = getTrapsCatalog();
  const json = JSON.stringify(catalog, null, 2);
  return {
    contents: [
      {
        uri: TRAPS_RESOURCE_URI,
        mimeType: 'application/json',
        text: sanitizeToolOutput(json).text
      }
    ]
  };
}
