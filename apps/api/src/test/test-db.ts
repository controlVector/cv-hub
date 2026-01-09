import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema';

// Get test database URL from environment or use default
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/cv_hub_test';

let pool: Pool | null = null;
let testDb: NodePgDatabase<typeof schema> | null = null;

/**
 * Get or create the test database connection
 */
export function getTestDb(): NodePgDatabase<typeof schema> {
  if (!testDb) {
    pool = new Pool({
      connectionString: TEST_DATABASE_URL,
      max: 5, // Limit connections for test environment
    });

    testDb = drizzle(pool, { schema });
  }

  return testDb;
}

/**
 * Close the test database connection
 */
export async function closeTestDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    testDb = null;
  }
}

/**
 * Truncate all tables in the database (for test isolation)
 * This is faster than dropping and recreating tables
 */
export async function truncateAllTables(): Promise<void> {
  const db = getTestDb();

  // Get all table names except migrations
  const tables = await db.execute(sql`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename != 'drizzle_migrations'
    AND tablename != '__drizzle_migrations'
  `);

  if (tables.rows.length === 0) {
    return;
  }

  // Truncate all tables with cascade
  const tableNames = (tables.rows as { tablename: string }[])
    .map((row) => `"${row.tablename}"`)
    .join(', ');
  await db.execute(sql.raw(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE`));
}

/**
 * Run a function within a transaction that gets rolled back
 * Useful for tests that need complete isolation
 */
export async function withTransaction<T>(
  fn: (tx: NodePgDatabase<typeof schema>) => Promise<T>
): Promise<T> {
  const db = getTestDb();

  // Note: Drizzle doesn't have built-in transaction rollback for tests,
  // so we use truncate approach instead. This is a placeholder for
  // more advanced transaction-based isolation if needed.
  return await fn(db);
}

/**
 * Seed basic test data that many tests need
 */
export async function seedBasicTestData(): Promise<{
  testUser: typeof schema.users.$inferSelect;
  testOrg: typeof schema.organizations.$inferSelect;
}> {
  const db = getTestDb();

  // Create a test user
  const [testUser] = await db
    .insert(schema.users)
    .values({
      username: 'testuser',
      email: 'test@example.com',
      displayName: 'Test User',
      emailVerified: true,
    })
    .returning();

  // Create a test organization
  const [testOrg] = await db
    .insert(schema.organizations)
    .values({
      slug: 'test-org',
      name: 'Test Organization',
      description: 'A test organization',
      isPublic: true,
    })
    .returning();

  // Add user to organization as owner
  await db.insert(schema.organizationMembers).values({
    organizationId: testOrg.id,
    userId: testUser.id,
    role: 'owner',
  });

  return { testUser, testOrg };
}

/**
 * Create a test user with password credentials
 */
export async function createTestUserWithPassword(
  overrides: Partial<typeof schema.users.$inferInsert> = {},
  password: string = 'testpassword123'
): Promise<typeof schema.users.$inferSelect> {
  const db = getTestDb();

  // Import argon2 dynamically to avoid issues if not installed
  const argon2 = await import('argon2');
  const passwordHash = await argon2.hash(password);

  const defaultUser = {
    username: `testuser_${Date.now()}`,
    email: `test_${Date.now()}@example.com`,
    displayName: 'Test User',
    emailVerified: true,
    ...overrides,
  };

  const [user] = await db
    .insert(schema.users)
    .values(defaultUser)
    .returning();

  // Create password credentials
  await db.insert(schema.passwordCredentials).values({
    userId: user.id,
    passwordHash,
  });

  return user;
}

/**
 * Create a test organization
 */
export async function createTestOrganization(
  overrides: Partial<typeof schema.organizations.$inferInsert> = {}
): Promise<typeof schema.organizations.$inferSelect> {
  const db = getTestDb();

  const defaultOrg = {
    slug: `test-org-${Date.now()}`,
    name: 'Test Organization',
    description: 'A test organization',
    isPublic: true,
    ...overrides,
  };

  const [org] = await db
    .insert(schema.organizations)
    .values(defaultOrg)
    .returning();

  return org;
}

export { schema };
