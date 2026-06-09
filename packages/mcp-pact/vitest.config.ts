/**
 * @fileoverview Vitest configuration for mcp-pact package
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
      // bin.ts is a thin shim that is exercised end-to-end by the integration
      // test in a subprocess (no in-process instrumentation). Excluding it
      // keeps the coverage metric focused on library code.
      exclude: ['src/bin.ts', 'src/index.ts'],
      thresholds: {
        functions: 90,
        lines: 85,
        branches: 80
      }
    },
    timeout: 30000, // 30s timeout for tests that spawn pact binary
    testTimeout: 30000
  }
});