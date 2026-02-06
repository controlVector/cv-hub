import { useState } from 'react';
import {
  Box,
  Container,
  Typography,
  Paper,
  ToggleButton,
  ToggleButtonGroup,
  Grid,
  Chip,
  CircularProgress,
  Alert,
  alpha,
  Divider,
  Button,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';
import {
  Layers as EnvironmentIcon,
  Receipt as QuoteIcon,
  ArrowForward as ArrowIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  PricingCard,
  EnvironmentCalculator,
  QuoteRequestForm,
} from '../../components/pricing';
import type { BillingInterval, PricingEstimate, QuoteRequest } from '../../types/pricing';
import { fetchPricingTiers, fetchUserQuotes } from '../../services/pricing';
import { colors } from '../../theme';

export default function EnvironmentPage() {
  const { user: _user } = useAuth();
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('monthly');
  const [selectedTier, setSelectedTier] = useState<string>('pro');
  const [estimate, setEstimate] = useState<PricingEstimate | null>(null);
  const [showQuoteForm, setShowQuoteForm] = useState(false);

  const { data: tiers, isLoading: tiersLoading, error: tiersError } = useQuery({
    queryKey: ['pricingTiers'],
    queryFn: fetchPricingTiers,
  });

  const { data: quotes, isLoading: quotesLoading } = useQuery({
    queryKey: ['userQuotes'],
    queryFn: fetchUserQuotes,
  });

  const handleBillingChange = (
    _event: React.MouseEvent<HTMLElement>,
    newBilling: BillingInterval | null
  ) => {
    if (newBilling) {
      setBillingInterval(newBilling);
    }
  };

  const currentTier = tiers?.find((t) => t.name === selectedTier);

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography
        variant="h4"
        gutterBottom
        sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
      >
        <EnvironmentIcon /> Environment & Billing
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Manage your subscription and calculate costs for your needs.
      </Typography>

      {/* Loading state */}
      {tiersLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {/* Error state */}
      {tiersError && (
        <Alert severity="error" sx={{ mb: 4 }}>
          Failed to load pricing information. Please try again later.
        </Alert>
      )}

      {tiers && (
        <>
          {/* Current plan info */}
          <Paper sx={{ p: 3, mb: 4 }}>
            <Typography variant="h6" gutterBottom>
              Current Plan
            </Typography>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 2,
              }}
            >
              <Box>
                <Typography variant="h5" sx={{ color: colors.violet }}>
                  {/* In a real app, this would come from the user's subscription */}
                  Starter (Free)
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  You're currently on the free plan. Upgrade to unlock more features.
                </Typography>
              </Box>
              <Button
                component={RouterLink}
                to="/pricing"
                variant="outlined"
                endIcon={<ArrowIcon />}
              >
                View All Plans
              </Button>
            </Box>
          </Paper>

          {/* Billing toggle */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 4 }}>
            <Typography variant="body2">Billing:</Typography>
            <ToggleButtonGroup
              value={billingInterval}
              exclusive
              onChange={handleBillingChange}
              size="small"
              sx={{
                '& .MuiToggleButton-root': {
                  px: 2,
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
                    height: 18,
                    fontSize: '0.65rem',
                  }}
                />
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>

          <Grid container spacing={4}>
            {/* Calculator */}
            <Grid size={{ xs: 12, md: 7 }}>
              <EnvironmentCalculator
                tiers={tiers}
                selectedTier={selectedTier}
                billingInterval={billingInterval}
                onTierChange={setSelectedTier}
                onEstimateChange={setEstimate}
              />
            </Grid>

            {/* Selected tier card */}
            <Grid size={{ xs: 12, md: 5 }}>
              {currentTier && (
                <PricingCard
                  tier={currentTier}
                  billingInterval={billingInterval}
                  isSelected
                  onSelect={() => {
                    // In a real app, this would initiate the upgrade flow
                    window.location.href = `/register?plan=${currentTier.name}`;
                  }}
                  onGetQuote={() => setShowQuoteForm(true)}
                />
              )}
            </Grid>
          </Grid>

          <Divider sx={{ my: 4 }} />

          {/* Quote request section */}
          <Box sx={{ mb: 4 }}>
            <Typography
              variant="h6"
              gutterBottom
              sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
            >
              <QuoteIcon /> Quote Requests
            </Typography>

            {!showQuoteForm ? (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Need a custom plan or have specific requirements? Request a quote from our sales team.
                </Typography>
                <Button
                  variant="outlined"
                  onClick={() => setShowQuoteForm(true)}
                >
                  Request Quote
                </Button>

                {/* Existing quotes */}
                {quotesLoading && <CircularProgress size={20} sx={{ ml: 2 }} />}
                {quotes && quotes.length > 0 && (
                  <Paper sx={{ mt: 3 }}>
                    <List>
                      {quotes.map((quote: QuoteRequest) => (
                        <ListItem key={quote.id} divider>
                          <ListItemText
                            primary={`${quote.requestedTier.charAt(0).toUpperCase() + quote.requestedTier.slice(1)} Plan Quote`}
                            secondary={
                              <>
                                Submitted: {new Date(quote.createdAt).toLocaleDateString()}
                                {quote.companyName && ` • ${quote.companyName}`}
                              </>
                            }
                          />
                          <Chip
                            label={quote.status}
                            size="small"
                            sx={{
                              bgcolor:
                                quote.status === 'pending'
                                  ? alpha(colors.amber, 0.2)
                                  : quote.status === 'contacted'
                                  ? alpha(colors.blue, 0.2)
                                  : quote.status === 'closed_won'
                                  ? alpha(colors.green, 0.2)
                                  : alpha(colors.slateLighter, 0.5),
                              color:
                                quote.status === 'pending'
                                  ? colors.amber
                                  : quote.status === 'contacted'
                                  ? colors.blue
                                  : quote.status === 'closed_won'
                                  ? colors.green
                                  : 'text.secondary',
                            }}
                          />
                        </ListItem>
                      ))}
                    </List>
                  </Paper>
                )}
              </>
            ) : (
              <Box sx={{ maxWidth: 700 }}>
                <QuoteRequestForm
                  requestedTier={selectedTier}
                  billingInterval={billingInterval}
                  requirements={estimate ? {
                    environments: estimate.limits.environments || undefined,
                    repositories: estimate.limits.repositories || undefined,
                    teamMembers: estimate.limits.teamMembers || undefined,
                    storageGb: estimate.limits.storageGb || undefined,
                    buildMinutes: estimate.limits.buildMinutes || undefined,
                  } : undefined}
                  onSuccess={() => {
                    setShowQuoteForm(false);
                  }}
                />
                <Button
                  variant="text"
                  onClick={() => setShowQuoteForm(false)}
                  sx={{ mt: 2 }}
                >
                  Cancel
                </Button>
              </Box>
            )}
          </Box>
        </>
      )}
    </Container>
  );
}
