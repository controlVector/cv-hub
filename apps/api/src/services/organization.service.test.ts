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
  updateMemberRole,
  listOrganizations,
  getUserOrganizations,
  createInvite,
  listPendingInvites,
  cancelInvite,
  acceptInviteByToken,
  getInviteByToken,
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

  // ========================================================================
  // Invite System Tests
  // ========================================================================

  describe('createInvite', () => {
    it('creates an invite with a token', async () => {
      const org = await createOrganization({ slug: 'invite-create-org', name: 'Invite Org' }, testUserId);

      const invite = await createInvite(org.id, 'newuser@example.com', 'member', testUserId);

      expect(invite.id).toBeDefined();
      expect(invite.token).toBeDefined();
      expect(invite.token.length).toBeGreaterThan(10);
      expect(invite.email).toBe('newuser@example.com');
      expect(invite.role).toBe('member');
      expect(invite.organizationId).toBe(org.id);
      expect(invite.invitedBy).toBe(testUserId);
      expect(invite.expiresAt).toBeDefined();
      expect(invite.acceptedAt).toBeNull();
    });

    it('rejects duplicate pending invite for same email+org', async () => {
      const org = await createOrganization({ slug: 'dup-invite-org', name: 'Dup Invite' }, testUserId);

      await createInvite(org.id, 'dup@example.com', 'member', testUserId);

      await expect(
        createInvite(org.id, 'dup@example.com', 'member', testUserId)
      ).rejects.toThrow('pending invite already exists');
    });

    it('rejects owner role', async () => {
      const org = await createOrganization({ slug: 'owner-invite-org', name: 'Owner Invite' }, testUserId);

      await expect(
        createInvite(org.id, 'owner@example.com', 'owner', testUserId)
      ).rejects.toThrow('Cannot invite as owner');
    });

    it('normalizes email to lowercase', async () => {
      const org = await createOrganization({ slug: 'case-invite-org', name: 'Case Invite' }, testUserId);

      const invite = await createInvite(org.id, 'UPPER@EXAMPLE.COM', 'member', testUserId);

      expect(invite.email).toBe('upper@example.com');
    });
  });

  describe('listPendingInvites', () => {
    it('returns only non-expired non-accepted invites', async () => {
      const org = await createOrganization({ slug: 'list-invite-org', name: 'List Invite' }, testUserId);

      await createInvite(org.id, 'pending1@example.com', 'member', testUserId);
      await createInvite(org.id, 'pending2@example.com', 'admin', testUserId);

      const invites = await listPendingInvites(org.id);

      expect(invites.length).toBe(2);
      expect(invites.every(i => i.acceptedAt === null)).toBe(true);
    });

    it('returns empty for org with no invites', async () => {
      const org = await createOrganization({ slug: 'empty-invite-org', name: 'Empty' }, testUserId);

      const invites = await listPendingInvites(org.id);
      expect(invites).toEqual([]);
    });
  });

  describe('cancelInvite', () => {
    it('removes an invite', async () => {
      const org = await createOrganization({ slug: 'cancel-invite-org', name: 'Cancel Invite' }, testUserId);
      const invite = await createInvite(org.id, 'cancel@example.com', 'member', testUserId);

      const cancelled = await cancelInvite(org.id, invite.id);
      expect(cancelled).toBe(true);

      const remaining = await listPendingInvites(org.id);
      expect(remaining.length).toBe(0);
    });

    it('returns false for non-existent invite', async () => {
      const org = await createOrganization({ slug: 'nocancel-org', name: 'No Cancel' }, testUserId);

      const cancelled = await cancelInvite(org.id, '00000000-0000-0000-0000-000000000000');
      expect(cancelled).toBe(false);
    });
  });

  describe('acceptInviteByToken', () => {
    it('creates membership and marks invite accepted', async () => {
      const org = await createOrganization({ slug: 'accept-org', name: 'Accept Org' }, testUserId);
      const invite = await createInvite(org.id, 'second@example.com', 'admin', testUserId);

      const member = await acceptInviteByToken(invite.token, secondUserId, 'second@example.com');

      expect(member.organizationId).toBe(org.id);
      expect(member.userId).toBe(secondUserId);
      expect(member.role).toBe('admin');
      expect(member.acceptedAt).toBeDefined();

      // Invite should be marked accepted
      const updated = await getInviteByToken(invite.token);
      expect(updated!.acceptedAt).not.toBeNull();
    });

    it('rejects expired token', async () => {
      const org = await createOrganization({ slug: 'expired-org', name: 'Expired Org' }, testUserId);
      const invite = await createInvite(org.id, 'second@example.com', 'member', testUserId);

      // Manually expire the invite via direct DB update
      const { db } = await import('../db');
      const { orgInvites } = await import('../db/schema');
      const { eq } = await import('drizzle-orm');
      await db.update(orgInvites)
        .set({ expiresAt: new Date('2020-01-01') })
        .where(eq(orgInvites.id, invite.id));

      await expect(
        acceptInviteByToken(invite.token, secondUserId, 'second@example.com')
      ).rejects.toThrow('expired');
    });

    it('rejects already-accepted token', async () => {
      const org = await createOrganization({ slug: 'double-accept-org', name: 'Double Accept' }, testUserId);
      const invite = await createInvite(org.id, 'second@example.com', 'member', testUserId);

      await acceptInviteByToken(invite.token, secondUserId, 'second@example.com');

      // Create another user to try accepting the same token
      const thirdUser = await createUser({
        email: 'third@example.com',
        username: 'thirduser',
        password: 'password123',
      });

      await expect(
        acceptInviteByToken(invite.token, thirdUser.id, 'second@example.com')
      ).rejects.toThrow('already been accepted');
    });

    it('rejects mismatched email', async () => {
      const org = await createOrganization({ slug: 'mismatch-org', name: 'Mismatch Org' }, testUserId);
      const invite = await createInvite(org.id, 'invited@example.com', 'member', testUserId);

      await expect(
        acceptInviteByToken(invite.token, secondUserId, 'wrong@example.com')
      ).rejects.toThrow('does not match');
    });
  });

  // ========================================================================
  // Last-Owner Protection Tests
  // ========================================================================

  describe('removeOrganizationMember - last owner protection', () => {
    it('blocks removing the last owner', async () => {
      const org = await createOrganization({ slug: 'last-owner-rm-org', name: 'Last Owner Remove' }, testUserId);

      await expect(
        removeOrganizationMember(org.id, testUserId)
      ).rejects.toThrow('Cannot remove the last owner');
    });

    it('allows removing an owner when another owner exists', async () => {
      const org = await createOrganization({ slug: 'multi-owner-rm-org', name: 'Multi Owner Remove' }, testUserId);
      await addOrganizationMember(org.id, secondUserId, 'owner');

      const removed = await removeOrganizationMember(org.id, testUserId);
      expect(removed).toBe(true);

      // secondUserId should still be owner
      const role = await getUserOrgRole(org.id, secondUserId);
      expect(role).toBe('owner');
    });
  });

  describe('updateMemberRole - last owner protection', () => {
    it('blocks demoting the last owner', async () => {
      const org = await createOrganization({ slug: 'last-owner-demote-org', name: 'Last Owner Demote' }, testUserId);

      await expect(
        updateMemberRole(org.id, testUserId, 'admin')
      ).rejects.toThrow('Cannot demote the last owner');
    });

    it('allows demoting an owner when another owner exists', async () => {
      const org = await createOrganization({ slug: 'multi-owner-demote-org', name: 'Multi Owner Demote' }, testUserId);
      await addOrganizationMember(org.id, secondUserId, 'owner');

      const updated = await updateMemberRole(org.id, testUserId, 'admin');
      expect(updated).not.toBeNull();
      expect(updated!.role).toBe('admin');

      // secondUserId should still be owner
      const role = await getUserOrgRole(org.id, secondUserId);
      expect(role).toBe('owner');
    });

    it('allows role changes that do not affect owners', async () => {
      const org = await createOrganization({ slug: 'role-change-org', name: 'Role Change' }, testUserId);
      await addOrganizationMember(org.id, secondUserId, 'member');

      const updated = await updateMemberRole(org.id, secondUserId, 'admin');
      expect(updated).not.toBeNull();
      expect(updated!.role).toBe('admin');
    });
  });
});
