import { describe, it, expect, beforeEach } from 'vitest';
import {
  addDeployKey,
  removeDeployKey,
  listDeployKeys,
  getDeployKey,
  findRepoByDeployKeyFingerprint,
  updateDeployKeyLastUsed,
} from './deploy-keys.service';
import { addKey } from './ssh-keys.service';
import { getTestDb, truncateAllTables } from '../test/test-db';
import { users, repositories } from '../db/schema';

async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const db = getTestDb();
  const [user] = await db.insert(users).values({
    username: `testuser_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    email: `test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.com`,
    displayName: 'Test User',
    emailVerified: true,
    ...overrides,
  }).returning();
  return user;
}

async function createTestRepo(userId: string, overrides: Partial<typeof repositories.$inferInsert> = {}) {
  const db = getTestDb();
  const slug = overrides.slug || `test-repo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [repo] = await db.insert(repositories).values({
    userId,
    name: overrides.name || slug,
    slug,
    visibility: 'public',
    provider: 'local',
    ...overrides,
  }).returning();
  return repo;
}

// Generate a unique ed25519 key for testing
// These are test-only keys, NOT real private keys
function generateTestKey(seed: number): string {
  // Create a properly formatted ed25519 public key for testing
  // Real ed25519 keys are 32 bytes, but the SSH format has the type prefix
  const keyType = 'ssh-ed25519';
  // Generate a deterministic but unique key data
  const typeBytes = Buffer.from(keyType);
  const typeLenBuf = Buffer.alloc(4);
  typeLenBuf.writeUInt32BE(typeBytes.length);

  const keyDataRaw = Buffer.alloc(32);
  keyDataRaw.writeUInt32BE(seed, 0);
  keyDataRaw.writeUInt32BE(seed + 1, 4);
  keyDataRaw.fill(0xAB, 8, 32);

  const keyDataLenBuf = Buffer.alloc(4);
  keyDataLenBuf.writeUInt32BE(keyDataRaw.length);

  const fullKey = Buffer.concat([typeLenBuf, typeBytes, keyDataLenBuf, keyDataRaw]);
  const base64 = fullKey.toString('base64');

  return `ssh-ed25519 ${base64} test-key-${seed}`;
}

describe('DeployKeysService', () => {
  let user: typeof users.$inferSelect;
  let repo: typeof repositories.$inferSelect;

  beforeEach(async () => {
    await truncateAllTables();
    user = await createTestUser();
    repo = await createTestRepo(user.id);
  });

  describe('addDeployKey', () => {
    it('adds a deploy key to a repository', async () => {
      const key = await addDeployKey(repo.id, 'CI Key', generateTestKey(1));

      expect(key.id).toBeDefined();
      expect(key.repositoryId).toBe(repo.id);
      expect(key.title).toBe('CI Key');
      expect(key.readOnly).toBe(true);
      expect(key.fingerprint).toBeDefined();
      expect(key.keyType).toBe('ssh-ed25519');
    });

    it('adds a read-write deploy key', async () => {
      const key = await addDeployKey(repo.id, 'Deploy Key', generateTestKey(2), false);

      expect(key.readOnly).toBe(false);
    });

    it('rejects invalid key format', async () => {
      await expect(
        addDeployKey(repo.id, 'Bad Key', 'not-a-valid-key')
      ).rejects.toThrow();
    });

    it('rejects duplicate fingerprint across deploy keys', async () => {
      const testKey = generateTestKey(3);
      await addDeployKey(repo.id, 'Key 1', testKey);

      const repo2 = await createTestRepo(user.id);
      await expect(
        addDeployKey(repo2.id, 'Key 2', testKey)
      ).rejects.toThrow('already in use by another repository');
    });

    it('rejects duplicate fingerprint within same repo', async () => {
      const testKey = generateTestKey(4);
      await addDeployKey(repo.id, 'Key 1', testKey);

      await expect(
        addDeployKey(repo.id, 'Key 2', testKey)
      ).rejects.toThrow('already added to this repository');
    });

    it('rejects key already used as user SSH key', async () => {
      const testKey = generateTestKey(5);
      await addKey(user.id, 'My SSH Key', testKey);

      await expect(
        addDeployKey(repo.id, 'Deploy Key', testKey)
      ).rejects.toThrow('already registered as a user SSH key');
    });
  });

  describe('removeDeployKey', () => {
    it('removes a deploy key', async () => {
      const key = await addDeployKey(repo.id, 'CI Key', generateTestKey(10));
      await removeDeployKey(key.id, repo.id);

      const keys = await listDeployKeys(repo.id);
      expect(keys).toHaveLength(0);
    });

    it('throws NotFoundError for non-existent key', async () => {
      await expect(
        removeDeployKey('00000000-0000-0000-0000-000000000000', repo.id)
      ).rejects.toThrow();
    });

    it('throws NotFoundError for wrong repo', async () => {
      const key = await addDeployKey(repo.id, 'CI Key', generateTestKey(11));
      const otherRepo = await createTestRepo(user.id);

      await expect(
        removeDeployKey(key.id, otherRepo.id)
      ).rejects.toThrow();
    });
  });

  describe('listDeployKeys', () => {
    it('lists all deploy keys for a repo', async () => {
      await addDeployKey(repo.id, 'Key 1', generateTestKey(20));
      await addDeployKey(repo.id, 'Key 2', generateTestKey(21));

      const keys = await listDeployKeys(repo.id);
      expect(keys).toHaveLength(2);
    });

    it('returns empty array when no keys exist', async () => {
      const keys = await listDeployKeys(repo.id);
      expect(keys).toHaveLength(0);
    });

    it('only returns keys for the specified repo', async () => {
      await addDeployKey(repo.id, 'Key 1', generateTestKey(22));

      const otherRepo = await createTestRepo(user.id);
      await addDeployKey(otherRepo.id, 'Key 2', generateTestKey(23));

      const keys = await listDeployKeys(repo.id);
      expect(keys).toHaveLength(1);
    });
  });

  describe('getDeployKey', () => {
    it('gets a specific deploy key', async () => {
      const created = await addDeployKey(repo.id, 'CI Key', generateTestKey(30));
      const fetched = await getDeployKey(created.id, repo.id);

      expect(fetched.id).toBe(created.id);
      expect(fetched.title).toBe('CI Key');
    });

    it('throws NotFoundError for non-existent key', async () => {
      await expect(
        getDeployKey('00000000-0000-0000-0000-000000000000', repo.id)
      ).rejects.toThrow();
    });
  });

  describe('findRepoByDeployKeyFingerprint', () => {
    it('finds repo by deploy key fingerprint', async () => {
      const key = await addDeployKey(repo.id, 'CI Key', generateTestKey(40));

      const result = await findRepoByDeployKeyFingerprint(key.fingerprint);

      expect(result).not.toBeNull();
      expect(result!.repository.id).toBe(repo.id);
      expect(result!.id).toBe(key.id);
    });

    it('returns null for unknown fingerprint', async () => {
      const result = await findRepoByDeployKeyFingerprint('SHA256:unknown');
      expect(result).toBeNull();
    });
  });

  describe('updateDeployKeyLastUsed', () => {
    it('updates the lastUsedAt timestamp', async () => {
      const key = await addDeployKey(repo.id, 'CI Key', generateTestKey(50));
      expect(key.lastUsedAt).toBeNull();

      await updateDeployKeyLastUsed(key.id);

      const updated = await getDeployKey(key.id, repo.id);
      expect(updated.lastUsedAt).not.toBeNull();
    });
  });
});
