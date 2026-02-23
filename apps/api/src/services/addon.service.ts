import Stripe from 'stripe';
import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../db';
import {
  organizationAddons,
  subscriptions,
  pricingTiers,
  type OrganizationAddon,
  type NewOrganizationAddon,
  type SubscriptionStatus,
} from '../db/schema';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// ============================================================================
// Add-on Queries
// ============================================================================

/**
 * Get an active add-on for an organization by type
 */
export async function getOrgAddon(
  orgId: string,
  addonType: string,
): Promise<OrganizationAddon | null> {
  const addon = await db.query.organizationAddons.findFirst({
    where: and(
      eq(organizationAddons.organizationId, orgId),
      eq(organizationAddons.addonType, addonType),
      inArray(organizationAddons.status, ['active', 'trialing']),
    ),
  });

  return addon ?? null;
}

// ============================================================================
// Access Checks
// ============================================================================

/**
 * Check if an organization has MCP Gateway access.
 * Access is granted if:
 *  1. The org's pricing tier includes mcpGateway in features, OR
 *  2. The org has an active mcp_gateway add-on subscription
 */
export async function hasOrgMcpGatewayAccess(orgId: string): Promise<boolean> {
  // Check 1: Does the org's plan tier include MCP Gateway?
  const sub = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.organizationId, orgId),
      inArray(subscriptions.status, ['active', 'trialing']),
    ),
  });

  if (sub?.pricingTierId) {
    const tier = await db.query.pricingTiers.findFirst({
      where: eq(pricingTiers.id, sub.pricingTierId),
    });

    if (tier?.features && (tier.features as any).mcpGateway) {
      return true;
    }
  }

  // Check 2: Active MCP Gateway add-on?
  const addon = await getOrgAddon(orgId, 'mcp_gateway');
  return addon !== null;
}

// ============================================================================
// Stripe Sync
// ============================================================================

/**
 * Sync an add-on subscription from a Stripe webhook event
 */
export async function syncAddonFromStripe(
  stripeSubscription: Stripe.Subscription,
): Promise<OrganizationAddon> {
  const orgId = stripeSubscription.metadata.organizationId;
  const addonType = stripeSubscription.metadata.addonType;

  if (!orgId || !addonType) {
    throw new Error('Add-on subscription missing organizationId or addonType metadata');
  }

  const sub = stripeSubscription as any;
  const priceId = stripeSubscription.items.data[0]?.price.id;

  const addonData: NewOrganizationAddon = {
    organizationId: orgId,
    addonType,
    stripeSubscriptionId: sub.id,
    stripePriceId: priceId,
    status: sub.status as SubscriptionStatus,
    billingInterval: sub.metadata?.billingInterval || 'monthly',
    currentPeriodStart: sub.current_period_start
      ? new Date(sub.current_period_start * 1000)
      : null,
    currentPeriodEnd: sub.current_period_end
      ? new Date(sub.current_period_end * 1000)
      : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
    canceledAt: sub.canceled_at
      ? new Date(sub.canceled_at * 1000)
      : null,
    metadata: sub.metadata as Record<string, string>,
    updatedAt: new Date(),
  };

  // Upsert by Stripe subscription ID
  const existing = await db.query.organizationAddons.findFirst({
    where: eq(organizationAddons.stripeSubscriptionId, stripeSubscription.id),
  });

  let result: OrganizationAddon;

  if (existing) {
    const [updated] = await db
      .update(organizationAddons)
      .set(addonData)
      .where(eq(organizationAddons.id, existing.id))
      .returning();
    result = updated;
  } else {
    const [created] = await db
      .insert(organizationAddons)
      .values(addonData)
      .returning();
    result = created;
  }

  logger.info('general', 'Add-on synced from Stripe', {
    addonId: result.id,
    addonType,
    stripeSubscriptionId: stripeSubscription.id,
    status: result.status,
  });

  return result;
}

// ============================================================================
// Redundant Add-on Cancellation
// ============================================================================

/**
 * Cancel MCP Gateway add-on when org upgrades to a tier that includes it.
 * Only cancels if the tier's features include mcpGateway: true.
 */
export async function cancelRedundantAddons(
  orgId: string,
  tierName: string,
): Promise<void> {
  // Only cancel if the new tier includes MCP Gateway
  const tier = await db.query.pricingTiers.findFirst({
    where: eq(pricingTiers.name, tierName),
  });

  if (!tier?.features || !(tier.features as any).mcpGateway) {
    return; // Tier doesn't include MCP Gateway, keep the add-on
  }

  // Find active MCP Gateway add-on
  const addon = await getOrgAddon(orgId, 'mcp_gateway');
  if (!addon?.stripeSubscriptionId) {
    return; // No active add-on to cancel
  }

  // Cancel via Stripe API
  if (!env.STRIPE_SECRET_KEY) {
    logger.warn('general', 'Cannot cancel redundant add-on: Stripe not configured', { orgId });
    return;
  }

  try {
    const stripe = new Stripe(env.STRIPE_SECRET_KEY);
    await stripe.subscriptions.cancel(addon.stripeSubscriptionId);

    logger.info('general', 'Canceled redundant MCP Gateway add-on', {
      orgId,
      addonId: addon.id,
      stripeSubscriptionId: addon.stripeSubscriptionId,
      reason: `Org upgraded to ${tierName} which includes MCP Gateway`,
    });
  } catch (err) {
    logger.error('general', 'Failed to cancel redundant MCP Gateway add-on', {
      orgId,
      addonId: addon.id,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
