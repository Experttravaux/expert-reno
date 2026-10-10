import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts', 'src/checklist/template-v1.ts'],
      reporter: ['text', 'lcov'],
      // §12: state machine and scoring must be fully covered.
      thresholds: {
        'src/state-machine.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },
        'src/scoring/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
        'src/checklist/severity.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },
        'src/marketplace/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
      },
    },
  },
});
