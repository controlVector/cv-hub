/**
 * Release Service
 * Repository release management with asset storage
 */

import { db } from '../db';
import {
  repoReleases,
  repoReleaseAssets,
  repositories,
  tags,
  type RepoRelease,
  type RepoReleaseAsset,
} from '../db/schema';
import { eq, and, desc, count, sql, isNull, isNotNull } from 'drizzle-orm';
import { NotFoundError, ValidationError, ConflictError } from '../utils/errors';
import { logger } from '../utils/logger';
import { getStorage } from './storage.service';

// ============================================================================
// Types
// ============================================================================

export interface CreateReleaseInput {
  repositoryId: string;
  tagName: string;
  name: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  authorId: string;
}

export interface UpdateReleaseInput {
  tagName?: string;
  name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
}

export interface ListReleasesOptions {
  limit?: number;
  offset?: number;
  includeDrafts?: boolean;
}

// ============================================================================
// Release CRUD
// ============================================================================

/**
 * Create a new release for a repository
 */
export async function createRelease(input: CreateReleaseInput): Promise<RepoRelease> {
  // Validate tag name format
  if (!input.tagName || input.tagName.trim().length === 0) {
    throw new ValidationError('Tag name is required');
  }

  // Check for duplicate tag_name within repo
  const existing = await db.query.repoReleases.findFirst({
    where: and(
      eq(repoReleases.repositoryId, input.repositoryId),
      eq(repoReleases.tagName, input.tagName),
    ),
  });

  if (existing) {
    throw new ConflictError(`A release with tag "${input.tagName}" already exists`);
  }

  // Ensure the git tag exists in the DB (or create a placeholder record)
  const existingTag = await db.query.tags.findFirst({
    where: and(
      eq(tags.repositoryId, input.repositoryId),
      eq(tags.name, input.tagName),
    ),
  });

  const publishedAt = input.draft ? null : new Date();

  const [release] = await db.insert(repoReleases).values({
    repositoryId: input.repositoryId,
    tagName: input.tagName,
    name: input.name,
    body: input.body,
    draft: input.draft ?? false,
    prerelease: input.prerelease ?? false,
    authorId: input.authorId,
    publishedAt,
  }).returning();

  if (!existingTag) {
    logger.warn('api', `Release created for tag "${input.tagName}" which does not exist in the tag index yet`);
  }

  logger.info('api', `Release "${release.name}" created for tag ${input.tagName}`);
  return release;
}

/**
 * Update an existing release
 */
export async function updateRelease(id: string, input: UpdateReleaseInput): Promise<RepoRelease> {
  const release = await db.query.repoReleases.findFirst({
    where: eq(repoReleases.id, id),
  });

  if (!release) {
    throw new NotFoundError('Release not found');
  }

  // If changing tag name, check for conflicts
  if (input.tagName && input.tagName !== release.tagName) {
    const conflict = await db.query.repoReleases.findFirst({
      where: and(
        eq(repoReleases.repositoryId, release.repositoryId),
        eq(repoReleases.tagName, input.tagName),
      ),
    });
    if (conflict) {
      throw new ConflictError(`A release with tag "${input.tagName}" already exists`);
    }
  }

  // If transitioning from draft to published, set publishedAt
  const updates: Record<string, any> = {
    ...input,
    updatedAt: new Date(),
  };

  if (input.draft === false && release.draft && !release.publishedAt) {
    updates.publishedAt = new Date();
  }

  const [updated] = await db.update(repoReleases)
    .set(updates)
    .where(eq(repoReleases.id, id))
    .returning();

  logger.info('api', `Release "${updated.name}" updated`);
  return updated;
}

/**
 * Delete a release and its assets from storage
 */
export async function deleteRelease(id: string): Promise<void> {
  const release = await db.query.repoReleases.findFirst({
    where: eq(repoReleases.id, id),
    with: { assets: true },
  });

  if (!release) {
    throw new NotFoundError('Release not found');
  }

  // Delete assets from storage
  const storage = getStorage();
  for (const asset of release.assets) {
    try {
      await storage.delete(asset.storageKey);
    } catch (err: any) {
      logger.error('api', `Failed to delete asset "${asset.name}" from storage`, err);
    }
  }

  // Delete release (cascade deletes asset records)
  await db.delete(repoReleases).where(eq(repoReleases.id, id));
  logger.info('api', `Release "${release.name}" deleted with ${release.assets.length} assets`);
}

/**
 * List releases for a repository
 */
export async function listReleases(
  repositoryId: string,
  options: ListReleasesOptions = {},
): Promise<{ releases: RepoRelease[]; total: number }> {
  const { limit = 20, offset = 0, includeDrafts = false } = options;

  const conditions = [eq(repoReleases.repositoryId, repositoryId)];
  if (!includeDrafts) {
    conditions.push(eq(repoReleases.draft, false));
  }

  const where = and(...conditions);

  const [releases, totalResult] = await Promise.all([
    db.query.repoReleases.findMany({
      where,
      with: {
        author: {
          columns: { id: true, username: true, displayName: true, avatarUrl: true },
        },
        assets: true,
      },
      orderBy: [desc(repoReleases.createdAt)],
      limit,
      offset,
    }),
    db.select({ count: count() }).from(repoReleases).where(where!),
  ]);

  return {
    releases,
    total: totalResult[0]?.count ?? 0,
  };
}

/**
 * Get a single release by ID with assets and author info
 */
export async function getRelease(id: string): Promise<RepoRelease & { author: any; assets: RepoReleaseAsset[] } | null> {
  const release = await db.query.repoReleases.findFirst({
    where: eq(repoReleases.id, id),
    with: {
      author: {
        columns: { id: true, username: true, displayName: true, avatarUrl: true },
      },
      assets: true,
    },
  });

  return release ?? null;
}

/**
 * Get the latest published release for a repository
 */
export async function getLatestRelease(repositoryId: string): Promise<(RepoRelease & { author: any; assets: RepoReleaseAsset[] }) | null> {
  const release = await db.query.repoReleases.findFirst({
    where: and(
      eq(repoReleases.repositoryId, repositoryId),
      eq(repoReleases.draft, false),
    ),
    with: {
      author: {
        columns: { id: true, username: true, displayName: true, avatarUrl: true },
      },
      assets: true,
    },
    orderBy: [desc(repoReleases.createdAt)],
  });

  return release ?? null;
}

/**
 * Get a release by tag name
 */
export async function getReleaseByTag(repositoryId: string, tagName: string): Promise<(RepoRelease & { author: any; assets: RepoReleaseAsset[] }) | null> {
  const release = await db.query.repoReleases.findFirst({
    where: and(
      eq(repoReleases.repositoryId, repositoryId),
      eq(repoReleases.tagName, tagName),
    ),
    with: {
      author: {
        columns: { id: true, username: true, displayName: true, avatarUrl: true },
      },
      assets: true,
    },
  });

  return release ?? null;
}

// ============================================================================
// Asset Management
// ============================================================================

/**
 * Upload an asset to a release
 */
export async function uploadAsset(
  releaseId: string,
  name: string,
  contentType: string,
  data: Buffer,
): Promise<RepoReleaseAsset> {
  const release = await db.query.repoReleases.findFirst({
    where: eq(repoReleases.id, releaseId),
  });

  if (!release) {
    throw new NotFoundError('Release not found');
  }

  // Check for duplicate asset name
  const existing = await db.query.repoReleaseAssets.findFirst({
    where: and(
      eq(repoReleaseAssets.releaseId, releaseId),
      eq(repoReleaseAssets.name, name),
    ),
  });

  if (existing) {
    throw new ConflictError(`An asset named "${name}" already exists on this release`);
  }

  // Store in configured storage backend
  const storageKey = `releases/${release.repositoryId}/${release.tagName}/${name}`;
  const storage = getStorage();
  await storage.upload(storageKey, data);

  const [asset] = await db.insert(repoReleaseAssets).values({
    releaseId,
    name,
    contentType,
    size: data.length,
    storageKey,
  }).returning();

  logger.info('api', `Asset "${name}" (${data.length} bytes) uploaded to release ${release.name}`);
  return asset;
}

/**
 * Delete an asset from a release
 */
export async function deleteAsset(assetId: string): Promise<void> {
  const asset = await db.query.repoReleaseAssets.findFirst({
    where: eq(repoReleaseAssets.id, assetId),
  });

  if (!asset) {
    throw new NotFoundError('Asset not found');
  }

  // Remove from storage
  const storage = getStorage();
  try {
    await storage.delete(asset.storageKey);
  } catch (err: any) {
    logger.error('api', `Failed to delete asset "${asset.name}" from storage`, err);
  }

  await db.delete(repoReleaseAssets).where(eq(repoReleaseAssets.id, assetId));
  logger.info('api', `Asset "${asset.name}" deleted`);
}

/**
 * Get download URL for an asset
 */
export async function getAssetDownloadUrl(assetId: string): Promise<{ url: string; asset: RepoReleaseAsset }> {
  const asset = await db.query.repoReleaseAssets.findFirst({
    where: eq(repoReleaseAssets.id, assetId),
  });

  if (!asset) {
    throw new NotFoundError('Asset not found');
  }

  // Increment download count
  await db.update(repoReleaseAssets)
    .set({ downloadCount: sql`${repoReleaseAssets.downloadCount} + 1` })
    .where(eq(repoReleaseAssets.id, assetId));

  const storage = getStorage();
  const url = storage.getUrl(asset.storageKey);

  return { url, asset };
}

/**
 * Download asset data directly
 */
export async function downloadAsset(assetId: string): Promise<{ data: Buffer; asset: RepoReleaseAsset }> {
  const asset = await db.query.repoReleaseAssets.findFirst({
    where: eq(repoReleaseAssets.id, assetId),
  });

  if (!asset) {
    throw new NotFoundError('Asset not found');
  }

  // Increment download count
  await db.update(repoReleaseAssets)
    .set({ downloadCount: sql`${repoReleaseAssets.downloadCount} + 1` })
    .where(eq(repoReleaseAssets.id, assetId));

  const storage = getStorage();
  const data = await storage.download(asset.storageKey);

  return { data, asset };
}
