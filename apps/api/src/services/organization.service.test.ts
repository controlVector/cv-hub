import { describe, it, expect, beforeEach } from 'vitest';
import {
  createOrganization,
  getOrganizationById,
  getOrganizationBySlug,
  updateOrganization,
  deleteOrganization,
  addOrganizationMember,
  getUserOrgRole,
  isOrgAdmin,
  isOrgOwner,
  removeOrganizationMember,
  listOrganizations,
  getUserOrganizations,
} from './organization.service';
import { createUser } from './user.service';
import { truncateAllTables } from '../test/test-db';

describe('OrganizationService', () => {
  let testUserId: string;
  let secondUserId: string;

  beforeEach(async () => {
    await truncateAllTables();

    // Create test users
    const testUser = await createUser({
      email: 'orgtest@example.com',
      username: 'orgtestuser',
      password: 'password123',
    });
    testUserId = testUser.id;

    const secondUser = await createUser({
      email: 'second@example.com',
      username: 'seconduser',
      password: 'password123',
    });
    secondUserId = secondUser.id;
  });

  describe('createOrganization', () => {
    it('creates an organization with the creator as owner', async () => {
      const org = await createOrganization(
        {
          slug: 'test-org',
          name: 'Test Organization',
          description: 'A test organization',
        },
        testUserId
      );

      expect(org.id).toBeDefined();
      expect(org.slug).toBe('test-org');
      expect(org.name).toBe('Test Organization');
      expect(org.description).toBe('A test organization');
      expect(org.isPublic).toBe(true); // Default
    });

    it('sets creator as owner member', async () => {
      const org = await createOrganization(
        { slug: 'owned-org', name: 'Owned Org' },
        testUserId
      );

      const role = await getUserOrgRole(org.id, testUserId);
      expect(role).toBe('owner');
    });

    it('creates organization with custom visibility', async () => {
      const org = await createOrganization(
        {
          slug: 'private-org',
          name: 'Private Org',
          isPublic: false,
        },
        testUserId
      );

      expect(org.isPublic).toBe(false);
    });
  });

  describe('getOrganizationById', () => {
    it('returns organization with stats', async () => {
      const created = await createOrganization(
        { slug: 'stats-org', name: 'Stats Org' },
        testUserId
      );

      const org = await getOrganizationById(created.id);

      expect(org).not.toBeNull();
      expect(org!.id).toBe(created.id);
      expect(org!.memberCount).toBe(1); // Creator is a member
      expect(org!.appCount).toBe(0);
    });

    it('returns null for non-existent organization', async () => {
      const org = await getOrganizationById('00000000-0000-0000-0000-000000000000');
      expect(org).toBeNull();
    });
  });

  describe('getOrganizationBySlug', () => {
    it('finds organization by slug', async () => {
      await createOrganization(
        { slug: 'findable-org', name: 'Findable Org' },
        testUserId
      );

      const org = await getOrganizationBySlug('findable-org');

      expect(org).not.toBeNull();
      expect(org!.slug).toBe('findable-org');
      expect(org!.name).toBe('Findable Org');
    });

    it('returns null for non-existent slug', async () => {
      const org = await getOrganizationBySlug('does-not-exist');
      expect(org).toBeNull();
    });
  });

  describe('updateOrganization', () => {
    it('updates organization fields', async () => {
      const created = await createOrganization(
        { slug: 'update-org', name: 'Original Name' },
        testUserId
      );

      const updated = await updateOrganization(created.id, {
        name: 'Updated Name',
        description: 'New description',
      });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated Name');
      expect(updated!.description).toBe('New description');
      expect(updated!.slug).toBe('update-org'); // Unchanged
    });

    it('returns null when organization not found', async () => {
      const result = await updateOrganization(
        '00000000-0000-0000-0000-000000000000',
        { name: 'New Name' }
      );
      expect(result).toBeNull();
    });
  });

  describe('deleteOrganization', () => {
    it('deletes existing organization', async () => {
      const org = await createOrganization(
        { slug: 'delete-me', name: 'Delete Me' },
        testUserId
      );

      const deleted = await deleteOrganization(org.id);
      expect(deleted).toBe(true);

      const found = await getOrganizationById(org.id);
      expect(found).toBeNull();
    });

    it('returns false for non-existent organization', async () => {
      const result = await deleteOrganization('00000000-0000-0000-0000-000000000000');
      expect(result).toBe(false);
    });
  });

  describe('addOrganizationMember', () => {
    it('adds a member to organization', async () => {
      const org = await createOrganization(
        { slug: 'member-org', name: 'Member Org' },
        testUserId
      );

      const member = await addOrganizationMember(org.id, secondUserId, 'member');

      expect(member.organizationId).toBe(org.id);
      expect(member.userId).toBe(secondUserId);
      expect(member.role).toBe('member');
    });

    it('adds member with specified role', async () => {
      const org = await createOrganization(
        { slug: 'admin-org', name: 'Admin Org' },
        testUserId
      );

      await addOrganizationMember(org.id, secondUserId, 'admin');

      const role = await getUserOrgRole(org.id, secondUserId);
      expect(role).toBe('admin');
    });

    it('tracks who invited the member', async () => {
      const org = await createOrganization(
        { slug: 'invite-org', name: 'Invite Org' },
        testUserId
      );

      const member = await addOrganizationMember(org.id, secondUserId, 'member', testUserId);

      expect(member.invitedBy).toBe(testUserId);
      expect(member.invitedAt).toBeDefined();
    });
  });

  describe('getUserOrgRole', () => {
    it('returns correct role for member', async () => {
      const org = await createOrganization(
        { slug: 'role-org', name: 'Role Org' },
        testUserId
      );
      await addOrganizationMember(org.id, secondUserId, 'admin');

      expect(await getUserOrgRole(org.id, testUserId)).toBe('owner');
      expect(await getUserOrgRole(org.id, secondUserId)).toBe('admin');
    });

    it('returns null for non-member', async () => {
      const org = await createOrganization(
        { slug: 'non-member-org', name: 'Non Member Org' },
        testUserId
      );

      const role = await getUserOrgRole(org.id, secondUserId);
      expect(role).toBeNull();
    });
  });

  describe('isOrgAdmin', () => {
    it('returns true for owner', async () => {
      const org = await createOrganization(
        { slug: 'admin-check-org', name: 'Admin Check' },
        testUserId
      );

      expect(await isOrgAdmin(org.id, testUserId)).toBe(true);
    });

    it('returns true for admin', async () => {
      const org = await createOrganization(
        { slug: 'admin-role-org', name: 'Admin Role' },
        testUserId
      );
      await addOrganizationMember(org.id, secondUserId, 'admin');

      expect(await isOrgAdmin(org.id, secondUserId)).toBe(true);
    });

    it('returns false for regular member', async () => {
      const org = await createOrganization(
        { slug: 'member-role-org', name: 'Member Role' },
        testUserId
      );
      await addOrganizationMember(org.id, secondUserId, 'member');

      expect(await isOrgAdmin(org.id, secondUserId)).toBe(false);
    });

    it('returns false for non-member', async () => {
      const org = await createOrganization(
        { slug: 'non-admin-org', name: 'Non Admin' },
        testUserId
      );

      expect(await isOrgAdmin(org.id, secondUserId)).toBe(false);
    });
  });

  describe('isOrgOwner', () => {
    it('returns true only for owner', async () => {
      const org = await createOrganization(
        { slug: 'owner-check-org', name: 'Owner Check' },
        testUserId
      );
      await addOrganizationMember(org.id, secondUserId, 'admin');

      expect(await isOrgOwner(org.id, testUserId)).toBe(true);
      expect(await isOrgOwner(org.id, secondUserId)).toBe(false);
    });
  });

  describe('removeOrganizationMember', () => {
    it('removes member from organization', async () => {
      const org = await createOrganization(
        { slug: 'remove-org', name: 'Remove Org' },
        testUserId
      );
      await addOrganizationMember(org.id, secondUserId, 'member');

      const removed = await removeOrganizationMember(org.id, secondUserId);
      expect(removed).toBe(true);

      const role = await getUserOrgRole(org.id, secondUserId);
      expect(role).toBeNull();
    });

    it('returns false when member not found', async () => {
      const org = await createOrganization(
        { slug: 'no-remove-org', name: 'No Remove' },
        testUserId
      );

      const result = await removeOrganizationMember(org.id, secondUserId);
      expect(result).toBe(false);
    });
  });

  describe('listOrganizations', () => {
    beforeEach(async () => {
      // Create multiple orgs for listing tests
      await createOrganization({ slug: 'public-a', name: 'Public A', isPublic: true }, testUserId);
      await createOrganization({ slug: 'public-b', name: 'Public B', isPublic: true }, testUserId);
      await createOrganization({ slug: 'private-c', name: 'Private C', isPublic: false }, testUserId);
    });

    it('lists public organizations by default', async () => {
      const orgs = await listOrganizations();

      expect(orgs.length).toBe(2);
      expect(orgs.every(o => o.isPublic)).toBe(true);
    });

    it('filters by search term', async () => {
      const orgs = await listOrganizations({ search: 'Public A' });

      expect(orgs.length).toBe(1);
      expect(orgs[0].name).toBe('Public A');
    });

    it('respects limit parameter', async () => {
      const orgs = await listOrganizations({ limit: 1 });
      expect(orgs.length).toBe(1);
    });
  });

  describe('getUserOrganizations', () => {
    it('returns organizations user belongs to', async () => {
      await createOrganization({ slug: 'user-org-1', name: 'User Org 1' }, testUserId);
      await createOrganization({ slug: 'user-org-2', name: 'User Org 2' }, testUserId);

      const orgs = await getUserOrganizations(testUserId);

      expect(orgs.length).toBe(2);
    });

    it('returns empty array for user with no organizations', async () => {
      const orgs = await getUserOrganizations(secondUserId);
      expect(orgs).toEqual([]);
    });
  });
});
