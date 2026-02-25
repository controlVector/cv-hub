/**
 * Credit Service
 * Manages organization AI credit balances, purchases, and usage deductions.
 *
 * Credits are consumed when using platform AI (embeddings, search, assistant).
 * BYOK (Bring Your Own Key) usage is free and never consumes credits.
 */

import { eq, sql, gte, and } from 'drizzle-orm';
import { db } from '../db';
import {
  organizationCredits,
  creditTransactions,
  pricingTiers,
} from '../db/schema';
import { getOrgSubscription } from './stripe.service';
import { getPricingTierById } from './pricing.service';
import { logger } from '../utils/logger';

// ============================================================================
// Token-Proportional Credit Calculation
// ============================================================================

export const INITIAL_FREE_CREDITS = 50;

export const CREDIT_RATES = {
  EMBEDDING_TOKENS_PER_CREDIT: 10_000,  // 1 credit per 10K embedding tokens
  LLM_TOKENS_PER_CREDIT: 2_500,         // 1 credit per 2.5K LLM tokens
  SEARCH_CREDIT_COST: 1,                // flat 1 credit per search
  MIN_CREDIT_COST: 1,                   // minimum 1 credit per operation
} as const;

export function calculateCreditCost(
  operation: 'embedding' | 'summarization' | 'assistant' | 'search',
  tokensUsed: number,
): number {
  if (operation === 'search') return CREDIT_RATES.SEARCH_CREDIT_COST;
  const rate = operation === 'embedding'
    ? CREDIT_RATES.EMBEDDING_TOKENS_PER_CREDIT
    : CREDIT_RATES.LLM_TOKENS_PER_CREDIT;
  return Math.max(Math.ceil(tokensUsed / rate), CREDIT_RATES.MIN_CREDIT_COST);
}

// ============================================================================
// Balance & Queries
// ============================================================================

/**
 * Get credit balance for an organization
 */
export async function getOrgCreditBalance(
  orgId: string
): Promise<{ balance: number; monthlyAllowance: number }> {
  const credits = await db.query.organizationCredits.findFirst({
    where: eq(organizationCredits.organizationId, orgId),
  });

  if (!credits) {
    return { balance: 0, monthlyAllowance: 0 };
  }

  return {
    balance: credits.balance,
    monthlyAllowance: credits.monthlyAllowance,
  };
}

/**
 * Check if org has credits > 0 or has a BYOK key configured
 */
export async function hasCreditsOrBYOK(orgId: string): Promise<boolean> {
  const { organizationEmbeddingConfig } = await import('../db/schema');

  // Check BYOK first
  const orgConfig = await db.query.organizationEmbeddingConfig.findFirst({
    where: eq(organizationEmbeddingConfig.organizationId, orgId),
  });

  if (orgConfig?.apiKeyEncrypted) {
    return true;
  }

  // Check credits
  const { balance } = await getOrgCreditBalance(orgId);
  return balance > 0;
}

/**
 * Look up the org's subscription tier and return the monthly credit allowance
 */
export async function getOrgMonthlyAllowance(orgId: string): Promise<number> {
  const subscription = await getOrgSubscription(orgId);
  if (!subscription?.pricingTierId) {
    return 0; // Starter / no subscription
  }

  const tier = await getPricingTierById(subscription.pricingTierId);
  if (!tier) {
    return 0;
  }

  // Read from features jsonb (set via SQL: monthlyAiCredits)
  const features = tier.features as Record<string, any>;
  return features?.monthlyAiCredits ?? 0;
}

// ============================================================================
// Credit Operations
// ============================================================================

/**
 * Deduct credits atomically (only if balance >= amount)
 */
export async function deductCredits(
  orgId: string,
  amount: number,
  operation: string,
  metadata?: Record<string, any>
): Promise<{ success: boolean; remainingBalance: number }> {
  if (amount <= 0) {
    const { balance } = await getOrgCreditBalance(orgId);
    return { success: true, remainingBalance: balance };
  }

  // Atomic decrement with WHERE balance >= amount
  const result = await db
    .update(organizationCredits)
    .set({
      balance: sql`${organizationCredits.balance} - ${amount}`,
      updatedAt: new Date(),
    })
    .where(
      sql`${organizationCredits.organizationId} = ${orgId} AND ${organizationCredits.balance} >= ${amount}`
    )
    .returning();

  if (result.length === 0) {
    // Not enough credits (or row doesn't exist)
    const { balance } = await getOrgCreditBalance(orgId);
    return { success: false, remainingBalance: balance };
  }

  // Record transaction
  await db.insert(creditTransactions).values({
    organizationId: orgId,
    amount: -amount,
    type: 'usage',
    description: operation,
    metadata: metadata ?? null,
  });

  logger.info('general', 'Credits deducted', {
    orgId,
    amount,
    remaining: result[0].balance,
    operation,
  });

  return { success: true, remainingBalance: result[0].balance };
}

/**
 * Add credits to an organization
 */
export async function addCredits(
  orgId: string,
  amount: number,
  type: 'purchase' | 'monthly_refresh' | 'bonus' | 'refund',
  description: string,
  stripeSessionId?: string
): Promise<number> {
  // Upsert the organization_credits row
  const existing = await db.query.organizationCredits.findFirst({
    where: eq(organizationCredits.organizationId, orgId),
  });

  let newBalance: number;

  if (existing) {
    const [updated] = await db
      .update(organizationCredits)
      .set({
        balance: sql`${organizationCredits.balance} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(organizationCredits.organizationId, orgId))
      .returning();
    newBalance = updated.balance;
  } else {
    const [created] = await db
      .insert(organizationCredits)
      .values({
        organizationId: orgId,
        balance: amount,
        monthlyAllowance: await getOrgMonthlyAllowance(orgId),
      })
      .returning();
    newBalance = created.balance;
  }

  // Record transaction
  await db.insert(creditTransactions).values({
    organizationId: orgId,
    amount,
    type,
    description,
    stripeSessionId: stripeSessionId ?? null,
  });

  logger.info('general', 'Credits added', {
    orgId,
    amount,
    type,
    newBalance,
  });

  return newBalance;
}

/**
 * Refresh monthly credits on subscription renewal
 */
export async function refreshMonthlyCredits(orgId: string): Promise<void> {
  const allowance = await getOrgMonthlyAllowance(orgId);
  if (allowance <= 0) return;

  const existing = await db.query.organizationCredits.findFirst({
    where: eq(organizationCredits.organizationId, orgId),
  });

  if (existing) {
    await db
      .update(organizationCredits)
      .set({
        balance: sql`${organizationCredits.balance} + ${allowance}`,
        monthlyAllowance: allowance,
        lastRefreshedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(organizationCredits.organizationId, orgId));
  } else {
    await db.insert(organizationCredits).values({
      organizationId: orgId,
      balance: allowance,
      monthlyAllowance: allowance,
      lastRefreshedAt: new Date(),
    });
  }

  // Record transaction
  await db.insert(creditTransactions).values({
    organizationId: orgId,
    amount: allowance,
    type: 'monthly_refresh',
    description: `Monthly credit refresh: ${allowance} credits`,
  });

  logger.info('general', 'Monthly credits refreshed', {
    orgId,
    allowance,
  });
}

// ============================================================================
// Monthly Quota Tracking & Enforcement
// ============================================================================

const MONTHLY_LIMITS: Record<string, number> = {
  starter: 100,
  pro: 1500,
  enterprise: 10000,
};

/**
 * Get total credit usage for an org in the current calendar month
 */
export async function getMonthlyUsage(orgId: string): Promise<number> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const result = await db
    .select({
      total: sql<number>`COALESCE(SUM(ABS(${creditTransactions.amount})), 0)`,
    })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.organizationId, orgId),
        eq(creditTransactions.type, 'usage'),
        gte(creditTransactions.createdAt, startOfMonth),
      )
    );

  return Number(result[0]?.total || 0);
}

/**
 * Check if an org is within its monthly quota
 */
export async function checkMonthlyQuota(orgId: string): Promise<{
  allowed: boolean;
  used: number;
  limit: number;
  warning?: string;
}> {
  // Determine the org's tier
  let tierName = 'starter';
  try {
    const subscription = await getOrgSubscription(orgId);
    if (subscription?.pricingTierId) {
      const tier = await getPricingTierById(subscription.pricingTierId);
      if (tier) tierName = tier.name;
    }
  } catch {
    // Default to starter
  }

  const limit = MONTHLY_LIMITS[tierName] ?? MONTHLY_LIMITS.starter;
  const used = await getMonthlyUsage(orgId);

  // Hard block at limit for starter tier
  if (tierName === 'starter' && used >= limit) {
    return {
      allowed: false,
      used,
      limit,
      warning: `Monthly quota exceeded (${used}/${limit} credits). Upgrade to Pro for 1,500 credits/month.`,
    };
  }

  // Soft warning at 80% for paid tiers
  if (used >= limit * 0.8 && used < limit) {
    return {
      allowed: true,
      used,
      limit,
      warning: `Approaching monthly limit: ${used}/${limit} credits used (${Math.round((used / limit) * 100)}%).`,
    };
  }

  // Hard block for all tiers at limit
  if (used >= limit) {
    return {
      allowed: false,
      used,
      limit,
      warning: `Monthly quota exceeded (${used}/${limit} credits). Contact support or wait for next billing cycle.`,
    };
  }

  return { allowed: true, used, limit };
}
