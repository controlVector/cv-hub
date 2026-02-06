import { useState } from 'react';
import {
  Box,
  Container,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
  Grid,
  Chip,
  CircularProgress,
  Alert,
  alpha,
  Tabs,
  Tab,
  AppBar,
  Toolbar,
  Button,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { PricingCard, FeatureComparison, QuoteRequestForm } from '../../components/pricing';
import type { PricingTier, BillingInterval } from '../../types/pricing';
import { fetchPricingTiers } from '../../services/pricing';
import { colors } from '../../theme';

export default function PricingPage() {
  const navigate = useNavigate();
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('monthly');
  const [activeTab, setActiveTab] = useState(0);
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [selectedQuoteTier, setSelectedQuoteTier] = useState<string>('enterprise');

  const { data: tiers, isLoading, error } = useQuery({
    queryKey: ['pricingTiers'],
    queryFn: fetchPricingTiers,
  });

  const handleBillingChange = (
    _event: React.MouseEvent<HTMLElement>,
    newBilling: BillingInterval | null
  ) => {
    if (newBilling) {
      setBillingInterval(newBilling);
    }
  };

  const handleSelectTier = (tier: PricingTier) => {
    // For now, redirect to registration with tier info
    navigate(`/register?plan=${tier.name}`);
  };

  const handleGetQuote = (tier: PricingTier) => {
    setSelectedQuoteTier(tier.name);
    setShowQuoteForm(true);
    // Scroll to quote form
    setTimeout(() => {
      document.getElementById('quote-form')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: colors.slate }}>
      {/* Header */}
      <AppBar position="static" sx={{ bgcolor: colors.slateLight }}>
        <Toolbar>
          <Typography
            variant="h6"
            component={RouterLink}
            to="/"
            sx={{
              textDecoration: 'none',
              color: 'inherit',
              background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.cyan} 100%)`,
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontWeight: 700,
            }}
          >
            Control Fabric
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <Button
            component={RouterLink}
            to="/login"
            variant="outlined"
            sx={{ mr: 1 }}
          >
            Log In
          </Button>
          <Button
            component={RouterLink}
            to="/register"
            variant="contained"
          >
            Sign Up
          </Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: 8 }}>
        {/* Hero section */}
        <Box sx={{ textAlign: 'center', mb: 6 }}>
          <Typography
            variant="h2"
            gutterBottom
            sx={{
              background: `linear-gradient(135deg, ${colors.textLight} 0%, ${colors.violetLight} 100%)`,
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              color: 'transparent',
              fontWeight: 700,
            }}
          >
            Simple, Transparent Pricing
          </Typography>
          <Typography
            variant="h5"
            color="text.secondary"
            sx={{ maxWidth: 600, mx: 'auto', mb: 4 }}
          >
            Choose the plan that fits your team. Start free, scale as you grow.
          </Typography>

          {/* Billing toggle */}
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 2 }}>
            <ToggleButtonGroup
              value={billingInterval}
              exclusive
              onChange={handleBillingChange}
              sx={{
                '& .MuiToggleButton-root': {
                  px: 4,
                  py: 1,
                  border: `1px solid ${colors.slateLighter}`,
                  '&.Mui-selected': {
                    bgcolor: alpha(colors.violet, 0.2),
                    borderColor: colors.violet,
                    color: colors.violet,
                  },
                },
              }}
            >
              <ToggleButton value="monthly">Monthly</ToggleButton>
              <ToggleButton value="annual">
                Annual
                <Chip
                  label="Save 20%"
                  size="small"
                  sx={{
                    ml: 1,
                    bgcolor: alpha(colors.green, 0.2),
                    color: colors.green,
                    height: 20,
                    fontSize: '0.7rem',
                  }}
                />
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </Box>

        {/* Loading state */}
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        )}

        {/* Error state */}
        {error && (
          <Alert severity="error" sx={{ mb: 4 }}>
            Failed to load pricing information. Please try again later.
          </Alert>
        )}

        {/* Pricing cards */}
        {tiers && (
          <>
            <Grid container spacing={4} sx={{ mb: 8 }}>
              {tiers.map((tier) => (
                <Grid size={{ xs: 12, md: 4 }} key={tier.id}>
                  <PricingCard
                    tier={tier}
                    billingInterval={billingInterval}
                    onSelect={handleSelectTier}
                    onGetQuote={handleGetQuote}
                  />
                </Grid>
              ))}
            </Grid>

            {/* Tabs for comparison and calculator */}
            <Box sx={{ mb: 6 }}>
              <Tabs
                value={activeTab}
                onChange={(_e, v) => setActiveTab(v)}
                centered
                sx={{
                  mb: 4,
                  '& .MuiTabs-indicator': {
                    background: `linear-gradient(90deg, ${colors.violet} 0%, ${colors.cyan} 100%)`,
                  },
                }}
              >
                <Tab label="Feature Comparison" />
                <Tab label="Contact Sales" />
              </Tabs>

              {activeTab === 0 && <FeatureComparison tiers={tiers} />}

              {activeTab === 1 && (
                <Box sx={{ maxWidth: 700, mx: 'auto' }} id="quote-form">
                  <QuoteRequestForm
                    requestedTier={selectedQuoteTier}
                    billingInterval={billingInterval}
                  />
                </Box>
              )}
            </Box>
          </>
        )}

        {/* Show quote form when triggered */}
        {showQuoteForm && activeTab !== 1 && (
          <Box sx={{ maxWidth: 700, mx: 'auto', mb: 6 }} id="quote-form">
            <QuoteRequestForm
              requestedTier={selectedQuoteTier}
              billingInterval={billingInterval}
              onSuccess={() => setShowQuoteForm(false)}
            />
          </Box>
        )}

        {/* FAQ or additional info */}
        <Box sx={{ textAlign: 'center', mt: 8 }}>
          <Typography variant="h5" gutterBottom>
            Questions?
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Contact our team at{' '}
            <Box
              component="a"
              href="mailto:sales@controlfabric.ai"
              sx={{ color: colors.violet }}
            >
              sales@controlfabric.ai
            </Box>
          </Typography>
        </Box>
      </Container>
    </Box>
  );
}
