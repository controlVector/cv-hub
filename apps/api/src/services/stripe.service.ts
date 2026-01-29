import Stripe from 'stripe';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import {
  subscriptions,
  paymentMethods,
  invoices,
  stripeEvents,
  organizations,
  pricingTiers,
  type Subscription,
  type NewSubscription,
  type PaymentMethod,
  type Invoice,
  type SubscriptionStatus,
} from '../db/schema';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// Initialize Stripe client (use latest API version)
const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY)
  : null;

function getStripe(): Stripe {
  if (!stripe) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY environment variable.');
  }
  return stripe;
}

// ============================================================================
// Customer Management
// ============================================================================

/**
 * Create or get Stripe customer for an organization
 */
export async function getOrCreateStripeCustomer(
  orgId: string,
  email: string,
  name: string
): Promise<string> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });

  if (!org) {
    throw new Error('Organization not found');
  }

  // Return existing customer ID if present
  if (org.stripeCustomerId) {
    return org.stripeCustomerId;
  }

  // Create new Stripe customer
  const customer = await getStripe().customers.create({
    email,
    name,
    metadata: {
      organizationId: orgId,
      organizationSlug: org.slug,
    },
  });

  // Store customer ID on org
  await db
    .update(organizations)
    .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));

  logger.info('general', 'Stripe customer created', { orgId, customerId: customer.id });

  return customer.id;
}

// ============================================================================
// Checkout Sessions
// ============================================================================

export interface CreateCheckoutInput {
  organizationId: string;
  priceId: string;
  customerEmail: string;
  customerName: string;
  successUrl: string;
  cancelUrl: string;
  billingInterval?: 'monthly' | 'annual';
}

/**
 * Create a Stripe checkout session for subscription
 */
export async function createCheckoutSession(input: CreateCheckoutInput): Promise<string> {
  const customerId = await getOrCreateStripeCustomer(
    input.organizationId,
    input.customerEmail,
    input.customerName
  );

  const session = await getStripe().checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [
      {
        price: input.priceId,
        quantity: 1,
      },
    ],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    subscription_data: {
      metadata: {
        organizationId: input.organizationId,
        billingInterval: input.billingInterval || 'monthly',
      },
    },
    metadata: {
      organizationId: input.organizationId,
    },
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    allow_promotion_codes: true,
  });

  logger.info('general', 'Checkout session created', {
    orgId: input.organizationId,
    sessionId: session.id,
  });

  return session.url!;
}

// ============================================================================
// Customer Portal
// ============================================================================

/**
 * Create a Stripe billing portal session
 */
export async function createPortalSession(
  organizationId: string,
  returnUrl: string
): Promise<string> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
  });

  if (!org?.stripeCustomerId) {
    throw new Error('Organization has no Stripe customer');
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: returnUrl,
  });

  return session.url;
}

// ============================================================================
// Subscription Management
// ============================================================================

/**
 * Get subscription for an organization
 */
export async function getOrgSubscription(organizationId: string): Promise<Subscription | null> {
  const subscription = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.organizationId, organizationId),
      eq(subscriptions.status, 'active')
    ),
  });

  return subscription ?? null;
}

/**
 * Sync subscription from Stripe webhook
 */
export async function syncSubscriptionFromStripe(
  stripeSubscription: Stripe.Subscription
): Promise<Subscription> {
  const orgId = stripeSubscription.metadata.organizationId;

  if (!orgId) {
    throw new Error('Subscription missing organizationId metadata');
  }

  // Find pricing tier by Stripe price ID
  const priceId = stripeSubscription.items.data[0]?.price.id;
  let pricingTierId: string | undefined;

  if (priceId) {
    // Match price to tier (you'd set up this mapping in your pricing tiers)
    const tier = await db.query.pricingTiers.findFirst({
      where: eq(pricingTiers.name, priceId.includes('pro') ? 'pro' : 'enterprise'),
    });
    pricingTierId = tier?.id;
  }

  // Cast to any to handle Stripe API version differences
  const sub = stripeSubscription as any;

  const subscriptionData: NewSubscription = {
    organizationId: orgId,
    stripeCustomerId: sub.customer as string,
    stripeSubscriptionId: sub.id,
    stripePriceId: priceId,
    pricingTierId,
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
    trialStart: sub.trial_start
      ? new Date(sub.trial_start * 1000)
      : null,
    trialEnd: sub.trial_end
      ? new Date(sub.trial_end * 1000)
      : null,
    metadata: sub.metadata as Record<string, string>,
    updatedAt: new Date(),
  };

  // Upsert subscription
  const existing = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, stripeSubscription.id),
  });

  let result: Subscription;

  if (existing) {
    const [updated] = await db
      .update(subscriptions)
      .set(subscriptionData)
      .where(eq(subscriptions.id, existing.id))
      .returning();
    result = updated;
  } else {
    const [created] = await db.insert(subscriptions).values(subscriptionData).returning();
    result = created;
  }

  logger.info('general', 'Subscription synced from Stripe', {
    subscriptionId: result.id,
    stripeSubscriptionId: stripeSubscription.id,
    status: result.status,
  });

  return result;
}

// ============================================================================
// Invoice Management
// ============================================================================

/**
 * Sync invoice from Stripe webhook
 */
export async function syncInvoiceFromStripe(stripeInvoice: Stripe.Invoice): Promise<Invoice> {
  // Cast to any to handle Stripe API version differences
  const inv = stripeInvoice as any;

  // Get org from customer
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.stripeCustomerId, inv.customer as string),
  });

  if (!org) {
    throw new Error(`Organization not found for Stripe customer ${inv.customer}`);
  }

  // Get subscription if linked
  let subscriptionId: string | undefined;
  if (inv.subscription) {
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.stripeSubscriptionId, inv.subscription as string),
    });
    subscriptionId = sub?.id;
  }

  const invoiceData = {
    organizationId: org.id,
    subscriptionId,
    stripeInvoiceId: inv.id!,
    stripeCustomerId: inv.customer as string,
    invoiceNumber: inv.number,
    status: inv.status as Invoice['status'],
    amountDue: inv.amount_due ?? 0,
    amountPaid: inv.amount_paid ?? 0,
    amountRemaining: inv.amount_remaining ?? 0,
    subtotal: inv.subtotal ?? 0,
    tax: inv.tax ?? 0,
    total: inv.total ?? 0,
    currency: inv.currency ?? 'usd',
    hostedInvoiceUrl: inv.hosted_invoice_url,
    invoicePdfUrl: inv.invoice_pdf,
    periodStart: inv.period_start
      ? new Date(inv.period_start * 1000)
      : null,
    periodEnd: inv.period_end
      ? new Date(inv.period_end * 1000)
      : null,
    dueDate: inv.due_date
      ? new Date(inv.due_date * 1000)
      : null,
    paidAt: inv.status === 'paid' && inv.status_transitions?.paid_at
      ? new Date(inv.status_transitions.paid_at * 1000)
      : null,
    lineItems: inv.lines?.data?.map((line: any) => ({
      description: line.description || '',
      quantity: line.quantity || 1,
      amount: line.amount,
    })),
    updatedAt: new Date(),
  };

  // Upsert invoice
  const existing = await db.query.invoices.findFirst({
    where: eq(invoices.stripeInvoiceId, stripeInvoice.id!),
  });

  let result: Invoice;

  if (existing) {
    const [updated] = await db
      .update(invoices)
      .set(invoiceData)
      .where(eq(invoices.id, existing.id))
      .returning();
    result = updated;
  } else {
    const [created] = await db.insert(invoices).values(invoiceData).returning();
    result = created;
  }

  logger.info('general', 'Invoice synced from Stripe', {
    invoiceId: result.id,
    stripeInvoiceId: stripeInvoice.id,
    status: result.status,
  });

  return result;
}

// ============================================================================
// Webhook Event Processing
// ============================================================================

/**
 * Check if event has been processed (idempotency)
 */
export async function isEventProcessed(eventId: string): Promise<boolean> {
  const event = await db.query.stripeEvents.findFirst({
    where: eq(stripeEvents.stripeEventId, eventId),
  });

  return event?.processed ?? false;
}

/**
 * Mark event as processed
 */
export async function markEventProcessed(
  eventId: string,
  eventType: string,
  error?: string
): Promise<void> {
  await db.insert(stripeEvents).values({
    stripeEventId: eventId,
    eventType,
    processed: !error,
    processedAt: new Date(),
    error,
  }).onConflictDoUpdate({
    target: stripeEvents.stripeEventId,
    set: {
      processed: !error,
      processedAt: new Date(),
      error,
    },
  });
}

/**
 * Verify webhook signature
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string
): Stripe.Event {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_WEBHOOK_SECRET not configured');
  }

  return getStripe().webhooks.constructEvent(
    payload,
    signature,
    env.STRIPE_WEBHOOK_SECRET
  );
}

/**
 * Process webhook event
 */
export async function processWebhookEvent(event: Stripe.Event): Promise<void> {
  // Idempotency check
  if (await isEventProcessed(event.id)) {
    logger.info('general', 'Skipping already processed Stripe event', { eventId: event.id });
    return;
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscriptionFromStripe(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.created':
      case 'invoice.updated':
      case 'invoice.paid':
      case 'invoice.payment_failed':
        await syncInvoiceFromStripe(event.data.object as Stripe.Invoice);
        break;

      case 'checkout.session.completed':
        // Checkout completed - subscription should be created via subscription webhook
        logger.info('general', 'Checkout session completed', {
          sessionId: (event.data.object as Stripe.Checkout.Session).id,
        });
        break;

      default:
        logger.info('general', 'Unhandled Stripe event', { type: event.type });
    }

    await markEventProcessed(event.id, event.type);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await markEventProcessed(event.id, event.type, errorMessage);
    throw error;
  }
}

// ============================================================================
// Pricing Helpers
// ============================================================================

/**
 * Get Stripe price ID for a tier
 */
export function getStripePriceId(tier: string, interval: 'monthly' | 'annual'): string | null {
  if (tier === 'pro') {
    return interval === 'monthly'
      ? env.STRIPE_PRICE_PRO_MONTHLY || null
      : env.STRIPE_PRICE_PRO_ANNUAL || null;
  }

  // Enterprise is custom pricing - no Stripe price
  return null;
}

/**
 * Check if Stripe is configured
 */
export function isStripeConfigured(): boolean {
  return !!env.STRIPE_SECRET_KEY;
}
