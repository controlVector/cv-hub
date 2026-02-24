import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { ForbiddenError, NotFoundError } from '../utils/errors';
import type { AppEnv } from '../app';
import { env } from '../config/env';
import {
  createCheckoutSession,
  createPortalSession,
  getOrgSubscription,
  getStripePriceId,
  isStripeConfigured,
  verifyWebhookSignature,
  processWebhookEvent,
} from '../services/stripe.service';
import { getOrganizationById, isOrgAdmin } from '../services/organization.service';
import { getUserById } from '../services/user.service';
import { getPricingTierById } from '../services/pricing.service';
import { getOrgAddon } from '../services/addon.service';
import { getOrgCreditBalance } from '../services/credit.service';

const stripeRoutes = new Hono<AppEnv>();

// ============================================================================
// PUBLIC ROUTES
// ============================================================================

/**
 * GET /api/stripe/config
 * Get Stripe publishable key (for frontend)
 */
stripeRoutes.get('/config', (c) => {
  return c.json({
    publishableKey: env.STRIPE_PUBLISHABLE_KEY || null,
    configured: isStripeConfigured(),
  });
});

// ============================================================================
// WEBHOOK (no auth - verified by signature)
// ============================================================================

/**
 * POST /api/stripe/webhook
 * Handle Stripe webhook events
 */
stripeRoutes.post('/webhook', async (c) => {
  const signature = c.req.header('stripe-signature');

  if (!signature) {
    return c.json({ error: 'Missing stripe-signature header' }, 400);
  }

  let event;
  try {
    // Get raw body for signature verification
    const body = await c.req.text();
    event = verifyWebhookSignature(body, signature);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook signature verification failed';
    console.error('Stripe webhook signature error:', message);
    return c.json({ error: message }, 400);
  }

  try {
    await processWebhookEvent(event);
  } catch (err) {
    // Always return 200 to Stripe so it doesn't retry endlessly.
    // The error is already persisted via markEventProcessed().
    console.error('Stripe webhook processing error:', err instanceof Error ? err.message : err);
  }

  return c.json({ received: true });
});

// ============================================================================
// AUTHENTICATED ROUTES
// ============================================================================

/**
 * POST /api/stripe/buy-credits
 * Purchase a credit pack (one-time payment)
 */
const buyCreditsSchema = z.object({
  organizationId: z.string().uuid(),
  pack: z.enum(['500', '2000', '5000']),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

const CREDIT_PACKS: Record<string, { credits: number; priceEnvKey: 'STRIPE_PRICE_CREDITS_500' | 'STRIPE_PRICE_CREDITS_2000' | 'STRIPE_PRICE_CREDITS_5000' }> = {
  '500':  { credits: 500,  priceEnvKey: 'STRIPE_PRICE_CREDITS_500' },
  '2000': { credits: 2000, priceEnvKey: 'STRIPE_PRICE_CREDITS_2000' },
  '5000': { credits: 5000, priceEnvKey: 'STRIPE_PRICE_CREDITS_5000' },
};

stripeRoutes.post(
  '/buy-credits',
  requireAuth,
  zValidator('json', buyCreditsSchema),
  async (c) => {
    const userId = c.get('userId')!;
    const input = c.req.valid('json');

    // Verify user is org admin
    const isAdmin = await isOrgAdmin(input.organizationId, userId);
    if (!isAdmin) {
      throw new ForbiddenError('Only organization admins can purchase credits');
    }

    const org = await getOrganizationById(input.organizationId);
    if (!org) throw new NotFoundError('Organization');

    const user = await getUserById(userId);
    if (!user) throw new NotFoundError('User');

    const pack = CREDIT_PACKS[input.pack];
    const priceId = env[pack.priceEnvKey];
    if (!priceId) {
      return c.json({
        error: { code: 'NO_PRICE', message: 'Credit pack pricing not configured.' },
      }, 400);
    }

    const checkoutUrl = await createCheckoutSession({
      organizationId: input.organizationId,
      priceId,
      customerEmail: user.email,
      customerName: org.name,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      mode: 'payment',
      sessionMetadata: {
        creditPack: input.pack,
        credits: String(pack.credits),
      },
    });

    return c.json({ url: checkoutUrl });
  }
);

/**
 * POST /api/stripe/checkout
 * Create checkout session for organization upgrade
 */
const checkoutSchema = z.object({
  organizationId: z.string().uuid(),
  tier: z.enum(['pro', 'enterprise']).optional(),
  product: z.enum(['cv-hub', 'cv-safe', 'mcp-gateway']).default('cv-hub'),
  billingInterval: z.enum(['monthly', 'annual']).default('monthly'),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

stripeRoutes.post(
  '/checkout',
  requireAuth,
  zValidator('json', checkoutSchema),
  async (c) => {
    const userId = c.get('userId')!;
    const input = c.req.valid('json');

    // Verify user is org admin
    const isAdmin = await isOrgAdmin(input.organizationId, userId);
    if (!isAdmin) {
      throw new ForbiddenError('Only organization admins can manage billing');
    }

    // Get org details
    const org = await getOrganizationById(input.organizationId);
    if (!org) {
      throw new NotFoundError('Organization');
    }

    // Get user for email
    const user = await getUserById(userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    // Block duplicate plan subscriptions (add-ons are allowed alongside a plan)
    const isAddon = input.product === 'mcp-gateway';
    if (!isAddon) {
      const existingSub = await getOrgSubscription(input.organizationId);
      if (existingSub) {
        return c.json({
          error: { code: 'ALREADY_SUBSCRIBED', message: 'Organization already has an active subscription.' },
        }, 400);
      }
    }

    // Add-on products don't require a tier
    if (!isAddon && !input.tier) {
      return c.json({
        error: { code: 'MISSING_TIER', message: 'Tier is required for plan subscriptions.' },
      }, 400);
    }

    // Get Stripe price ID
    const priceId = getStripePriceId(input.tier || '', input.billingInterval, input.product);
    if (!priceId) {
      return c.json({
        error: {
          code: 'NO_PRICE',
          message: input.tier === 'enterprise'
            ? 'Enterprise plans require a custom quote. Please contact sales.'
            : 'Pricing not configured for this product.',
        },
      }, 400);
    }

    // Create checkout session (add addonType metadata for add-on products)
    const checkoutUrl = await createCheckoutSession({
      organizationId: input.organizationId,
      priceId,
      customerEmail: user.email,
      customerName: org.name,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      billingInterval: input.billingInterval,
      ...(isAddon ? { addonType: 'mcp_gateway' } : {}),
    });

    return c.json({ url: checkoutUrl });
  }
);

/**
 * POST /api/stripe/portal
 * Create billing portal session for subscription management
 */
const portalSchema = z.object({
  organizationId: z.string().uuid(),
  returnUrl: z.string().url(),
});

stripeRoutes.post(
  '/portal',
  requireAuth,
  zValidator('json', portalSchema),
  async (c) => {
    const userId = c.get('userId')!;
    const input = c.req.valid('json');

    // Verify user is org admin
    const isAdmin = await isOrgAdmin(input.organizationId, userId);
    if (!isAdmin) {
      throw new ForbiddenError('Only organization admins can manage billing');
    }

    try {
      const portalUrl = await createPortalSession(input.organizationId, input.returnUrl);
      return c.json({ url: portalUrl });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Portal error';
      return c.json({
        error: {
          code: 'PORTAL_ERROR',
          message,
        },
      }, 400);
    }
  }
);

/**
 * GET /api/stripe/subscription/:orgId
 * Get subscription status for organization
 */
stripeRoutes.get('/subscription/:orgId', requireAuth, async (c) => {
  const userId = c.get('userId')!;
  const orgId = c.req.param('orgId');

  // Verify user is org member (at least)
  const org = await getOrganizationById(orgId);
  if (!org) {
    throw new NotFoundError('Organization');
  }

  // Get subscription
  const subscription = await getOrgSubscription(orgId);

  // Fetch credits for org
  const credits = await getOrgCreditBalance(orgId);

  if (!subscription) {
    const mcpAddon = await getOrgAddon(orgId, 'mcp_gateway');
    return c.json({
      subscription: null,
      tier: 'starter',
      status: 'free',
      credits,
      addons: {
        mcpGateway: mcpAddon
          ? { status: mcpAddon.status, cancelAtPeriodEnd: mcpAddon.cancelAtPeriodEnd }
          : null,
      },
    });
  }

  // Resolve actual tier name from DB
  let tierName = 'starter';
  let tierDisplayName = 'Starter';
  if (subscription.pricingTierId) {
    const tier = await getPricingTierById(subscription.pricingTierId);
    if (tier) {
      tierName = tier.name;
      tierDisplayName = tier.displayName;
    }
  }

  // Fetch MCP Gateway add-on status
  const mcpAddon = await getOrgAddon(orgId, 'mcp_gateway');

  return c.json({
    subscription: {
      id: subscription.id,
      status: subscription.status,
      billingInterval: subscription.billingInterval,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    },
    tier: tierName,
    tierDisplayName,
    status: subscription.status,
    credits,
    addons: {
      mcpGateway: mcpAddon
        ? { status: mcpAddon.status, cancelAtPeriodEnd: mcpAddon.cancelAtPeriodEnd }
        : null,
    },
  });
});

export { stripeRoutes };
