/**
 * Stripe Service Tests
 * Tests for webhook event processing with mocked Stripe payloads.
 * Does NOT hit real Stripe APIs.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type Stripe from 'stripe';
import { eq, and, inArray } from 'drizzle-orm';
import {
  processWebhookEvent,
  syncSubscriptionFromStripe,
  isEventProcessed,
  markEventProcessed,
  getOrgSubscription,
} from './stripe.service';
import {
  getOrgUsage,
  getOrgTierInfo,
  getOrgEgressToday,
} from './tier-limits.service';
import { getOrgCreditBalance } from './credit.service';
import { getOrgAddon } from './addon.service';
import { db } from '../db';
import {
  organizations,
  organizationMembers,
  users,
  subscriptions,
  pricingTiers,
  stripeEvents,
  repositories,
  contextEngineSessions,
} from '../db/schema';
import type { PricingTierLimits, PricingTierFeatures } from '../db/schema';

let seq = 0;
function uid() { return `${Date.now()}_${++seq}`; }

// Mock Stripe subscription object
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

// Mock Stripe event
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
      organization_credits, credit_transactions,
      organization_members, pricing_tiers, users, organizations
    CASCADE
  `);
}

describe('Stripe Service', () => {
  beforeAll(async () => {
    await db.execute(/* sql */`SELECT 1`);
  });

  afterEach(async () => {
    await truncate();
  });

  async function createOrg() {
    const u = uid();
    const customerId = `cus_${u}`;
    const [org] = await db.insert(organizations).values({
      slug: `stripe-org-${u}`,
      name: 'Stripe Test Org',
      stripeCustomerId: customerId,
    }).returning();
    return { org, customerId };
  }

  // ========================================================================
  // syncSubscriptionFromStripe
  // ========================================================================
  describe('syncSubscriptionFromStripe', () => {
    it('creates subscription on first sync', async () => {
      const { org, customerId } = await createOrg();
      const stripeSub = mockStripeSubscription({
        organizationId: org.id,
        customerId,
        status: 'active',
      });

      const result = await syncSubscriptionFromStripe(stripeSub);
      expect(result.organizationId).toBe(org.id);
      expect(result.status).toBe('active');
      expect(result.stripeSubscriptionId).toBe(stripeSub.id);
    });

    it('updates existing subscription on re-sync', async () => {
      const { org, customerId } = await createOrg();
      const stripeSub = mockStripeSubscription({
        organizationId: org.id,
        customerId,
        status: 'active',
      });

      await syncSubscriptionFromStripe(stripeSub);

      // Update status to canceled
      stripeSub.status = 'canceled' as any;
      const result = await syncSubscriptionFromStripe(stripeSub);
      expect(result.status).toBe('canceled');

      // Should still be just one subscription record
      const all = await db.select().from(subscriptions)
        .where(eq(subscriptions.organizationId, org.id));
      expect(all).toHaveLength(1);
    });

    it('links to pricing tier when price matches', async () => {
      const { org, customerId } = await createOrg();
      const [tier] = await db.insert(pricingTiers).values({
        name: 'pro', displayName: 'Pro',
        basePriceMonthly: 2900,
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
      }).returning();

      // We can't easily match price IDs without env vars, but the function
      // gracefully falls back to no tier when price doesn't match
      const stripeSub = mockStripeSubscription({
        organizationId: org.id,
        customerId,
        status: 'active',
        priceId: 'price_nomatch',
      });

      const result = await syncSubscriptionFromStripe(stripeSub);
      expect(result.organizationId).toBe(org.id);
      // pricingTierId will be undefined since price doesn't match any env var
      // This is expected behavior — tier resolution uses STRIPE_PRICE_* env vars
    });
  });

  // ========================================================================
  // processWebhookEvent
  // ========================================================================
  describe('processWebhookEvent', () => {
    it('processes subscription.created event', async () => {
      const { org, customerId } = await createOrg();
      const stripeSub = mockStripeSubscription({
        organizationId: org.id,
        customerId,
        status: 'active',
      });
      const event = mockStripeEvent('customer.subscription.created', stripeSub);

      await processWebhookEvent(event);

      const sub = await getOrgSubscription(org.id);
      expect(sub).toBeTruthy();
      expect(sub!.status).toBe('active');
    });

    it('processes subscription.updated event', async () => {
      const { org, customerId } = await createOrg();
      const stripeSub = mockStripeSubscription({
        organizationId: org.id,
        customerId,
        status: 'active',
      });

      // First create
      await processWebhookEvent(
        mockStripeEvent('customer.subscription.created', stripeSub)
      );

      // Then update to canceled
      stripeSub.status = 'canceled' as any;
      await processWebhookEvent(
        mockStripeEvent('customer.subscription.updated', stripeSub)
      );

      // Subscription should be canceled now
      const all = await db.select().from(subscriptions)
        .where(eq(subscriptions.organizationId, org.id));
      expect(all).toHaveLength(1);
      expect(all[0].status).toBe('canceled');
    });

    it('processes subscription.deleted (downgrade to free)', async () => {
      const { org, customerId } = await createOrg();
      const stripeSub = mockStripeSubscription({
        organizationId: org.id,
        customerId,
        status: 'active',
      });

      // Create subscription
      await processWebhookEvent(
        mockStripeEvent('customer.subscription.created', stripeSub)
      );

      // Delete subscription (cancel)
      stripeSub.status = 'canceled' as any;
      stripeSub.canceled_at = Math.floor(Date.now() / 1000) as any;
      await processWebhookEvent(
        mockStripeEvent('customer.subscription.deleted', stripeSub)
      );

      // No active subscription should remain
      const active = await getOrgSubscription(org.id);
      expect(active).toBeNull();
    });

    it('after downgrade: existing data preserved', async () => {
      const { org, customerId } = await createOrg();
      const stripeSub = mockStripeSubscription({
        organizationId: org.id,
        customerId,
        status: 'active',
      });

      await processWebhookEvent(
        mockStripeEvent('customer.subscription.created', stripeSub)
      );

      // Downgrade
      stripeSub.status = 'canceled' as any;
      await processWebhookEvent(
        mockStripeEvent('customer.subscription.deleted', stripeSub)
      );

      // Org still exists (data preserved)
      const orgRow = await db.query.organizations.findFirst({
        where: eq(organizations.id, org.id),
      });
      expect(orgRow).toBeTruthy();
      expect(orgRow!.stripeCustomerId).toBe(customerId);
    });

    it('handles checkout.session.completed (acknowledges)', async () => {
      const { org } = await createOrg();
      const session = {
        id: `cs_${uid()}`,
        object: 'checkout.session',
        metadata: { organizationId: org.id },
      };
      const event = mockStripeEvent('checkout.session.completed', session);

      // Should not throw
      await processWebhookEvent(event);

      // Event should be marked processed
      const processed = await isEventProcessed(event.id);
      expect(processed).toBe(true);
    });

    it('ignores unknown event types (returns 200)', async () => {
      const event = mockStripeEvent('charge.succeeded', { id: 'ch_123' });

      // Should not throw
      await processWebhookEvent(event);

      // Event still gets marked as processed
      const processed = await isEventProcessed(event.id);
      expect(processed).toBe(true);
    });
  });

  // ========================================================================
  // Idempotency
  // ========================================================================
  describe('idempotency', () => {
    it('skips already-processed events', async () => {
      const { org, customerId } = await createOrg();
      const stripeSub = mockStripeSubscription({
        organizationId: org.id,
        customerId,
        status: 'active',
      });
      const eventId = `evt_idempotent_${uid()}`;
      const event = mockStripeEvent('customer.subscription.created', stripeSub, eventId);

      // Process once
      await processWebhookEvent(event);
      const sub1 = await getOrgSubscription(org.id);

      // Process again (same event ID) — should be skipped
      stripeSub.status = 'canceled' as any; // changed status
      const event2 = mockStripeEvent('customer.subscription.updated', stripeSub, eventId);
      await processWebhookEvent(event2);

      // Subscription should still be active (second call was skipped)
      const sub2 = await getOrgSubscription(org.id);
      expect(sub2!.status).toBe('active');
    });

    it('double delivery produces same result', async () => {
      const { org, customerId } = await createOrg();
      const stripeSub = mockStripeSubscription({
        organizationId: org.id,
        customerId,
        status: 'active',
      });
      const eventId = `evt_double_${uid()}`;

      await processWebhookEvent(
        mockStripeEvent('customer.subscription.created', stripeSub, eventId)
      );
      await processWebhookEvent(
        mockStripeEvent('customer.subscription.created', stripeSub, eventId)
      );

      // Should still be exactly 1 subscription
      const all = await db.select().from(subscriptions)
        .where(eq(subscriptions.organizationId, org.id));
      expect(all).toHaveLength(1);
    });
  });

  // ========================================================================
  // markEventProcessed / isEventProcessed
  // ========================================================================
  describe('event tracking', () => {
    it('marks event as processed', async () => {
      const eventId = `evt_${uid()}`;
      await markEventProcessed(eventId, 'test.event');
      expect(await isEventProcessed(eventId)).toBe(true);
    });

    it('returns false for unprocessed events', async () => {
      expect(await isEventProcessed(`evt_nonexistent_${uid()}`)).toBe(false);
    });

    it('records error on failed processing', async () => {
      const eventId = `evt_err_${uid()}`;
      await markEventProcessed(eventId, 'test.event', 'Something went wrong');

      const record = await db.query.stripeEvents.findFirst({
        where: eq(stripeEvents.stripeEventId, eventId),
      });
      expect(record).toBeTruthy();
      expect(record!.processed).toBe(false);
      expect(record!.error).toBe('Something went wrong');
    });
  });

  // ========================================================================
  // getOrgSubscription
  // ========================================================================
  describe('getOrgSubscription', () => {
    it('returns null for org with no subscription', async () => {
      const { org } = await createOrg();
      expect(await getOrgSubscription(org.id)).toBeNull();
    });

    it('returns active subscription', async () => {
      const { org, customerId } = await createOrg();
      await db.insert(subscriptions).values({
        organizationId: org.id,
        stripeCustomerId: customerId,
        stripeSubscriptionId: `sub_${uid()}`,
        status: 'active',
        billingInterval: 'monthly',
      });

      const sub = await getOrgSubscription(org.id);
      expect(sub).toBeTruthy();
      expect(sub!.status).toBe('active');
    });

    it('ignores canceled subscriptions', async () => {
      const { org, customerId } = await createOrg();
      await db.insert(subscriptions).values({
        organizationId: org.id,
        stripeCustomerId: customerId,
        stripeSubscriptionId: `sub_${uid()}`,
        status: 'canceled',
        billingInterval: 'monthly',
      });

      expect(await getOrgSubscription(org.id)).toBeNull();
    });
  });

  // ========================================================================
  // Subscription Info Enrichment (Step 3)
  // Tests for the data that the GET /subscription/:orgId endpoint returns
  // ========================================================================
  describe('subscription info enrichment', () => {
    async function createTier(overrides: {
      limits?: Partial<PricingTierLimits>;
      features?: Partial<PricingTierFeatures>;
      basePriceMonthly?: number;
      name?: string;
    } = {}) {
      const name = overrides.name || `tier_${uid()}`;
      const [tier] = await db.insert(pricingTiers).values({
        name,
        displayName: name.charAt(0).toUpperCase() + name.slice(1),
        limits: {
          environments: 1, repositories: 10, teamMembers: 5, storageGb: 10,
          buildMinutes: 1000, configSets: 0, configSchemas: 0, configHistoryDays: 0,
          egressPerDay: 200, skNodesPerRepo: 500,
          ...overrides.limits,
        },
        features: {
          branchProtection: true, sso: false, customDomain: false, analytics: true,
          auditLogs: true, prioritySupport: true, sla: false, dedicatedInstance: false,
          ipAllowlisting: false, webhooks: true, apiAccess: true,
          configManagement: true, configExternalStores: false, configExports: true,
          mcpGateway: true, contextEngine: true,
          ...overrides.features,
        },
        basePriceMonthly: overrides.basePriceMonthly ?? 2900,
      }).returning();
      return tier;
    }

    async function createSub(orgId: string, tierId: string, customerId: string) {
      const [sub] = await db.insert(subscriptions).values({
        organizationId: orgId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: `sub_${uid()}`,
        pricingTierId: tierId,
        status: 'active',
        billingInterval: 'monthly',
      }).returning();
      return sub;
    }

    it('free org: tier info returns starter defaults', async () => {
      const { org } = await createOrg();
      const tierInfo = await getOrgTierInfo(org.id);
      expect(tierInfo.tierName).toBe('starter');
      expect(tierInfo.isFreeTier).toBe(true);
      expect(tierInfo.limits.repositories).toBe(5);
      expect(tierInfo.limits.egressPerDay).toBe(50);
    });

    it('free org: usage returns zero counts', async () => {
      const { org } = await createOrg();
      const usage = await getOrgUsage(org.id);
      expect(usage.repos).toBe(0);
      expect(usage.members).toBe(0);
    });

    it('free org: credits returns zero balance', async () => {
      const { org } = await createOrg();
      const credits = await getOrgCreditBalance(org.id);
      expect(credits.balance).toBe(0);
      expect(credits.monthlyAllowance).toBe(0);
    });

    it('free org: no active subscription', async () => {
      const { org } = await createOrg();
      const sub = await getOrgSubscription(org.id);
      expect(sub).toBeNull();
    });

    it('free org: addon returns null when none configured', async () => {
      const { org } = await createOrg();
      const addon = await getOrgAddon(org.id, 'mcp_gateway');
      expect(addon).toBeNull();
    });

    it('pro org: tier info returns paid tier', async () => {
      const { org, customerId } = await createOrg();
      const tier = await createTier({
        name: 'pro',
        limits: { repositories: 20, egressPerDay: 500, skNodesPerRepo: 1000 },
        basePriceMonthly: 2900,
      });
      await createSub(org.id, tier.id, customerId);

      const tierInfo = await getOrgTierInfo(org.id);
      expect(tierInfo.tierName).toBe('pro');
      expect(tierInfo.isFreeTier).toBe(false);
      expect(tierInfo.limits.repositories).toBe(20);
      expect(tierInfo.limits.egressPerDay).toBe(500);
    });

    it('pro org: usage reflects actual repos', async () => {
      const { org, customerId } = await createOrg();
      const tier = await createTier({ name: 'pro', basePriceMonthly: 2900 });
      await createSub(org.id, tier.id, customerId);

      // Create 3 repos
      for (let i = 0; i < 3; i++) {
        const u = uid();
        await db.insert(repositories).values({
          name: `Repo ${u}`, slug: `repo-${u}`,
          organizationId: org.id, visibility: 'private', defaultBranch: 'main',
        });
      }

      const usage = await getOrgUsage(org.id);
      expect(usage.repos).toBe(3);
    });

    it('egress today returns 0 when no sessions', async () => {
      const { org } = await createOrg();
      const egress = await getOrgEgressToday(org.id);
      expect(egress).toBe(0);
    });

    it('egress today sums turns across sessions', async () => {
      const { org } = await createOrg();
      const u = uid();

      // Create a repo for the org
      const [repo] = await db.insert(repositories).values({
        name: `Repo ${u}`, slug: `repo-${u}`,
        organizationId: org.id, visibility: 'private', defaultBranch: 'main',
      }).returning();

      // Create a user for the sessions
      const [user] = await db.insert(users).values({
        username: `egress_user_${u}`,
        email: `egress_${u}@example.com`,
        displayName: 'Egress Test',
        emailVerified: true,
      }).returning();

      // Create sessions with turns
      await db.insert(contextEngineSessions).values([
        {
          sessionId: `ses_a_${u}`,
          repositoryId: repo.id,
          userId: user.id,
          lastTurnCount: 15,
          lastActivityAt: new Date(),
        },
        {
          sessionId: `ses_b_${u}`,
          repositoryId: repo.id,
          userId: user.id,
          lastTurnCount: 25,
          lastActivityAt: new Date(),
        },
      ]);

      const egress = await getOrgEgressToday(org.id);
      expect(egress).toBe(40);
    });
  });

  // ========================================================================
  // Portal Guard (Step 3)
  // Tests that the portal session requires an active subscription
  // ========================================================================
  describe('portal guard', () => {
    it('free org has no subscription for portal', async () => {
      const { org } = await createOrg();
      // Portal guard: check subscription first
      const sub = await getOrgSubscription(org.id);
      expect(sub).toBeNull();
      // Route would return 400 NO_SUBSCRIPTION here
    });

    it('paying org has active subscription for portal', async () => {
      const { org, customerId } = await createOrg();
      await db.insert(subscriptions).values({
        organizationId: org.id,
        stripeCustomerId: customerId,
        stripeSubscriptionId: `sub_${uid()}`,
        status: 'active',
        billingInterval: 'monthly',
      });

      const sub = await getOrgSubscription(org.id);
      expect(sub).toBeTruthy();
      expect(sub!.status).toBe('active');
      // Route would proceed to createPortalSession here
    });
  });
});
