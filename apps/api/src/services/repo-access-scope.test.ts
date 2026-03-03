/**
 * Repository Access Scoping Tests
 *
 * Verifies that getUserAccessibleRepositories does NOT leak public repos
 * from other users/orgs. Only returns repos the user owns, is a member of,
 * or belongs to the user's organizations.
 *
 * Search mode: also includes matching public repos for discovery.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createUser } from './user.service';
import { createOrganization } from './organization.service';
import {
  createRepository,
  getUserAccessibleRepositories,
} from './repository.service';

let seq = 0;
function uid() { return `ras_${Date.now()}_${++seq}`; }

describe('Repository Access Scoping', () => {
  let userA: { id: string };
  let userB: { id: string };
  let orgA: { id: string };

  beforeEach(async () => {
    const u = uid();
    // User A owns org A
    userA = await createUser({ email: `a_${u}@test.com`, username: `a_${u}`, password: 'pass123' });
    orgA = await createOrganization({ slug: `org-a-${u}`, name: 'Org A', isPublic: true }, userA.id);

    // User B is a stranger — no orgs, no memberships
    userB = await createUser({ email: `b_${u}@test.com`, username: `b_${u}`, password: 'pass123' });
  });

  it('user with no repos gets empty list', async () => {
    const repos = await getUserAccessibleRepositories(userB.id);
    expect(repos).toEqual([]);
  });

  it('does not return public repos from other users', async () => {
    const u = uid();
    // User A creates a public repo
    await createRepository(
      { slug: `pub-${u}`, name: `pub-${u}`, organizationId: orgA.id, visibility: 'public' },
      userA.id,
    );

    // User B should NOT see it in their list
    const repos = await getUserAccessibleRepositories(userB.id);
    const slugs = repos.map((r) => r.slug);
    expect(slugs).not.toContain(`pub-${u}`);
  });

  it('does not return private repos from other users', async () => {
    const u = uid();
    await createRepository(
      { slug: `priv-${u}`, name: `priv-${u}`, organizationId: orgA.id, visibility: 'private' },
      userA.id,
    );

    const repos = await getUserAccessibleRepositories(userB.id);
    const slugs = repos.map((r) => r.slug);
    expect(slugs).not.toContain(`priv-${u}`);
  });

  it('owner sees their own repos', async () => {
    const u = uid();
    await createRepository(
      { slug: `own-${u}`, name: `own-${u}`, organizationId: orgA.id, visibility: 'private' },
      userA.id,
    );

    const repos = await getUserAccessibleRepositories(userA.id);
    const slugs = repos.map((r) => r.slug);
    expect(slugs).toContain(`own-${u}`);
  });

  it('search finds matching public repos from other users', async () => {
    const u = uid();
    await createRepository(
      { slug: `searchable-${u}`, name: `Searchable ${u}`, organizationId: orgA.id, visibility: 'public' },
      userA.id,
    );

    // User B searches — should find the public repo
    const repos = await getUserAccessibleRepositories(userB.id, { search: `searchable-${u}` });
    const slugs = repos.map((r) => r.slug);
    expect(slugs).toContain(`searchable-${u}`);
  });

  it('search does not find private repos from other users', async () => {
    const u = uid();
    await createRepository(
      { slug: `secret-${u}`, name: `secret-${u}`, organizationId: orgA.id, visibility: 'private' },
      userA.id,
    );

    const repos = await getUserAccessibleRepositories(userB.id, { search: `secret-${u}` });
    const slugs = repos.map((r) => r.slug);
    expect(slugs).not.toContain(`secret-${u}`);
  });

  it('org member sees org repos without search', async () => {
    const u = uid();
    // User A already owns orgA. Create a private repo in orgA.
    await createRepository(
      { slug: `org-repo-${u}`, name: `org-repo-${u}`, organizationId: orgA.id, visibility: 'private' },
      userA.id,
    );

    // User A should see it (they're an org member/owner)
    const repos = await getUserAccessibleRepositories(userA.id);
    const slugs = repos.map((r) => r.slug);
    expect(slugs).toContain(`org-repo-${u}`);
  });

  it('non-member does not see org private repos even with search', async () => {
    const u = uid();
    await createRepository(
      { slug: `orgpriv-${u}`, name: `orgpriv-${u}`, organizationId: orgA.id, visibility: 'private' },
      userA.id,
    );

    const repos = await getUserAccessibleRepositories(userB.id, { search: `orgpriv-${u}` });
    const slugs = repos.map((r) => r.slug);
    expect(slugs).not.toContain(`orgpriv-${u}`);
  });
});
