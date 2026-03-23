import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Typography,
  Chip,
  Button,
  Skeleton,
  Alert,
  TextField,
  Divider,
} from '@mui/material';
import {
  ArrowBack,
  RadioButtonUnchecked,
  CheckCircle,
} from '@mui/icons-material';
import { useState } from 'react';
import { colors } from '../theme';
import Markdown from '../components/Markdown';
import {
  getIssue,
  getIssueComments,
  addIssueComment,
  closeIssue,
  reopenIssue,
  type Issue,
  type IssueComment,
} from '../services/issues';

const getPriorityColor = (priority: string) => {
  switch (priority) {
    case 'critical': return colors.coral;
    case 'high': return colors.coral;
    case 'medium': return colors.violet;
    case 'low': return colors.cyan;
    default: return colors.textMuted;
  }
};

const getLabelColor = (label: string) => {
  const labelColors: Record<string, string> = {
    bug: colors.coral,
    feature: colors.green,
    enhancement: colors.violet,
    documentation: colors.cyan,
    security: colors.coral,
    performance: colors.violet,
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
  return date.toLocaleDateString();
};

export default function IssueDetailPage() {
  const { owner, repo, number } = useParams<{ owner: string; repo: string; number: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [commentBody, setCommentBody] = useState('');

  const issueNumber = parseInt(number || '0');

  const { data: issueData, isLoading, error } = useQuery({
    queryKey: ['issue', owner, repo, issueNumber],
    queryFn: () => getIssue(owner!, repo!, issueNumber),
    enabled: !!owner && !!repo && issueNumber > 0,
  });

  const { data: commentsData } = useQuery({
    queryKey: ['issueComments', owner, repo, issueNumber],
    queryFn: () => getIssueComments(owner!, repo!, issueNumber),
    enabled: !!owner && !!repo && issueNumber > 0,
  });

  const addCommentMutation = useMutation({
    mutationFn: () => addIssueComment(owner!, repo!, issueNumber, commentBody),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issueComments', owner, repo, issueNumber] });
      queryClient.invalidateQueries({ queryKey: ['issue', owner, repo, issueNumber] });
      setCommentBody('');
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => closeIssue(owner!, repo!, issueNumber),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue', owner, repo, issueNumber] });
      queryClient.invalidateQueries({ queryKey: ['repoIssues', owner, repo] });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: () => reopenIssue(owner!, repo!, issueNumber),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue', owner, repo, issueNumber] });
      queryClient.invalidateQueries({ queryKey: ['repoIssues', owner, repo] });
    },
  });

  if (!owner || !repo || !number) return null;

  const issue: Issue | undefined = issueData?.issue;
  const comments: IssueComment[] = commentsData?.comments || [];

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto' }}>
      {/* Back button */}
      <Button
        startIcon={<ArrowBack />}
        onClick={() => navigate(`/dashboard/repositories/${owner}/${repo}`, { state: { tab: 2 } })}
        sx={{ mb: 2, color: colors.textMuted }}
        size="small"
      >
        Back to Issues
      </Button>

      {/* Loading */}
      {isLoading && (
        <Box>
          <Skeleton variant="text" width="70%" height={40} />
          <Skeleton variant="text" width="40%" height={24} sx={{ mt: 1 }} />
          <Skeleton variant="rectangular" height={200} sx={{ mt: 3, borderRadius: 2 }} />
        </Box>
      )}

      {/* Error */}
      {error && (
        <Alert severity="error">Failed to load issue.</Alert>
      )}

      {/* Issue content */}
      {issue && (
        <>
          {/* Header */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 1 }}>
            {issue.state === 'open' ? (
              <RadioButtonUnchecked sx={{ color: colors.green, fontSize: 28, mt: 0.5 }} />
            ) : (
              <CheckCircle sx={{ color: colors.purple, fontSize: 28, mt: 0.5 }} />
            )}
            <Box sx={{ flex: 1 }}>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                {issue.title}
                <Typography component="span" sx={{ color: colors.textMuted, fontWeight: 400, ml: 1 }}>
                  #{issue.number}
                </Typography>
              </Typography>
            </Box>
          </Box>

          {/* Metadata bar */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3, ml: 5, flexWrap: 'wrap' }}>
            <Chip
              label={issue.state}
              size="small"
              sx={{
                backgroundColor: issue.state === 'open' ? `${colors.green}20` : `${colors.purple}20`,
                color: issue.state === 'open' ? colors.green : colors.purple,
                fontWeight: 600,
                textTransform: 'uppercase',
                fontSize: '0.7rem',
              }}
            />
            <Chip
              label={issue.priority}
              size="small"
              sx={{
                height: 22,
                fontSize: '0.65rem',
                textTransform: 'uppercase',
                backgroundColor: `${getPriorityColor(issue.priority)}20`,
                color: getPriorityColor(issue.priority),
              }}
            />
            {issue.labels?.map((label) => (
              <Chip
                key={label}
                label={label}
                size="small"
                sx={{
                  height: 22,
                  fontSize: '0.65rem',
                  backgroundColor: `${getLabelColor(label)}20`,
                  color: getLabelColor(label),
                  border: `1px solid ${getLabelColor(label)}40`,
                }}
              />
            ))}
            <Typography variant="body2" sx={{ color: colors.textMuted }}>
              opened {formatDate(issue.createdAt)} by {issue.author?.displayName || issue.author?.username}
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
            {issue.body ? (
              <Markdown>{issue.body}</Markdown>
            ) : (
              <Typography sx={{ color: colors.textMuted, fontStyle: 'italic' }}>
                No description provided.
              </Typography>
            )}
          </Box>

          {/* State toggle */}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 3 }}>
            {issue.state === 'open' ? (
              <Button
                variant="outlined"
                color="secondary"
                size="small"
                onClick={() => closeMutation.mutate()}
                disabled={closeMutation.isPending}
              >
                {closeMutation.isPending ? 'Closing...' : 'Close Issue'}
              </Button>
            ) : (
              <Button
                variant="outlined"
                color="success"
                size="small"
                onClick={() => reopenMutation.mutate()}
                disabled={reopenMutation.isPending}
              >
                {reopenMutation.isPending ? 'Reopening...' : 'Reopen Issue'}
              </Button>
            )}
          </Box>

          <Divider sx={{ borderColor: colors.navyLighter, mb: 3 }} />

          {/* Comments */}
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
            Comments ({comments.length})
          </Typography>

          {comments.length === 0 && (
            <Typography sx={{ color: colors.textMuted, mb: 3 }}>
              No comments yet.
            </Typography>
          )}

          {comments.map((comment) => (
            <Box
              key={comment.id}
              sx={{
                backgroundColor: colors.navy,
                border: `1px solid ${colors.navyLighter}`,
                borderRadius: 2,
                p: 2,
                mb: 2,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {comment.author?.displayName || comment.author?.username || 'Unknown'}
                </Typography>
                <Typography variant="caption" sx={{ color: colors.textMuted }}>
                  {formatDate(comment.createdAt)}
                </Typography>
                {comment.isEdited && (
                  <Typography variant="caption" sx={{ color: colors.textMuted, fontStyle: 'italic' }}>
                    (edited)
                  </Typography>
                )}
              </Box>
              <Markdown>{comment.body}</Markdown>
            </Box>
          ))}

          {/* Add comment */}
          <Box sx={{ mt: 3 }}>
            <TextField
              placeholder="Leave a comment..."
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              fullWidth
              multiline
              rows={3}
              sx={{ mb: 1 }}
            />
            {addCommentMutation.error && (
              <Alert severity="error" sx={{ mb: 1 }}>
                Failed to add comment.
              </Alert>
            )}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="contained"
                size="small"
                onClick={() => addCommentMutation.mutate()}
                disabled={!commentBody.trim() || addCommentMutation.isPending}
              >
                {addCommentMutation.isPending ? 'Posting...' : 'Comment'}
              </Button>
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
}
