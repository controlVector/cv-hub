import { eq, and, desc, sql, ilike, or, isNull } from 'drizzle-orm';
import { db } from '../db';
import {
  repositories,
  repositoryMembers,
  branches,
  repoStars,
  repoWatchers,
  organizations,
  users,
  type Repository,
  type NewRepository,
  type RepositoryMember,
  type NewRepositoryMember,
  type Branch,
  type RepoRole,
  type RepoVisibility,
  type RepoProvider,
} from '../db/schema';
import { logger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface RepositoryWithOwner extends Repository {
  owner: {
    type: 'organization' | 'user';
    id: string;
    slug: string;
    name: string;
    avatarUrl: string | null;
    isVerified?: boolean;
  } | null;
}

export interface RepositoryWithStats extends RepositoryWithOwner {
  branchCount: number;
}

export interface RepositoryListFilters {
  organizationId?: string;
  userId?: string;
  visibility?: RepoVisibility;
  provider?: RepoProvider;
  search?: string;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Repository CRUD
// ============================================================================

/**
 * Get owner info helper
 */
async function getOwnerInfo(repo: Repository): Promise<RepositoryWithOwner['owner']> {
  if (repo.organizationId) {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, repo.organizationId),
    });
    if (org) {
      return {
        type: 'organization',
        id: org.id,
        slug: org.slug,
        name: org.name,
        avatarUrl: org.logoUrl,
        isVerified: org.isVerified,
      };
    }
  } else if (repo.userId) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, repo.userId),
    });
    if (user) {
      return {
        type: 'user',
        id: user.id,
        slug: user.username,
        name: user.displayName || user.username,
        avatarUrl: user.avatarUrl,
      };
    }
  }
  return null;
}

/**
 * List repositories with filters
 */
export async function listRepositories(filters: RepositoryListFilters = {}): Promise<RepositoryWithStats[]> {
  const {
    organizationId,
    userId,
    visibility,
    provider,
    search,
    includeArchived = false,
    limit = 50,
    offset = 0,
  } = filters;

  const conditions = [];

  if (organizationId) conditions.push(eq(repositories.organizationId, organizationId));
  if (userId) conditions.push(eq(repositories.userId, userId));
  if (visibility) conditions.push(eq(repositories.visibility, visibility));
  if (provider) conditions.push(eq(repositories.provider, provider));
  if (!includeArchived) conditions.push(eq(repositories.isArchived, false));

  if (search) {
    conditions.push(
      or(
        ilike(repositories.name, `%${search}%`),
        ilike(repositories.slug, `%${search}%`),
        ilike(repositories.description, `%${search}%`)
      )!
    );
  }

  const repoList = await db.query.repositories.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(repositories.starCount), desc(repositories.updatedAt)],
    limit,
    offset,
  });

  const reposWithStats: RepositoryWithStats[] = [];
  for (const repo of repoList) {
    const owner = await getOwnerInfo(repo);

    const [branchStats] = await db
      .select({ count: sql<number>`count(*)` })
      .from(branches)
      .where(eq(branches.repositoryId, repo.id));

    reposWithStats.push({
      ...repo,
      owner,
      branchCount: Number(branchStats?.count || 0),
    });
  }

  return reposWithStats;
}

/**
 * List public repositories
 */
export async function listPublicRepositories(filters: Omit<RepositoryListFilters, 'visibility'> = {}): Promise<RepositoryWithStats[]> {
  return listRepositories({ ...filters, visibility: 'public' });
}

/**
 * Get repository by ID
 */
export async function getRepositoryById(repoId: string): Promise<RepositoryWithStats | null> {
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repoId),
  });

  if (!repo) return null;

  const owner = await getOwnerInfo(repo);

  const [branchStats] = await db
    .select({ count: sql<number>`count(*)` })
    .from(branches)
    .where(eq(branches.repositoryId, repo.id));

  return {
    ...repo,
    owner,
    branchCount: Number(branchStats?.count || 0),
  };
}

/**
 * Get repository by owner and slug (e.g., "controlvector/cv-git")
 */
export async function getRepositoryByOwnerAndSlug(
  ownerSlug: string,
  repoSlug: string
): Promise<RepositoryWithStats | null> {
  // Try organization first
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.slug, ownerSlug),
  });

  if (org) {
    const repo = await db.query.repositories.findFirst({
      where: and(
        eq(repositories.organizationId, org.id),
        eq(repositories.slug, repoSlug)
      ),
    });

    if (repo) {
      const [branchStats] = await db
        .select({ count: sql<number>`count(*)` })
        .from(branches)
        .where(eq(branches.repositoryId, repo.id));

      return {
        ...repo,
        owner: {
          type: 'organization',
          id: org.id,
          slug: org.slug,
          name: org.name,
          avatarUrl: org.logoUrl,
          isVerified: org.isVerified,
        },
        branchCount: Number(branchStats?.count || 0),
      };
    }
  }

  // Try user
  const user = await db.query.users.findFirst({
    where: eq(users.username, ownerSlug),
  });

  if (user) {
    const repo = await db.query.repositories.findFirst({
      where: and(
        eq(repositories.userId, user.id),
        eq(repositories.slug, repoSlug)
      ),
    });

    if (repo) {
      const [branchStats] = await db
        .select({ count: sql<number>`count(*)` })
        .from(branches)
        .where(eq(branches.repositoryId, repo.id));

      return {
        ...repo,
        owner: {
          type: 'user',
          id: user.id,
          slug: user.username,
          name: user.displayName || user.username,
          avatarUrl: user.avatarUrl,
        },
        branchCount: Number(branchStats?.count || 0),
      };
    }
  }

  return null;
}

/**
 * Create a new repository
 */
export async function createRepository(
  input: NewRepository,
  creatorUserId: string
): Promise<Repository> {
  // Auto-generate slug if not provided
  const slug = input.slug || input.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  const [repo] = await db.insert(repositories).values({
    ...input,
    slug,
  }).returning();

  // Add creator as admin
  await db.insert(repositoryMembers).values({
    repositoryId: repo.id,
    userId: creatorUserId,
    role: 'admin',
    acceptedAt: new Date(),
  });

  // Create default branch entry
  await db.insert(branches).values({
    repositoryId: repo.id,
    name: repo.defaultBranch,
    sha: '0000000000000000000000000000000000000000', // Placeholder until first push
    isDefault: true,
  });

  logger.info('general', 'Repository created', {
    repoId: repo.id,
    slug: repo.slug,
    creatorId: creatorUserId,
  });

  return repo;
}

/**
 * Update repository
 */
export async function updateRepository(
  repoId: string,
  updates: Partial<NewRepository>
): Promise<Repository | null> {
  const [repo] = await db
    .update(repositories)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(repositories.id, repoId))
    .returning();

  if (repo) {
    logger.info('general', 'Repository updated', { repoId });
  }

  return repo ?? null;
}

/**
 * Delete repository
 */
export async function deleteRepository(repoId: string): Promise<boolean> {
  const result = await db
    .delete(repositories)
    .where(eq(repositories.id, repoId))
    .returning({ id: repositories.id });

  if (result.length > 0) {
    logger.info('general', 'Repository deleted', { repoId });
    return true;
  }
  return false;
}

/**
 * Archive/unarchive repository
 */
export async function setRepositoryArchived(repoId: string, archived: boolean): Promise<Repository | null> {
  const [repo] = await db
    .update(repositories)
    .set({
      isArchived: archived,
      archivedAt: archived ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, repoId))
    .returning();

  if (repo) {
    logger.info('general', `Repository ${archived ? 'archived' : 'unarchived'}`, { repoId });
  }

  return repo ?? null;
}

// ============================================================================
// Repository Members / Access Control
// ============================================================================

export interface MemberWithUser extends RepositoryMember {
  user: {
    id: string;
    username: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

/**
 * List repository members
 */
export async function listRepositoryMembers(repoId: string): Promise<MemberWithUser[]> {
  const members = await db.query.repositoryMembers.findMany({
    where: eq(repositoryMembers.repositoryId, repoId),
    with: {
      user: {
        columns: {
          id: true,
          username: true,
          email: true,
          displayName: true,
          avatarUrl: true,
        },
      },
    },
    orderBy: [desc(repositoryMembers.createdAt)],
  });

  return members as MemberWithUser[];
}

/**
 * Get user's role in repository
 */
export async function getUserRepoRole(repoId: string, userId: string): Promise<RepoRole | null> {
  const member = await db.query.repositoryMembers.findFirst({
    where: and(
      eq(repositoryMembers.repositoryId, repoId),
      eq(repositoryMembers.userId, userId)
    ),
  });

  return member?.role ?? null;
}

/**
 * Check if user can access repository
 */
export async function canUserAccessRepo(repoId: string, userId: string | null): Promise<boolean> {
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repoId),
  });

  if (!repo) return false;

  // Public repos are accessible to everyone
  if (repo.visibility === 'public') return true;

  // For non-public repos, user must be authenticated
  if (!userId) return false;

  // Check if user is a direct member
  const directMember = await getUserRepoRole(repoId, userId);
  if (directMember) return true;

  // For internal repos, check if user is in the org
  if (repo.visibility === 'internal' && repo.organizationId) {
    const { getUserOrgRole } = await import('./organization.service');
    const orgRole = await getUserOrgRole(repo.organizationId, userId);
    if (orgRole) return true;
  }

  // Check if user is the owner
  if (repo.userId === userId) return true;

  return false;
}

/**
 * Check if user can write to repository
 */
export async function canUserWriteToRepo(repoId: string, userId: string): Promise<boolean> {
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repoId),
  });

  if (!repo) return false;

  // Check if repo is archived
  if (repo.isArchived) return false;

  // Check if user is the owner
  if (repo.userId === userId) return true;

  // Check direct member role
  const directRole = await getUserRepoRole(repoId, userId);
  if (directRole === 'admin' || directRole === 'write') return true;

  // Check org membership
  if (repo.organizationId) {
    const { isOrgAdmin } = await import('./organization.service');
    if (await isOrgAdmin(repo.organizationId, userId)) return true;
  }

  return false;
}

/**
 * Check if user is repo admin
 */
export async function isRepoAdmin(repoId: string, userId: string): Promise<boolean> {
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repoId),
  });

  if (!repo) return false;

  // Check if user is the owner
  if (repo.userId === userId) return true;

  // Check direct member role
  const directRole = await getUserRepoRole(repoId, userId);
  if (directRole === 'admin') return true;

  // Check org admin
  if (repo.organizationId) {
    const { isOrgAdmin } = await import('./organization.service');
    if (await isOrgAdmin(repo.organizationId, userId)) return true;
  }

  return false;
}

/**
 * Add member to repository
 */
export async function addRepositoryMember(
  repoId: string,
  userId: string,
  role: RepoRole = 'read',
  invitedBy?: string
): Promise<RepositoryMember> {
  const [member] = await db
    .insert(repositoryMembers)
    .values({
      repositoryId: repoId,
      userId,
      role,
      invitedBy,
      invitedAt: invitedBy ? new Date() : undefined,
      acceptedAt: !invitedBy ? new Date() : undefined,
    })
    .returning();

  logger.info('general', 'Repository member added', { repoId, userId, role });
  return member;
}

/**
 * Update member role
 */
export async function updateRepositoryMemberRole(
  repoId: string,
  userId: string,
  newRole: RepoRole
): Promise<RepositoryMember | null> {
  const [member] = await db
    .update(repositoryMembers)
    .set({ role: newRole, updatedAt: new Date() })
    .where(
      and(
        eq(repositoryMembers.repositoryId, repoId),
        eq(repositoryMembers.userId, userId)
      )
    )
    .returning();

  if (member) {
    logger.info('general', 'Repository member role updated', { repoId, userId, newRole });
  }

  return member ?? null;
}

/**
 * Remove member from repository
 */
export async function removeRepositoryMember(repoId: string, userId: string): Promise<boolean> {
  const result = await db
    .delete(repositoryMembers)
    .where(
      and(
        eq(repositoryMembers.repositoryId, repoId),
        eq(repositoryMembers.userId, userId)
      )
    )
    .returning({ id: repositoryMembers.id });

  if (result.length > 0) {
    logger.info('general', 'Repository member removed', { repoId, userId });
    return true;
  }
  return false;
}

// ============================================================================
// Stars & Watchers
// ============================================================================

/**
 * Star a repository
 */
export async function starRepository(repoId: string, userId: string): Promise<boolean> {
  try {
    await db.insert(repoStars).values({
      repositoryId: repoId,
      userId,
    });

    // Increment star count
    await db
      .update(repositories)
      .set({
        starCount: sql`${repositories.starCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, repoId));

    logger.info('general', 'Repository starred', { repoId, userId });
    return true;
  } catch (error) {
    // Likely already starred (unique constraint)
    return false;
  }
}

/**
 * Unstar a repository
 */
export async function unstarRepository(repoId: string, userId: string): Promise<boolean> {
  const result = await db
    .delete(repoStars)
    .where(
      and(
        eq(repoStars.repositoryId, repoId),
        eq(repoStars.userId, userId)
      )
    )
    .returning({ id: repoStars.id });

  if (result.length > 0) {
    // Decrement star count
    await db
      .update(repositories)
      .set({
        starCount: sql`${repositories.starCount} - 1`,
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, repoId));

    logger.info('general', 'Repository unstarred', { repoId, userId });
    return true;
  }
  return false;
}

/**
 * Check if user has starred a repository
 */
export async function hasUserStarredRepo(repoId: string, userId: string): Promise<boolean> {
  const star = await db.query.repoStars.findFirst({
    where: and(
      eq(repoStars.repositoryId, repoId),
      eq(repoStars.userId, userId)
    ),
  });

  return !!star;
}

/**
 * Watch a repository
 */
export async function watchRepository(
  repoId: string,
  userId: string,
  watchLevel: string = 'all'
): Promise<boolean> {
  try {
    await db.insert(repoWatchers).values({
      repositoryId: repoId,
      userId,
      watchLevel,
    });

    // Increment watcher count
    await db
      .update(repositories)
      .set({
        watcherCount: sql`${repositories.watcherCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, repoId));

    logger.info('general', 'Repository watched', { repoId, userId, watchLevel });
    return true;
  } catch (error) {
    // Already watching - update watch level
    await db
      .update(repoWatchers)
      .set({ watchLevel, updatedAt: new Date() })
      .where(
        and(
          eq(repoWatchers.repositoryId, repoId),
          eq(repoWatchers.userId, userId)
        )
      );
    return true;
  }
}

/**
 * Unwatch a repository
 */
export async function unwatchRepository(repoId: string, userId: string): Promise<boolean> {
  const result = await db
    .delete(repoWatchers)
    .where(
      and(
        eq(repoWatchers.repositoryId, repoId),
        eq(repoWatchers.userId, userId)
      )
    )
    .returning({ id: repoWatchers.id });

  if (result.length > 0) {
    // Decrement watcher count
    await db
      .update(repositories)
      .set({
        watcherCount: sql`${repositories.watcherCount} - 1`,
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, repoId));

    logger.info('general', 'Repository unwatched', { repoId, userId });
    return true;
  }
  return false;
}

/**
 * Get user's watch status for a repository
 */
export async function getUserWatchStatus(repoId: string, userId: string): Promise<string | null> {
  const watcher = await db.query.repoWatchers.findFirst({
    where: and(
      eq(repoWatchers.repositoryId, repoId),
      eq(repoWatchers.userId, userId)
    ),
  });

  return watcher?.watchLevel ?? null;
}

// ============================================================================
// User's Repositories
// ============================================================================

/**
 * Get all repositories a user can access
 */
export async function getUserAccessibleRepositories(
  userId: string,
  filters: Omit<RepositoryListFilters, 'userId'> = {}
): Promise<RepositoryWithStats[]> {
  const { search, includeArchived = false, limit = 50, offset = 0 } = filters;

  // Get user's direct memberships
  const memberships = await db.query.repositoryMembers.findMany({
    where: eq(repositoryMembers.userId, userId),
  });

  const memberRepoIds = memberships.map((m) => m.repositoryId);

  // Get user's org memberships
  const { getUserOrganizations } = await import('./organization.service');
  const userOrgs = await getUserOrganizations(userId);
  const orgIds = userOrgs.map((o) => o.id);

  // Build conditions
  const conditions = [];

  // User's own repos OR member repos OR org repos OR public repos
  conditions.push(
    or(
      eq(repositories.userId, userId),
      memberRepoIds.length > 0
        ? or(...memberRepoIds.map((id) => eq(repositories.id, id)))
        : sql`false`,
      orgIds.length > 0
        ? or(...orgIds.map((id) => eq(repositories.organizationId, id)))
        : sql`false`,
      eq(repositories.visibility, 'public')
    )!
  );

  if (!includeArchived) conditions.push(eq(repositories.isArchived, false));

  if (search) {
    conditions.push(
      or(
        ilike(repositories.name, `%${search}%`),
        ilike(repositories.slug, `%${search}%`),
        ilike(repositories.description, `%${search}%`)
      )!
    );
  }

  const repoList = await db.query.repositories.findMany({
    where: and(...conditions),
    orderBy: [desc(repositories.updatedAt)],
    limit,
    offset,
  });

  const reposWithStats: RepositoryWithStats[] = [];
  for (const repo of repoList) {
    const owner = await getOwnerInfo(repo);

    const [branchStats] = await db
      .select({ count: sql<number>`count(*)` })
      .from(branches)
      .where(eq(branches.repositoryId, repo.id));

    reposWithStats.push({
      ...repo,
      owner,
      branchCount: Number(branchStats?.count || 0),
    });
  }

  return reposWithStats;
}

/**
 * Get user's starred repositories
 */
export async function getUserStarredRepositories(userId: string): Promise<RepositoryWithStats[]> {
  const stars = await db.query.repoStars.findMany({
    where: eq(repoStars.userId, userId),
    orderBy: [desc(repoStars.createdAt)],
  });

  const reposWithStats: RepositoryWithStats[] = [];
  for (const star of stars) {
    const repo = await getRepositoryById(star.repositoryId);
    if (repo) {
      reposWithStats.push(repo);
    }
  }

  return reposWithStats;
}

// ============================================================================
// Transfer Repository
// ============================================================================

/**
 * Transfer repository to a different owner
 */
export async function transferRepository(
  repoId: string,
  targetOrgId: string | null,
  targetUserId: string | null
): Promise<Repository | null> {
  if (!targetOrgId && !targetUserId) {
    throw new Error('Must specify either organization or user as target');
  }

  const [repo] = await db
    .update(repositories)
    .set({
      organizationId: targetOrgId,
      userId: targetUserId,
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, repoId))
    .returning();

  if (repo) {
    logger.info('general', 'Repository transferred', {
      repoId,
      targetOrgId,
      targetUserId,
    });
  }

  return repo ?? null;
}
