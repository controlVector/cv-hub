/**
 * Repository Issues Page
 * List and create issues for a repository
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Tabs,
  Tab,
  TextField,
  InputAdornment,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Skeleton,
  Alert,
} from '@mui/material';
import {
  Search as SearchIcon,
  BugReport as IssueIcon,
  CheckCircle,
  RadioButtonUnchecked,
  Comment,
  Schedule,
  Add as AddIcon,
} from '@mui/icons-material';
import { colors } from '../theme';
import {
  getRepositoryIssues,
  createIssue,
  type Issue,
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
  return `${Math.floor(diffDays / 30)} months ago`;
};

interface RepositoryIssuesProps {
  owner: string;
  repo: string;
}

export default function RepositoryIssues({ owner, repo }: RepositoryIssuesProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tabValue, setTabValue] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newPriority, setNewPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');

  const stateFilter = tabValue === 0 ? 'open' : tabValue === 1 ? 'closed' : 'all';

  const { data, isLoading, error } = useQuery({
    queryKey: ['repoIssues', owner, repo, stateFilter, searchQuery],
    queryFn: () =>
      getRepositoryIssues(owner, repo, {
        state: stateFilter as any,
        search: searchQuery || undefined,
        limit: 50,
      }),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createIssue(owner, repo, {
        title: newTitle,
        body: newBody || undefined,
        priority: newPriority,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repoIssues', owner, repo] });
      setCreateOpen(false);
      setNewTitle('');
      setNewBody('');
      setNewPriority('medium');
    },
  });

  const issues: Issue[] = data?.issues || [];

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Issues
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
        >
          New Issue
        </Button>
      </Box>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <TextField
          placeholder="Search issues..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          size="small"
          sx={{ width: 280 }}
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
          <Tab label={`Open${data ? ` (${tabValue === 0 ? issues.length : ''})` : ''}`} />
          <Tab label="Closed" />
          <Tab label="All" />
        </Tabs>
      </Box>

      {/* Error */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load issues.
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
      {!isLoading && !error && issues.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <IssueIcon sx={{ fontSize: 48, color: colors.textMuted, mb: 2 }} />
          <Typography variant="h6" sx={{ color: colors.textMuted, mb: 1 }}>
            {searchQuery ? 'No issues match your search' : 'No issues yet'}
          </Typography>
          <Typography variant="body2" sx={{ color: colors.textMuted }}>
            {!searchQuery && 'Create an issue to track bugs, features, or tasks.'}
          </Typography>
        </Box>
      )}

      {/* Issue List */}
      {!isLoading && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {issues.map((issue) => (
            <Card
              key={issue.id}
              sx={{ cursor: 'pointer', '&:hover': { borderColor: colors.slateLighter } }}
              onClick={() => navigate(`/dashboard/repositories/${owner}/${repo}/issues/${issue.number}`)}
            >
              <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                  {issue.state === 'open' ? (
                    <RadioButtonUnchecked sx={{ color: colors.green, fontSize: 20, mt: 0.3 }} />
                  ) : (
                    <CheckCircle sx={{ color: colors.purple, fontSize: 20, mt: 0.3 }} />
                  )}

                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
                      <Typography sx={{ fontWeight: 600 }}>
                        {issue.title}
                      </Typography>
                      <Chip
                        label={issue.priority}
                        size="small"
                        sx={{
                          height: 20,
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
                            height: 20,
                            fontSize: '0.65rem',
                            backgroundColor: `${getLabelColor(label)}20`,
                            color: getLabelColor(label),
                            border: `1px solid ${getLabelColor(label)}40`,
                          }}
                        />
                      ))}
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Typography variant="body2" sx={{ color: colors.textMuted }}>
                        #{issue.number} opened by {issue.author?.displayName || issue.author?.username}
                      </Typography>
                      {(issue.commentCount ?? 0) > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Comment sx={{ fontSize: 14, color: colors.textMuted }} />
                          <Typography variant="caption" sx={{ color: colors.textMuted }}>
                            {issue.commentCount}
                          </Typography>
                        </Box>
                      )}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Schedule sx={{ fontSize: 14, color: colors.textMuted }} />
                        <Typography variant="caption" sx={{ color: colors.textMuted }}>
                          {formatDate(issue.updatedAt)}
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

      {/* Create Issue Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Issue</DialogTitle>
        <DialogContent>
          <TextField
            label="Title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            fullWidth
            required
            sx={{ mt: 1, mb: 2 }}
          />
          <TextField
            label="Description"
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            fullWidth
            multiline
            rows={4}
            sx={{ mb: 2 }}
          />
          <FormControl fullWidth>
            <InputLabel>Priority</InputLabel>
            <Select
              value={newPriority}
              label="Priority"
              onChange={(e) => setNewPriority(e.target.value as any)}
            >
              <MenuItem value="low">Low</MenuItem>
              <MenuItem value="medium">Medium</MenuItem>
              <MenuItem value="high">High</MenuItem>
              <MenuItem value="critical">Critical</MenuItem>
            </Select>
          </FormControl>

          {createMutation.error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              Failed to create issue. Please try again.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => createMutation.mutate()}
            disabled={!newTitle.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating...' : 'Create Issue'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
