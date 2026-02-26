/**
 * Tier Limits Service Tests
 * Tests for plan limit enforcement: repos, members, egress, SK nodes, context engine access.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  getOrgTierInfo,
  checkOrgRepoLimit,
  checkOrgMemberLimit,
  checkEgressLimit,
  checkSKNodeLimit,
  checkContextEngineAccess,
  getOrgEgressToday,
} from './tier-limits.service';
import { db } from '../db';
import {
  organizations,
  organizationMembers,
  users,
  passwordCredentials,
  repositories,
  contextEngineSessions,
  pricingTiers,
  subscriptions,
} from '../db/schema';
import type { PricingTierLimits, PricingTierFeatures } from '../db/schema';

// Use the service db for everything — avoids dual-pool deadlocks
let seq = 0;
function uid() { return `${Date.now()}_${++seq}`; }

async function truncate() {
  // Truncate in FK-safe order
  await db.execute(/* sql */`
    TRUNCATE TABLE context_engine_sessions, subscriptions, repositories,
      organization_members, pricing_tiers, password_credentials, users,
      organizations
    CASCADE
  `);
}

describe('Tier Limits Service', () => {
  beforeAll(async () => {
    await db.execute(/* sql */`SELECT 1`);
  });

  afterEach(async () => {
    await truncate();
  });

  async function createUserAndOrg() {
    const u = uid();
    const argon2 = await import('argon2');
    const hash = await argon2.hash('testpass');
    const [user] = await db.insert(users).values({
      username: `tier_user_${u}`,
      email: `tier_${u}@example.com`,
      displayName: 'Test',
      emailVerified: true,
    }).returning();
    await db.insert(passwordCredentials).values({
      userId: user.id,
      passwordHash: hash,
    });
    const [org] = await db.insert(organizations).values({
      slug: `tier-org-${u}`,
      name: 'Tier Test Org',
    }).returning();
    await db.insert(organizationMembers).values({
      organizationId: org.id,
      userId: user.id,
      role: 'owner',
    });
    return { user, org };
  }

  async function createTier(overrides: {
    limits?: Partial<PricingTierLimits>;
    features?: Partial<PricingTierFeatures>;
    basePriceMonthly?: number;
    name?: string;
  } = {}) {
    const name = overrides.name || `tier_${uid()}`;
    const [tier] = await db.insert(pricingTiers).values({
      name,
      displayName: name,
      limits: {
        environments: 1, repositories: 5, teamMembers: 3, storageGb: 1,
        buildMinutes: 500, configSets: 0, configSchemas: 0, configHistoryDays: 0,
        egressPerDay: 50, skNodesPerRepo: 100,
        ...overrides.limits,
      },
      features: {
        branchProtection: false, sso: false, customDomain: false, analytics: false,
        auditLogs: false, prioritySupport: false, sla: false, dedicatedInstance: false,
        ipAllowlisting: false, webhooks: true, apiAccess: true,
        configManagement: false, configExternalStores: false, configExports: false,
        mcpGateway: false, contextEngine: true,
        ...overrides.features,
      },
      basePriceMonthly: overrides.basePriceMonthly ?? 0,
    }).returning();
    return tier;
  }

  async function createSub(orgId: string, tierId: string) {
    const customerId = `cus_${uid()}`;
    await db.update(organizations)
      .set({ stripeCustomerId: customerId })
      .where(eq(organizations.id, orgId));
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

  async function createRepo(orgId: string) {
    const u = uid();
    const [repo] = await db.insert(repositories).values({
      name: `Repo ${u}`, slug: `repo-${u}`,
      organizationId: orgId, visibility: 'private', defaultBranch: 'main',
    }).returning();
    return repo;
  }

  async function createCESession(repoId: string, userId: string, turnCount: number) {
    const [session] = await db.insert(contextEngineSessions).values({
      sessionId: `ses_${uid()}`,
      repositoryId: repoId,
      userId,
      lastTurnCount: turnCount,
      lastActivityAt: new Date(),
    }).returning();
    return session;
  }

  // ========================================================================
  // getOrgTierInfo
  // ========================================================================
  describe('getOrgTierInfo', () => {
    it('returns starter defaults when no subscription', async () => {
      const { org } = await createUserAndOrg();
      const info = await getOrgTierInfo(org.id);
      expect(info.tierName).toBe('starter');
      expect(info.isFreeTier).toBe(true);
      expect(info.limits.egressPerDay).toBe(50);
      expect(info.limits.skNodesPerRepo).toBe(100);
      expect(info.features.contextEngine).toBe(true);
    });

    it('returns tier from active subscription', async () => {
      const { org } = await createUserAndOrg();
      const tier = await createTier({
        limits: { repositories: null, egressPerDay: null, skNodesPerRepo: null },
        features: { contextEngine: true, mcpGateway: true },
        basePriceMonthly: 2900,
      });
      await createSub(org.id, tier.id);
      const info = await getOrgTierInfo(org.id);
      expect(info.tierName).toBe(tier.name);
      expect(info.isFreeTier).toBe(false);
      expect(info.limits.egressPerDay).toBeNull();
    });
  });

  // ========================================================================
  // checkOrgRepoLimit
  // ========================================================================
  describe('checkOrgRepoLimit', () => {
    it('allows when under limit', async () => {
      const { org } = await createUserAndOrg();
      const result = await checkOrgRepoLimit(org.id);
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(0);
    });

    it('blocks at limit', async () => {
      const { org } = await createUserAndOrg();
      const tier = await createTier({ limits: { repositories: 1 } });
      await createSub(org.id, tier.id);
      await createRepo(org.id);
      const result = await checkOrgRepoLimit(org.id);
      expect(result.allowed).toBe(false);
      expect(result.current).toBe(1);
      expect(result.limit).toBe(1);
    });

    it('allows unlimited when null', async () => {
      const { org } = await createUserAndOrg();
      const tier = await createTier({ limits: { repositories: null }, basePriceMonthly: 2900 });
      await createSub(org.id, tier.id);
      for (let i = 0; i < 10; i++) await createRepo(org.id);
      const result = await checkOrgRepoLimit(org.id);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(-1);
    });
  });

  // ========================================================================
  // checkOrgMemberLimit
  // ========================================================================
  describe('checkOrgMemberLimit', () => {
    it('blocks at member limit', async () => {
      const { org } = await createUserAndOrg();
      const tier = await createTier({ limits: { teamMembers: 1 } });
      await createSub(org.id, tier.id);
      const result = await checkOrgMemberLimit(org.id);
      expect(result.allowed).toBe(false);
      expect(result.current).toBe(1);
    });
  });

  // ========================================================================
  // checkContextEngineAccess
  // ========================================================================
  describe('checkContextEngineAccess', () => {
    it('allows when contextEngine is true', async () => {
      const { org } = await createUserAndOrg();
      const tier = await createTier({ features: { contextEngine: true } });
      await createSub(org.id, tier.id);
      const result = await checkContextEngineAccess(org.id);
      expect(result.allowed).toBe(true);
    });

    it('denies when contextEngine is false', async () => {
      const { org } = await createUserAndOrg();
      const tier = await createTier({ features: { contextEngine: false } });
      await createSub(org.id, tier.id);
      const result = await checkContextEngineAccess(org.id);
      expect(result.allowed).toBe(false);
    });
  });

  // ========================================================================
  // checkEgressLimit
  // ========================================================================
  describe('checkEgressLimit', () => {
    it('allows under daily limit', async () => {
      const { user, org } = await createUserAndOrg();
      const tier = await createTier({ limits: { egressPerDay: 50 } });
      await createSub(org.id, tier.id);
      const repo = await createRepo(org.id);
      await createCESession(repo.id, user.id, 10);
      const result = await checkEgressLimit(org.id);
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(10);
      expect(result.limit).toBe(50);
    });

    it('blocks at daily limit', async () => {
      const { user, org } = await createUserAndOrg();
      const tier = await createTier({ limits: { egressPerDay: 50 } });
      await createSub(org.id, tier.id);
      const repo = await createRepo(org.id);
      await createCESession(repo.id, user.id, 50);
      const result = await checkEgressLimit(org.id);
      expect(result.allowed).toBe(false);
      expect(result.current).toBe(50);
      expect(result.limit).toBe(50);
    });

    it('allows unlimited when null', async () => {
      const { user, org } = await createUserAndOrg();
      const tier = await createTier({ limits: { egressPerDay: null }, basePriceMonthly: 2900 });
      await createSub(org.id, tier.id);
      const repo = await createRepo(org.id);
      await createCESession(repo.id, user.id, 999);
      const result = await checkEgressLimit(org.id);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(-1);
    });

    it('includes tierName', async () => {
      const { org } = await createUserAndOrg();
      const tier = await createTier({ limits: { egressPerDay: 50 } });
      await createSub(org.id, tier.id);
      const result = await checkEgressLimit(org.id);
      expect(result.tierName).toBe(tier.name);
    });
  });

  // ========================================================================
  // checkSKNodeLimit
  // ========================================================================
  describe('checkSKNodeLimit', () => {
    it('allows under limit', async () => {
      const { user, org } = await createUserAndOrg();
      const tier = await createTier({ limits: { skNodesPerRepo: 100 } });
      await createSub(org.id, tier.id);
      const repo = await createRepo(org.id);
      await createCESession(repo.id, user.id, 50);
      const result = await checkSKNodeLimit(org.id, repo.id);
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(50);
    });

    it('blocks at limit', async () => {
      const { user, org } = await createUserAndOrg();
      const tier = await createTier({ limits: { skNodesPerRepo: 100 } });
      await createSub(org.id, tier.id);
      const repo = await createRepo(org.id);
      await createCESession(repo.id, user.id, 100);
      const result = await checkSKNodeLimit(org.id, repo.id);
      expect(result.allowed).toBe(false);
      expect(result.current).toBe(100);
    });

    it('allows unlimited when null', async () => {
      const { user, org } = await createUserAndOrg();
      const tier = await createTier({ limits: { skNodesPerRepo: null }, basePriceMonthly: 2900 });
      await createSub(org.id, tier.id);
      const repo = await createRepo(org.id);
      await createCESession(repo.id, user.id, 999);
      const result = await checkSKNodeLimit(org.id, repo.id);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(-1);
    });
  });

  // ========================================================================
  // getOrgEgressToday
  // ========================================================================
  describe('getOrgEgressToday', () => {
    it('returns 0 when no sessions', async () => {
      const { org } = await createUserAndOrg();
      expect(await getOrgEgressToday(org.id)).toBe(0);
    });

    it('sums turns across sessions', async () => {
      const { user, org } = await createUserAndOrg();
      const repo = await createRepo(org.id);
      await createCESession(repo.id, user.id, 10);
      await createCESession(repo.id, user.id, 20);
      expect(await getOrgEgressToday(org.id)).toBe(30);
    });
  });
});
