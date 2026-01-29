import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Paper,
  alpha,
} from '@mui/material';
import {
  Check as CheckIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import type { PricingTier } from '../../types/pricing';
import { formatLimit, FEATURE_DISPLAYS } from '../../types/pricing';
import { colors } from '../../theme';

interface FeatureComparisonProps {
  tiers: PricingTier[];
}

export default function FeatureComparison({ tiers }: FeatureComparisonProps) {
  return (
    <TableContainer
      component={Paper}
      sx={{
        bgcolor: colors.slateLight,
        border: `1px solid ${colors.slateLighter}`,
      }}
    >
      <Table>
        <TableHead>
          <TableRow>
            <TableCell
              sx={{
                fontWeight: 600,
                borderBottom: `1px solid ${colors.slateLighter}`,
                bgcolor: alpha(colors.violet, 0.05),
              }}
            >
              Feature
            </TableCell>
            {tiers.map((tier) => (
              <TableCell
                key={tier.id}
                align="center"
                sx={{
                  fontWeight: 600,
                  borderBottom: `1px solid ${colors.slateLighter}`,
                  bgcolor: tier.isPopular ? alpha(colors.violet, 0.1) : alpha(colors.violet, 0.05),
                  borderLeft: `1px solid ${colors.slateLighter}`,
                }}
              >
                <Typography
                  variant="subtitle1"
                  sx={{
                    color: tier.isPopular ? colors.violet : 'text.primary',
                  }}
                >
                  {tier.displayName}
                </Typography>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {/* Limits section */}
          <TableRow>
            <TableCell
              colSpan={tiers.length + 1}
              sx={{
                bgcolor: alpha(colors.cyan, 0.05),
                fontWeight: 600,
                color: colors.cyan,
                py: 1.5,
              }}
            >
              Resource Limits
            </TableCell>
          </TableRow>

          <TableRow>
            <TableCell>Environments</TableCell>
            {tiers.map((tier) => (
              <TableCell
                key={tier.id}
                align="center"
                sx={{
                  borderLeft: `1px solid ${colors.slateLighter}`,
                  bgcolor: tier.isPopular ? alpha(colors.violet, 0.03) : undefined,
                }}
              >
                {formatLimit(tier.limits.environments)}
              </TableCell>
            ))}
          </TableRow>

          <TableRow>
            <TableCell>Repositories</TableCell>
            {tiers.map((tier) => (
              <TableCell
                key={tier.id}
                align="center"
                sx={{
                  borderLeft: `1px solid ${colors.slateLighter}`,
                  bgcolor: tier.isPopular ? alpha(colors.violet, 0.03) : undefined,
                }}
              >
                {formatLimit(tier.limits.repositories)}
              </TableCell>
            ))}
          </TableRow>

          <TableRow>
            <TableCell>Team Members</TableCell>
            {tiers.map((tier) => (
              <TableCell
                key={tier.id}
                align="center"
                sx={{
                  borderLeft: `1px solid ${colors.slateLighter}`,
                  bgcolor: tier.isPopular ? alpha(colors.violet, 0.03) : undefined,
                }}
              >
                {formatLimit(tier.limits.teamMembers)}
              </TableCell>
            ))}
          </TableRow>

          <TableRow>
            <TableCell>Storage (GB)</TableCell>
            {tiers.map((tier) => (
              <TableCell
                key={tier.id}
                align="center"
                sx={{
                  borderLeft: `1px solid ${colors.slateLighter}`,
                  bgcolor: tier.isPopular ? alpha(colors.violet, 0.03) : undefined,
                }}
              >
                {formatLimit(tier.limits.storageGb)}
              </TableCell>
            ))}
          </TableRow>

          <TableRow>
            <TableCell>Build Minutes / Month</TableCell>
            {tiers.map((tier) => (
              <TableCell
                key={tier.id}
                align="center"
                sx={{
                  borderLeft: `1px solid ${colors.slateLighter}`,
                  bgcolor: tier.isPopular ? alpha(colors.violet, 0.03) : undefined,
                }}
              >
                {formatLimit(tier.limits.buildMinutes)}
              </TableCell>
            ))}
          </TableRow>

          {/* Features section */}
          <TableRow>
            <TableCell
              colSpan={tiers.length + 1}
              sx={{
                bgcolor: alpha(colors.cyan, 0.05),
                fontWeight: 600,
                color: colors.cyan,
                py: 1.5,
              }}
            >
              Features
            </TableCell>
          </TableRow>

          {FEATURE_DISPLAYS.map((feature) => (
            <TableRow key={feature.key}>
              <TableCell>
                <Box>
                  <Typography variant="body2">{feature.label}</Typography>
                  {feature.description && (
                    <Typography variant="caption" color="text.secondary">
                      {feature.description}
                    </Typography>
                  )}
                </Box>
              </TableCell>
              {tiers.map((tier) => (
                <TableCell
                  key={tier.id}
                  align="center"
                  sx={{
                    borderLeft: `1px solid ${colors.slateLighter}`,
                    bgcolor: tier.isPopular ? alpha(colors.violet, 0.03) : undefined,
                  }}
                >
                  {tier.features[feature.key] ? (
                    <CheckIcon sx={{ color: colors.green }} />
                  ) : (
                    <CloseIcon sx={{ color: 'text.disabled' }} />
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
