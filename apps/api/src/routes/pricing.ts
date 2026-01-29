import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { NotFoundError } from '../utils/errors';
import type { AppEnv } from '../app';
import {
  listPricingTiers,
  getPricingTierByName,
  calculatePricing,
  createQuoteRequest,
  listUserQuoteRequests,
} from '../services/pricing.service';

const pricingRoutes = new Hono<AppEnv>();

// ============================================================================
// PUBLIC APIs (no auth required)
// ============================================================================

/**
 * GET /api/pricing/tiers
 * List all active pricing tiers
 */
pricingRoutes.get('/tiers', async (c) => {
  const tiers = await listPricingTiers();

  return c.json({
    tiers: tiers.map((tier) => ({
      id: tier.id,
      name: tier.name,
      displayName: tier.displayName,
      description: tier.description,
      basePriceMonthly: tier.basePriceMonthly,
      basePriceAnnual: tier.basePriceAnnual,
      limits: tier.limits,
      features: tier.features,
      isPopular: tier.isPopular,
      isCustomPricing: tier.isCustomPricing,
    })),
  });
});

/**
 * GET /api/pricing/tiers/:name
 * Get a specific pricing tier by name
 */
pricingRoutes.get('/tiers/:name', async (c) => {
  const name = c.req.param('name');
  const tier = await getPricingTierByName(name);

  if (!tier) {
    throw new NotFoundError('Pricing tier');
  }

  return c.json({
    tier: {
      id: tier.id,
      name: tier.name,
      displayName: tier.displayName,
      description: tier.description,
      basePriceMonthly: tier.basePriceMonthly,
      basePriceAnnual: tier.basePriceAnnual,
      limits: tier.limits,
      features: tier.features,
      isPopular: tier.isPopular,
      isCustomPricing: tier.isCustomPricing,
    },
  });
});

/**
 * POST /api/pricing/calculate
 * Calculate pricing for a given configuration
 */
const calculateSchema = z.object({
  tier: z.string().min(1).max(32),
  billingInterval: z.enum(['monthly', 'annual']).default('monthly'),
  requirements: z.object({
    environments: z.number().int().min(0).optional(),
    repositories: z.number().int().min(0).optional(),
    teamMembers: z.number().int().min(0).optional(),
    storageGb: z.number().min(0).optional(),
    buildMinutes: z.number().int().min(0).optional(),
  }).optional(),
});

pricingRoutes.post('/calculate', zValidator('json', calculateSchema), async (c) => {
  const input = c.req.valid('json');

  try {
    const estimate = await calculatePricing({
      tier: input.tier,
      billingInterval: input.billingInterval,
      requirements: input.requirements,
    });

    return c.json({ estimate });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      throw new NotFoundError('Pricing tier');
    }
    throw error;
  }
});

// ============================================================================
// QUOTE REQUESTS (optional auth - can submit anonymously)
// ============================================================================

/**
 * POST /api/pricing/quote
 * Submit a quote request
 */
const quoteSchema = z.object({
  contactName: z.string().min(1).max(100),
  contactEmail: z.string().email().max(255),
  contactPhone: z.string().max(32).optional(),
  companyName: z.string().max(200).optional(),
  companySize: z.enum(['1-10', '11-50', '51-200', '201-500', '500+']).optional(),
  requestedTier: z.string().min(1).max(32),
  billingInterval: z.enum(['monthly', 'annual']).default('annual'),
  requirements: z.object({
    environments: z.number().int().min(0).optional(),
    repositories: z.number().int().min(0).optional(),
    teamMembers: z.number().int().min(0).optional(),
    storageGb: z.number().min(0).optional(),
    buildMinutes: z.number().int().min(0).optional(),
    additionalNotes: z.string().max(2000).optional(),
  }).optional(),
});

pricingRoutes.post('/quote', optionalAuth, zValidator('json', quoteSchema), async (c) => {
  const input = c.req.valid('json');
  const userId = c.get('userId'); // May be undefined for anonymous submissions

  const quote = await createQuoteRequest({
    ...input,
    userId,
  });

  return c.json({
    quote: {
      id: quote.id,
      contactEmail: quote.contactEmail,
      requestedTier: quote.requestedTier,
      status: quote.status,
      createdAt: quote.createdAt,
    },
    message: 'Quote request submitted successfully. Our team will contact you shortly.',
  }, 201);
});

// ============================================================================
// AUTHENTICATED ROUTES
// ============================================================================

/**
 * GET /api/pricing/quotes
 * List current user's quote requests
 */
pricingRoutes.get('/quotes', requireAuth, async (c) => {
  const userId = c.get('userId')!;
  const quotes = await listUserQuoteRequests(userId);

  return c.json({
    quotes: quotes.map((quote) => ({
      id: quote.id,
      contactName: quote.contactName,
      contactEmail: quote.contactEmail,
      companyName: quote.companyName,
      requestedTier: quote.requestedTier,
      billingInterval: quote.billingInterval,
      requirements: quote.requirements,
      status: quote.status,
      createdAt: quote.createdAt,
      respondedAt: quote.respondedAt,
    })),
  });
});

export { pricingRoutes };
