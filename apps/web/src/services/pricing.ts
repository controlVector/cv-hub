import { api } from '../lib/api';
import type {
  PricingTier,
  PricingEstimate,
  QuoteRequest,
  CalculatePricingInput,
  SubmitQuoteInput,
  CreateCheckoutInput,
  SubscriptionResponse,
  StripeConfig,
} from '../types/pricing';

/**
 * Fetch all active pricing tiers
 */
export async function fetchPricingTiers(): Promise<PricingTier[]> {
  const response = await api.get<{ tiers: PricingTier[] }>('/pricing/tiers');
  return response.data.tiers;
}

/**
 * Fetch a specific pricing tier by name
 */
export async function fetchPricingTierByName(name: string): Promise<PricingTier> {
  const response = await api.get<{ tier: PricingTier }>(`/pricing/tiers/${name}`);
  return response.data.tier;
}

/**
 * Calculate pricing for a configuration
 */
export async function calculatePricing(input: CalculatePricingInput): Promise<PricingEstimate> {
  const response = await api.post<{ estimate: PricingEstimate }>('/pricing/calculate', input);
  return response.data.estimate;
}

/**
 * Submit a quote request
 */
export async function submitQuoteRequest(input: SubmitQuoteInput): Promise<{ quote: QuoteRequest; message: string }> {
  const response = await api.post<{ quote: QuoteRequest; message: string }>('/pricing/quote', input);
  return response.data;
}

/**
 * Fetch current user's quote requests
 */
export async function fetchUserQuotes(): Promise<QuoteRequest[]> {
  const response = await api.get<{ quotes: QuoteRequest[] }>('/pricing/quotes');
  return response.data.quotes;
}

// ============================================================================
// Stripe / Subscription APIs
// ============================================================================

/**
 * Get Stripe configuration
 */
export async function fetchStripeConfig(): Promise<StripeConfig> {
  const response = await api.get<StripeConfig>('/stripe/config');
  return response.data;
}

/**
 * Create checkout session and redirect to Stripe
 */
export async function createCheckoutSession(input: CreateCheckoutInput): Promise<string> {
  const response = await api.post<{ url: string }>('/stripe/checkout', input);
  return response.data.url;
}

/**
 * Create billing portal session
 */
export async function createPortalSession(
  organizationId: string,
  returnUrl: string
): Promise<string> {
  const response = await api.post<{ url: string }>('/stripe/portal', {
    organizationId,
    returnUrl,
  });
  return response.data.url;
}

/**
 * Get subscription status for organization
 */
export async function fetchOrgSubscription(orgId: string): Promise<SubscriptionResponse> {
  const response = await api.get<SubscriptionResponse>(`/stripe/subscription/${orgId}`);
  return response.data;
}
