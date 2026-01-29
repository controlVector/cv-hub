import { eq, desc } from 'drizzle-orm';
import { db } from '../db';
import {
  pricingTiers,
  quoteRequests,
  type PricingTier,
  type NewQuoteRequest,
  type QuoteRequest,
  type BillingInterval,
  type PricingTierLimits,
} from '../db/schema';
import { logger } from '../utils/logger';

// ============================================================================
// Pricing Tiers Service
// ============================================================================

/**
 * List all active pricing tiers
 */
export async function listPricingTiers(): Promise<PricingTier[]> {
  const tiers = await db.query.pricingTiers.findMany({
    where: eq(pricingTiers.isActive, true),
    orderBy: [pricingTiers.sortOrder],
  });

  return tiers;
}

/**
 * Get a specific pricing tier by name
 */
export async function getPricingTierByName(name: string): Promise<PricingTier | null> {
  const tier = await db.query.pricingTiers.findFirst({
    where: eq(pricingTiers.name, name),
  });

  return tier ?? null;
}

/**
 * Get a specific pricing tier by ID
 */
export async function getPricingTierById(id: string): Promise<PricingTier | null> {
  const tier = await db.query.pricingTiers.findFirst({
    where: eq(pricingTiers.id, id),
  });

  return tier ?? null;
}

// ============================================================================
// Pricing Calculator
// ============================================================================

export interface PricingCalculateInput {
  tier: string;
  billingInterval: BillingInterval;
  requirements?: {
    environments?: number;
    repositories?: number;
    teamMembers?: number;
    storageGb?: number;
    buildMinutes?: number;
  };
}

export interface PricingEstimate {
  tierName: string;
  tierDisplayName: string;
  billingInterval: BillingInterval;
  monthlyCents: number | null;
  annualCents: number | null;
  effectiveMonthlyCents: number | null;
  isCustomPricing: boolean;
  breakdown: {
    basePrice: number | null;
    overages: OverageItem[];
    totalOverage: number;
  };
  limits: PricingTierLimits;
  exceedsLimits: boolean;
  exceedingLimits: string[];
  annualSavingsPercent: number;
}

export interface OverageItem {
  name: string;
  currentLimit: number | null;
  requested: number;
  overageAmount: number;
  overageCost: number;
}

// Overage costs per unit (monthly, in cents)
const OVERAGE_COSTS = {
  environments: 1500,    // $15/environment
  repositories: 100,     // $1/repo
  teamMembers: 500,      // $5/seat
  storageGb: 25,         // $0.25/GB
  buildMinutes: 2,       // $0.02/minute
};

/**
 * Calculate pricing for a given configuration
 */
export async function calculatePricing(input: PricingCalculateInput): Promise<PricingEstimate> {
  const tier = await getPricingTierByName(input.tier);

  if (!tier) {
    throw new Error(`Pricing tier '${input.tier}' not found`);
  }

  const limits = tier.limits as PricingTierLimits;
  const requirements = input.requirements || {};

  // For custom pricing tiers (Enterprise), return custom quote needed
  if (tier.isCustomPricing) {
    return {
      tierName: tier.name,
      tierDisplayName: tier.displayName,
      billingInterval: input.billingInterval,
      monthlyCents: null,
      annualCents: null,
      effectiveMonthlyCents: null,
      isCustomPricing: true,
      breakdown: {
        basePrice: null,
        overages: [],
        totalOverage: 0,
      },
      limits,
      exceedsLimits: false,
      exceedingLimits: [],
      annualSavingsPercent: 20,
    };
  }

  // Calculate overages
  const overages: OverageItem[] = [];
  const exceedingLimits: string[] = [];
  let totalOverage = 0;

  // Check each limit
  const checkLimit = (
    key: keyof PricingTierLimits,
    displayName: string,
    requested?: number
  ) => {
    if (requested === undefined) return;

    const limit = limits[key];
    if (limit === null) return; // Unlimited

    if (requested > limit) {
      const overage = requested - limit;
      const cost = overage * (OVERAGE_COSTS[key] || 0);

      overages.push({
        name: displayName,
        currentLimit: limit,
        requested,
        overageAmount: overage,
        overageCost: cost,
      });

      totalOverage += cost;
      exceedingLimits.push(displayName);
    }
  };

  checkLimit('environments', 'Environments', requirements.environments);
  checkLimit('repositories', 'Repositories', requirements.repositories);
  checkLimit('teamMembers', 'Team Members', requirements.teamMembers);
  checkLimit('storageGb', 'Storage (GB)', requirements.storageGb);
  checkLimit('buildMinutes', 'Build Minutes', requirements.buildMinutes);

  // Calculate totals
  const baseMonthly = tier.basePriceMonthly ?? 0;
  const baseAnnual = tier.basePriceAnnual ?? 0;

  const monthlyCents = baseMonthly + totalOverage;
  const annualCents = baseAnnual + (totalOverage * 12);

  // Effective monthly is annual / 12 if annual billing
  const effectiveMonthlyCents = input.billingInterval === 'annual'
    ? Math.round(annualCents / 12)
    : monthlyCents;

  // Calculate annual savings
  const monthlyTotal = monthlyCents * 12;
  const annualSavingsPercent = monthlyTotal > 0
    ? Math.round(((monthlyTotal - annualCents) / monthlyTotal) * 100)
    : 20;

  return {
    tierName: tier.name,
    tierDisplayName: tier.displayName,
    billingInterval: input.billingInterval,
    monthlyCents,
    annualCents,
    effectiveMonthlyCents,
    isCustomPricing: false,
    breakdown: {
      basePrice: baseMonthly,
      overages,
      totalOverage,
    },
    limits,
    exceedsLimits: exceedingLimits.length > 0,
    exceedingLimits,
    annualSavingsPercent,
  };
}

// ============================================================================
// Quote Requests Service
// ============================================================================

export interface CreateQuoteInput {
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  companyName?: string;
  companySize?: string;
  requestedTier: string;
  billingInterval?: BillingInterval;
  requirements?: {
    environments?: number;
    repositories?: number;
    teamMembers?: number;
    storageGb?: number;
    buildMinutes?: number;
    additionalNotes?: string;
  };
  userId?: string;
}

/**
 * Create a new quote request
 */
export async function createQuoteRequest(input: CreateQuoteInput): Promise<QuoteRequest> {
  const values: NewQuoteRequest = {
    contactName: input.contactName,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone,
    companyName: input.companyName,
    companySize: input.companySize,
    requestedTier: input.requestedTier,
    billingInterval: input.billingInterval ?? 'annual',
    requirements: input.requirements,
    userId: input.userId,
    status: 'pending',
  };

  const [quote] = await db.insert(quoteRequests).values(values).returning();

  logger.info('general', 'Quote request created', {
    quoteId: quote.id,
    contactEmail: quote.contactEmail,
    requestedTier: quote.requestedTier,
  });

  return quote;
}

/**
 * List quote requests for a user
 */
export async function listUserQuoteRequests(userId: string): Promise<QuoteRequest[]> {
  const quotes = await db.query.quoteRequests.findMany({
    where: eq(quoteRequests.userId, userId),
    orderBy: [desc(quoteRequests.createdAt)],
  });

  return quotes;
}

/**
 * Get a quote request by ID
 */
export async function getQuoteRequestById(id: string): Promise<QuoteRequest | null> {
  const quote = await db.query.quoteRequests.findFirst({
    where: eq(quoteRequests.id, id),
  });

  return quote ?? null;
}

/**
 * Update quote request status (for admin use)
 */
export async function updateQuoteRequestStatus(
  id: string,
  status: QuoteRequest['status'],
  updates?: {
    assignedTo?: string;
    notes?: string;
  }
): Promise<QuoteRequest | null> {
  const updateValues: Partial<NewQuoteRequest> = {
    status,
    updatedAt: new Date(),
  };

  if (updates?.assignedTo) {
    updateValues.assignedTo = updates.assignedTo;
  }
  if (updates?.notes) {
    updateValues.notes = updates.notes;
  }

  // Set responded_at on first status change from pending
  if (status !== 'pending') {
    const existing = await getQuoteRequestById(id);
    if (existing?.status === 'pending') {
      (updateValues as any).respondedAt = new Date();
    }
  }

  // Set closed_at on closed status
  if (status === 'closed_won' || status === 'closed_lost') {
    (updateValues as any).closedAt = new Date();
  }

  const [quote] = await db
    .update(quoteRequests)
    .set(updateValues)
    .where(eq(quoteRequests.id, id))
    .returning();

  if (quote) {
    logger.info('general', 'Quote request status updated', {
      quoteId: id,
      newStatus: status,
    });
  }

  return quote ?? null;
}
