/**
 * TimelineView Component
 * Vertical timeline showing commits that modified a file/symbol
 */

import { Box, Typography } from '@mui/material';
import { Commit as CommitIcon } from '@mui/icons-material';
import { colors } from '../../theme';
import type { TimelineEntry } from '../../services/repository';

interface TimelineViewProps {
  entries: TimelineEntry[];
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const now = Date.now();
  const diffMs = now - ts;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return date.toLocaleDateString();
}

export function TimelineView({ entries }: TimelineViewProps) {
  if (entries.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: colors.textMuted, fontSize: '0.75rem', py: 1 }}>
        No commit history available
      </Typography>
    );
  }

  return (
    <Box sx={{ pl: 1 }}>
      {entries.map((entry, idx) => (
        <Box
          key={entry.sha}
          sx={{
            display: 'flex',
            gap: 1,
            pb: 1.5,
            position: 'relative',
            // Vertical line
            '&::before': idx < entries.length - 1 ? {
              content: '""',
              position: 'absolute',
              left: 7,
              top: 18,
              bottom: 0,
              width: 1,
              backgroundColor: colors.navyLighter,
            } : {},
          }}
        >
          <CommitIcon
            sx={{
              fontSize: 16,
              color: entry.changeType === 'added' ? colors.green :
                     entry.changeType === 'deleted' ? colors.rose :
                     colors.blue,
              mt: 0.25,
              flexShrink: 0,
            }}
          />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant="body2"
              sx={{
                fontSize: '0.75rem',
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {entry.message.split('\n')[0]}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mt: 0.25 }}>
              <Typography variant="caption" sx={{ color: colors.textMuted, fontSize: '0.65rem' }}>
                {entry.author}
              </Typography>
              <Typography variant="caption" sx={{ color: colors.textMuted, fontSize: '0.65rem' }}>
                {formatTimestamp(entry.timestamp)}
              </Typography>
              {(entry.insertions != null || entry.deletions != null) && (
                <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>
                  <Box component="span" sx={{ color: colors.green }}>+{entry.insertions || 0}</Box>
                  {' '}
                  <Box component="span" sx={{ color: colors.rose }}>-{entry.deletions || 0}</Box>
                </Typography>
              )}
            </Box>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

export default TimelineView;
