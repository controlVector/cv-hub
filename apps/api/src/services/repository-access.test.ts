/**
 * Repository Access Tests
 * Tests for getUserAccessibleRepoIds and canUserAccessRepo
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { getUserAccessibleRepoIds, canUserAccessRepo } from './repository.service';
import {
  truncateAllTables,
  createTestUserWithPassword,
  createTestOrganization,
  getTestDb,
} from '../test/test-db';
import * as schema from '../db/schema';

describe('Repository Access', () => {
  beforeAll(async () => {
    const db = getTestDb();
    await db.execute(/* sql */`SELECT 1`);
  });

  afterEach(async () => {
    await truncateAllTables();
  });

  async function createSetup() {
    const db = getTestDb();

    // Create two users
    const userA = await createTestUserWithPassword({
      username: `userA_${Date.now()}`,
      email: `userA_${Date.now()}@example.com`,
    });
    const userB = await createTestUserWithPassword({
      username: `userB_${Date.now()}`,
      email: `userB_${Date.now()}@example.com`,
    });

    // Create an org
    const org = await createTestOrganization({
      slug: `access-org-${Date.now()}`,
      name: 'Access Test Org',
    });

    // Make userA an owner of the org
    await db.insert(schema.organizationMembers).values({
      organizationId: org.id,
      userId: userA.id,
      role: 'owner',
    });

    // Create repos
    const [personalRepo] = await db.insert(schema.repositories).values({
      name: 'Personal Repo',
      slug: `personal-${Date.now()}`,
      userId: userA.id,
      visibility: 'private',
      defaultBranch: 'main',
    }).returning();

    const [orgRepo] = await db.insert(schema.repositories).values({
      name: 'Org Repo',
      slug: `org-repo-${Date.now()}`,
      organizationId: org.id,
      visibility: 'internal',
      defaultBranch: 'main',
    }).returning();

    const [publicRepo] = await db.insert(schema.repositories).values({
      name: 'Public Repo',
      slug: `public-${Date.now()}`,
      userId: userB.id,
      visibility: 'public',
      defaultBranch: 'main',
    }).returning();

    return { userA, userB, org, personalRepo, orgRepo, publicRepo };
  }

  describe('getUserAccessibleRepoIds', () => {
    it('returns repos the user owns', async () => {
      const { userA, personalRepo } = await createSetup();

      const repoIds = await getUserAccessibleRepoIds(userA.id);

      expect(repoIds).toContain(personalRepo.id);
    });

    it('returns org repos for org members', async () => {
      const { userA, orgRepo } = await createSetup();

      const repoIds = await getUserAccessibleRepoIds(userA.id);

      expect(repoIds).toContain(orgRepo.id);
    });

    it('does not return repos from other orgs', async () => {
      const { userB, orgRepo } = await createSetup();

      const repoIds = await getUserAccessibleRepoIds(userB.id);

      expect(repoIds).not.toContain(orgRepo.id);
    });

    it('returns repos the user is a direct member of', async () => {
      const db = getTestDb();
      const { userB, personalRepo } = await createSetup();

      // Add userB as a direct member of userA's personal repo
      await db.insert(schema.repositoryMembers).values({
        repositoryId: personalRepo.id,
        userId: userB.id,
        role: 'read',
      });

      const repoIds = await getUserAccessibleRepoIds(userB.id);

      expect(repoIds).toContain(personalRepo.id);
    });

    it('returns empty for user with no repos', async () => {
      const user = await createTestUserWithPassword({
        username: `lonely_${Date.now()}`,
        email: `lonely_${Date.now()}@example.com`,
      });

      const repoIds = await getUserAccessibleRepoIds(user.id);

      expect(repoIds).toEqual([]);
    });
  });

  describe('canUserAccessRepo', () => {
    it('allows owner to access their repo', async () => {
      const { userA, personalRepo } = await createSetup();

      const canAccess = await canUserAccessRepo(personalRepo.id, userA.id);
      expect(canAccess).toBe(true);
    });

    it('allows anyone to access public repos', async () => {
      const { userA, publicRepo } = await createSetup();

      const canAccess = await canUserAccessRepo(publicRepo.id, userA.id);
      expect(canAccess).toBe(true);
    });

    it('allows unauthenticated users to access public repos', async () => {
      const { publicRepo } = await createSetup();

      const canAccess = await canUserAccessRepo(publicRepo.id, null);
      expect(canAccess).toBe(true);
    });

    it('denies unauthenticated users private repos', async () => {
      const { personalRepo } = await createSetup();

      const canAccess = await canUserAccessRepo(personalRepo.id, null);
      expect(canAccess).toBe(false);
    });

    it('allows org members to access internal org repos', async () => {
      const { userA, orgRepo } = await createSetup();

      const canAccess = await canUserAccessRepo(orgRepo.id, userA.id);
      expect(canAccess).toBe(true);
    });

    it('denies non-org-members access to internal org repos', async () => {
      const { userB, orgRepo } = await createSetup();

      const canAccess = await canUserAccessRepo(orgRepo.id, userB.id);
      expect(canAccess).toBe(false);
    });
  });
});
