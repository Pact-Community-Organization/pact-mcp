/**
 * @fileoverview Vitest configuration for mcp-chainweb
 * @author Developer
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      // bin.ts is a thin shim exercised by the integration test via a child
      // process. index.ts (if any) is a pure barrel. Excluded from coverage.
      exclude: ['src/bin.ts'],
      thresholds: {
        functions: 90,
        lines: 85,
        branches: 80
      }
    },
    timeout: 30000,
    testTimeout: 30000
  }
});
