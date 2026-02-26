/**
 * Context Engine Session Detail
 * Turn-by-turn timeline for a single session
 */

import {
  Box,
  Typography,
  Chip,
  Skeleton,
  Alert,
  IconButton,
} from '@mui/material';
import { ArrowBack, Psychology } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { colors } from '../theme';
import { getSessionTimeline } from '../services/context-engine';

function formatTimestamp(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function ContextEngineSessionDetail() {
  const { owner, repo, sessionId } = useParams<{
    owner: string; repo: string; sessionId: string;
  }>();
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['ceTimeline', owner, repo, sessionId],
    queryFn: () => getSessionTimeline(owner!, repo!, sessionId!),
    enabled: !!owner && !!repo && !!sessionId,
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Skeleton variant="rectangular" height={40} sx={{ borderRadius: 1, width: 300 }} />
        {[1, 2, 3].map(i => (
          <Skeleton key={i} variant="rectangular" height={100} sx={{ borderRadius: 2 }} />
        ))}
      </Box>
    );
  }

  if (isError || !data) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Failed to load session timeline.</Alert>
      </Box>
    );
  }

  const turns = [...data.turns].reverse(); // most recent first

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <IconButton
          size="small"
          onClick={() => navigate(`/dashboard/repositories/${owner}/${repo}/context-engine`)}
        >
          <ArrowBack sx={{ fontSize: 18 }} />
        </IconButton>
        <Psychology sx={{ fontSize: 20, color: colors.cyan }} />
        <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1rem' }}>
          Session Timeline
        </Typography>
        <Chip
          label={sessionId && sessionId.length > 32 ? `${sessionId.slice(0, 32)}...` : sessionId}
          size="small"
          sx={{ fontSize: '0.7rem', fontFamily: 'monospace', ml: 1 }}
        />
      </Box>

      {turns.length === 0 ? (
        <Alert severity="info">No knowledge turns recorded for this session yet.</Alert>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0, pl: 2 }}>
          {turns.map((turn, idx) => (
            <Box
              key={turn.turnNumber}
              sx={{
                position: 'relative',
                pl: 3,
                pb: idx < turns.length - 1 ? 2 : 0,
                // Vertical connector line
                '&::before': idx < turns.length - 1 ? {
                  content: '""',
                  position: 'absolute',
                  left: 8,
                  top: 24,
                  bottom: 0,
                  width: 2,
                  backgroundColor: colors.navyLighter,
                } : undefined,
              }}
            >
              {/* Dot on the timeline */}
              <Box
                sx={{
                  position: 'absolute',
                  left: 2,
                  top: 8,
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  backgroundColor: colors.cyan,
                  border: `2px solid ${colors.navyLight}`,
                }}
              />

              {/* Turn card */}
              <Box
                sx={{
                  p: 2,
                  borderRadius: 1.5,
                  backgroundColor: colors.navyLight,
                  border: `1px solid ${colors.navyLighter}`,
                }}
              >
                {/* Turn header */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Chip
                    label={`Turn ${turn.turnNumber}`}
                    size="small"
                    sx={{ fontSize: '0.7rem', height: 20, fontWeight: 600 }}
                  />
                  {turn.concern && (
                    <Chip
                      label={turn.concern}
                      size="small"
                      variant="outlined"
                      sx={{ fontSize: '0.65rem', height: 18 }}
                    />
                  )}
                  <Typography variant="caption" sx={{ color: colors.textMuted, ml: 'auto' }}>
                    {formatTimestamp(turn.timestamp)}
                  </Typography>
                </Box>

                {/* Summary */}
                {turn.summary && (
                  <Typography variant="body2" sx={{ fontSize: '0.85rem', lineHeight: 1.6, mb: 1 }}>
                    {turn.summary}
                  </Typography>
                )}

                {/* Files touched */}
                {turn.filesTouched.length > 0 && (
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.5 }}>
                    {turn.filesTouched.map((f) => (
                      <Chip
                        key={f}
                        label={f}
                        size="small"
                        sx={{
                          fontSize: '0.6rem', height: 18, fontFamily: 'monospace',
                          backgroundColor: 'rgba(59, 130, 246, 0.15)',
                          color: colors.blue,
                        }}
                      />
                    ))}
                  </Box>
                )}

                {/* Symbols referenced */}
                {turn.symbolsReferenced.length > 0 && (
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {turn.symbolsReferenced.map((s) => (
                      <Chip
                        key={s}
                        label={s}
                        size="small"
                        sx={{
                          fontSize: '0.6rem', height: 18, fontFamily: 'monospace',
                          backgroundColor: 'rgba(16, 185, 129, 0.15)',
                          color: colors.green,
                        }}
                      />
                    ))}
                  </Box>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
