import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  Grid,
  Avatar,
  Chip,
  IconButton,
  Tooltip,
  Skeleton,
} from '@mui/material';
import {
  Folder as RepoIcon,
  CallMerge as PRIcon,
  BugReport as IssueIcon,
  AutoAwesome as AIIcon,
  TrendingUp,
  Warning,
  Security,
  Speed,
  Code,
  ArrowForward,
  CheckCircle,
  Schedule,
  RocketLaunch as UpgradeIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { colors } from '../theme';
import { api } from '../lib/api';
import type { AIInsight, ActivityItem } from '../types';

interface BillingInfo {
  orgId: string;
  orgSlug: string;
  orgName: string;
  tierName: string;
  tierDisplayName: string;
  isFreeTier: boolean;
  usage: {
    repos: number;
    members: number;
  };
  limits: {
    repositories: number | null;
    teamMembers: number | null;
    storageGb: number | null;
    environments: number | null;
    buildMinutes: number | null;
  };
}

interface DashboardStats {
  stats: {
    repositories: number;
    pullRequests: number;
    openIssues: number;
  };
  recentRepositories: {
    id: string;
    name: string;
    slug: string;
    fullName: string;
    description: string | null;
    visibility: string;
    starCount: number;
    openIssueCount: number;
    openPrCount: number;
    graphSyncStatus: string;
    updatedAt: string;
  }[];
  billing: BillingInfo | null;
}

// Placeholder data for AI insights (will be populated from graph analysis)
const aiInsights: AIInsight[] = [];

const recentActivity: Partial<ActivityItem>[] = [];

// Language colors for future use when displaying repo languages
const _getLanguageColor = (lang: string) => {
  const langColors: Record<string, string> = {
    TypeScript: '#3178c6',
    JavaScript: '#f7df1e',
    Python: '#3776ab',
    Go: '#00add8',
    Rust: '#dea584',
    Java: '#b07219',
  };
  return langColors[lang] || colors.navyLighter;
};
void _getLanguageColor;

const getSeverityColor = (severity: string) => {
  switch (severity) {
    case 'high':
      return colors.coral;
    case 'medium':
      return colors.orange;
    case 'low':
      return colors.blue;
    default:
      return colors.textMuted;
  }
};

const getInsightIcon = (type: string) => {
  switch (type) {
    case 'security':
      return <Security />;
    case 'complexity':
      return <Speed />;
    case 'dead_code':
      return <Code />;
    case 'hotspot':
      return <TrendingUp />;
    default:
      return <Warning />;
  }
};

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return date.toLocaleDateString();
}

export default function Dashboard() {
  const navigate = useNavigate();

  // Fetch dashboard stats from API
  const { data: dashboardData, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const response = await api.get('/v1/dashboard/stats');
      return response.data;
    },
    staleTime: 30000, // Cache for 30 seconds
  });

  const stats = [
    { label: 'Repositories', value: dashboardData?.stats.repositories ?? 0, icon: <RepoIcon />, change: '' },
    { label: 'Pull Requests', value: dashboardData?.stats.pullRequests ?? 0, icon: <PRIcon />, change: '' },
    { label: 'Open Issues', value: dashboardData?.stats.openIssues ?? 0, icon: <IssueIcon />, change: '' },
    { label: 'Graph Synced', value: dashboardData?.recentRepositories.filter(r => r.graphSyncStatus === 'synced').length ?? 0, icon: <AIIcon />, change: '' },
  ];

  const recentRepos = dashboardData?.recentRepositories ?? [];

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
          Welcome back
        </Typography>
        <Typography variant="body1" sx={{ color: colors.textMuted }}>
          Here's what's happening across your repositories
        </Typography>
      </Box>

      {/* Stats Grid */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        {isLoading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <Grid size={{ xs: 12, sm: 6, md: 3 }} key={i}>
                <Card>
                  <CardContent>
                    <Skeleton variant="rectangular" height={80} />
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </>
        ) : stats.map((stat) => (
          <Grid size={{ xs: 12, sm: 6, md: 3 }} key={stat.label}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                  <Box
                    sx={{
                      p: 1,
                      borderRadius: 2,
                      backgroundColor: colors.navyLighter,
                      color: colors.orange,
                    }}
                  >
                    {stat.icon}
                  </Box>
                  {stat.change && (
                    <Chip
                      label={stat.change}
                      size="small"
                      sx={{
                        backgroundColor: stat.change.startsWith('+')
                          ? `${colors.green}20`
                          : stat.change.startsWith('-')
                          ? `${colors.coral}20`
                          : `${colors.blue}20`,
                        color: stat.change.startsWith('+')
                          ? colors.green
                          : stat.change.startsWith('-')
                          ? colors.coral
                          : colors.blue,
                      }}
                    />
                  )}
                </Box>
                <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
                  {stat.value}
                </Typography>
                <Typography variant="body2" sx={{ color: colors.textMuted }}>
                  {stat.label}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Upgrade CTA for free-tier users */}
      {dashboardData?.billing?.isFreeTier && (
        <Card
          sx={{
            mb: 4,
            background: `linear-gradient(135deg, ${colors.violet}18 0%, ${colors.cyan}18 100%)`,
            border: `1px solid ${colors.violet}40`,
          }}
        >
          <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 2, '&:last-child': { pb: 2 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box
                sx={{
                  p: 1,
                  borderRadius: 2,
                  background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.cyan} 100%)`,
                  color: colors.textLight,
                  display: 'flex',
                }}
              >
                <UpgradeIcon />
              </Box>
              <Box>
                <Typography sx={{ fontWeight: 600 }}>
                  {dashboardData.billing.tierDisplayName} Plan
                </Typography>
                <Typography variant="body2" sx={{ color: colors.textMuted }}>
                  {dashboardData.billing.usage.repos}/{dashboardData.billing.limits.repositories ?? '\u221E'} repositories
                  {' \u00B7 '}
                  {dashboardData.billing.usage.members}/{dashboardData.billing.limits.teamMembers ?? '\u221E'} members
                </Typography>
              </Box>
            </Box>
            <Button
              variant="contained"
              size="small"
              onClick={() => navigate(`/dashboard/orgs/${dashboardData.billing!.orgSlug}/settings`)}
              sx={{
                background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.cyan} 100%)`,
                textTransform: 'none',
                fontWeight: 600,
                '&:hover': {
                  background: `linear-gradient(135deg, ${colors.violet} 20%, ${colors.cyan} 120%)`,
                },
              }}
            >
              Upgrade to Pro
            </Button>
          </CardContent>
        </Card>
      )}

      <Grid container spacing={3}>
        {/* Recent Repositories */}
        <Grid size={{ xs: 12, lg: 8 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  Recent Repositories
                </Typography>
                <Box
                  onClick={() => navigate('/dashboard/repositories')}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    color: colors.orange,
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    '&:hover': { textDecoration: 'underline' },
                  }}
                >
                  View all <ArrowForward sx={{ fontSize: 16 }} />
                </Box>
              </Box>

              {isLoading ? (
                <>
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} variant="rectangular" height={70} sx={{ mb: 1, borderRadius: 2 }} />
                  ))}
                </>
              ) : recentRepos.length === 0 ? (
                <Box sx={{ p: 4, textAlign: 'center' }}>
                  <Typography variant="body2" sx={{ color: colors.textMuted }}>
                    No repositories yet. Create your first repository to get started.
                  </Typography>
                </Box>
              ) : recentRepos.map((repo) => (
                <Box
                  key={repo.id}
                  onClick={() => navigate(`/dashboard/repositories/${repo.fullName}`)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    p: 2,
                    mb: 1,
                    borderRadius: 2,
                    backgroundColor: colors.navy,
                    border: `1px solid ${colors.navyLighter}`,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      borderColor: colors.orange,
                      backgroundColor: `${colors.orange}08`,
                    },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <RepoIcon sx={{ color: colors.textMuted }} />
                    <Box>
                      <Typography sx={{ fontWeight: 600 }}>{repo.name}</Typography>
                      <Typography variant="body2" sx={{ color: colors.textMuted }}>
                        {repo.description || 'No description'}
                      </Typography>
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <Tooltip title="Stars">
                      <Chip
                        label={repo.starCount}
                        size="small"
                        sx={{ backgroundColor: colors.navyLighter }}
                      />
                    </Tooltip>

                    <Tooltip title="Graph Status">
                      <Chip
                        label={repo.graphSyncStatus}
                        size="small"
                        sx={{
                          backgroundColor: repo.graphSyncStatus === 'synced' ? `${colors.green}20` : colors.navyLighter,
                          color: repo.graphSyncStatus === 'synced' ? colors.green : colors.textMuted,
                        }}
                      />
                    </Tooltip>

                    <Typography variant="caption" sx={{ color: colors.textMuted }}>
                      {formatTimeAgo(repo.updatedAt)}
                    </Typography>
                  </Box>
                </Box>
              ))}
            </CardContent>
          </Card>

          {/* AI Insights */}
          <Card sx={{ mt: 3 }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <AIIcon sx={{ color: colors.orange }} />
                  <Typography variant="h6" sx={{ fontWeight: 600 }}>
                    AI Insights
                  </Typography>
                </Box>
                {aiInsights.length > 0 && (
                  <Chip
                    label={`${aiInsights.length} new`}
                    size="small"
                    sx={{
                      background: `linear-gradient(135deg, ${colors.orange} 0%, ${colors.coral} 100%)`,
                      color: colors.navy,
                      fontWeight: 600,
                    }}
                  />
                )}
              </Box>

              {aiInsights.length === 0 ? (
                <Box sx={{ p: 3, textAlign: 'center' }}>
                  <AIIcon sx={{ fontSize: 40, color: colors.textMuted, opacity: 0.4, mb: 1 }} />
                  <Typography variant="body2" sx={{ color: colors.textMuted, mb: 2 }}>
                    Sync a repository's knowledge graph to see AI-powered insights about code quality, complexity hotspots, and potential issues.
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => navigate('/dashboard/repositories')}
                  >
                    View Repositories
                  </Button>
                </Box>
              ) : aiInsights.map((insight, index) => (
                <Box
                  key={index}
                  sx={{
                    display: 'flex',
                    gap: 2,
                    p: 2,
                    mb: 1,
                    borderRadius: 2,
                    backgroundColor: colors.navy,
                    border: `1px solid ${colors.navyLighter}`,
                    borderLeft: `4px solid ${getSeverityColor(insight.severity)}`,
                  }}
                >
                  <Box
                    sx={{
                      p: 1,
                      borderRadius: 1,
                      backgroundColor: `${getSeverityColor(insight.severity)}20`,
                      color: getSeverityColor(insight.severity),
                      height: 'fit-content',
                    }}
                  >
                    {getInsightIcon(insight.type)}
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography sx={{ fontWeight: 600 }}>{insight.title}</Typography>
                      <Chip
                        label={insight.severity}
                        size="small"
                        sx={{
                          fontSize: '0.7rem',
                          height: 20,
                          backgroundColor: `${getSeverityColor(insight.severity)}20`,
                          color: getSeverityColor(insight.severity),
                          textTransform: 'uppercase',
                        }}
                      />
                    </Box>
                    <Typography variant="body2" sx={{ color: colors.textMuted, mb: 1 }}>
                      {insight.description}
                    </Typography>
                    {insight.file && (
                      <Typography
                        variant="caption"
                        sx={{
                          color: colors.orange,
                          fontFamily: 'monospace',
                          cursor: 'pointer',
                          '&:hover': { textDecoration: 'underline' },
                        }}
                      >
                        {insight.file}:{insight.line}
                      </Typography>
                    )}
                  </Box>
                  <Tooltip title="View details">
                    <IconButton size="small" sx={{ color: colors.textMuted }}>
                      <ArrowForward />
                    </IconButton>
                  </Tooltip>
                </Box>
              ))}
            </CardContent>
          </Card>
        </Grid>

        {/* Activity Feed */}
        <Grid size={{ xs: 12, lg: 4 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
                Recent Activity
              </Typography>

              {recentActivity.length === 0 ? (
                <Box sx={{ p: 3, textAlign: 'center' }}>
                  <Schedule sx={{ fontSize: 40, color: colors.textMuted, opacity: 0.4, mb: 1 }} />
                  <Typography variant="body2" sx={{ color: colors.textMuted }}>
                    Your recent commits, pull requests, and actions will appear here as you work.
                  </Typography>
                </Box>
              ) : null}
              {recentActivity.map((activity) => (
                <Box
                  key={activity.id}
                  sx={{
                    display: 'flex',
                    gap: 2,
                    pb: 2,
                    mb: 2,
                    borderBottom: `1px solid ${colors.navyLighter}`,
                    '&:last-child': { borderBottom: 'none', mb: 0, pb: 0 },
                  }}
                >
                  <Avatar
                    sx={{
                      width: 32,
                      height: 32,
                      backgroundColor:
                        activity.type === 'commit'
                          ? colors.green
                          : activity.type === 'pr'
                          ? colors.purple
                          : colors.orange,
                    }}
                  >
                    {activity.type === 'commit' ? (
                      <CheckCircle sx={{ fontSize: 18 }} />
                    ) : activity.type === 'pr' ? (
                      <PRIcon sx={{ fontSize: 18 }} />
                    ) : (
                      <AIIcon sx={{ fontSize: 18 }} />
                    )}
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {activity.title}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                      <Typography variant="caption" sx={{ color: colors.orange }}>
                        {activity.repository}
                      </Typography>
                      <Typography variant="caption" sx={{ color: colors.textMuted }}>
                        •
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Schedule sx={{ fontSize: 12, color: colors.textMuted }} />
                        <Typography variant="caption" sx={{ color: colors.textMuted }}>
                          {activity.timestamp}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                </Box>
              ))}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card sx={{ mt: 3 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                Quick Actions
              </Typography>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {[
                  { label: 'New Repository', icon: <RepoIcon />, action: '/dashboard/repositories/new' },
                  { label: 'AI Code Review', icon: <AIIcon />, action: '/dashboard/ai-assistant?mode=review' },
                  { label: 'Search Code', icon: <Code />, action: '/dashboard/search' },
                ].map((action) => (
                  <Box
                    key={action.label}
                    onClick={() => navigate(action.action)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                      p: 1.5,
                      borderRadius: 2,
                      backgroundColor: colors.navy,
                      border: `1px solid ${colors.navyLighter}`,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      '&:hover': {
                        borderColor: colors.orange,
                        backgroundColor: `${colors.orange}08`,
                      },
                    }}
                  >
                    <Box sx={{ color: colors.orange }}>{action.icon}</Box>
                    <Typography variant="body2">{action.label}</Typography>
                  </Box>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
