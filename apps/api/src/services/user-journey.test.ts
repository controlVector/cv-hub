/**
 * Full User Journey Integration Tests (Sprint 8 — Step 1)
 *
 * 1a. New User Onboarding — register, org creation, repo, invite flow
 * 1b. Task Board Lifecycle — create task, status transitions, listing
 * 1c. PAT Lifecycle — create, validate, revoke
 *
 * Uses `db` from '../db' directly for all data setup (same pool as services).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../db';
import {
  users,
  passwordCredentials,
} from '../db/schema';
import { authenticateUser } from './user.service';
import {
  createOrganization,
  getUserOrganizations,
  listOrganizationMembers,
  createInvite,
  acceptInviteByToken,
  getUserOrgRole,
  isOrgAdmin,
  isOrgOwner,
} from './organization.service';
import {
  createRepository,
  getUserAccessibleRepositories,
} from './repository.service';
import {
  createAgentTask,
  listAgentTasks,
  updateAgentTaskStatus,
  getAgentTask,
  cancelAgentTask,
} from './agent-task.service';
import { createToken, validateToken, revokeToken } from './pat.service';

let seq = 0;
function uid() { return `s8j_${Date.now()}_${++seq}`; }

/** Ensure all pending pool operations are flushed. */
async function sync() {
  await db.execute(/* sql */`SELECT 1`);
}

/** Create a user + password credential using the app db pool directly. */
async function createUser(
  overrides: { username: string; email: string; displayName?: string },
  password: string,
) {
  const argon2 = await import('argon2');
  const passwordHash = await argon2.hash(password);

  const [user] = await db
    .insert(users)
    .values({
      username: overrides.username,
      email: overrides.email,
      displayName: overrides.displayName ?? overrides.username,
      emailVerified: true,
    })
    .returning();

  await db.insert(passwordCredentials).values({
    userId: user.id,
    passwordHash,
  });

  // Sync to ensure writes are visible to all pool connections
  await sync();

  return user;
}

// ---------------------------------------------------------------------------
// 1a. New User Onboarding
// ---------------------------------------------------------------------------

describe('New User Onboarding Journey', () => {
  beforeAll(async () => {
    await sync();
  });

  it('completes the full onboarding lifecycle', async () => {
    const u = uid();

    // 1. Register user A
    const userA = await createUser(
      { username: `alice_${u}`, email: `alice_${u}@test.com`, displayName: 'Alice' },
      'password123',
    );
    expect(userA.id).toBeTruthy();

    // 2. Login (authenticate) user A
    const authed = await authenticateUser(`alice_${u}@test.com`, 'password123');
    expect(authed.id).toBe(userA.id);

    // 3. User has no orgs initially
    const orgs0 = await getUserOrganizations(userA.id);
    expect(orgs0).toHaveLength(0);

    // 4. Create "Acme Corp" organization
    const org = await createOrganization(
      { slug: `acme-${u}`, name: 'Acme Corp', description: 'Test org', isPublic: true },
      userA.id,
    );
    expect(org.name).toBe('Acme Corp');

    // 5. User now has one org and is owner
    const orgs1 = await getUserOrganizations(userA.id);
    expect(orgs1).toHaveLength(1);
    expect(orgs1[0].name).toBe('Acme Corp');

    const isOwner = await isOrgOwner(org.id, userA.id);
    expect(isOwner).toBe(true);

    // 6. Create a repository
    const repo = await createRepository(
      { slug: `my-app-${u}`, name: `my-app-${u}`, organizationId: org.id, visibility: 'private' },
      userA.id,
    );
    expect(repo.slug).toBe(`my-app-${u}`);

    // 7. User can see repo
    const repos = await getUserAccessibleRepositories(userA.id);
    expect(repos.length).toBeGreaterThanOrEqual(1);

    // 8. Create user B for invite flow
    const userB = await createUser(
      { username: `bob_${u}`, email: `bob_${u}@test.com`, displayName: 'Bob' },
      'password456',
    );

    // 9. Invite user B
    const invite = await createInvite(org.id, `bob_${u}@test.com`, 'member', userA.id);
    expect(invite.email).toBe(`bob_${u}@test.com`);
    expect(invite.token).toBeTruthy();

    // 10. Accept invite as user B
    const membership = await acceptInviteByToken(invite.token, userB.id, `bob_${u}@test.com`);
    expect(membership.role).toBe('member');
    expect(membership.userId).toBe(userB.id);

    // 11. User B can now see the org
    const bobOrgs = await getUserOrganizations(userB.id);
    expect(bobOrgs).toHaveLength(1);

    // 12. User B can see repos
    const bobRepos = await getUserAccessibleRepositories(userB.id);
    expect(bobRepos.length).toBeGreaterThanOrEqual(1);

    // 13. User B is member, not admin
    const bobRole = await getUserOrgRole(org.id, userB.id);
    expect(bobRole).toBe('member');
    const bobIsAdmin = await isOrgAdmin(org.id, userB.id);
    expect(bobIsAdmin).toBe(false);

    // 14. Members list shows both users
    const members = await listOrganizationMembers(org.id);
    expect(members).toHaveLength(2);
    const roles = members.map((m) => m.role).sort();
    expect(roles).toEqual(['member', 'owner']);
  });
});

// ---------------------------------------------------------------------------
// 1b. Task Board Lifecycle
// ---------------------------------------------------------------------------

describe('Task Board Lifecycle', () => {
  it('manages tasks through full board lifecycle', async () => {
    const u = uid();

    const user = await createUser(
      { username: `taskuser_${u}`, email: `taskuser_${u}@test.com` },
      'pass123',
    );

    // 1. Create tasks in different categories
    const task1 = await createAgentTask({
      userId: user.id,
      title: 'Fix login bug',
      description: 'Users get 500 on login',
      taskType: 'debug',
      priority: 'high',
    });
    expect(task1.status).toBe('pending');

    const task2 = await createAgentTask({
      userId: user.id,
      title: 'Add dark mode',
      taskType: 'code_change',
      priority: 'medium',
    });

    const task3 = await createAgentTask({
      userId: user.id,
      title: 'Deploy to staging',
      taskType: 'deploy',
      priority: 'critical',
    });

    // 2. List all tasks
    const allTasks = await listAgentTasks({ userId: user.id });
    expect(allTasks.length).toBeGreaterThanOrEqual(3);

    // 3. Move task1 to queued (To Do)
    const queued = await updateAgentTaskStatus(task1.id, user.id, 'queued');
    expect(queued!.status).toBe('queued');

    // 4. Move task1 to running (In Progress)
    const running = await updateAgentTaskStatus(task1.id, user.id, 'running');
    expect(running!.status).toBe('running');
    expect(running!.startedAt).toBeTruthy();

    // 5. Complete task1
    const completed = await updateAgentTaskStatus(task1.id, user.id, 'completed');
    expect(completed!.status).toBe('completed');
    expect(completed!.completedAt).toBeTruthy();

    // 6. Cancel task3
    const cancelled = await cancelAgentTask(task3.id, user.id);
    expect(cancelled!.status).toBe('cancelled');

    // 7. Filter by status — check that at least 1 pending task exists (task2)
    const pendingOnly = await listAgentTasks({ userId: user.id, status: ['pending'] });
    expect(pendingOnly.length).toBeGreaterThanOrEqual(1);
    expect(pendingOnly.some(t => t.title === 'Add dark mode')).toBe(true);

    // 8. Get single task
    const fetched = await getAgentTask(task1.id, user.id);
    expect(fetched!.title).toBe('Fix login bug');
    expect(fetched!.status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// 1c. PAT Lifecycle
// ---------------------------------------------------------------------------

describe('PAT Lifecycle', () => {
  it('creates, validates, and revokes a PAT', async () => {
    const u = uid();

    const user = await createUser(
      { username: `patuser_${u}`, email: `patuser_${u}@test.com` },
      'pass123',
    );

    // 1. Create PAT
    const { token, tokenInfo } = await createToken({
      userId: user.id,
      name: 'CI Token',
      scopes: ['repo:read', 'repo:write'],
      expiresInDays: 30,
    });
    expect(token).toBeTruthy();
    expect(tokenInfo.name).toBe('CI Token');

    // 2. Validate PAT
    const valid = await validateToken(token);
    expect(valid.valid).toBe(true);
    expect(valid.userId).toBe(user.id);
    expect(valid.scopes).toContain('repo:read');

    // 3. Revoke PAT
    await revokeToken(user.id, tokenInfo.id);

    // 4. Validate again — should fail
    const invalid = await validateToken(token);
    expect(invalid.valid).toBe(false);
  });
});
