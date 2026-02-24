import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Tabs,
  Tab,
  Chip,
  TextField,
  InputAdornment,
  Skeleton,
  Alert,
} from '@mui/material';
import {
  Search as SearchIcon,
  CallMerge as PRIcon,
  CheckCircle,
  Cancel,
  Comment,
  Schedule,
} from '@mui/icons-material';
import { colors } from '../theme';
import {
  getUserPullRequests,
  getUserReviewRequests,
  type PullRequest,
} from '../services/pullRequests';

const getStateIcon = (state: string) => {
  switch (state) {
    case 'open':
    case 'draft':
      return <PRIcon sx={{ color: colors.green, fontSize: 20 }} />;
    case 'merged':
      return <CheckCircle sx={{ color: colors.purple, fontSize: 20 }} />;
    case 'closed':
      return <Cancel sx={{ color: colors.coral, fontSize: 20 }} />;
    default:
      return <PRIcon sx={{ fontSize: 20 }} />;
  }
};

const getLabelColor = (label: string) => {
  const labelColors: Record<string, string> = {
    feature: colors.green,
    bug: colors.coral,
    security: colors.coral,
    enhancement: colors.violet,
    refactor: colors.purple,
    dependencies: colors.cyan,
    documentation: colors.cyan,
  };
  return labelColors[label] || colors.slateLighter;
};

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return `${Math.floor(diffDays / 30)} months ago`;
};

export default function PullRequests() {
  const [tabValue, setTabValue] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  // Tab 0 = my open PRs, Tab 1 = review requests, Tab 2 = merged, Tab 3 = all
  const stateFilter = tabValue === 0 ? 'open' : tabValue === 2 ? 'merged' : undefined;

  const { data: myPRs, isLoading: loadingMy, error: errorMy } = useQuery({
    queryKey: ['userPullRequests', stateFilter],
    queryFn: () => getUserPullRequests({ state: stateFilter, limit: 50 }),
    enabled: tabValue !== 1,
  });

  const { data: reviewRequests, isLoading: loadingReviews, error: errorReviews } = useQuery({
    queryKey: ['userReviewRequests'],
    queryFn: getUserReviewRequests,
    enabled: tabValue === 1,
  });

  const isLoading = tabValue === 1 ? loadingReviews : loadingMy;
  const error = tabValue === 1 ? errorReviews : errorMy;
  const prs: PullRequest[] = tabValue === 1
    ? (reviewRequests?.pullRequests || [])
    : (myPRs?.pullRequests || []);

  const filtered = prs.filter((pr) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      pr.title.toLowerCase().includes(q) ||
      pr.sourceBranch.toLowerCase().includes(q) ||
      pr.author?.username?.toLowerCase().includes(q)
    );
  });

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
          Pull Requests
        </Typography>
        <Typography variant="body1" sx={{ color: colors.textMuted }}>
          {filtered.length} pull request{filtered.length !== 1 ? 's' : ''}
        </Typography>
      </Box>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <TextField
          placeholder="Search pull requests..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          size="small"
          sx={{ width: 300 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ color: colors.textMuted }} />
              </InputAdornment>
            ),
          }}
        />
        <Tabs
          value={tabValue}
          onChange={(_, v) => setTabValue(v)}
          sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40, py: 0 } }}
        >
          <Tab label="Open" />
          <Tab label="Review Requests" />
          <Tab label="Merged" />
          <Tab label="All" />
        </Tabs>
      </Box>

      {/* Error */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load pull requests. Please try again.
        </Alert>
      )}

      {/* Loading */}
      {isLoading && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent>
                <Skeleton variant="text" width="60%" height={28} />
                <Skeleton variant="text" width="40%" height={20} sx={{ mt: 1 }} />
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      {/* Empty state */}
      {!isLoading && !error && filtered.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Typography variant="h6" sx={{ color: colors.textMuted, mb: 1 }}>
            {searchQuery ? 'No pull requests match your search' : 'No pull requests'}
          </Typography>
          <Typography variant="body2" sx={{ color: colors.textMuted }}>
            {tabValue === 1
              ? 'No pending review requests.'
              : 'Pull requests you create will appear here.'}
          </Typography>
        </Box>
      )}

      {/* PR List */}
      {!isLoading && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {filtered.map((pr) => (
            <Card key={pr.id}>
              <CardContent sx={{ py: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                  {getStateIcon(pr.state)}

                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
                      <Typography sx={{ fontWeight: 600 }}>
                        {pr.title}
                      </Typography>
                      {pr.isDraft && (
                        <Chip label="Draft" size="small" sx={{ height: 20, fontSize: '0.65rem' }} />
                      )}
                      {pr.labels?.map((label) => (
                        <Chip
                          key={label}
                          label={label}
                          size="small"
                          sx={{
                            height: 20,
                            fontSize: '0.65rem',
                            backgroundColor: `${getLabelColor(label)}20`,
                            color: getLabelColor(label),
                            border: `1px solid ${getLabelColor(label)}40`,
                          }}
                        />
                      ))}
                    </Box>

                    <Typography variant="body2" sx={{ color: colors.textMuted }}>
                      #{pr.number} {pr.state === 'merged' ? 'merged' : 'opened'} by{' '}
                      {pr.author?.displayName || pr.author?.username}
                      {pr.repository && (
                        <> in <b>{pr.repository.name}</b></>
                      )}
                    </Typography>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
                      <Typography variant="caption" sx={{ color: colors.textMuted, fontFamily: 'monospace' }}>
                        {pr.sourceBranch} → {pr.targetBranch}
                      </Typography>
                      {(pr.commentCount ?? 0) > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Comment sx={{ fontSize: 14, color: colors.textMuted }} />
                          <Typography variant="caption" sx={{ color: colors.textMuted }}>
                            {pr.commentCount}
                          </Typography>
                        </Box>
                      )}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Schedule sx={{ fontSize: 14, color: colors.textMuted }} />
                        <Typography variant="caption" sx={{ color: colors.textMuted }}>
                          {formatDate(pr.updatedAt)}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}
    </Box>
  );
}
