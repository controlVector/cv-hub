/**
 * Multi-Tenant Isolation Tests (Sprint 8 — Step 2)
 *
 * Proves that data from Org A never leaks to Org B, and User A
 * cannot access User B's private resources.
 *
 * Uses the same patterns as existing passing tests:
 * - truncateAllTables() in beforeEach (from test-db, uses getTestDb pool)
 * - createUser() from user.service (uses db pool)
 * - createOrganization() from organization.service (uses db pool)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createUser } from './user.service';
import {
  createOrganization,
  getUserOrganizations,
  getUserOrgRole,
  isOrgOwner,
  createInvite,
  acceptInviteByToken,
} from './organization.service';
import {
  createRepository,
  getUserAccessibleRepositories,
  canUserAccessRepo,
} from './repository.service';
import {
  createAgentTask,
  listAgentTasks,
  getAgentTask,
} from './agent-task.service';
import { createToken, validateToken, revokeToken, listTokens } from './pat.service';
import { getOrgTierInfo, getOrgUsage, checkOrgRepoLimit } from './tier-limits.service';
import { sql } from 'drizzle-orm';
import { db } from '../db';

let seq = 0;
function uid() { return `mt_${Date.now()}_${++seq}`; }

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

// Shared test state — set up fresh in each beforeEach
let alice: { id: string; email: string };
let bob: { id: string; email: string };

// ---------------------------------------------------------------------------
// 2a. Organization Isolation
// ---------------------------------------------------------------------------

describe('Organization Isolation', () => {
  beforeEach(async () => {
    await cleanDb();
    const u = uid();
    alice = await createUser({ email: `alice_${u}@test.com`, username: `alice_${u}`, password: 'pass123' });
    bob = await createUser({ email: `bob_${u}@test.com`, username: `bob_${u}`, password: 'pass123' });
  });

  it('user A cannot see orgs they are not a member of', async () => {
    const u = uid();
    const orgA = await createOrganization({ slug: `org-a-${u}`, name: 'Org A', isPublic: false }, alice.id);
    const orgB = await createOrganization({ slug: `org-b-${u}`, name: 'Org B', isPublic: false }, bob.id);

    // Alice only sees Org A
    const aliceOrgs = await getUserOrganizations(alice.id);
    expect(aliceOrgs.map(o => o.id)).toContain(orgA.id);
    expect(aliceOrgs.map(o => o.id)).not.toContain(orgB.id);

    // Bob only sees Org B
    const bobOrgs = await getUserOrganizations(bob.id);
    expect(bobOrgs.map(o => o.id)).toContain(orgB.id);
    expect(bobOrgs.map(o => o.id)).not.toContain(orgA.id);

    // Cross-org role checks return null
    expect(await getUserOrgRole(orgB.id, alice.id)).toBeNull();
    expect(await getUserOrgRole(orgA.id, bob.id)).toBeNull();
    expect(await isOrgOwner(orgA.id, bob.id)).toBe(false);
  });

  it('invite scoped to correct email — wrong user cannot accept', async () => {
    const u = uid();
    const charlie = await createUser({ email: `charlie_${u}@test.com`, username: `charlie_${u}`, password: 'pass123' });

    const org = await createOrganization({ slug: `invite-org-${u}`, name: 'Invite Org', isPublic: true }, alice.id);
    const invite = await createInvite(org.id, bob.email, 'member', alice.id);

    // Charlie tries to accept with wrong email — should fail
    await expect(
      acceptInviteByToken(invite.token, charlie.id, charlie.email),
    ).rejects.toThrow();

    // Bob can accept with correct email
    const membership = await acceptInviteByToken(invite.token, bob.id, bob.email);
    expect(membership.userId).toBe(bob.id);
  });
});

// ---------------------------------------------------------------------------
// 2b. Repository Isolation
// ---------------------------------------------------------------------------

describe('Repository Isolation', () => {
  beforeEach(async () => {
    await cleanDb();
    const u = uid();
    alice = await createUser({ email: `alice_${u}@test.com`, username: `alice_${u}`, password: 'pass123' });
    bob = await createUser({ email: `bob_${u}@test.com`, username: `bob_${u}`, password: 'pass123' });
  });

  it('user cannot access another org private repo', async () => {
    const u = uid();
    const orgA = await createOrganization({ slug: `repo-a-${u}`, name: 'Org A', isPublic: true }, alice.id);
    const orgB = await createOrganization({ slug: `repo-b-${u}`, name: 'Org B', isPublic: true }, bob.id);

    const repoA = await createRepository(
      { slug: `priv-a-${u}`, name: `priv-a-${u}`, organizationId: orgA.id, visibility: 'private' },
      alice.id,
    );
    const repoB = await createRepository(
      { slug: `priv-b-${u}`, name: `priv-b-${u}`, organizationId: orgB.id, visibility: 'private' },
      bob.id,
    );

    // Cross-org access denied
    expect(await canUserAccessRepo(repoB.id, alice.id)).toBe(false);
    expect(await canUserAccessRepo(repoA.id, bob.id)).toBe(false);

    // Each user only sees their own org's repos
    const aliceRepos = await getUserAccessibleRepositories(alice.id);
    expect(aliceRepos.map(r => r.id)).toContain(repoA.id);
    expect(aliceRepos.map(r => r.id)).not.toContain(repoB.id);
  });

  it('org member can access org repo, non-member cannot', async () => {
    const u = uid();
    const outsider = await createUser({ email: `outsider_${u}@test.com`, username: `outsider_${u}`, password: 'pass123' });

    const org = await createOrganization({ slug: `shared-${u}`, name: 'Shared Org', isPublic: true }, alice.id);
    const invite = await createInvite(org.id, bob.email, 'member', alice.id);
    await acceptInviteByToken(invite.token, bob.id, bob.email);

    // Internal repo: org members can access, outsiders cannot
    const internalRepo = await createRepository(
      { slug: `internal-${u}`, name: `internal-${u}`, organizationId: org.id, visibility: 'internal' },
      alice.id,
    );

    // Org members can access internal repos
    expect(await canUserAccessRepo(internalRepo.id, alice.id)).toBe(true);
    expect(await canUserAccessRepo(internalRepo.id, bob.id)).toBe(true);

    // Outsider cannot access internal repos
    expect(await canUserAccessRepo(internalRepo.id, outsider.id)).toBe(false);

    // Private repo: requires direct membership, even org members are blocked
    const privateRepo = await createRepository(
      { slug: `private-${u}`, name: `private-${u}`, organizationId: org.id, visibility: 'private' },
      alice.id,
    );
    expect(await canUserAccessRepo(privateRepo.id, alice.id)).toBe(true);    // creator/owner
    expect(await canUserAccessRepo(privateRepo.id, bob.id)).toBe(false);     // org member but not repo member
    expect(await canUserAccessRepo(privateRepo.id, outsider.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2c. Task Isolation
// ---------------------------------------------------------------------------

describe('Task Isolation', () => {
  beforeEach(async () => {
    await cleanDb();
    const u = uid();
    alice = await createUser({ email: `alice_${u}@test.com`, username: `alice_${u}`, password: 'pass123' });
    bob = await createUser({ email: `bob_${u}@test.com`, username: `bob_${u}`, password: 'pass123' });
  });

  it('user cannot access another user tasks', async () => {
    const u = uid();

    const taskA = await createAgentTask({
      userId: alice.id,
      title: `Alice task ${u}`,
      taskType: 'code_change',
      priority: 'medium',
    });

    const taskB = await createAgentTask({
      userId: bob.id,
      title: `Bob task ${u}`,
      taskType: 'debug',
      priority: 'high',
    });

    // Cross-user access denied (getAgentTask returns undefined for no match)
    expect(await getAgentTask(taskB.id, alice.id)).toBeUndefined();
    expect(await getAgentTask(taskA.id, bob.id)).toBeUndefined();

    // Each user lists only their own tasks
    const aliceTasks = await listAgentTasks({ userId: alice.id });
    expect(aliceTasks.some(t => t.title === `Alice task ${u}`)).toBe(true);
    expect(aliceTasks.some(t => t.title === `Bob task ${u}`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2d. PAT Isolation
// ---------------------------------------------------------------------------

describe('PAT Isolation', () => {
  beforeEach(async () => {
    await cleanDb();
    const u = uid();
    alice = await createUser({ email: `alice_${u}@test.com`, username: `alice_${u}`, password: 'pass123' });
    bob = await createUser({ email: `bob_${u}@test.com`, username: `bob_${u}`, password: 'pass123' });
  });

  it('tokens resolve to correct owner, not other users', async () => {
    const { token: aliceToken } = await createToken({
      userId: alice.id,
      name: 'Alice Token',
      scopes: ['repo:read'],
      expiresInDays: 30,
    });

    const { token: bobToken } = await createToken({
      userId: bob.id,
      name: 'Bob Token',
      scopes: ['repo:read'],
      expiresInDays: 30,
    });

    const aliceValid = await validateToken(aliceToken);
    expect(aliceValid.valid).toBe(true);
    expect(aliceValid.userId).toBe(alice.id);

    const bobValid = await validateToken(bobToken);
    expect(bobValid.valid).toBe(true);
    expect(bobValid.userId).toBe(bob.id);
  });

  it('user cannot list or revoke another user tokens', async () => {
    const { tokenInfo: aliceInfo } = await createToken({
      userId: alice.id,
      name: 'Alice Token',
      scopes: ['repo:read'],
      expiresInDays: 30,
    });

    const { tokenInfo: bobInfo } = await createToken({
      userId: bob.id,
      name: 'Bob Token',
      scopes: ['repo:read'],
      expiresInDays: 30,
    });

    // Alice's list excludes Bob's token
    const aliceTokens = await listTokens(alice.id);
    expect(aliceTokens.map(t => t.id)).toContain(aliceInfo.id);
    expect(aliceTokens.map(t => t.id)).not.toContain(bobInfo.id);

    // Bob cannot revoke Alice's token
    await expect(revokeToken(bob.id, aliceInfo.id)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2e. Billing Isolation
// ---------------------------------------------------------------------------

describe('Billing Isolation', () => {
  beforeEach(async () => {
    await cleanDb();
    const u = uid();
    alice = await createUser({ email: `alice_${u}@test.com`, username: `alice_${u}`, password: 'pass123' });
    bob = await createUser({ email: `bob_${u}@test.com`, username: `bob_${u}`, password: 'pass123' });
  });

  it('org A usage does not count toward org B limits', async () => {
    const u = uid();
    const orgA = await createOrganization({ slug: `billing-a-${u}`, name: 'Billing A', isPublic: true }, alice.id);
    const orgB = await createOrganization({ slug: `billing-b-${u}`, name: 'Billing B', isPublic: true }, bob.id);

    // Create repos in Org A only
    await createRepository(
      { slug: `r1-${u}`, name: `r1-${u}`, organizationId: orgA.id, visibility: 'private' },
      alice.id,
    );
    await createRepository(
      { slug: `r2-${u}`, name: `r2-${u}`, organizationId: orgA.id, visibility: 'private' },
      alice.id,
    );

    // Org A has repos
    const usageA = await getOrgUsage(orgA.id);
    expect(Number(usageA.repos)).toBeGreaterThanOrEqual(2);

    // Org B has zero repos (Org A's repos don't leak)
    const usageB = await getOrgUsage(orgB.id);
    expect(Number(usageB.repos)).toBe(0);

    // Each org has independent tier info
    const tierA = await getOrgTierInfo(orgA.id);
    const tierB = await getOrgTierInfo(orgB.id);
    expect(tierA.tierName).toBe('starter');
    expect(tierB.tierName).toBe('starter');

    // Org B can still create repos (not limited by Org A's usage)
    const limitCheckB = await checkOrgRepoLimit(orgB.id);
    expect(limitCheckB.allowed).toBe(true);
  });
});
