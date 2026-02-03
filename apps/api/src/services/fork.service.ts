/**
 * Fork Service
 * Handles repository forking: cloning bare repos and creating linked DB records
 */

import { db } from '../db';
import {
  repositories,
  repositoryMembers,
  branches,
  tags,
  type Repository,
} from '../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { NotFoundError, ValidationError, ConflictError } from '../utils/errors';
import { logger } from '../utils/logger';
import * as gitBackend from './git/git-backend.service';

// ============================================================================
// Types
// ============================================================================

export interface ForkOptions {
  name?: string;            // Override fork name (defaults to source name)
  organizationId?: string;  // Fork into an org instead of user account
}

export interface ForkResult {
  repository: Repository;
  localPath: string;
}

// ============================================================================
// Fork Operations
// ============================================================================

/**
 * Fork a repository to a user's account or an organization
 */
export async function forkRepository(
  sourceRepoId: string,
  targetUserId: string,
  options: ForkOptions = {}
): Promise<ForkResult> {
  // Load source repo with owner info
  const source = await db.query.repositories.findFirst({
    where: eq(repositories.id, sourceRepoId),
    with: {
      organization: true,
      owner: true,
    },
  });

  if (!source) {
    throw new NotFoundError('Repository');
  }

  if (source.provider !== 'local') {
    throw new ValidationError('Only local repositories can be forked');
  }

  const sourceOwnerSlug = source.organization?.slug || source.owner?.username;
  if (!sourceOwnerSlug) {
    throw new ValidationError('Source repository has no owner');
  }

  // Determine target owner
  let targetOwnerSlug: string;
  let targetOrgId: string | null = null;
  let targetUid: string | null = null;

  if (options.organizationId) {
    const org = await db.query.repositories.findFirst({
      where: eq(repositories.id, options.organizationId),
    });
    // Look up the org directly
    const { organizations } = await import('../db/schema');
    const targetOrg = await db.query.organizations.findFirst({
      where: eq(organizations.id, options.organizationId),
    });
    if (!targetOrg) {
      throw new NotFoundError('Organization');
    }
    targetOwnerSlug = targetOrg.slug;
    targetOrgId = targetOrg.id;
  } else {
    const { users } = await import('../db/schema');
    const targetUser = await db.query.users.findFirst({
      where: eq(users.id, targetUserId),
    });
    if (!targetUser) {
      throw new NotFoundError('User');
    }
    targetOwnerSlug = targetUser.username;
    targetUid = targetUser.id;
  }

  // Determine fork name/slug
  const baseName = options.name || source.name;
  const baseSlug = (options.name || source.slug).toLowerCase().replace(/[^a-z0-9-]/g, '-');

  // Check for existing fork by this user/org from the same source
  const existingFork = await db.query.repositories.findFirst({
    where: and(
      eq(repositories.forkedFromId, sourceRepoId),
      targetOrgId
        ? eq(repositories.organizationId, targetOrgId)
        : eq(repositories.userId, targetUid!),
    ),
  });

  if (existingFork) {
    throw new ConflictError('You already have a fork of this repository');
  }

  // Resolve slug conflicts by appending -1, -2, etc.
  let slug = baseSlug;
  let name = baseName;
  let suffix = 0;

  while (true) {
    const conflict = await db.query.repositories.findFirst({
      where: and(
        eq(repositories.slug, slug),
        targetOrgId
          ? eq(repositories.organizationId, targetOrgId)
          : eq(repositories.userId, targetUid!),
      ),
    });

    if (!conflict) break;

    suffix++;
    slug = `${baseSlug}-${suffix}`;
    name = `${baseName}-${suffix}`;
  }

  // Clone the bare repo on disk
  const localPath = await gitBackend.cloneBareRepo(
    sourceOwnerSlug,
    source.slug,
    targetOwnerSlug,
    slug
  );

  // Create DB record
  const [fork] = await db.insert(repositories).values({
    organizationId: targetOrgId,
    userId: targetUid,
    name,
    slug,
    description: source.description,
    visibility: source.visibility,
    provider: 'local',
    localPath,
    defaultBranch: source.defaultBranch,
    forkedFromId: sourceRepoId,
    hasIssues: source.hasIssues,
    hasPullRequests: source.hasPullRequests,
    hasWiki: false,
  }).returning();

  // Add forking user as admin
  await db.insert(repositoryMembers).values({
    repositoryId: fork.id,
    userId: targetUserId,
    role: 'admin',
    acceptedAt: new Date(),
  });

  // Sync branches from source
  try {
    const refs = await gitBackend.getRefs(targetOwnerSlug, slug);

    for (const ref of refs) {
      if (ref.type === 'branch') {
        await db.insert(branches).values({
          repositoryId: fork.id,
          name: ref.name,
          sha: ref.sha,
          isDefault: ref.name === source.defaultBranch,
        });
      } else if (ref.type === 'tag') {
        await db.insert(tags).values({
          repositoryId: fork.id,
          name: ref.name,
          sha: ref.sha,
        });
      }
    }
  } catch (err) {
    logger.warn('general', 'Failed to sync refs for fork', err as Error);
  }

  // Increment fork count on source
  await db.update(repositories)
    .set({
      forkCount: sql`${repositories.forkCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, sourceRepoId));

  logger.info('general', 'Repository forked', {
    sourceId: sourceRepoId,
    forkId: fork.id,
    targetOwner: targetOwnerSlug,
    slug,
  });

  return { repository: fork, localPath };
}

/**
 * List forks of a repository
 */
export async function listForks(
  sourceRepoId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<{ forks: Repository[]; total: number }> {
  const { limit = 30, offset = 0 } = options;

  const forks = await db.query.repositories.findMany({
    where: eq(repositories.forkedFromId, sourceRepoId),
    with: {
      organization: true,
      owner: true,
    },
    orderBy: desc(repositories.createdAt),
    limit,
    offset,
  });

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(repositories)
    .where(eq(repositories.forkedFromId, sourceRepoId));

  return {
    forks,
    total: Number(countResult?.count || 0),
  };
}
