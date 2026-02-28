/**
 * Error State & Edge Case Tests (Sprint 8 — Step 3)
 *
 * 3a. Auth errors — invalid credentials, expired tokens
 * 3b. Validation errors — duplicate emails, weak input
 * 3c. Organization edge cases — last-owner protection, invite boundaries
 * 3d. Concurrency — double invite, double revoke
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createUser, authenticateUser } from './user.service';
import {
  createOrganization,
  createInvite,
  acceptInviteByToken,
  updateMemberRole,
  removeOrganizationMember,
} from './organization.service';
import { createToken, validateToken, revokeToken } from './pat.service';
import { createRepository, canUserAccessRepo } from './repository.service';
import { sql } from 'drizzle-orm';
import { db } from '../db';

let seq = 0;
function uid() { return `err_${Date.now()}_${++seq}`; }

/** Truncate all tables using the app db pool (same pool as services). */
async function cleanDb() {
  const tables = await db.execute(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename NOT IN ('drizzle_migrations', '__drizzle_migrations')
  `);
  if (tables.rows.length === 0) return;
  const names = (tables.rows as { tablename: string }[])
    .map(r => `"${r.tablename}"`).join(', ');
  await db.execute(sql.raw(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`));
}

// ---------------------------------------------------------------------------
// 3a. Auth Errors
// ---------------------------------------------------------------------------

describe('Auth Error States', () => {
  let userId: string;

  beforeEach(async () => {
    await cleanDb();
    const u = uid();
    const user = await createUser({ email: `auth_${u}@test.com`, username: `auth_${u}`, password: 'correct_pass123' });
    userId = user.id;
  });

  it('rejects login with wrong password', async () => {
    const u = `auth_${Date.now()}_find`;
    const user = await createUser({ email: `wrong_${u}@test.com`, username: `wrong_${u}`, password: 'correct_pass' });
    await expect(
      authenticateUser(`wrong_${u}@test.com`, 'wrong_pass'),
    ).rejects.toThrow(/invalid email or password/i);
  });

  it('rejects login for non-existent user', async () => {
    await expect(
      authenticateUser('nobody@nowhere.com', 'any_pass'),
    ).rejects.toThrow(/invalid email or password/i);
  });

  it('validates and rejects invalid PAT format', async () => {
    const result = await validateToken('not_a_real_token');
    expect(result.valid).toBe(false);
  });

  it('validates and rejects revoked PAT', async () => {
    const { token, tokenInfo } = await createToken({
      userId,
      name: 'Revoked Token',
      scopes: ['repo:read'],
      expiresInDays: 30,
    });
    await revokeToken(userId, tokenInfo.id);
    const result = await validateToken(token);
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3b. Validation Errors
// ---------------------------------------------------------------------------

describe('Validation Error States', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  it('rejects duplicate email on registration', async () => {
    const u = uid();
    await createUser({ email: `dup_${u}@test.com`, username: `dup1_${u}`, password: 'pass123' });
    await expect(
      createUser({ email: `dup_${u}@test.com`, username: `dup2_${u}`, password: 'pass123' }),
    ).rejects.toThrow(/already in use/i);
  });

  it('rejects duplicate username on registration', async () => {
    const u = uid();
    await createUser({ email: `user1_${u}@test.com`, username: `sameuser_${u}`, password: 'pass123' });
    await expect(
      createUser({ email: `user2_${u}@test.com`, username: `sameuser_${u}`, password: 'pass123' }),
    ).rejects.toThrow(/already in use/i);
  });

  it('rejects PAT with invalid scopes', async () => {
    const u = uid();
    const user = await createUser({ email: `scope_${u}@test.com`, username: `scope_${u}`, password: 'pass123' });
    await expect(
      createToken({ userId: user.id, name: 'Bad Scope', scopes: ['nonexistent:scope'], expiresInDays: 30 }),
    ).rejects.toThrow();
  });

  it('rejects PAT with empty name', async () => {
    const u = uid();
    const user = await createUser({ email: `name_${u}@test.com`, username: `name_${u}`, password: 'pass123' });
    await expect(
      createToken({ userId: user.id, name: '', scopes: ['repo:read'], expiresInDays: 30 }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3c. Organization Edge Cases
// ---------------------------------------------------------------------------

describe('Organization Edge Cases', () => {
  let ownerId: string;
  let memberId: string;
  let orgId: string;

  beforeEach(async () => {
    await cleanDb();
    const u = uid();
    const owner = await createUser({ email: `owner_${u}@test.com`, username: `owner_${u}`, password: 'pass123' });
    ownerId = owner.id;

    const member = await createUser({ email: `member_${u}@test.com`, username: `member_${u}`, password: 'pass123' });
    memberId = member.id;

    const org = await createOrganization({ slug: `edge-org-${u}`, name: 'Edge Org', isPublic: true }, ownerId);
    orgId = org.id;

    // Add member via invite flow
    const invite = await createInvite(orgId, `member_${u}@test.com`, 'member', ownerId);
    await acceptInviteByToken(invite.token, memberId, `member_${u}@test.com`);
  });

  it('prevents demoting last owner', async () => {
    await expect(
      updateMemberRole(orgId, ownerId, 'member'),
    ).rejects.toThrow(/last owner/i);
  });

  it('prevents removing last owner', async () => {
    await expect(
      removeOrganizationMember(orgId, ownerId),
    ).rejects.toThrow(/last owner/i);
  });

  it('allows demoting owner when another owner exists', async () => {
    // Promote member to owner first
    await updateMemberRole(orgId, memberId, 'owner');
    // Now we can demote the original owner
    const result = await updateMemberRole(orgId, ownerId, 'admin');
    expect(result!.role).toBe('admin');
  });

  it('prevents inviting with owner role', async () => {
    const u = uid();
    await expect(
      createInvite(orgId, `new_${u}@test.com`, 'owner', ownerId),
    ).rejects.toThrow();
  });

  it('prevents duplicate pending invite for same email', async () => {
    const u = uid();
    const email = `invite_${u}@test.com`;
    await createInvite(orgId, email, 'member', ownerId);
    await expect(
      createInvite(orgId, email, 'member', ownerId),
    ).rejects.toThrow(/pending invite already exists/i);
  });

  it('rejects accepting invite with mismatched email', async () => {
    const u = uid();
    const newUser = await createUser({ email: `real_${u}@test.com`, username: `real_${u}`, password: 'pass123' });
    const invite = await createInvite(orgId, `fake_${u}@test.com`, 'member', ownerId);

    await expect(
      acceptInviteByToken(invite.token, newUser.id, `real_${u}@test.com`),
    ).rejects.toThrow();
  });

  it('rejects accepting already-accepted invite', async () => {
    const u = uid();
    const newUser = await createUser({ email: `accept_${u}@test.com`, username: `accept_${u}`, password: 'pass123' });
    const invite = await createInvite(orgId, `accept_${u}@test.com`, 'member', ownerId);

    // First accept succeeds
    await acceptInviteByToken(invite.token, newUser.id, `accept_${u}@test.com`);

    // Second accept rejects
    await expect(
      acceptInviteByToken(invite.token, newUser.id, `accept_${u}@test.com`),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3d. Concurrency & Double Operations
// ---------------------------------------------------------------------------

describe('Concurrency Edge Cases', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  it('double-revoking a PAT fails on second attempt', async () => {
    const u = uid();
    const user = await createUser({ email: `rev_${u}@test.com`, username: `rev_${u}`, password: 'pass123' });
    const { token, tokenInfo } = await createToken({
      userId: user.id,
      name: 'Double Revoke',
      scopes: ['repo:read'],
      expiresInDays: 30,
    });

    // First revoke succeeds
    await revokeToken(user.id, tokenInfo.id);

    // Second revoke throws
    await expect(
      revokeToken(user.id, tokenInfo.id),
    ).rejects.toThrow();
  });

  it('access check on non-existent repo returns false', async () => {
    const u = uid();
    const user = await createUser({ email: `noexist_${u}@test.com`, username: `noexist_${u}`, password: 'pass123' });
    const result = await canUserAccessRepo('00000000-0000-0000-0000-000000000000', user.id);
    expect(result).toBe(false);
  });
});
