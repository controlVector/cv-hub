import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Chip,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  alpha,
} from '@mui/material';
import {
  Check as CheckIcon,
  Close as CloseIcon,
  Star as StarIcon,
} from '@mui/icons-material';
import type { PricingTier, BillingInterval } from '../../types/pricing';
import { formatPrice, formatLimit, FEATURE_DISPLAYS } from '../../types/pricing';
import { colors } from '../../theme';

interface PricingCardProps {
  tier: PricingTier;
  billingInterval: BillingInterval;
  isSelected?: boolean;
  onSelect?: (tier: PricingTier) => void;
  onGetQuote?: (tier: PricingTier) => void;
}

export default function PricingCard({
  tier,
  billingInterval,
  isSelected,
  onSelect,
  onGetQuote,
}: PricingCardProps) {
  const effectiveMonthlyPrice = billingInterval === 'annual' && tier.basePriceAnnual
    ? Math.round(tier.basePriceAnnual / 12)
    : tier.basePriceMonthly;

  const handleAction = () => {
    if (tier.isCustomPricing) {
      onGetQuote?.(tier);
    } else {
      onSelect?.(tier);
    }
  };

  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'visible',
        mt: tier.isPopular ? 2 : 0,
        border: tier.isPopular
          ? `2px solid ${colors.violet}`
          : isSelected
          ? `2px solid ${colors.cyan}`
          : undefined,
        boxShadow: tier.isPopular
          ? `0 8px 30px ${colors.violetGlow}`
          : undefined,
      }}
    >
      {/* Popular badge */}
      {tier.isPopular && (
        <Box
          sx={{
            position: 'absolute',
            top: -12,
            left: '50%',
            transform: 'translateX(-50%)',
          }}
        >
          <Chip
            icon={<StarIcon sx={{ fontSize: 16 }} />}
            label="Most Popular"
            size="small"
            sx={{
              background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.purple} 100%)`,
              color: 'white',
              fontWeight: 600,
            }}
          />
        </Box>
      )}

      <CardContent sx={{ flexGrow: 1, p: 3, pt: tier.isPopular ? 4 : 3 }}>
        {/* Tier name */}
        <Typography variant="h5" gutterBottom>
          {tier.displayName}
        </Typography>

        {/* Description */}
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mb: 3, minHeight: 40 }}
        >
          {tier.description}
        </Typography>

        {/* Price */}
        <Box sx={{ mb: 3 }}>
          {tier.isCustomPricing ? (
            <Typography
              variant="h3"
              sx={{
                background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.cyan} 100%)`,
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                color: 'transparent',
              }}
            >
              Custom
            </Typography>
          ) : (
            <>
              <Typography
                variant="h3"
                component="span"
                sx={{ fontWeight: 700 }}
              >
                {formatPrice(effectiveMonthlyPrice, 'monthly').replace('/mo', '')}
              </Typography>
              <Typography variant="body1" component="span" color="text.secondary">
                /month
              </Typography>
              {billingInterval === 'annual' && tier.basePriceMonthly && tier.basePriceMonthly > 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  <Box
                    component="span"
                    sx={{ textDecoration: 'line-through', mr: 1 }}
                  >
                    {formatPrice(tier.basePriceMonthly, 'monthly')}
                  </Box>
                  <Chip
                    label="Save 20%"
                    size="small"
                    sx={{
                      bgcolor: alpha(colors.green, 0.2),
                      color: colors.green,
                      fontSize: '0.7rem',
                      height: 20,
                    }}
                  />
                </Typography>
              )}
            </>
          )}
        </Box>

        {/* Limits summary */}
        <Box
          sx={{
            mb: 3,
            p: 2,
            bgcolor: alpha(colors.violet, 0.05),
            borderRadius: 1,
          }}
        >
          <Typography variant="subtitle2" gutterBottom sx={{ color: colors.violetLight }}>
            Includes:
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
            <Typography variant="body2">
              <strong>{formatLimit(tier.limits.environments)}</strong> environments
            </Typography>
            <Typography variant="body2">
              <strong>{formatLimit(tier.limits.repositories)}</strong> repos
            </Typography>
            <Typography variant="body2">
              <strong>{formatLimit(tier.limits.teamMembers)}</strong> team members
            </Typography>
            <Typography variant="body2">
              <strong>{formatLimit(tier.limits.storageGb)}</strong> storage
            </Typography>
          </Box>
        </Box>

        {/* Key features */}
        <List dense sx={{ mb: 2 }}>
          {FEATURE_DISPLAYS.slice(0, 6).map((feature) => {
            const hasFeature = tier.features[feature.key];
            return (
              <ListItem key={feature.key} disablePadding sx={{ py: 0.5 }}>
                <ListItemIcon sx={{ minWidth: 28 }}>
                  {hasFeature ? (
                    <CheckIcon sx={{ color: colors.green, fontSize: 18 }} />
                  ) : (
                    <CloseIcon sx={{ color: 'text.disabled', fontSize: 18 }} />
                  )}
                </ListItemIcon>
                <ListItemText
                  primary={feature.label}
                  primaryTypographyProps={{
                    variant: 'body2',
                    color: hasFeature ? 'text.primary' : 'text.disabled',
                  }}
                />
              </ListItem>
            );
          })}
        </List>
      </CardContent>

      {/* Action button */}
      <Box sx={{ p: 3, pt: 0 }}>
        <Button
          fullWidth
          variant={tier.isPopular ? 'contained' : 'outlined'}
          size="large"
          onClick={handleAction}
          sx={{
            py: 1.5,
            ...(tier.isPopular && {
              background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.purple} 100%)`,
            }),
          }}
        >
          {tier.isCustomPricing ? 'Contact Sales' : 'Get Started'}
        </Button>
      </Box>
    </Card>
  );
}
