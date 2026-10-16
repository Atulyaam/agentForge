import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
  },
  resolve: {
    alias: {
      '@agentforge/shared': path.resolve(__dirname, 'packages/shared/src'),
      '@agentforge/schemas': path.resolve(__dirname, 'packages/schemas/src'),
      '@agentforge/llm': path.resolve(__dirname, 'packages/llm/src'),
      '@agentforge/policies': path.resolve(__dirname, 'packages/policies/src'),
      '@agentforge/orchestrator': path.resolve(__dirname, 'packages/orchestrator/src'),
      '@agentforge/adapter-kit': path.resolve(__dirname, 'packages/adapter-kit/src'),
      '@agentforge/evaluation': path.resolve(__dirname, 'packages/evaluation/src'),
      '@': path.resolve(__dirname, 'apps/web/src'),
    },
  },
});
