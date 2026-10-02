import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['**/*.test.ts', '**/types.ts'],
      // This is a regression floor, not a claim that broad coverage is
      // complete. Security-critical modules also have focused integration
      // tests; raise these global floors as uncovered provider paths become
      // deterministic and testable.
        thresholds: {
          lines: 35,
          functions: 35,
          // Vitest 5/V8 counts logical short-circuit branches more strictly
          // than Vitest 1; retain a meaningful floor above the current 41%.
          branches: 40,
          statements: 35,
      },
    },
  },
});
