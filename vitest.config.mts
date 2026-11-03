import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/tests/testSetup.ts'],
    globalSetup: ['./src/tests/globalSetup.ts'],
    fsModuleCache: false,
  },
});
