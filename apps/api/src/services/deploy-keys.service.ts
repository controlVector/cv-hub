/**
 * Deploy Keys Service
 * Manages per-repository SSH keys for CI/CD and deployment pipelines
 */

import { db } from '../db';
import { deployKeys, sshKeys, type DeployKey } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { NotFoundError, ValidationError, ConflictError } from '../utils/errors';
import { validateKeyFormat, calculateFingerprint } from './ssh-keys.service';
import { logger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface DeployKeyWithRepo extends DeployKey {
  repository: {
    id: string;
    slug: string;
    name: string;
  };
}

// ============================================================================
// Key Management
// ============================================================================

/**
 * Add a deploy key to a repository
 */
export async function addDeployKey(
  repositoryId: string,
  title: string,
  publicKey: string,
  readOnly = true,
): Promise<DeployKey> {
  // Validate key format
  const validation = validateKeyFormat(publicKey);
  if (!validation.valid) {
    throw new ValidationError(validation.error || 'Invalid SSH key');
  }

  const fingerprint = validation.fingerprint!;

  // Check if fingerprint already exists as a user SSH key
  const existingUserKey = await db.query.sshKeys.findFirst({
    where: eq(sshKeys.fingerprint, fingerprint),
  });

  if (existingUserKey) {
    throw new ConflictError('This key is already registered as a user SSH key');
  }

  // Check if fingerprint already exists as a deploy key
  const existingDeployKey = await db.query.deployKeys.findFirst({
    where: eq(deployKeys.fingerprint, fingerprint),
  });

  if (existingDeployKey) {
    if (existingDeployKey.repositoryId === repositoryId) {
      throw new ConflictError('This key is already added to this repository');
    }
    throw new ConflictError('This key is already in use by another repository');
  }

  const [key] = await db.insert(deployKeys).values({
    repositoryId,
    title: title.trim(),
    publicKey: publicKey.trim(),
    fingerprint,
    keyType: validation.type,
    readOnly,
  }).returning();

  logger.info('general', 'Deploy key added', { repositoryId, keyId: key.id, readOnly });

  return key;
}

/**
 * Remove a deploy key from a repository
 */
export async function removeDeployKey(
  keyId: string,
  repositoryId: string,
): Promise<void> {
  const result = await db.delete(deployKeys)
    .where(and(
      eq(deployKeys.id, keyId),
      eq(deployKeys.repositoryId, repositoryId),
    ))
    .returning();

  if (result.length === 0) {
    throw new NotFoundError('Deploy key not found');
  }

  logger.info('general', 'Deploy key removed', { keyId, repositoryId });
}

/**
 * List all deploy keys for a repository
 */
export async function listDeployKeys(
  repositoryId: string,
): Promise<DeployKey[]> {
  return db.query.deployKeys.findMany({
    where: eq(deployKeys.repositoryId, repositoryId),
    orderBy: (keys, { desc }) => [desc(keys.createdAt)],
  });
}

/**
 * Get a single deploy key
 */
export async function getDeployKey(
  keyId: string,
  repositoryId: string,
): Promise<DeployKey> {
  const key = await db.query.deployKeys.findFirst({
    where: and(
      eq(deployKeys.id, keyId),
      eq(deployKeys.repositoryId, repositoryId),
    ),
  });

  if (!key) {
    throw new NotFoundError('Deploy key not found');
  }

  return key;
}

/**
 * Find repository by deploy key fingerprint.
 * Used during SSH authentication to match a deploy key to a repo.
 */
export async function findRepoByDeployKeyFingerprint(
  fingerprint: string,
): Promise<DeployKeyWithRepo | null> {
  const key = await db.query.deployKeys.findFirst({
    where: eq(deployKeys.fingerprint, fingerprint),
    with: {
      repository: {
        columns: { id: true, slug: true, name: true },
      },
    },
  });

  if (!key) return null;

  return key as DeployKeyWithRepo;
}

/**
 * Update last used timestamp for a deploy key
 */
export async function updateDeployKeyLastUsed(keyId: string): Promise<void> {
  await db.update(deployKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(deployKeys.id, keyId));
}
