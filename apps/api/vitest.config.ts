import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['node_modules/', 'dist/'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        'src/index.ts', // Entry point
        'src/db/migrate.ts', // Migration script
        'src/db/seed-*.ts', // Seed scripts
        'scripts/', // Utility scripts
      ],
      thresholds: {
        // Start with achievable thresholds, increase over time
        lines: 50,
        functions: 50,
        branches: 50,
        statements: 50,
      },
    },
    // Test timeout for database operations
    testTimeout: 30000,
    // Hook timeout for setup/teardown
    hookTimeout: 30000,
    // Pool settings for parallel execution
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Run tests in a single process for database isolation
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@cv-hub/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
});
