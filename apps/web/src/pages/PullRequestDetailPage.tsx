import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Typography,
  Chip,
  Button,
  Skeleton,
  Alert,
  Divider,
  TextField,
  Stack,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import {
  ArrowBack,
  CallMerge,
  CheckCircle,
  Cancel,
  ThumbUp,
  ThumbDown,
  ChatBubbleOutline,
} from '@mui/icons-material';
import { useState } from 'react';
import { colors } from '../theme';
import Markdown from '../components/Markdown';
import {
  getPullRequest,
  getReviews,
  getPullRequestDiff,
  submitReview,
  mergePullRequest,
  updatePullRequest,
  type PullRequest,
  type PullRequestReview,
} from '../services/pullRequests';

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return date.toLocaleDateString();
};

const stateBadgeColor = (state: PullRequest['state']) => {
  switch (state) {
    case 'open':  return colors.green;
    case 'draft': return colors.textMuted;
    case 'merged': return colors.purple;
    case 'closed': return colors.coral;
    default: return colors.textMuted;
  }
};

const reviewStateColor = (state: PullRequestReview['state']) => {
  switch (state) {
    case 'approved': return colors.green;
    case 'changes_requested': return colors.coral;
    case 'commented': return colors.cyan;
    case 'dismissed': return colors.textMuted;
    default: return colors.textMuted;
  }
};

const reviewStateLabel: Record<PullRequestReview['state'], string> = {
  pending: 'Review requested',
  approved: 'Approved',
  changes_requested: 'Changes requested',
  commented: 'Commented',
  dismissed: 'Dismissed',
};

export default function PullRequestDetailPage() {
  const { owner, repo, number } = useParams<{ owner: string; repo: string; number: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reviewBody, setReviewBody] = useState('');

  const prNumber = parseInt(number || '0', 10);
  const enabled = !!owner && !!repo && prNumber > 0;

  const prQuery = useQuery({
    queryKey: ['pullRequest', owner, repo, prNumber],
    queryFn: () => getPullRequest(owner!, repo!, prNumber),
    enabled,
  });

  const reviewsQuery = useQuery({
    queryKey: ['pullRequestReviews', owner, repo, prNumber],
    queryFn: () => getReviews(owner!, repo!, prNumber),
    enabled,
  });

  const diffQuery = useQuery({
    queryKey: ['pullRequestDiff', owner, repo, prNumber],
    queryFn: () => getPullRequestDiff(owner!, repo!, prNumber),
    enabled,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['pullRequest', owner, repo, prNumber] });
    queryClient.invalidateQueries({ queryKey: ['pullRequestReviews', owner, repo, prNumber] });
  };

  const approveMutation = useMutation({
    mutationFn: () => submitReview(owner!, repo!, prNumber, { state: 'approved', body: reviewBody || undefined }),
    onSuccess: () => { setReviewBody(''); invalidate(); },
  });

  const requestChangesMutation = useMutation({
    mutationFn: () => submitReview(owner!, repo!, prNumber, { state: 'changes_requested', body: reviewBody || undefined }),
    onSuccess: () => { setReviewBody(''); invalidate(); },
  });

  const commentMutation = useMutation({
    mutationFn: () => submitReview(owner!, repo!, prNumber, { state: 'commented', body: reviewBody || undefined }),
    onSuccess: () => { setReviewBody(''); invalidate(); },
  });

  const mergeMutation = useMutation({
    mutationFn: () => mergePullRequest(owner!, repo!, prNumber, 'merge'),
    onSuccess: invalidate,
  });

  const closeMutation = useMutation({
    mutationFn: () => updatePullRequest(owner!, repo!, prNumber, { state: 'closed' }),
    onSuccess: invalidate,
  });

  if (!enabled) return null;

  const pr = prQuery.data?.pullRequest;
  const reviews = reviewsQuery.data?.reviews ?? pr?.reviews ?? [];
  const diff = diffQuery.data;

  const approvedCount = reviews.filter(r => r.state === 'approved').length;
  const changesRequestedCount = reviews.filter(r => r.state === 'changes_requested').length;
  const requiredReviewers = pr?.requiredReviewers ?? 1;
  const hasEnoughApprovals = approvedCount >= requiredReviewers;
  const hasBlockingReview = changesRequestedCount > 0;
  const canMerge = pr?.state === 'open' && hasEnoughApprovals && !hasBlockingReview;

  const mergeError = (mergeMutation.error as any)?.response?.data?.error as string | undefined;
  const reviewError =
    (approveMutation.error as any)?.response?.data?.error ??
    (requestChangesMutation.error as any)?.response?.data?.error ??
    (commentMutation.error as any)?.response?.data?.error;

  return (
    <Box sx={{ maxWidth: 960, mx: 'auto' }}>
      <Button
        startIcon={<ArrowBack />}
        onClick={() => navigate('/dashboard/pull-requests')}
        sx={{ mb: 2, color: colors.textMuted }}
        size="small"
      >
        Back to Pull Requests
      </Button>

      {prQuery.isLoading && (
        <Box>
          <Skeleton variant="text" width="70%" height={40} />
          <Skeleton variant="text" width="40%" height={24} sx={{ mt: 1 }} />
          <Skeleton variant="rectangular" height={160} sx={{ mt: 3, borderRadius: 2 }} />
        </Box>
      )}

      {prQuery.error && <Alert severity="error">Failed to load pull request.</Alert>}

      {pr && (
        <>
          {/* Header */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 1 }}>
            <CallMerge sx={{ color: stateBadgeColor(pr.state), fontSize: 28, mt: 0.5 }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                {pr.title}
                <Typography component="span" sx={{ color: colors.textMuted, fontWeight: 400, ml: 1 }}>
                  #{pr.number}
                </Typography>
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3, ml: 5, flexWrap: 'wrap' }}>
            <Chip
              label={pr.state}
              size="small"
              sx={{
                backgroundColor: `${stateBadgeColor(pr.state)}20`,
                color: stateBadgeColor(pr.state),
                fontWeight: 600,
                textTransform: 'uppercase',
                fontSize: '0.7rem',
              }}
            />
            <Typography variant="body2" sx={{ color: colors.textMuted, fontFamily: 'monospace' }}>
              {pr.sourceBranch} → {pr.targetBranch}
            </Typography>
            <Typography variant="body2" sx={{ color: colors.textMuted }}>
              opened {formatDate(pr.createdAt)} by {pr.author?.displayName || pr.author?.username}
            </Typography>
          </Box>

          {/* Body */}
          <Box
            sx={{
              backgroundColor: colors.navy,
              border: `1px solid ${colors.navyLighter}`,
              borderRadius: 2,
              p: 3,
              mb: 3,
            }}
          >
            {pr.body ? <Markdown>{pr.body}</Markdown> : (
              <Typography sx={{ color: colors.textMuted, fontStyle: 'italic' }}>
                No description provided.
              </Typography>
            )}
          </Box>

          {/* Merge panel */}
          {pr.state === 'open' && (
            <Box
              sx={{
                backgroundColor: colors.navy,
                border: `1px solid ${hasBlockingReview ? colors.coral : canMerge ? colors.green : colors.navyLighter}`,
                borderRadius: 2,
                p: 2.5,
                mb: 3,
              }}
            >
              <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }}>
                {canMerge ? <CheckCircle sx={{ color: colors.green }} /> :
                  hasBlockingReview ? <Cancel sx={{ color: colors.coral }} /> :
                  <ChatBubbleOutline sx={{ color: colors.textMuted }} />}
                <Typography sx={{ fontWeight: 600 }}>
                  {canMerge
                    ? 'Ready to merge'
                    : hasBlockingReview
                    ? 'Changes requested — cannot merge'
                    : `Needs ${requiredReviewers - approvedCount} more approval${requiredReviewers - approvedCount === 1 ? '' : 's'}`}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography variant="body2" sx={{ color: colors.textMuted }}>
                  {approvedCount} / {requiredReviewers} approved
                </Typography>
              </Stack>

              {mergeError && <Alert severity="error" sx={{ mt: 1, mb: 1 }}>{mergeError}</Alert>}

              <Stack direction="row" spacing={1}>
                <Tooltip title={!canMerge ? 'Merge blocked — see above' : ''}>
                  <span>
                    <Button
                      variant="contained"
                      startIcon={mergeMutation.isPending ? <CircularProgress size={16} /> : <CallMerge />}
                      onClick={() => mergeMutation.mutate()}
                      disabled={!canMerge || mergeMutation.isPending}
                      sx={{ backgroundColor: colors.green, '&:hover': { backgroundColor: colors.green } }}
                    >
                      {mergeMutation.isPending ? 'Merging…' : 'Merge pull request'}
                    </Button>
                  </span>
                </Tooltip>
                <Button
                  variant="outlined"
                  color="secondary"
                  onClick={() => closeMutation.mutate()}
                  disabled={closeMutation.isPending}
                >
                  Close without merge
                </Button>
              </Stack>
            </Box>
          )}

          {/* Review action */}
          {pr.state === 'open' && (
            <Box sx={{ mb: 4 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
                Submit a review
              </Typography>
              <TextField
                placeholder="Optional comment…"
                value={reviewBody}
                onChange={(e) => setReviewBody(e.target.value)}
                fullWidth
                multiline
                rows={3}
                sx={{ mb: 1 }}
              />
              {reviewError && <Alert severity="error" sx={{ mb: 1 }}>{String(reviewError)}</Alert>}
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  startIcon={<ThumbUp />}
                  onClick={() => approveMutation.mutate()}
                  disabled={approveMutation.isPending}
                  sx={{ backgroundColor: colors.green }}
                >
                  Approve
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<ThumbDown />}
                  onClick={() => requestChangesMutation.mutate()}
                  disabled={requestChangesMutation.isPending}
                  sx={{ color: colors.coral, borderColor: colors.coral }}
                >
                  Request changes
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<ChatBubbleOutline />}
                  onClick={() => commentMutation.mutate()}
                  disabled={commentMutation.isPending || !reviewBody.trim()}
                >
                  Comment
                </Button>
              </Stack>
            </Box>
          )}

          <Divider sx={{ borderColor: colors.navyLighter, mb: 3 }} />

          {/* Reviews */}
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
            Reviews ({reviews.length})
          </Typography>

          {reviews.length === 0 && (
            <Typography sx={{ color: colors.textMuted, mb: 3 }}>
              No reviews yet.
            </Typography>
          )}

          {reviews.map((r) => (
            <Box
              key={r.id}
              sx={{
                backgroundColor: colors.navy,
                border: `1px solid ${colors.navyLighter}`,
                borderLeft: `3px solid ${reviewStateColor(r.state)}`,
                borderRadius: 1,
                p: 2,
                mb: 1.5,
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: r.body ? 1 : 0 }}>
                <Chip
                  label={reviewStateLabel[r.state]}
                  size="small"
                  sx={{
                    backgroundColor: `${reviewStateColor(r.state)}20`,
                    color: reviewStateColor(r.state),
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    fontSize: '0.65rem',
                    height: 20,
                  }}
                />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {r.reviewer?.displayName || r.reviewer?.username || 'Unknown'}
                </Typography>
                <Typography variant="caption" sx={{ color: colors.textMuted }}>
                  {formatDate(r.submittedAt ?? r.createdAt)}
                </Typography>
              </Stack>
              {r.body && <Markdown>{r.body}</Markdown>}
            </Box>
          ))}

          {/* Files changed */}
          <Divider sx={{ borderColor: colors.navyLighter, my: 3 }} />
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
            Files changed{diff ? ` (${diff.files?.length ?? 0})` : ''}
            {diff && (
              <Typography component="span" sx={{ ml: 1, color: colors.textMuted, fontSize: '0.85rem', fontWeight: 400 }}>
                <Typography component="span" sx={{ color: colors.green }}>+{diff.totalAdditions}</Typography>
                {' / '}
                <Typography component="span" sx={{ color: colors.coral }}>-{diff.totalDeletions}</Typography>
              </Typography>
            )}
          </Typography>

          {diffQuery.isLoading && <Skeleton variant="rectangular" height={120} sx={{ borderRadius: 1 }} />}
          {diffQuery.error && <Alert severity="warning">Could not load diff.</Alert>}
          {diff && diff.files?.length === 0 && (
            <Typography sx={{ color: colors.textMuted }}>No file changes.</Typography>
          )}
          {diff?.files?.map((f) => (
            <Box
              key={f.path}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                py: 0.75,
                px: 1.5,
                borderBottom: `1px solid ${colors.navyLighter}`,
                fontFamily: 'monospace',
                fontSize: '0.85rem',
              }}
            >
              <Typography sx={{ flex: 1, fontFamily: 'monospace', fontSize: '0.85rem' }}>
                {f.path}
              </Typography>
              <Typography sx={{ color: colors.green, fontFamily: 'monospace' }}>+{f.additions}</Typography>
              <Typography sx={{ color: colors.coral, fontFamily: 'monospace' }}>-{f.deletions}</Typography>
            </Box>
          ))}
        </>
      )}
    </Box>
  );
}
