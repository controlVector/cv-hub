import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema';

// ---------------------------------------------------------------------------
// Unified DB pool for tests
//
// Previously, test-db.ts created its OWN pg.Pool, separate from the app's
// pool in ../db/index.ts. Two pools hitting the same database caused FK
// constraint races: truncation on Pool A wasn't always visible to Pool B.
//
// Fix: lazily resolve the app's `db` instance via dynamic import.
// Dynamic import is necessary because setup.ts sets process.env.DATABASE_URL
// AFTER its static imports resolve (ES module hoisting), but db/index.ts
// needs that env var. By the time getTestDb() is called (in beforeAll),
// the env var is set and the app pool initialises correctly.
// ---------------------------------------------------------------------------

let _db: NodePgDatabase<typeof schema> | null = null;

async function resolveDb(): Promise<NodePgDatabase<typeof schema>> {
  if (!_db) {
    const mod = await import('../db');
    _db = mod.db;
  }
  return _db;
}

/**
 * Get the shared database instance (same pool services use).
 */
export async function getTestDb(): Promise<NodePgDatabase<typeof schema>> {
  return resolveDb();
}

/**
 * Close the test database connection.
 * No-op: the app pool manages its own lifecycle via process exit.
 */
export async function closeTestDb(): Promise<void> {
  // Nothing to do — we reuse the app pool.
}

/**
 * Truncate all tables in the database (for test isolation).
 * Uses the app's db pool to avoid cross-pool visibility issues.
 */
export async function truncateAllTables(): Promise<void> {
  const db = await resolveDb();

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

  const tableNames = (tables.rows as { tablename: string }[])
    .map((row) => `"${row.tablename}"`)
    .join(', ');
  await db.execute(sql.raw(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE`));
}

/**
 * Run a function within a transaction that gets rolled back.
 * Placeholder for more advanced transaction-based isolation.
 */
export async function withTransaction<T>(
  fn: (tx: NodePgDatabase<typeof schema>) => Promise<T>
): Promise<T> {
  const db = await resolveDb();
  return await fn(db);
}

/**
 * Seed basic test data that many tests need.
 */
export async function seedBasicTestData(): Promise<{
  testUser: typeof schema.users.$inferSelect;
  testOrg: typeof schema.organizations.$inferSelect;
}> {
  const db = await resolveDb();

  const [testUser] = await db
    .insert(schema.users)
    .values({
      username: 'testuser',
      email: 'test@example.com',
      displayName: 'Test User',
      emailVerified: true,
    })
    .returning();

  const [testOrg] = await db
    .insert(schema.organizations)
    .values({
      slug: 'test-org',
      name: 'Test Organization',
      description: 'A test organization',
      isPublic: true,
    })
    .returning();

  await db.insert(schema.organizationMembers).values({
    organizationId: testOrg.id,
    userId: testUser.id,
    role: 'owner',
  });

  return { testUser, testOrg };
}

/**
 * Create a test user with password credentials.
 */
export async function createTestUserWithPassword(
  overrides: Partial<typeof schema.users.$inferInsert> = {},
  password: string = 'testpassword123'
): Promise<typeof schema.users.$inferSelect> {
  const db = await resolveDb();

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

  await db.insert(schema.passwordCredentials).values({
    userId: user.id,
    passwordHash,
  });

  return user;
}

/**
 * Create a test organization.
 */
export async function createTestOrganization(
  overrides: Partial<typeof schema.organizations.$inferInsert> = {}
): Promise<typeof schema.organizations.$inferSelect> {
  const db = await resolveDb();

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
