import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Slider,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  Chip,
  CircularProgress,
  alpha,
} from '@mui/material';
import type {
  PricingTier,
  PricingEstimate,
  BillingInterval,
  PricingRequirements,
} from '../../types/pricing';
import { formatPrice, formatLimit } from '../../types/pricing';
import { calculatePricing } from '../../services/pricing';
import { colors } from '../../theme';

interface EnvironmentCalculatorProps {
  tiers: PricingTier[];
  selectedTier?: string;
  billingInterval: BillingInterval;
  onTierChange?: (tier: string) => void;
  onEstimateChange?: (estimate: PricingEstimate | null) => void;
}

export default function EnvironmentCalculator({
  tiers,
  selectedTier,
  billingInterval,
  onTierChange,
  onEstimateChange,
}: EnvironmentCalculatorProps) {
  const [tier, setTier] = useState(selectedTier || 'pro');
  const [requirements, setRequirements] = useState<PricingRequirements>({
    environments: 2,
    repositories: 10,
    teamMembers: 5,
    storageGb: 20,
    buildMinutes: 500,
  });
  const [estimate, setEstimate] = useState<PricingEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentTier = tiers.find((t) => t.name === tier);

  const fetchEstimate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await calculatePricing({
        tier,
        billingInterval,
        requirements,
      });
      setEstimate(result);
      onEstimateChange?.(result);
    } catch (err) {
      setError('Failed to calculate pricing');
      setEstimate(null);
      onEstimateChange?.(null);
    } finally {
      setLoading(false);
    }
  }, [tier, billingInterval, requirements, onEstimateChange]);

  // Debounced fetch
  useEffect(() => {
    const timeout = setTimeout(fetchEstimate, 300);
    return () => clearTimeout(timeout);
  }, [fetchEstimate]);

  // Sync tier with parent
  useEffect(() => {
    if (selectedTier && selectedTier !== tier) {
      setTier(selectedTier);
    }
  }, [selectedTier, tier]);

  const handleTierChange = (newTier: string) => {
    setTier(newTier);
    onTierChange?.(newTier);
  };

  const handleSliderChange = (key: keyof PricingRequirements) => (
    _event: Event,
    value: number | number[]
  ) => {
    setRequirements((prev) => ({
      ...prev,
      [key]: value as number,
    }));
  };

  const sliderConfig = [
    { key: 'environments' as const, label: 'Environments', min: 1, max: 20, step: 1 },
    { key: 'repositories' as const, label: 'Repositories', min: 1, max: 200, step: 1 },
    { key: 'teamMembers' as const, label: 'Team Members', min: 1, max: 100, step: 1 },
    { key: 'storageGb' as const, label: 'Storage (GB)', min: 1, max: 500, step: 5 },
    { key: 'buildMinutes' as const, label: 'Build Minutes / Month', min: 100, max: 10000, step: 100 },
  ];

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        Calculate Your Price
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Adjust the sliders to estimate your monthly cost based on your needs.
      </Typography>

      {/* Tier selector */}
      <FormControl fullWidth sx={{ mb: 3 }}>
        <InputLabel>Select Plan</InputLabel>
        <Select
          value={tier}
          label="Select Plan"
          onChange={(e) => handleTierChange(e.target.value)}
        >
          {tiers.map((t) => (
            <MenuItem key={t.id} value={t.name}>
              {t.displayName}
              {t.isCustomPricing && ' (Custom Pricing)'}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Show limits info */}
      {currentTier && !currentTier.isCustomPricing && (
        <Alert severity="info" sx={{ mb: 3 }}>
          <Typography variant="body2">
            <strong>{currentTier.displayName}</strong> includes:{' '}
            {formatLimit(currentTier.limits.environments)} environments,{' '}
            {formatLimit(currentTier.limits.repositories)} repos,{' '}
            {formatLimit(currentTier.limits.teamMembers)} team members,{' '}
            {formatLimit(currentTier.limits.storageGb)}GB storage,{' '}
            {formatLimit(currentTier.limits.buildMinutes)} build minutes.
          </Typography>
        </Alert>
      )}

      {/* Sliders */}
      {currentTier && !currentTier.isCustomPricing && (
        <Box sx={{ mb: 3 }}>
          {sliderConfig.map((config) => {
            const value = requirements[config.key] || config.min;
            const limit = currentTier.limits[config.key];
            const isOverLimit = limit !== null && value > limit;

            return (
              <Box key={config.key} sx={{ mb: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body2">{config.label}</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 600,
                        color: isOverLimit ? colors.amber : 'text.primary',
                      }}
                    >
                      {value}
                    </Typography>
                    {isOverLimit && (
                      <Chip
                        label={`+${value - limit!} overage`}
                        size="small"
                        sx={{
                          bgcolor: alpha(colors.amber, 0.2),
                          color: colors.amber,
                          fontSize: '0.7rem',
                          height: 20,
                        }}
                      />
                    )}
                  </Box>
                </Box>
                <Slider
                  value={value}
                  min={config.min}
                  max={config.max}
                  step={config.step}
                  onChange={handleSliderChange(config.key)}
                  marks={[
                    { value: config.min, label: String(config.min) },
                    ...(limit !== null ? [{ value: limit, label: `Included: ${limit}` }] : []),
                    { value: config.max, label: String(config.max) },
                  ]}
                  sx={{
                    '& .MuiSlider-markLabel': {
                      fontSize: '0.7rem',
                    },
                    '& .MuiSlider-thumb': {
                      bgcolor: isOverLimit ? colors.amber : colors.violet,
                    },
                    '& .MuiSlider-track': {
                      bgcolor: isOverLimit ? colors.amber : colors.violet,
                    },
                  }}
                />
              </Box>
            );
          })}
        </Box>
      )}

      {/* Enterprise message */}
      {currentTier?.isCustomPricing && (
        <Alert severity="info" sx={{ mb: 3 }}>
          Enterprise plans have unlimited resources and custom pricing. Contact our sales team for a quote.
        </Alert>
      )}

      {/* Error */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Estimate result */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={24} />
        </Box>
      ) : estimate && !estimate.isCustomPricing ? (
        <Box
          sx={{
            p: 3,
            bgcolor: alpha(colors.violet, 0.05),
            borderRadius: 1,
            border: `1px solid ${colors.slateLighter}`,
          }}
        >
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Estimated {billingInterval === 'annual' ? 'Annual' : 'Monthly'} Cost
          </Typography>

          <Typography variant="h3" sx={{ mb: 2 }}>
            {billingInterval === 'annual'
              ? formatPrice(estimate.annualCents, 'annual')
              : formatPrice(estimate.monthlyCents, 'monthly')}
          </Typography>

          {billingInterval === 'annual' && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              ({formatPrice(estimate.effectiveMonthlyCents, 'monthly')} effective monthly)
            </Typography>
          )}

          {/* Breakdown */}
          {estimate.breakdown.overages.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Price Breakdown
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2">Base Price</Typography>
                <Typography variant="body2">
                  {formatPrice(estimate.breakdown.basePrice, 'monthly')}
                </Typography>
              </Box>
              {estimate.breakdown.overages.map((overage) => (
                <Box
                  key={overage.name}
                  sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}
                >
                  <Typography variant="body2" color="warning.main">
                    {overage.name} overage (+{overage.overageAmount})
                  </Typography>
                  <Typography variant="body2" color="warning.main">
                    +{formatPrice(overage.overageCost, 'monthly')}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}

          {/* Overage warning */}
          {estimate.exceedsLimits && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              Your configuration exceeds the {estimate.tierDisplayName} plan limits for:{' '}
              {estimate.exceedingLimits.join(', ')}. Consider upgrading to a higher tier.
            </Alert>
          )}
        </Box>
      ) : null}
    </Paper>
  );
}
