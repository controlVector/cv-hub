import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Alert,
  Chip,
  Divider,
  ToggleButton,
  ToggleButtonGroup,
  CircularProgress,
  Skeleton,
} from '@mui/material';
import {
  CreditCard as CreditCardIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material';
import { colors } from '../../theme';
import {
  fetchOrgSubscription,
  fetchStripeConfig,
  createCheckoutSession,
  createPortalSession,
} from '../../services/pricing';
import type { BillingInterval } from '../../types/pricing';

interface BillingCardProps {
  organizationId: string;
  orgSlug: string;
  isAdmin: boolean;
  checkoutStatus?: 'success' | 'canceled' | null;
}

export default function BillingCard({ organizationId, orgSlug, isAdmin, checkoutStatus }: BillingCardProps) {
  const queryClient = useQueryClient();
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('monthly');
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [addonCheckoutLoading, setAddonCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  const { data: subData, isLoading: subLoading } = useQuery({
    queryKey: ['org-subscription', organizationId],
    queryFn: () => fetchOrgSubscription(organizationId),
    enabled: !!organizationId,
    refetchInterval: polling ? 2000 : false,
  });

  const { data: stripeConfig } = useQuery({
    queryKey: ['stripe-config'],
    queryFn: fetchStripeConfig,
  });

  // Poll for subscription after checkout success
  useEffect(() => {
    if (checkoutStatus === 'success' && subData?.tier === 'starter' && !subData?.addons?.mcpGateway) {
      setPolling(true);
    }
  }, [checkoutStatus, subData?.tier, subData?.addons?.mcpGateway]);

  // Stop polling once subscription is active or add-on appears, or after timeout
  useEffect(() => {
    if (!polling) return;

    if (subData?.tier !== 'starter' || subData?.addons?.mcpGateway) {
      setPolling(false);
      queryClient.invalidateQueries({ queryKey: ['org-subscription', organizationId] });
      return;
    }

    const timeout = setTimeout(() => {
      setPolling(false);
    }, 30000);

    return () => clearTimeout(timeout);
  }, [polling, subData?.tier, subData?.addons?.mcpGateway, organizationId, queryClient]);

  const handleUpgrade = useCallback(async () => {
    setError(null);
    setCheckoutLoading(true);
    try {
      const baseUrl = window.location.origin;
      const settingsUrl = `${baseUrl}/dashboard/orgs/${orgSlug}/settings`;
      const url = await createCheckoutSession({
        organizationId,
        tier: 'pro',
        billingInterval,
        successUrl: `${settingsUrl}?checkout=success`,
        cancelUrl: `${settingsUrl}?checkout=canceled`,
      });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create checkout session');
      setCheckoutLoading(false);
    }
  }, [organizationId, orgSlug, billingInterval]);

  const handleAddMcpGateway = useCallback(async () => {
    setError(null);
    setAddonCheckoutLoading(true);
    try {
      const baseUrl = window.location.origin;
      const settingsUrl = `${baseUrl}/dashboard/orgs/${orgSlug}/settings`;
      const url = await createCheckoutSession({
        organizationId,
        product: 'mcp-gateway',
        billingInterval: 'monthly',
        successUrl: `${settingsUrl}?checkout=success`,
        cancelUrl: `${settingsUrl}?checkout=canceled`,
      });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create checkout session');
      setAddonCheckoutLoading(false);
    }
  }, [organizationId, orgSlug]);

  const handleManage = useCallback(async () => {
    setError(null);
    setPortalLoading(true);
    try {
      const returnUrl = `${window.location.origin}/dashboard/orgs/${orgSlug}/settings`;
      const url = await createPortalSession(organizationId, returnUrl);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open billing portal');
      setPortalLoading(false);
    }
  }, [organizationId, orgSlug]);

  if (!isAdmin) return null;
  if (!stripeConfig?.configured) return null;

  const subscription = subData?.subscription;
  const tier = subData?.tier ?? 'starter';
  const tierDisplay = subData?.tierDisplayName ?? tier.charAt(0).toUpperCase() + tier.slice(1);
  const isActive = subscription?.status === 'active' || subscription?.status === 'trialing';
  const isCanceling = isActive && subscription?.cancelAtPeriodEnd;
  const mcpAddon = subData?.addons?.mcpGateway;
  const mcpAddonActive = mcpAddon?.status === 'active' || mcpAddon?.status === 'trialing';
  const isPaidTier = tier === 'pro' || tier === 'enterprise';

  return (
    <Card sx={{ mb: 4 }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
          <CreditCardIcon sx={{ color: colors.violet }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            Billing
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {checkoutStatus === 'success' && (tier !== 'starter' || mcpAddonActive) && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {mcpAddonActive && tier === 'starter'
              ? 'MCP Gateway add-on activated!'
              : `Subscription activated! You're now on the ${tierDisplay} plan.`}
          </Alert>
        )}

        {checkoutStatus === 'success' && polling && (
          <Alert severity="info" sx={{ mb: 2 }} icon={<CircularProgress size={20} />}>
            Processing your subscription... This may take a few seconds.
          </Alert>
        )}

        {checkoutStatus === 'canceled' && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Checkout was canceled. You can try again anytime.
          </Alert>
        )}

        {subLoading ? (
          <Box>
            <Skeleton variant="text" width="40%" height={32} />
            <Skeleton variant="text" width="60%" height={24} sx={{ mt: 1 }} />
            <Skeleton variant="rectangular" width={160} height={40} sx={{ mt: 2 }} />
          </Box>
        ) : isCanceling ? (
          /* Canceling state */
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                {tierDisplay}
              </Typography>
              <Chip label="Canceling" size="small" color="warning" />
            </Box>
            <Typography variant="body2" sx={{ color: colors.textMuted, mb: 1 }}>
              Your subscription will end on{' '}
              <strong>
                {subscription?.currentPeriodEnd
                  ? new Date(subscription.currentPeriodEnd).toLocaleDateString()
                  : 'the end of the billing period'}
              </strong>.
              You can reactivate before then.
            </Typography>
            <Button
              variant="outlined"
              startIcon={portalLoading ? <CircularProgress size={16} /> : <OpenInNewIcon />}
              onClick={handleManage}
              disabled={portalLoading}
              sx={{ mt: 2 }}
            >
              {portalLoading ? 'Opening...' : 'Manage Subscription'}
            </Button>
          </Box>
        ) : isActive ? (
          /* Active subscription */
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                {tierDisplay}
              </Typography>
              <Chip label="Active" size="small" color="success" />
            </Box>
            <Typography variant="body2" sx={{ color: colors.textMuted }}>
              Billed {subscription?.billingInterval === 'annual' ? 'annually' : 'monthly'}
              {subscription?.currentPeriodEnd && (
                <> &middot; Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString()}</>
              )}
            </Typography>

            {/* MCP Gateway included for Pro/Enterprise */}
            {isPaidTier && (
              <Typography variant="body2" sx={{ color: colors.textMuted, mt: 1 }}>
                MCP Gateway: <strong>Included</strong>
              </Typography>
            )}

            <Button
              variant="outlined"
              startIcon={portalLoading ? <CircularProgress size={16} /> : <OpenInNewIcon />}
              onClick={handleManage}
              disabled={portalLoading}
              sx={{ mt: 2 }}
            >
              {portalLoading ? 'Opening...' : 'Manage Subscription'}
            </Button>
          </Box>
        ) : (
          /* Free/Starter */
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                {tierDisplay}
              </Typography>
              <Chip label="Free" size="small" />
            </Box>
            <Typography variant="body2" sx={{ color: colors.textMuted, mb: 2 }}>
              Upgrade to Pro for more repositories, team members, storage, and advanced features.
            </Typography>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
              <ToggleButtonGroup
                value={billingInterval}
                exclusive
                onChange={(_, val) => val && setBillingInterval(val)}
                size="small"
              >
                <ToggleButton value="monthly">$29/mo</ToggleButton>
                <ToggleButton value="annual">
                  $278/yr
                  <Chip label="Save 20%" size="small" color="success" sx={{ ml: 1, height: 20 }} />
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>

            <Button
              variant="contained"
              startIcon={checkoutLoading ? <CircularProgress size={16} color="inherit" /> : undefined}
              onClick={handleUpgrade}
              disabled={checkoutLoading}
            >
              {checkoutLoading ? 'Redirecting...' : 'Upgrade to Pro'}
            </Button>

            {/* MCP Gateway Add-on Section */}
            <Divider sx={{ my: 3 }} />

            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
              MCP Gateway Add-on
            </Typography>
            <Typography variant="body2" sx={{ color: colors.textMuted, mb: 2 }}>
              Connect Claude.ai directly to your repos via MCP. $5/mo.
            </Typography>

            {mcpAddonActive ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip label="MCP Gateway" size="small" />
                <Chip label="Active" size="small" color="success" />
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={portalLoading ? <CircularProgress size={14} /> : <OpenInNewIcon />}
                  onClick={handleManage}
                  disabled={portalLoading}
                  sx={{ ml: 1 }}
                >
                  Manage
                </Button>
              </Box>
            ) : (
              <Button
                variant="outlined"
                startIcon={addonCheckoutLoading ? <CircularProgress size={16} /> : undefined}
                onClick={handleAddMcpGateway}
                disabled={addonCheckoutLoading}
              >
                {addonCheckoutLoading ? 'Redirecting...' : 'Add MCP Gateway \u2014 $5/mo'}
              </Button>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
