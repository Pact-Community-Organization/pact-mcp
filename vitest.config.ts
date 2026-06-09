import { defineConfig } from 'vitest/config';

// [Developer] Vitest workspace configuration for MCP monorepo
// ADR-MCP-001: Coverage thresholds enforce security baseline quality
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'coverage/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.config.{ts,js,mjs}',
        '**/.eslintrc.{ts,js,mjs}'
      ],
      thresholds: {
        functions: 90,
        lines: 85,
        branches: 80,
        statements: 85
      }
    },
    typecheck: {
      // [Developer] typecheck is now a separate CLI subcommand in vitest 4
      // Run: vitest typecheck (or pnpm -r typecheck for tsc --noEmit)
    }
  }
});