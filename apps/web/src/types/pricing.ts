// Billing interval type
export type BillingInterval = 'monthly' | 'annual';

// Quote request status
export type QuoteStatus = 'pending' | 'contacted' | 'qualified' | 'closed_won' | 'closed_lost';

// Pricing tier limits
export interface PricingTierLimits {
  environments: number | null;
  repositories: number | null;
  teamMembers: number | null;
  storageGb: number | null;
  buildMinutes: number | null;
}

// Pricing tier features
export interface PricingTierFeatures {
  branchProtection: boolean;
  sso: boolean;
  customDomain: boolean;
  analytics: boolean;
  auditLogs: boolean;
  prioritySupport: boolean;
  sla: boolean;
  dedicatedInstance: boolean;
  ipAllowlisting: boolean;
  webhooks: boolean;
  apiAccess: boolean;
}

// Pricing tier from API
export interface PricingTier {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  basePriceMonthly: number | null;
  basePriceAnnual: number | null;
  limits: PricingTierLimits;
  features: PricingTierFeatures;
  isPopular: boolean;
  isCustomPricing: boolean;
}

// Overage item in pricing breakdown
export interface OverageItem {
  name: string;
  currentLimit: number | null;
  requested: number;
  overageAmount: number;
  overageCost: number;
}

// Pricing estimate from calculator
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

// Requirements input for calculator
export interface PricingRequirements {
  environments?: number;
  repositories?: number;
  teamMembers?: number;
  storageGb?: number;
  buildMinutes?: number;
}

// Calculate pricing input
export interface CalculatePricingInput {
  tier: string;
  billingInterval: BillingInterval;
  requirements?: PricingRequirements;
}

// Quote request from API
export interface QuoteRequest {
  id: string;
  contactName: string;
  contactEmail: string;
  companyName: string | null;
  requestedTier: string;
  billingInterval: BillingInterval;
  requirements: PricingRequirements & { additionalNotes?: string } | null;
  status: QuoteStatus;
  createdAt: string;
  respondedAt: string | null;
}

// Submit quote request input
export interface SubmitQuoteInput {
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  companyName?: string;
  companySize?: '1-10' | '11-50' | '51-200' | '201-500' | '500+';
  requestedTier: string;
  billingInterval?: BillingInterval;
  requirements?: PricingRequirements & { additionalNotes?: string };
}

// Feature display configuration for comparison table
export interface FeatureDisplay {
  key: keyof PricingTierFeatures;
  label: string;
  description?: string;
}

// Feature display list
export const FEATURE_DISPLAYS: FeatureDisplay[] = [
  { key: 'branchProtection', label: 'Branch Protection', description: 'Protect branches from force pushes and deletions' },
  { key: 'webhooks', label: 'Webhooks', description: 'HTTP callbacks for repository events' },
  { key: 'apiAccess', label: 'API Access', description: 'Full REST API access' },
  { key: 'sso', label: 'Single Sign-On (SSO)', description: 'SAML/OIDC authentication' },
  { key: 'customDomain', label: 'Custom Domain', description: 'Use your own domain' },
  { key: 'analytics', label: 'Analytics', description: 'Repository and team analytics' },
  { key: 'auditLogs', label: 'Audit Logs', description: 'Detailed activity logging' },
  { key: 'prioritySupport', label: 'Priority Support', description: '24/7 priority support' },
  { key: 'sla', label: 'SLA', description: '99.9% uptime guarantee' },
  { key: 'dedicatedInstance', label: 'Dedicated Instance', description: 'Isolated infrastructure' },
  { key: 'ipAllowlisting', label: 'IP Allowlisting', description: 'Restrict access by IP' },
];

// Helper function to format price
export function formatPrice(cents: number | null, interval: BillingInterval = 'monthly'): string {
  if (cents === null) return 'Custom';
  if (cents === 0) return 'Free';

  const dollars = cents / 100;
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(dollars);

  return interval === 'annual' ? `${formatted}/year` : `${formatted}/mo`;
}

// Helper function to format limit
export function formatLimit(value: number | null): string {
  if (value === null) return 'Unlimited';
  return value.toLocaleString();
}

// Subscription status
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

// Subscription from API
export interface Subscription {
  id: string;
  status: SubscriptionStatus;
  billingInterval: BillingInterval;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

// Subscription response
export interface SubscriptionResponse {
  subscription: Subscription | null;
  tier: string;
  status: string;
}

// Checkout input
export interface CreateCheckoutInput {
  organizationId: string;
  tier: 'pro' | 'enterprise';
  billingInterval: BillingInterval;
  successUrl: string;
  cancelUrl: string;
}

// Stripe config response
export interface StripeConfig {
  publishableKey: string | null;
  configured: boolean;
}
