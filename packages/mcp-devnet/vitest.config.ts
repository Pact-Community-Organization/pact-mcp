/**
 * @fileoverview Vitest configuration for mcp-devnet package.
 * @author Developer
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // [Developer] Run each test file in its own fork, sequentially.
    // The default `threads` pool + parallel file execution caused rare
    // stderr-capture flakes under load (tests/docker/spawn.test.ts) due to
    // concurrent mkdtemp fixtures piling up /tmp. Serial execution
    // eliminates the race (~15s total, well inside the test budget).
    pool: 'forks',
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      // bin.ts is a thin shim exercised end-to-end by the integration test
      // in a subprocess; excluding it keeps the coverage metric focused on
      // library code. agents.ts is a pure const map re-exported by server.ts.
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
