/**
 * Billing Lifecycle Integration Test
 * End-to-end test of the Stripe → Access Control loop:
 *   starter → checkout → pro → cancel → downgrade → data preserved
 *
 * Does NOT hit real Stripe APIs — exercises the internal sync + enforcement functions.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import {
  processWebhookEvent,
  syncSubscriptionFromStripe,
  getOrgSubscription,
} from './stripe.service';
import {
  getOrgTierInfo,
  getOrgUsage,
  getOrgEgressToday,
  checkOrgRepoLimit,
  checkOrgMemberLimit,
  checkEgressLimit,
  checkContextEngineAccess,
} from './tier-limits.service';
import { getOrgCreditBalance } from './credit.service';
import { db } from '../db';
import {
  organizations,
  users,
  subscriptions,
  pricingTiers,
  repositories,
  contextEngineSessions,
} from '../db/schema';

let seq = 0;
function uid() { return `${Date.now()}_${++seq}`; }

function mockStripeSubscription(overrides: Partial<{
  id: string;
  status: string;
  organizationId: string;
  customerId: string;
  priceId: string;
  billingInterval: string;
  cancelAtPeriodEnd: boolean;
  canceledAt: number | null;
}>): Stripe.Subscription {
  const u = uid();
  return {
    id: overrides.id || `sub_${u}`,
    object: 'subscription',
    status: overrides.status || 'active',
    customer: overrides.customerId || `cus_${u}`,
    current_period_start: Math.floor(Date.now() / 1000),
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
    cancel_at_period_end: overrides.cancelAtPeriodEnd ?? false,
    canceled_at: overrides.canceledAt ?? null,
    trial_start: null,
    trial_end: null,
    items: {
      object: 'list',
      data: [{
        id: `si_${u}`,
        price: { id: overrides.priceId || `price_${u}` },
      }],
    } as any,
    metadata: {
      organizationId: overrides.organizationId || '',
      billingInterval: overrides.billingInterval || 'monthly',
    },
  } as any;
}

function mockStripeEvent(type: string, object: any, eventId?: string): Stripe.Event {
  return {
    id: eventId || `evt_${uid()}`,
    object: 'event',
    type,
    data: { object },
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
    api_version: '2024-12-18.acacia',
  } as any;
}

async function truncate() {
  await db.execute(/* sql */`
    TRUNCATE TABLE stripe_events, subscriptions, organization_addons,
      organization_credits, credit_transactions, context_engine_sessions,
      repositories, organization_members, pricing_tiers, users, organizations
    CASCADE
  `);
}

describe('Billing Lifecycle Integration', () => {
  beforeAll(async () => {
    await db.execute(/* sql */`SELECT 1`);
  });

  afterEach(async () => {
    await truncate();
  });

  it('full lifecycle: starter → pro → cancel → downgrade → data preserved', async () => {
    // ================================================================
    // Step 1: Create org → starts on starter tier
    // ================================================================
    const u = uid();
    const customerId = `cus_lifecycle_${u}`;
    const [org] = await db.insert(organizations).values({
      slug: `lifecycle-org-${u}`,
      name: 'Lifecycle Test Org',
      stripeCustomerId: customerId,
    }).returning();

    // ================================================================
    // Step 2: Verify starter limits
    // ================================================================
    const starterTier = await getOrgTierInfo(org.id);
    expect(starterTier.tierName).toBe('starter');
    expect(starterTier.isFreeTier).toBe(true);
    expect(starterTier.limits.repositories).toBe(5);
    expect(starterTier.limits.egressPerDay).toBe(50);
    expect(starterTier.features.contextEngine).toBe(true);

    const starterSub = await getOrgSubscription(org.id);
    expect(starterSub).toBeNull();

    const starterCredits = await getOrgCreditBalance(org.id);
    expect(starterCredits.balance).toBe(0);

    // Starter limits should allow some repos
    const repoCheck = await checkOrgRepoLimit(org.id);
    expect(repoCheck.allowed).toBe(true);
    expect(repoCheck.current).toBe(0);
    expect(repoCheck.limit).toBe(5);

    // Context engine should be allowed on starter
    const ceAccess = await checkContextEngineAccess(org.id);
    expect(ceAccess.allowed).toBe(true);

    // ================================================================
    // Step 3: Create a pro tier and simulate checkout → subscription created
    // ================================================================
    const [proTier] = await db.insert(pricingTiers).values({
      name: 'pro',
      displayName: 'Pro',
      limits: {
        environments: null, repositories: null, teamMembers: 10,
        storageGb: 50, buildMinutes: null, configSets: null,
        configSchemas: null, configHistoryDays: null,
        egressPerDay: null, skNodesPerRepo: null,
      },
      features: {
        branchProtection: true, sso: false, customDomain: false,
        analytics: true, auditLogs: true, prioritySupport: true,
        sla: false, dedicatedInstance: false, ipAllowlisting: false,
        webhooks: true, apiAccess: true, configManagement: true,
        configExternalStores: false, configExports: true,
        mcpGateway: true, contextEngine: true,
      },
      basePriceMonthly: 2900,
    }).returning();

    const subId = `sub_lifecycle_${u}`;
    const stripeSub = mockStripeSubscription({
      id: subId,
      organizationId: org.id,
      customerId,
      status: 'active',
      billingInterval: 'monthly',
    });

    // Simulate Stripe webhook: subscription.created
    const createEvent = mockStripeEvent('customer.subscription.created', stripeSub);
    await processWebhookEvent(createEvent);

    // ================================================================
    // Step 4: Verify pro tier limits
    // ================================================================
    const activeSub = await getOrgSubscription(org.id);
    expect(activeSub).toBeTruthy();
    expect(activeSub!.status).toBe('active');

    // Note: tier resolution requires matching price IDs to env vars.
    // Without STRIPE_PRICE_* env vars, the subscription won't link to
    // the pro tier. We verify the subscription exists and is active.
    // To fully test tier linking, we manually link it.
    await db.update(subscriptions)
      .set({ pricingTierId: proTier.id })
      .where(eq(subscriptions.stripeSubscriptionId, subId));

    const proTierInfo = await getOrgTierInfo(org.id);
    expect(proTierInfo.tierName).toBe('pro');
    expect(proTierInfo.isFreeTier).toBe(false);
    expect(proTierInfo.limits.repositories).toBeNull(); // unlimited
    expect(proTierInfo.limits.egressPerDay).toBeNull(); // unlimited
    expect(proTierInfo.features.contextEngine).toBe(true);

    // Pro: repo limit should be unlimited
    const proRepoCheck = await checkOrgRepoLimit(org.id);
    expect(proRepoCheck.allowed).toBe(true);
    expect(proRepoCheck.limit).toBe(-1); // -1 = unlimited

    // Pro: egress should be unlimited
    const proEgressCheck = await checkEgressLimit(org.id);
    expect(proEgressCheck.allowed).toBe(true);
    expect(proEgressCheck.limit).toBe(-1);

    // ================================================================
    // Step 5: Verify usage tracking
    // ================================================================
    // Create some repos and sessions to track usage
    const [user] = await db.insert(users).values({
      username: `lifecycle_user_${u}`,
      email: `lifecycle_${u}@example.com`,
      displayName: 'Lifecycle Test',
      emailVerified: true,
    }).returning();

    for (let i = 0; i < 3; i++) {
      const ru = uid();
      await db.insert(repositories).values({
        name: `Repo ${ru}`, slug: `repo-${ru}`,
        organizationId: org.id, visibility: 'private', defaultBranch: 'main',
      });
    }

    const usage = await getOrgUsage(org.id);
    expect(usage.repos).toBe(3);
    expect(usage.members).toBe(0); // no members added

    // Create some egress sessions
    const [repo] = await db.select().from(repositories)
      .where(eq(repositories.organizationId, org.id))
      .limit(1);

    await db.insert(contextEngineSessions).values({
      sessionId: `ses_lifecycle_${u}`,
      repositoryId: repo.id,
      userId: user.id,
      lastTurnCount: 42,
      lastActivityAt: new Date(),
    });

    const egressToday = await getOrgEgressToday(org.id);
    expect(egressToday).toBe(42);

    // ================================================================
    // Step 6: Simulate subscription update → cancel at period end
    // ================================================================
    stripeSub.cancel_at_period_end = true as any;
    const updateEvent = mockStripeEvent('customer.subscription.updated', stripeSub);
    await processWebhookEvent(updateEvent);

    // ================================================================
    // Step 7: Subscription still active until period ends
    // ================================================================
    const pendingCancelSub = await getOrgSubscription(org.id);
    expect(pendingCancelSub).toBeTruthy();
    expect(pendingCancelSub!.status).toBe('active');
    expect(pendingCancelSub!.cancelAtPeriodEnd).toBe(true);

    // Pro features still available during pending cancel
    const stillProTier = await getOrgTierInfo(org.id);
    expect(stillProTier.tierName).toBe('pro');
    expect(stillProTier.isFreeTier).toBe(false);

    // ================================================================
    // Step 8: Simulate subscription deleted (period ended)
    // ================================================================
    stripeSub.status = 'canceled' as any;
    stripeSub.canceled_at = Math.floor(Date.now() / 1000) as any;
    const deleteEvent = mockStripeEvent('customer.subscription.deleted', stripeSub);
    await processWebhookEvent(deleteEvent);

    // ================================================================
    // Step 9: Verify downgrade to starter
    // ================================================================
    const deletedSub = await getOrgSubscription(org.id);
    expect(deletedSub).toBeNull(); // No active subscription

    const downgraded = await getOrgTierInfo(org.id);
    expect(downgraded.tierName).toBe('starter');
    expect(downgraded.isFreeTier).toBe(true);
    expect(downgraded.limits.repositories).toBe(5);
    expect(downgraded.limits.egressPerDay).toBe(50);

    // Starter repo limit enforcement kicks in (3 repos, limit 5 → still allowed)
    const postDowngradeRepoCheck = await checkOrgRepoLimit(org.id);
    expect(postDowngradeRepoCheck.allowed).toBe(true);
    expect(postDowngradeRepoCheck.current).toBe(3);
    expect(postDowngradeRepoCheck.limit).toBe(5);

    // Egress limit now capped at 50
    const postDowngradeEgress = await checkEgressLimit(org.id);
    expect(postDowngradeEgress.allowed).toBe(true); // 42 < 50
    expect(postDowngradeEgress.current).toBe(42);
    expect(postDowngradeEgress.limit).toBe(50);

    // ================================================================
    // Step 10: Data preserved after downgrade
    // ================================================================
    const orgRow = await db.query.organizations.findFirst({
      where: eq(organizations.id, org.id),
    });
    expect(orgRow).toBeTruthy();
    expect(orgRow!.stripeCustomerId).toBe(customerId);
    expect(orgRow!.name).toBe('Lifecycle Test Org');

    // Repos still exist
    const finalUsage = await getOrgUsage(org.id);
    expect(finalUsage.repos).toBe(3);

    // Egress sessions still exist
    const finalEgress = await getOrgEgressToday(org.id);
    expect(finalEgress).toBe(42);
  });
});
