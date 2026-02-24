/**
 * ImpactAnalysis Component
 * Shows callers and co-changed symbols for a selected symbol
 */

import { Box, Typography, Chip } from '@mui/material';
import {
  CallReceived,
  SwapHoriz,
} from '@mui/icons-material';
import { colors } from '../../theme';
import type { ImpactData } from '../../services/repository';

interface ImpactAnalysisProps {
  data: ImpactData | null;
}

export function ImpactAnalysis({ data }: ImpactAnalysisProps) {
  if (!data) {
    return (
      <Typography variant="body2" sx={{ color: colors.textMuted, fontSize: '0.75rem', py: 1 }}>
        No impact data available
      </Typography>
    );
  }

  return (
    <Box>
      {/* Affected callers */}
      {data.callerCount > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
            <CallReceived sx={{ fontSize: 14, color: '#f43f5e' }} />
            <Typography variant="caption" sx={{ color: colors.textMuted }}>
              Affected callers ({data.callerCount})
            </Typography>
          </Box>
          {data.callers.slice(0, 8).map((caller) => (
            <Box
              key={caller.qualifiedName}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 2, py: 0.25 }}
            >
              <Chip
                label={caller.kind}
                size="small"
                sx={{ height: 14, fontSize: '0.6rem', backgroundColor: colors.navyLighter }}
              />
              <Typography variant="body2" sx={{ fontSize: '0.75rem' }}>
                {caller.name}
              </Typography>
              <Typography variant="caption" sx={{ color: colors.textMuted, fontSize: '0.6rem' }}>
                {caller.file?.split('/').pop()}
              </Typography>
            </Box>
          ))}
          {data.callerCount > 8 && (
            <Typography variant="caption" sx={{ pl: 2, color: colors.textMuted }}>
              +{data.callerCount - 8} more
            </Typography>
          )}
        </Box>
      )}

      {/* Co-changed symbols */}
      {data.coChangedCount > 0 && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
            <SwapHoriz sx={{ fontSize: 14, color: '#f59e0b' }} />
            <Typography variant="caption" sx={{ color: colors.textMuted }}>
              Frequently co-changed ({data.coChangedCount})
            </Typography>
          </Box>
          {data.coChanged.slice(0, 8).map((sym) => (
            <Box
              key={sym.qualifiedName}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 2, py: 0.25 }}
            >
              <Chip
                label={sym.kind}
                size="small"
                sx={{ height: 14, fontSize: '0.6rem', backgroundColor: colors.navyLighter }}
              />
              <Typography variant="body2" sx={{ fontSize: '0.75rem' }}>
                {sym.name}
              </Typography>
              <Chip
                label={`${sym.coChangeCount}x`}
                size="small"
                sx={{ height: 14, fontSize: '0.6rem' }}
              />
            </Box>
          ))}
          {data.coChangedCount > 8 && (
            <Typography variant="caption" sx={{ pl: 2, color: colors.textMuted }}>
              +{data.coChangedCount - 8} more
            </Typography>
          )}
        </Box>
      )}

      {data.callerCount === 0 && data.coChangedCount === 0 && (
        <Typography variant="body2" sx={{ color: colors.textMuted, fontSize: '0.75rem', py: 1 }}>
          No impact data found for this symbol
        </Typography>
      )}
    </Box>
  );
}

export default ImpactAnalysis;
