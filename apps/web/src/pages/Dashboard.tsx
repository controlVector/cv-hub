import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Avatar,
  Chip,
  LinearProgress,
  IconButton,
  Tooltip,
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
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { colors } from '../theme';
import type { Repository, AIInsight, ActivityItem } from '../types';

// Mock data
const stats = [
  { label: 'Repositories', value: 12, icon: <RepoIcon />, change: '+2' },
  { label: 'Pull Requests', value: 8, icon: <PRIcon />, change: '+3' },
  { label: 'Open Issues', value: 24, icon: <IssueIcon />, change: '-5' },
  { label: 'AI Operations', value: '3.5K', icon: <AIIcon />, change: '35%' },
];

const recentRepos: Partial<Repository>[] = [
  {
    id: '1',
    name: 'cv-git',
    fullName: 'team/cv-git',
    description: 'AI-native version control platform',
    language: 'TypeScript',
    stars: 128,
    healthScore: 92,
    lastUpdated: '2 hours ago',
  },
  {
    id: '2',
    name: 'api-service',
    fullName: 'team/api-service',
    description: 'Backend API service for the platform',
    language: 'Go',
    stars: 45,
    healthScore: 87,
    lastUpdated: '5 hours ago',
  },
  {
    id: '3',
    name: 'web-frontend',
    fullName: 'team/web-frontend',
    description: 'React-based web frontend',
    language: 'TypeScript',
    stars: 32,
    healthScore: 78,
    lastUpdated: '1 day ago',
  },
];

const aiInsights: AIInsight[] = [
  {
    type: 'security',
    severity: 'high',
    title: 'Potential SQL Injection',
    description: 'Unparameterized query detected in user input handler',
    file: 'api-service/handlers/user.go',
    line: 142,
    recommendation: 'Use parameterized queries to prevent SQL injection',
  },
  {
    type: 'complexity',
    severity: 'medium',
    title: 'High Cyclomatic Complexity',
    description: 'Function processPayment has complexity of 28',
    file: 'cv-git/src/payment/processor.ts',
    line: 89,
    recommendation: 'Break down into smaller, focused functions',
  },
  {
    type: 'dead_code',
    severity: 'low',
    title: 'Unused Export Detected',
    description: '3 exported functions have no callers',
    file: 'web-frontend/src/utils/helpers.ts',
    recommendation: 'Consider removing or documenting for future use',
  },
];

const recentActivity: Partial<ActivityItem>[] = [
  {
    id: '1',
    type: 'commit',
    title: 'feat: add semantic search API',
    repository: 'cv-git',
    timestamp: '30 minutes ago',
    user: { username: 'developer', displayName: 'Developer' } as any,
  },
  {
    id: '2',
    type: 'pr',
    title: 'PR #42: Implement AI code review',
    repository: 'api-service',
    timestamp: '2 hours ago',
    user: { username: 'reviewer', displayName: 'Reviewer' } as any,
  },
  {
    id: '3',
    type: 'ai_operation',
    title: 'AI Review completed on PR #41',
    repository: 'web-frontend',
    timestamp: '4 hours ago',
  },
];

const getLanguageColor = (lang: string) => {
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

export default function Dashboard() {
  const navigate = useNavigate();

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
        {stats.map((stat) => (
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
                  onClick={() => navigate('/repositories')}
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

              {recentRepos.map((repo) => (
                <Box
                  key={repo.id}
                  onClick={() => navigate(`/repositories/${repo.fullName}`)}
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
                        {repo.description}
                      </Typography>
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box
                        sx={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          backgroundColor: getLanguageColor(repo.language || ''),
                        }}
                      />
                      <Typography variant="body2" sx={{ color: colors.textMuted }}>
                        {repo.language}
                      </Typography>
                    </Box>

                    <Tooltip title="Health Score">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 60 }}>
                          <LinearProgress
                            variant="determinate"
                            value={repo.healthScore}
                            sx={{
                              height: 6,
                              borderRadius: 3,
                              backgroundColor: colors.navyLighter,
                              '& .MuiLinearProgress-bar': {
                                background:
                                  repo.healthScore! >= 90
                                    ? colors.green
                                    : repo.healthScore! >= 70
                                    ? colors.orange
                                    : colors.coral,
                                borderRadius: 3,
                              },
                            }}
                          />
                        </Box>
                        <Typography variant="body2" sx={{ color: colors.textMuted, minWidth: 30 }}>
                          {repo.healthScore}%
                        </Typography>
                      </Box>
                    </Tooltip>

                    <Typography variant="caption" sx={{ color: colors.textMuted }}>
                      {repo.lastUpdated}
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
                <Chip
                  label="3 new"
                  size="small"
                  sx={{
                    background: `linear-gradient(135deg, ${colors.orange} 0%, ${colors.coral} 100%)`,
                    color: colors.navy,
                    fontWeight: 600,
                  }}
                />
              </Box>

              {aiInsights.map((insight, index) => (
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
                  { label: 'New Repository', icon: <RepoIcon />, action: '/repositories/new' },
                  { label: 'AI Code Review', icon: <AIIcon />, action: '/ai-assistant?mode=review' },
                  { label: 'Search Code', icon: <Code />, action: '/search' },
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
