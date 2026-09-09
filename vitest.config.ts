import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    environmentMatchGlobs: [
      ['**/*.dom.test.{ts,tsx}', 'jsdom'],
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['lib/**/*.ts', 'app/api/**/*.ts'],
      exclude: ['**/*.test.ts', '**/types.ts'],
      // This is a regression floor, not a claim that broad coverage is
      // complete. Security-critical modules also have focused integration
      // tests; raise these global floors as uncovered provider paths become
      // deterministic and testable.
      thresholds: {
        lines: 35,
        functions: 35,
        branches: 50,
        statements: 35,
      },
    },
  },
});
