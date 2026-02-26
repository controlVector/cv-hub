import { eq, and, inArray, count, isNull, gte, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  subscriptions,
  pricingTiers,
  repositories,
  organizationMembers,
  contextEngineSessions,
  type PricingTierLimits,
  type PricingTierFeatures,
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
  features: PricingTierFeatures;
  isFreeTier: boolean;
}

// Hardcoded feature defaults when no tier is in the DB
const STARTER_FEATURES: PricingTierFeatures = {
  branchProtection: false,
  sso: false,
  customDomain: false,
  analytics: false,
  auditLogs: false,
  prioritySupport: false,
  sla: false,
  dedicatedInstance: false,
  ipAllowlisting: false,
  webhooks: true,
  apiAccess: true,
  configManagement: false,
  configExternalStores: false,
  configExports: false,
  mcpGateway: false,
  contextEngine: true, // enabled but limited by egressPerDay
};

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
        egressPerDay: 50,
        skNodesPerRepo: 100,
      },
      features: STARTER_FEATURES,
      isFreeTier: true,
    };
  }

  return {
    tierName: tier.name,
    tierDisplayName: tier.displayName,
    limits: tier.limits as PricingTierLimits,
    features: (tier.features ?? STARTER_FEATURES) as PricingTierFeatures,
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

// ============================================================================
// Context Engine Limit Checks
// ============================================================================

/**
 * Count egress calls today for all repos in an organization.
 * Uses lastActivityAt on context_engine_sessions to approximate daily turns.
 */
export async function getOrgEgressToday(orgId: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // Count turns across all org repos updated today
  const [result] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${contextEngineSessions.lastTurnCount}), 0)`,
    })
    .from(contextEngineSessions)
    .innerJoin(repositories, eq(contextEngineSessions.repositoryId, repositories.id))
    .where(
      and(
        eq(repositories.organizationId, orgId),
        gte(contextEngineSessions.lastActivityAt, startOfDay),
      )
    );

  return Number(result?.total || 0);
}

/**
 * Check if an org's context engine is enabled by their plan.
 */
export async function checkContextEngineAccess(orgId: string): Promise<{
  allowed: boolean;
  tierName: string;
}> {
  const tierInfo = await getOrgTierInfo(orgId);
  const contextEngine = tierInfo.features?.contextEngine ?? true;

  return {
    allowed: contextEngine,
    tierName: tierInfo.tierName,
  };
}

/**
 * Check if an org can make another egress call today.
 */
export async function checkEgressLimit(orgId: string): Promise<LimitCheckResult> {
  const tierInfo = await getOrgTierInfo(orgId);
  const limit = tierInfo.limits.egressPerDay ?? null;

  // null means unlimited
  if (limit === null) {
    return { allowed: true, current: 0, limit: -1, tierName: tierInfo.tierName };
  }

  const current = await getOrgEgressToday(orgId);

  return {
    allowed: current < limit,
    current,
    limit,
    tierName: tierInfo.tierName,
  };
}

/**
 * Check if a repo can store another SK node based on the org's plan.
 */
export async function checkSKNodeLimit(orgId: string, repoId: string): Promise<LimitCheckResult> {
  const tierInfo = await getOrgTierInfo(orgId);
  const limit = tierInfo.limits.skNodesPerRepo ?? null;

  // null means unlimited
  if (limit === null) {
    return { allowed: true, current: 0, limit: -1, tierName: tierInfo.tierName };
  }

  // Count SK nodes for this repo via context engine sessions turn count
  const [result] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${contextEngineSessions.lastTurnCount}), 0)`,
    })
    .from(contextEngineSessions)
    .where(eq(contextEngineSessions.repositoryId, repoId));

  const current = Number(result?.total || 0);

  return {
    allowed: current < limit,
    current,
    limit,
    tierName: tierInfo.tierName,
  };
}
