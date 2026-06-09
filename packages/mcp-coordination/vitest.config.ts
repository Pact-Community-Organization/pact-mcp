import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
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
