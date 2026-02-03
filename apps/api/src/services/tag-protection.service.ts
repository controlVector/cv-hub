/**
 * Tag Protection Service
 * Manages tag protection rules to prevent deletion or overwriting of release tags
 */

import { db } from '../db';
import { tagProtectionRules, type TagProtectionRule } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { NotFoundError, ValidationError, ConflictError } from '../utils/errors';
import { logger } from '../utils/logger';

// ============================================================================
// Pattern Matching
// ============================================================================

/**
 * Check if a tag name matches a protection pattern.
 * Supports wildcards: * matches any sequence, ? matches single char
 */
export function matchesTagPattern(tagName: string, pattern: string): boolean {
  if (tagName === pattern) return true;

  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(tagName);
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Add a tag protection rule
 */
export async function addTagProtection(
  repositoryId: string,
  pattern: string,
  createdBy?: string,
  allowAdminOverride = true,
): Promise<TagProtectionRule> {
  if (!pattern || pattern.trim().length === 0) {
    throw new ValidationError('Pattern is required');
  }

  // Check for duplicate pattern
  const existing = await db.query.tagProtectionRules.findFirst({
    where: and(
      eq(tagProtectionRules.repositoryId, repositoryId),
      eq(tagProtectionRules.pattern, pattern.trim()),
    ),
  });

  if (existing) {
    throw new ConflictError('A protection rule with this pattern already exists');
  }

  const [rule] = await db.insert(tagProtectionRules).values({
    repositoryId,
    pattern: pattern.trim(),
    allowAdminOverride,
    createdBy: createdBy || null,
  }).returning();

  logger.info('general', 'Tag protection rule added', { repositoryId, pattern });

  return rule;
}

/**
 * Remove a tag protection rule
 */
export async function removeTagProtection(
  ruleId: string,
  repositoryId: string,
): Promise<void> {
  const result = await db.delete(tagProtectionRules)
    .where(and(
      eq(tagProtectionRules.id, ruleId),
      eq(tagProtectionRules.repositoryId, repositoryId),
    ))
    .returning();

  if (result.length === 0) {
    throw new NotFoundError('Tag protection rule not found');
  }

  logger.info('general', 'Tag protection rule removed', { ruleId, repositoryId });
}

/**
 * List tag protection rules for a repository
 */
export async function listTagProtection(
  repositoryId: string,
): Promise<TagProtectionRule[]> {
  return db.query.tagProtectionRules.findMany({
    where: eq(tagProtectionRules.repositoryId, repositoryId),
    orderBy: (rules, { asc }) => [asc(rules.createdAt)],
  });
}

/**
 * Get a single tag protection rule
 */
export async function getTagProtection(
  ruleId: string,
  repositoryId: string,
): Promise<TagProtectionRule> {
  const rule = await db.query.tagProtectionRules.findFirst({
    where: and(
      eq(tagProtectionRules.id, ruleId),
      eq(tagProtectionRules.repositoryId, repositoryId),
    ),
  });

  if (!rule) {
    throw new NotFoundError('Tag protection rule not found');
  }

  return rule;
}

// ============================================================================
// Tag Push Validation
// ============================================================================

/**
 * Check if a tag ref is protected and whether the operation is allowed.
 * Returns { allowed, reason } for each blocked tag ref.
 */
export async function validateTagPush(
  repositoryId: string,
  refName: string,
  oldSha: string,
  newSha: string,
  isAdmin: boolean,
): Promise<{ allowed: boolean; reason?: string }> {
  const ZERO_SHA = '0000000000000000000000000000000000000000';

  // Only applies to tag refs
  const tagName = extractTagName(refName);
  if (!tagName) {
    return { allowed: true };
  }

  // Get all tag protection rules for this repo
  const rules = await listTagProtection(repositoryId);
  if (rules.length === 0) {
    return { allowed: true };
  }

  // Find matching rule
  const matchingRule = rules.find(r => matchesTagPattern(tagName, r.pattern));
  if (!matchingRule) {
    return { allowed: true };
  }

  // Admin override check
  if (isAdmin && matchingRule.allowAdminOverride) {
    return { allowed: true };
  }

  // Tag deletion
  if (newSha === ZERO_SHA) {
    return {
      allowed: false,
      reason: `Cannot delete protected tag '${tagName}' (matches pattern '${matchingRule.pattern}')`,
    };
  }

  // Tag update (force push / overwrite)
  if (oldSha !== ZERO_SHA) {
    return {
      allowed: false,
      reason: `Cannot overwrite protected tag '${tagName}' (matches pattern '${matchingRule.pattern}')`,
    };
  }

  // Tag creation is allowed
  return { allowed: true };
}

/**
 * Extract tag name from git ref
 */
export function extractTagName(refName: string): string | null {
  if (refName.startsWith('refs/tags/')) {
    return refName.slice(10);
  }
  return null;
}
