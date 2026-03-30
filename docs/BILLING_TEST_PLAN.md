# Billing End-to-End Test Plan

**Status:** Pending — requires Stripe CLI access (on separate machine)
**Last reviewed:** 2026-03-27

---

## Current State

### What's working
- Stripe live keys configured (sk_live_, pk_live_) in production K8s secrets
- Price IDs for Pro monthly/annual and credit packs are set
- Webhook endpoint at `/api/stripe/webhook` with signature verification
- Webhook handler covers: subscription lifecycle, invoices, checkout, credit packs, add-ons
- Tier limit enforcement on repo/member creation
- BillingCard component handles upgrade flow, billing portal, MCP Gateway add-on
- PricingPage renders tiers from DB with feature comparison

### What's NOT working
- The `controlvector` org subscription has `stripe_customer_id = 'cus_internal_test'` — a manually inserted record, not a real Stripe subscription
- No `stripe_subscription_id` or `stripe_price_id` on that record
- "Manage Subscription" button will fail (no real Stripe customer)
- Monthly credit refresh won't fire (no `invoice.paid` webhook)
- 0 invoices in the database (no real billing cycle)
- `STRIPE_PORTAL_CONFIG_ID` is empty (portal falls back to Stripe generic)

### Founder exemption
The `controlvector` org (schmotz@controlvector.io) has a manually inserted Pro subscription. This is intentional — it's the founder's org and should not be charged. This record should be preserved as-is.

---

## Test Plan: Validate Full Stripe Pipeline

### Prerequisites
- Stripe CLI installed and authenticated (`stripe login`)
- Access to Stripe Dashboard (dashboard.stripe.com)
- A test user account on CV-Hub (e.g. `richard_jjg` or create a new one)

### Step 1: Create a 100% Off Coupon in Stripe

```bash
# Via Stripe CLI
stripe coupons create \
  --duration once \
  --percent-off 100 \
  --name "E2E Test - 100% Off" \
  --max-redemptions 3 \
  --metadata[purpose]="end-to-end billing test"

# Note the coupon ID (e.g., "XXXX_test")
```

Or via Stripe Dashboard: Products → Coupons → Create → 100% off, once, max 3 redemptions.

### Step 2: Create an Org with the Test User

1. Log in as the test user (e.g. `richard_jjg`)
2. Navigate to Organizations → Create Organization
3. Name it something like "billing-test-org"

### Step 3: Go Through Stripe Checkout

1. Navigate to the org settings page
2. Click "Upgrade to Pro" ($29/mo or $278/yr)
3. On the Stripe Checkout page, apply the 100% coupon
4. Complete checkout with any card (won't be charged)

### Step 4: Verify Webhook Processing

After checkout completes, verify in the database:

```sql
-- Check subscription was created
SELECT s.id, s.status, s.stripe_subscription_id, s.stripe_customer_id,
       s.pricing_tier_id, pt.name as tier
FROM subscriptions s
JOIN pricing_tiers pt ON s.pricing_tier_id = pt.id
WHERE s.organization_id = (SELECT id FROM organizations WHERE slug = 'billing-test-org');

-- Check invoice was synced
SELECT id, status, amount_due, amount_paid, total
FROM invoices
WHERE organization_id = (SELECT id FROM organizations WHERE slug = 'billing-test-org');

-- Check stripe events were processed
SELECT stripe_event_id, event_type, processed, error
FROM stripe_events
ORDER BY created_at DESC
LIMIT 10;

-- Check credits were allocated
SELECT * FROM organization_credits
WHERE organization_id = (SELECT id FROM organizations WHERE slug = 'billing-test-org');
```

### Step 5: Verify Frontend Reflects Changes

1. Refresh org settings page — should show "Pro" with "Active" chip
2. Dashboard sidebar usage bar should reflect org limits (50 repos)
3. "Manage Subscription" button should open Stripe billing portal
4. Creating repos should enforce Pro limits (50 repos)

### Step 6: Test Credit Pack Purchase

1. On the org AI settings page, buy a 500-credit pack
2. Apply the same 100% coupon at checkout
3. Verify `organization_credits.balance` increased by 500
4. Verify a `credit_transactions` row was created

### Step 7: Test MCP Gateway Add-on (Starter Only)

1. Create a second test org on Starter (no subscription)
2. Click "Add MCP Gateway — $5/mo"
3. Apply coupon, complete checkout
4. Verify `organization_addons` has a row with `addon_type = 'mcp_gateway'`

### Step 8: Test Cancellation

1. Click "Manage Subscription" on the Pro test org
2. Cancel the subscription in the Stripe portal
3. Verify `cancel_at_period_end = true` in the subscriptions table
4. Verify the UI shows "Canceling" state with end date

### Step 9: Cleanup

```sql
-- Delete test org and cascade
DELETE FROM organizations WHERE slug = 'billing-test-org';
```

Or cancel all test subscriptions in Stripe Dashboard first, then delete the org.

---

## Known Issues to Fix During Testing

1. **BillingCard hardcodes prices** — Shows "$29/mo" and "$278/yr" instead of reading from the pricing tiers API. If prices change in the DB, the UI won't reflect it.

2. **No usage breakdown in billing portal** — The sidebar shows total repos but doesn't break down org vs personal. The API now returns `orgRepos` and `personalRepos` but the frontend doesn't display the breakdown yet.

3. **PricingPage has teal gradients** — Header and tab indicator still use `colors.cyan`. Should be `colors.purple` per brand guidelines.

4. **No email notifications** — SMTP is optional and may not be configured. Stripe sends its own receipt emails, but CV-Hub doesn't send upgrade confirmation emails.

5. **Credit refresh timing** — Credits refresh on `invoice.paid`, which fires at the start of each billing period. If a user upgrades mid-month, they get their first credit allocation immediately (via `checkout.session.completed`), but the monthly refresh depends on the invoice cycle.

---

## Stripe Environment Variables Reference

All set in K8s secret `cv-hub-secrets`:

| Variable | Status | Notes |
|----------|--------|-------|
| `STRIPE_SECRET_KEY` | Set (live) | `sk_live_51T3...` |
| `STRIPE_PUBLISHABLE_KEY` | Set (live) | `pk_live_51T3...` |
| `STRIPE_WEBHOOK_SECRET` | Set | `whsec_x8...` |
| `STRIPE_PRICE_PRO_MONTHLY` | Set | `price_1T4KkJ...` |
| `STRIPE_PRICE_PRO_ANNUAL` | Set | `price_1T4KkK...` |
| `STRIPE_PRICE_CREDITS_500` | Set | `price_1T4PIW...` |
| `STRIPE_PRICE_CREDITS_2000` | Set | `price_1T4PIW...` |
| `STRIPE_PRICE_CREDITS_5000` | Set | `price_1T4PIX...` |
| `STRIPE_PRICE_MCP_GATEWAY_MONTHLY` | Set | Value TBD |
| `STRIPE_PRICE_CVSAFE_PRO_ANNUAL` | Set | Value TBD |
| `STRIPE_PORTAL_CONFIG_ID` | **Empty** | Needs config in Stripe Dashboard |
