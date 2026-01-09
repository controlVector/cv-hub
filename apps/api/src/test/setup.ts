import { beforeAll, afterAll, afterEach, vi } from 'vitest';
import { closeTestDb, truncateAllTables, getTestDb } from './test-db';

// Set test environment
process.env.NODE_ENV = 'test';

// Set required environment variables for tests
// These should be overridden by CI/CD or local .env.test
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/cv_hub_test';

process.env.REDIS_URL = process.env.TEST_REDIS_URL ||
  process.env.REDIS_URL ||
  'redis://localhost:6379';

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ||
  'test-jwt-access-secret-must-be-at-least-32-chars';

process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ||
  'test-jwt-refresh-secret-must-be-at-least-32-chars';

process.env.CSRF_SECRET = process.env.CSRF_SECRET ||
  'test-csrf-secret-must-be-at-least-32-chars';

process.env.MFA_ENCRYPTION_KEY = process.env.MFA_ENCRYPTION_KEY ||
  'test-mfa-encryption-key-32-char!';

process.env.APP_URL = process.env.APP_URL || 'http://localhost:5173';
process.env.API_URL = process.env.API_URL || 'http://localhost:3000';

// Mock external services that shouldn't be called in tests
vi.mock('../services/email.service', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
  sendVerificationEmail: vi.fn().mockResolvedValue({ success: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ success: true }),
}));

// Global setup: runs once before all tests
beforeAll(async () => {
  // Verify database connection
  try {
    const db = getTestDb();
    // Simple query to verify connection using sql template
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`SELECT 1`);
    console.log('✓ Test database connection established');
  } catch (error) {
    console.error('✗ Failed to connect to test database:', error);
    throw new Error(
      'Could not connect to test database. Ensure PostgreSQL is running and ' +
      'TEST_DATABASE_URL or DATABASE_URL is set correctly.'
    );
  }
});

// After each test: clean up data for isolation
afterEach(async () => {
  // Truncate tables after each test for isolation
  // This is slower but safer than transactions for complex tests
  await truncateAllTables();

  // Clear all mocks
  vi.clearAllMocks();
});

// Global teardown: runs once after all tests
afterAll(async () => {
  await closeTestDb();
  console.log('✓ Test database connection closed');
});

// Export test utilities for convenience
export * from './test-db';

// Type augmentation for Vitest globals
declare global {
  // eslint-disable-next-line no-var
  var testDb: ReturnType<typeof getTestDb>;
}
