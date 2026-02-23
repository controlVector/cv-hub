import { eq, and, inArray, count, isNull } from 'drizzle-orm';
import { db } from '../db';
import {
  subscriptions,
  pricingTiers,
  repositories,
  organizationMembers,
  type PricingTierLimits,
} from '../db/schema';
import { getPricingTierByName } from './pricing.service';
import { logger } from '../utils/logger';

// ============================================================================
// Tier Info
// ============================================================================

export interface OrgTierInfo {
  tierName: string;
  tierDisplayName: string;
  limits: PricingTierLimits;
  isFreeTier: boolean;
}

/**
 * Resolve the effective pricing tier for an organization.
 * Falls back to 'starter' if no active subscription exists.
 */
export async function getOrgTierInfo(orgId: string): Promise<OrgTierInfo> {
  // Find active/trialing subscription
  const sub = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.organizationId, orgId),
      inArray(subscriptions.status, ['active', 'trialing']),
    ),
  });

  let tier = null;
  if (sub?.pricingTierId) {
    tier = await db.query.pricingTiers.findFirst({
      where: eq(pricingTiers.id, sub.pricingTierId),
    });
  }

  // Default to starter tier
  if (!tier) {
    tier = await getPricingTierByName('starter');
  }

  if (!tier) {
    // Absolute fallback if starter tier doesn't exist in DB
    logger.warn('general', 'No starter tier found in DB, using hardcoded defaults');
    return {
      tierName: 'starter',
      tierDisplayName: 'Starter',
      limits: {
        environments: 1,
        repositories: 5,
        teamMembers: 3,
        storageGb: 1,
        buildMinutes: 500,
        configSets: 0,
        configSchemas: 0,
        configHistoryDays: 0,
      },
      isFreeTier: true,
    };
  }

  return {
    tierName: tier.name,
    tierDisplayName: tier.displayName,
    limits: tier.limits as PricingTierLimits,
    isFreeTier: tier.basePriceMonthly === 0 || tier.basePriceMonthly === null,
  };
}

// ============================================================================
// Usage Counts
// ============================================================================

export interface OrgUsage {
  repos: number;
  members: number;
}

/**
 * Count current resource usage for an organization.
 */
export async function getOrgUsage(orgId: string): Promise<OrgUsage> {
  const [repoResult] = await db
    .select({ value: count() })
    .from(repositories)
    .where(eq(repositories.organizationId, orgId));

  const [memberResult] = await db
    .select({ value: count() })
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, orgId));

  return {
    repos: repoResult?.value ?? 0,
    members: memberResult?.value ?? 0,
  };
}

// ============================================================================
// Limit Checks
// ============================================================================

export interface LimitCheckResult {
  allowed: boolean;
  current: number;
  limit: number;
  tierName: string;
}

/**
 * Check if an org can create another repository.
 */
export async function checkOrgRepoLimit(orgId: string): Promise<LimitCheckResult> {
  const tierInfo = await getOrgTierInfo(orgId);
  const usage = await getOrgUsage(orgId);

  const limit = tierInfo.limits.repositories;

  // null means unlimited
  if (limit === null) {
    return { allowed: true, current: usage.repos, limit: -1, tierName: tierInfo.tierName };
  }

  return {
    allowed: usage.repos < limit,
    current: usage.repos,
    limit,
    tierName: tierInfo.tierName,
  };
}

/**
 * Check if an org can add another member.
 */
export async function checkOrgMemberLimit(orgId: string): Promise<LimitCheckResult> {
  const tierInfo = await getOrgTierInfo(orgId);
  const usage = await getOrgUsage(orgId);

  const limit = tierInfo.limits.teamMembers;

  if (limit === null) {
    return { allowed: true, current: usage.members, limit: -1, tierName: tierInfo.tierName };
  }

  return {
    allowed: usage.members < limit,
    current: usage.members,
    limit,
    tierName: tierInfo.tierName,
  };
}

const PERSONAL_REPO_LIMIT = 5;

/**
 * Check if a user can create another personal repository (not under any org).
 */
export async function checkPersonalRepoLimit(userId: string): Promise<LimitCheckResult> {
  const [result] = await db
    .select({ value: count() })
    .from(repositories)
    .where(and(
      eq(repositories.userId, userId),
      isNull(repositories.organizationId),
    ));

  const current = result?.value ?? 0;

  return {
    allowed: current < PERSONAL_REPO_LIMIT,
    current,
    limit: PERSONAL_REPO_LIMIT,
    tierName: 'personal',
  };
}

// ============================================================================
// Combined Usage + Limits (for dashboard API)
// ============================================================================

export interface OrgUsageWithLimits {
  tierName: string;
  tierDisplayName: string;
  isFreeTier: boolean;
  usage: {
    repos: number;
    members: number;
  };
  limits: {
    repositories: number | null;
    teamMembers: number | null;
    storageGb: number | null;
    environments: number | null;
    buildMinutes: number | null;
  };
}

/**
 * Get combined tier info + usage for the dashboard API.
 */
export async function getOrgUsageWithLimits(orgId: string): Promise<OrgUsageWithLimits> {
  const tierInfo = await getOrgTierInfo(orgId);
  const usage = await getOrgUsage(orgId);

  return {
    tierName: tierInfo.tierName,
    tierDisplayName: tierInfo.tierDisplayName,
    isFreeTier: tierInfo.isFreeTier,
    usage: {
      repos: usage.repos,
      members: usage.members,
    },
    limits: {
      repositories: tierInfo.limits.repositories,
      teamMembers: tierInfo.limits.teamMembers,
      storageGb: tierInfo.limits.storageGb,
      environments: tierInfo.limits.environments,
      buildMinutes: tierInfo.limits.buildMinutes,
    },
  };
}
