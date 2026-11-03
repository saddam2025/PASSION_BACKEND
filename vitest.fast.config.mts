import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 20_000,
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    include: ['src/tests/**/*.unit.test.ts', 'src/tests/foundation.http.test.ts'],
    setupFiles: ['./src/tests/testSetup.ts'],
    fsModuleCache: false,
  },
});
