import { defineConfig } from 'vitest/config';

export default defineConfig({
  extends: '../../vitest.config.ts',
  test: {
    name: 'mcp-shared'
  }
});