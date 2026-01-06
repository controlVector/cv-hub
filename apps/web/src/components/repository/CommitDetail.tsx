/**
 * CommitDetail Component
 * Shows detailed information about a single commit including diff
 */

import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Avatar,
  Chip,
  Tooltip,
  Skeleton,
  Button,
  Divider,
} from '@mui/material';
import {
  ContentCopy,
  ArrowBack,
  AccountTree,
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import { colors } from '../../theme';
import { getCommit, compareRefs, type CommitInfo, type DiffFile } from '../../services/repository';
import DiffViewer from './DiffViewer';

// Generate avatar color from string
function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 65%, 45%)`;
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

// Format date
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface CommitDetailProps {
  owner: string;
  repo: string;
}

export function CommitDetail({ owner, repo }: CommitDetailProps) {
  const navigate = useNavigate();
  const { sha } = useParams<{ sha: string }>();
  const [commit, setCommit] = useState<CommitInfo | null>(null);
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [totalAdditions, setTotalAdditions] = useState(0);
  const [totalDeletions, setTotalDeletions] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function loadCommit() {
      if (!sha) return;

      setIsLoading(true);
      setError(null);

      try {
        // Load commit info
        const commitData = await getCommit(owner, repo, sha);
        setCommit(commitData.commit);

        // Load diff (compare with parent)
        if (commitData.commit.parents && commitData.commit.parents.length > 0) {
          const parentSha = commitData.commit.parents[0];
          const compareData = await compareRefs(owner, repo, parentSha, sha);
          setFiles(compareData.files);
          setTotalAdditions(compareData.totalAdditions);
          setTotalDeletions(compareData.totalDeletions);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load commit');
        console.error('Failed to load commit:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadCommit();
  }, [owner, repo, sha]);

  const handleCopySha = () => {
    if (sha) {
      navigator.clipboard.writeText(sha);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleBack = () => {
    navigate(-1);
  };

  const handleViewTree = () => {
    navigate(`/repositories/${owner}/${repo}/tree/${sha}`);
  };

  if (isLoading) {
    return (
      <Box>
        {/* Header skeleton */}
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <Skeleton variant="circular" width={48} height={48} />
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="text" width="60%" height={28} />
              <Skeleton variant="text" width="40%" height={20} />
            </Box>
          </Box>
          <Skeleton variant="rounded" width="100%" height={100} />
        </Box>

        {/* Files skeleton */}
        <Skeleton variant="text" width={200} height={24} sx={{ mb: 2 }} />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} variant="rounded" width="100%" height={200} sx={{ mb: 2 }} />
        ))}
      </Box>
    );
  }

  if (error || !commit) {
    return (
      <Box sx={{ py: 8, textAlign: 'center' }}>
        <Typography variant="h6" sx={{ color: colors.coral, mb: 2 }}>
          {error || 'Commit not found'}
        </Typography>
        <Button variant="outlined" onClick={handleBack} startIcon={<ArrowBack />}>
          Go back
        </Button>
      </Box>
    );
  }

  const [title, ...bodyLines] = commit.message.split('\n');
  const body = bodyLines.filter((l) => l.trim()).join('\n');

  return (
    <Box>
      {/* Back button */}
      <Button
        variant="text"
        startIcon={<ArrowBack />}
        onClick={handleBack}
        sx={{ mb: 2, color: colors.textMuted }}
      >
        Back to commits
      </Button>

      {/* Commit header */}
      <Box
        sx={{
          backgroundColor: colors.navyLight,
          borderRadius: 2,
          border: `1px solid ${colors.navyLighter}`,
          p: 3,
          mb: 3,
        }}
      >
        {/* Title */}
        <Typography variant="h5" sx={{ fontWeight: 600, mb: 2 }}>
          {title}
        </Typography>

        {/* Body */}
        {body && (
          <Typography
            variant="body1"
            sx={{
              color: colors.textMuted,
              whiteSpace: 'pre-wrap',
              fontFamily: 'monospace',
              backgroundColor: colors.navy,
              p: 2,
              borderRadius: 1,
              mb: 3,
            }}
          >
            {body}
          </Typography>
        )}

        <Divider sx={{ my: 2, borderColor: colors.navyLighter }} />

        {/* Author info */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
          <Avatar
            sx={{
              width: 48,
              height: 48,
              backgroundColor: stringToColor(commit.author.email),
            }}
          >
            {getInitials(commit.author.name)}
          </Avatar>

          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body1" sx={{ fontWeight: 500, color: colors.orange }}>
                {commit.author.name}
              </Typography>
              <Typography variant="body2" sx={{ color: colors.textMuted }}>
                authored on {formatDate(commit.author.date)}
              </Typography>
            </Box>
            {commit.committer.name !== commit.author.name && (
              <Typography variant="body2" sx={{ color: colors.textMuted }}>
                committed by {commit.committer.name} on {formatDate(commit.committer.date)}
              </Typography>
            )}
          </Box>
        </Box>

        {/* Commit info */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          {/* SHA */}
          <Tooltip title={copied ? 'Copied!' : 'Copy full SHA'}>
            <Chip
              label={sha}
              onClick={handleCopySha}
              icon={<ContentCopy sx={{ fontSize: 14 }} />}
              sx={{
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                cursor: 'pointer',
                '&:hover': {
                  backgroundColor: colors.orange,
                  color: colors.navy,
                },
              }}
            />
          </Tooltip>

          {/* Parent commits */}
          {commit.parents && commit.parents.length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" sx={{ color: colors.textMuted }}>
                Parent{commit.parents.length > 1 ? 's' : ''}:
              </Typography>
              {commit.parents.map((parent) => (
                <Chip
                  key={parent}
                  label={parent.slice(0, 7)}
                  size="small"
                  onClick={() => navigate(`/repositories/${owner}/${repo}/commit/${parent}`)}
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </Box>
          )}

          {/* Browse files button */}
          <Tooltip title="Browse repository at this commit">
            <Button
              variant="outlined"
              size="small"
              startIcon={<AccountTree />}
              onClick={handleViewTree}
            >
              Browse files
            </Button>
          </Tooltip>
        </Box>
      </Box>

      {/* File changes */}
      <Typography variant="h6" sx={{ mb: 2 }}>
        Changes
      </Typography>

      <DiffViewer
        files={files}
        totalAdditions={totalAdditions}
        totalDeletions={totalDeletions}
      />
    </Box>
  );
}

export default CommitDetail;
