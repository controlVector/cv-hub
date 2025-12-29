import { useState } from 'react';
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
  IconButton,
  LinearProgress,
  Tooltip,
  Collapse,
  Button,
} from '@mui/material';
import {
  Search as SearchIcon,
  CallMerge as PRIcon,
  CheckCircle,
  Cancel,
  AutoAwesome as AIIcon,
  Security,
  Speed,
  BugReport,
  Code,
  ExpandMore,
  ExpandLess,
  Comment,
  Add,
  Remove,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { colors } from '../theme';
import type { PullRequest, AIReviewIssue } from '../types';

const mockPRs: (Partial<PullRequest> & { aiScore?: number })[] = [
  {
    id: '1',
    number: 42,
    title: 'feat: implement semantic search API',
    description: 'Adds vector-based semantic search using embeddings',
    author: { username: 'developer', displayName: 'Alex Developer', avatarUrl: '' } as any,
    status: 'open',
    sourceBranch: 'feature/semantic-search',
    targetBranch: 'main',
    createdAt: '2024-01-15T10:30:00Z',
    changedFiles: 8,
    additions: 342,
    deletions: 45,
    comments: 12,
    labels: ['feature', 'ai'],
    aiScore: 94,
  },
  {
    id: '2',
    number: 41,
    title: 'fix: resolve authentication race condition',
    description: 'Fixes issue where token refresh could fail under high load',
    author: { username: 'security', displayName: 'Sam Security', avatarUrl: '' } as any,
    status: 'open',
    sourceBranch: 'fix/auth-race',
    targetBranch: 'main',
    createdAt: '2024-01-14T15:00:00Z',
    changedFiles: 3,
    additions: 67,
    deletions: 23,
    comments: 5,
    labels: ['bug', 'security'],
    aiScore: 88,
  },
  {
    id: '3',
    number: 40,
    title: 'refactor: extract common utilities',
    description: 'Moves shared utilities to a separate package for reuse',
    author: { username: 'refactor', displayName: 'Riley Refactor', avatarUrl: '' } as any,
    status: 'merged',
    sourceBranch: 'refactor/utilities',
    targetBranch: 'main',
    createdAt: '2024-01-13T09:00:00Z',
    changedFiles: 15,
    additions: 234,
    deletions: 456,
    comments: 8,
    labels: ['refactor'],
    aiScore: 96,
  },
  {
    id: '4',
    number: 39,
    title: 'chore: update dependencies',
    description: 'Updates all npm dependencies to latest versions',
    author: { username: 'bot', displayName: 'Dependabot', avatarUrl: '' } as any,
    status: 'closed',
    sourceBranch: 'chore/deps',
    targetBranch: 'main',
    createdAt: '2024-01-12T12:00:00Z',
    changedFiles: 2,
    additions: 123,
    deletions: 98,
    comments: 2,
    labels: ['dependencies'],
    aiScore: 72,
  },
];

const mockAIReviewIssues: AIReviewIssue[] = [
  {
    severity: 'critical',
    category: 'security',
    file: 'src/api/users.ts',
    line: 45,
    message: 'Potential SQL injection vulnerability in user query',
    suggestion: 'Use parameterized queries instead of string concatenation',
  },
  {
    severity: 'warning',
    category: 'performance',
    file: 'src/services/search.ts',
    line: 89,
    message: 'N+1 query detected in search results mapping',
    suggestion: 'Consider using batch fetching or eager loading',
  },
  {
    severity: 'info',
    category: 'maintainability',
    file: 'src/utils/helpers.ts',
    line: 23,
    message: 'Function complexity is above threshold (15)',
    suggestion: 'Consider breaking into smaller, focused functions',
  },
];

const getLabelColor = (label: string) => {
  const labelColors: Record<string, string> = {
    feature: colors.green,
    bug: colors.coral,
    security: colors.coral,
    ai: colors.orange,
    refactor: colors.purple,
    dependencies: colors.blue,
    documentation: colors.teal,
  };
  return labelColors[label] || colors.navyLighter;
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'open':
      return <PRIcon sx={{ color: colors.green }} />;
    case 'merged':
      return <CheckCircle sx={{ color: colors.purple }} />;
    case 'closed':
      return <Cancel sx={{ color: colors.coral }} />;
    default:
      return <PRIcon />;
  }
};

const getSeverityColor = (severity: string) => {
  switch (severity) {
    case 'critical':
      return colors.coral;
    case 'warning':
      return colors.orange;
    case 'info':
      return colors.blue;
    default:
      return colors.textMuted;
  }
};

const getCategoryIcon = (category: string) => {
  switch (category) {
    case 'security':
      return <Security />;
    case 'performance':
      return <Speed />;
    case 'bug':
      return <BugReport />;
    default:
      return <Code />;
  }
};

export default function PullRequests() {
  const navigate = useNavigate();
  const [tabValue, setTabValue] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedPR, setExpandedPR] = useState<string | null>('1');

  const filteredPRs = mockPRs.filter((pr) => {
    const matchesSearch =
      pr.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pr.description?.toLowerCase().includes(searchQuery.toLowerCase());

    if (tabValue === 0) return matchesSearch && pr.status === 'open';
    if (tabValue === 1) return matchesSearch && pr.status === 'merged';
    if (tabValue === 2) return matchesSearch && pr.status === 'closed';
    return matchesSearch;
  });

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
            Pull Requests
          </Typography>
          <Typography variant="body1" sx={{ color: colors.textMuted }}>
            {mockPRs.filter((pr) => pr.status === 'open').length} open, all with AI-powered reviews
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<PRIcon />}
          onClick={() => navigate('/pull-requests/new')}
        >
          New Pull Request
        </Button>
      </Box>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
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
        <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)}>
          <Tab
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                Open
                <Chip
                  label={mockPRs.filter((pr) => pr.status === 'open').length}
                  size="small"
                  sx={{ height: 20, fontSize: '0.7rem' }}
                />
              </Box>
            }
          />
          <Tab label="Merged" />
          <Tab label="Closed" />
          <Tab label="All" />
        </Tabs>
      </Box>

      {/* PR List */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {filteredPRs.map((pr) => (
          <Card key={pr.id}>
            <CardContent sx={{ p: 0 }}>
              {/* PR Header */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  p: 2,
                  cursor: 'pointer',
                }}
                onClick={() => setExpandedPR(expandedPR === pr.id ? null : pr.id!)}
              >
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  {getStatusIcon(pr.status!)}
                </Box>

                <Box sx={{ flex: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Typography
                      sx={{
                        fontWeight: 600,
                        cursor: 'pointer',
                        '&:hover': { color: colors.orange },
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/pull-requests/${pr.number}`);
                      }}
                    >
                      {pr.title}
                    </Typography>
                    {pr.labels?.map((label) => (
                      <Chip
                        key={label}
                        label={label}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: '0.7rem',
                          backgroundColor: `${getLabelColor(label)}20`,
                          color: getLabelColor(label),
                          border: `1px solid ${getLabelColor(label)}40`,
                        }}
                      />
                    ))}
                  </Box>
                  <Typography variant="body2" sx={{ color: colors.textMuted }}>
                    #{pr.number} opened by {pr.author?.displayName} •{' '}
                    {pr.sourceBranch} → {pr.targetBranch}
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  {/* AI Score */}
                  <Tooltip title="AI Review Score">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <AIIcon
                        sx={{
                          fontSize: 18,
                          color:
                            pr.aiScore! >= 90
                              ? colors.green
                              : pr.aiScore! >= 70
                              ? colors.orange
                              : colors.coral,
                        }}
                      />
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 600,
                          color:
                            pr.aiScore! >= 90
                              ? colors.green
                              : pr.aiScore! >= 70
                              ? colors.orange
                              : colors.coral,
                        }}
                      >
                        {pr.aiScore}%
                      </Typography>
                    </Box>
                  </Tooltip>

                  {/* Changes */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Add sx={{ fontSize: 14, color: colors.green }} />
                      <Typography variant="caption" sx={{ color: colors.green }}>
                        {pr.additions}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Remove sx={{ fontSize: 14, color: colors.coral }} />
                      <Typography variant="caption" sx={{ color: colors.coral }}>
                        {pr.deletions}
                      </Typography>
                    </Box>
                  </Box>

                  {/* Comments */}
                  <Tooltip title="Comments">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Comment sx={{ fontSize: 16, color: colors.textMuted }} />
                      <Typography variant="caption" sx={{ color: colors.textMuted }}>
                        {pr.comments}
                      </Typography>
                    </Box>
                  </Tooltip>

                  <IconButton size="small">
                    {expandedPR === pr.id ? <ExpandLess /> : <ExpandMore />}
                  </IconButton>
                </Box>
              </Box>

              {/* Expanded AI Review */}
              <Collapse in={expandedPR === pr.id}>
                <Box
                  sx={{
                    p: 2,
                    pt: 0,
                    borderTop: `1px solid ${colors.navyLighter}`,
                    backgroundColor: colors.navy,
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, pt: 2 }}>
                    <AIIcon sx={{ color: colors.orange }} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      AI Review Summary
                    </Typography>
                  </Box>

                  {/* Score Bar */}
                  <Box sx={{ mb: 3 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                      <Typography variant="caption" sx={{ color: colors.textMuted }}>
                        Overall Score
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          fontWeight: 600,
                          color:
                            pr.aiScore! >= 90
                              ? colors.green
                              : pr.aiScore! >= 70
                              ? colors.orange
                              : colors.coral,
                        }}
                      >
                        {pr.aiScore}%
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={pr.aiScore}
                      sx={{
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: colors.navyLighter,
                        '& .MuiLinearProgress-bar': {
                          background:
                            pr.aiScore! >= 90
                              ? colors.green
                              : pr.aiScore! >= 70
                              ? `linear-gradient(90deg, ${colors.orange} 0%, ${colors.coral} 100%)`
                              : colors.coral,
                          borderRadius: 4,
                        },
                      }}
                    />
                  </Box>

                  {/* Issues */}
                  <Typography variant="caption" sx={{ color: colors.textMuted, mb: 1, display: 'block' }}>
                    Issues Found ({mockAIReviewIssues.length})
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {mockAIReviewIssues.map((issue, i) => (
                      <Box
                        key={i}
                        sx={{
                          display: 'flex',
                          gap: 2,
                          p: 1.5,
                          borderRadius: 1,
                          backgroundColor: colors.navyLight,
                          border: `1px solid ${colors.navyLighter}`,
                          borderLeft: `3px solid ${getSeverityColor(issue.severity)}`,
                        }}
                      >
                        <Box
                          sx={{
                            p: 0.5,
                            borderRadius: 1,
                            backgroundColor: `${getSeverityColor(issue.severity)}20`,
                            color: getSeverityColor(issue.severity),
                            height: 'fit-content',
                          }}
                        >
                          {getCategoryIcon(issue.category)}
                        </Box>
                        <Box sx={{ flex: 1 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                              {issue.message}
                            </Typography>
                            <Chip
                              label={issue.severity}
                              size="small"
                              sx={{
                                height: 18,
                                fontSize: '0.65rem',
                                textTransform: 'uppercase',
                                backgroundColor: `${getSeverityColor(issue.severity)}20`,
                                color: getSeverityColor(issue.severity),
                              }}
                            />
                          </Box>
                          <Typography
                            variant="caption"
                            sx={{
                              color: colors.orange,
                              fontFamily: 'monospace',
                              cursor: 'pointer',
                              '&:hover': { textDecoration: 'underline' },
                            }}
                          >
                            {issue.file}:{issue.line}
                          </Typography>
                          {issue.suggestion && (
                            <Typography variant="caption" sx={{ display: 'block', color: colors.textMuted, mt: 0.5 }}>
                              Suggestion: {issue.suggestion}
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    ))}
                  </Box>

                  {/* Action Buttons */}
                  <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => navigate(`/pull-requests/${pr.number}`)}
                    >
                      View Full Review
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<AIIcon />}
                    >
                      Re-run AI Review
                    </Button>
                  </Box>
                </Box>
              </Collapse>
            </CardContent>
          </Card>
        ))}
      </Box>
    </Box>
  );
}
