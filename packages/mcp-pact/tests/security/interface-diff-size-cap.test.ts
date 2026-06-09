/**
 * @fileoverview Security — interface_diff enforces the 2 MB per-file size cap
 *               that matches module_scan's policy (MAX_SOURCE_BYTES).
 */

import { describe, test, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { createInterfaceDiffTool } from '../../src/tools/interface-diff.js';

const fixtures = path.resolve(import.meta.dirname, '../fixtures');
const diff = createInterfaceDiffTool({ workspaceRoot: fixtures });

describe('interface_diff size cap', () => {
  test('rejects files exceeding 2MB', async () => {
    const big = path.join(fixtures, 'big.pact');
    // [Developer] 2 MB + 1 byte
    const buf = Buffer.alloc(2 * 1024 * 1024 + 1, 0x20);
    fs.writeFileSync(big, buf);
    try {
      await expect(
        diff({ before: 'big.pact', after: 'iface-after.pact' })
      ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
      // Also verify rejection works on the `after` slot
      await expect(
        diff({ before: 'iface-after.pact', after: 'big.pact' })
      ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    } finally {
      fs.unlinkSync(big);
    }
  });
});
