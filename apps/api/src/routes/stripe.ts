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

  try {
    // Get raw body for signature verification
    const body = await c.req.text();
    const event = verifyWebhookSignature(body, signature);

    await processWebhookEvent(event);

    return c.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook error';
    console.error('Stripe webhook error:', message);
    return c.json({ error: message }, 400);
  }
});

// ============================================================================
// AUTHENTICATED ROUTES
// ============================================================================

/**
 * POST /api/stripe/checkout
 * Create checkout session for organization upgrade
 */
const checkoutSchema = z.object({
  organizationId: z.string().uuid(),
  tier: z.enum(['pro', 'enterprise']),
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

    // Get Stripe price ID
    const priceId = getStripePriceId(input.tier, input.billingInterval);
    if (!priceId) {
      return c.json({
        error: {
          code: 'NO_PRICE',
          message: input.tier === 'enterprise'
            ? 'Enterprise plans require a custom quote. Please contact sales.'
            : 'Pricing not configured for this tier.',
        },
      }, 400);
    }

    // Create checkout session
    const checkoutUrl = await createCheckoutSession({
      organizationId: input.organizationId,
      priceId,
      customerEmail: user.email,
      customerName: org.name,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      billingInterval: input.billingInterval,
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

  if (!subscription) {
    return c.json({
      subscription: null,
      tier: 'starter',
      status: 'free',
    });
  }

  return c.json({
    subscription: {
      id: subscription.id,
      status: subscription.status,
      billingInterval: subscription.billingInterval,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    },
    tier: subscription.pricingTierId ? 'pro' : 'starter',
    status: subscription.status,
  });
});

export { stripeRoutes };
