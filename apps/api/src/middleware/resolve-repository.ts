import { db } from '../db';
import { repositories } from '../db/schema';
import { eq } from 'drizzle-orm';
import { canUserAccessRepo } from '../services/repository.service';

/**
 * Shared helper to resolve a repository by owner/repo slug pair.
 * Replaces the duplicated getRepository() helpers across route files.
 *
 * - Queries by slug, validates owner matches org.slug or user.username
 * - If requireAccess is true (default), checks canUserAccessRepo()
 * - Returns null if repo not found, owner mismatch, or access denied
 */
export async function resolveRepository(
  owner: string,
  repo: string,
  userId: string | null,
  options: { requireAccess?: boolean } = {}
) {
  const { requireAccess = true } = options;

  const repository = await db.query.repositories.findFirst({
    where: eq(repositories.slug, repo),
    with: {
      organization: true,
      owner: true,
    },
  });

  if (!repository) return null;

  // Verify owner matches
  const ownerSlug = repository.organization?.slug || repository.owner?.username;
  if (ownerSlug !== owner) return null;

  // Enforce access control
  if (requireAccess) {
    const canAccess = await canUserAccessRepo(repository.id, userId);
    if (!canAccess) return null;
  }

  return repository;
}
