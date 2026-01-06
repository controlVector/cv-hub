/**
 * CommitHistory Component
 * Displays commit history with author info and commit messages
 */

import { useState } from 'react';
import {
  Box,
  Typography,
  Avatar,
  Skeleton,
  Button,
  Tooltip,
  IconButton,
} from '@mui/material';
import {
  ContentCopy,
  OpenInNew,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { colors } from '../../theme';
import type { CommitInfo } from '../../services/repository';

// Generate avatar color from string
function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

// Format relative time
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
  if (diffWeek < 4) return `${diffWeek} week${diffWeek > 1 ? 's' : ''} ago`;
  if (diffMonth < 12) return `${diffMonth} month${diffMonth > 1 ? 's' : ''} ago`;

  return date.toLocaleDateString();
}

// Get initials from name
function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

interface CommitItemProps {
  commit: CommitInfo;
  owner: string;
  repo: string;
}

function CommitItem({ commit, owner, repo }: CommitItemProps) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const shortSha = commit.sha.slice(0, 7);
  const [title] = commit.message.split('\n');

  const handleCopySha = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(commit.sha);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleViewCommit = () => {
    navigate(`/repositories/${owner}/${repo}/commit/${commit.sha}`);
  };

  const handleViewTree = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/repositories/${owner}/${repo}/tree/${commit.sha}`);
  };

  return (
    <Box
      onClick={handleViewCommit}
      sx={{
        display: 'flex',
        gap: 2,
        p: 2,
        borderBottom: `1px solid ${colors.navyLighter}`,
        cursor: 'pointer',
        '&:hover': {
          backgroundColor: `${colors.orange}08`,
        },
        '&:last-child': {
          borderBottom: 'none',
        },
      }}
    >
      {/* Avatar */}
      <Avatar
        sx={{
          width: 40,
          height: 40,
          backgroundColor: stringToColor(commit.author.email),
          fontSize: '0.9rem',
        }}
      >
        {getInitials(commit.author.name)}
      </Avatar>

      {/* Content */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {/* Title */}
        <Typography
          variant="body1"
          sx={{
            fontWeight: 500,
            color: colors.textLight,
            mb: 0.5,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </Typography>

        {/* Author and time */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" sx={{ color: colors.orange }}>
            {commit.author.name}
          </Typography>
          <Typography variant="body2" sx={{ color: colors.textMuted }}>
            committed {formatRelativeTime(commit.author.date)}
          </Typography>
        </Box>
      </Box>

      {/* Actions */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {/* SHA */}
        <Tooltip title={copied ? 'Copied!' : 'Copy SHA'}>
          <Box
            onClick={handleCopySha}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              px: 1,
              py: 0.5,
              borderRadius: 1,
              backgroundColor: colors.navyLighter,
              cursor: 'pointer',
              '&:hover': {
                backgroundColor: colors.orange,
                '& .MuiTypography-root': {
                  color: colors.navy,
                },
                '& .MuiSvgIcon-root': {
                  color: colors.navy,
                },
              },
            }}
          >
            <Typography
              variant="caption"
              sx={{
                fontFamily: 'monospace',
                color: colors.textLight,
              }}
            >
              {shortSha}
            </Typography>
            <ContentCopy sx={{ fontSize: 14, color: colors.textMuted }} />
          </Box>
        </Tooltip>

        {/* Browse files */}
        <Tooltip title="Browse files at this commit">
          <IconButton
            size="small"
            onClick={handleViewTree}
            sx={{
              color: colors.textMuted,
              '&:hover': {
                color: colors.orange,
              },
            }}
          >
            <OpenInNew sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

interface CommitHistoryProps {
  commits: CommitInfo[];
  owner: string;
  repo: string;
  isLoading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

export function CommitHistory({
  commits,
  owner,
  repo,
  isLoading,
  hasMore,
  onLoadMore,
}: CommitHistoryProps) {
  if (isLoading && commits.length === 0) {
    return (
      <Box
        sx={{
          backgroundColor: colors.navyLight,
          borderRadius: 2,
          border: `1px solid ${colors.navyLighter}`,
          overflow: 'hidden',
        }}
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <Box
            key={i}
            sx={{
              display: 'flex',
              gap: 2,
              p: 2,
              borderBottom: `1px solid ${colors.navyLighter}`,
            }}
          >
            <Skeleton variant="circular" width={40} height={40} />
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="text" width="60%" height={24} />
              <Skeleton variant="text" width="40%" height={20} />
            </Box>
            <Skeleton variant="rounded" width={80} height={28} />
          </Box>
        ))}
      </Box>
    );
  }

  if (commits.length === 0) {
    return (
      <Box
        sx={{
          backgroundColor: colors.navyLight,
          borderRadius: 2,
          border: `1px solid ${colors.navyLighter}`,
          p: 4,
          textAlign: 'center',
        }}
      >
        <Typography variant="body1" sx={{ color: colors.textMuted }}>
          No commits found
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        backgroundColor: colors.navyLight,
        borderRadius: 2,
        border: `1px solid ${colors.navyLighter}`,
        overflow: 'hidden',
      }}
    >
      {commits.map((commit) => (
        <CommitItem
          key={commit.sha}
          commit={commit}
          owner={owner}
          repo={repo}
        />
      ))}

      {hasMore && (
        <Box sx={{ p: 2, textAlign: 'center' }}>
          <Button
            variant="outlined"
            size="small"
            onClick={onLoadMore}
            disabled={isLoading}
          >
            {isLoading ? 'Loading...' : 'Load more commits'}
          </Button>
        </Box>
      )}
    </Box>
  );
}

export default CommitHistory;
