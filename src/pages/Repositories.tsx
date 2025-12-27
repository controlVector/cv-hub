import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  TextField,
  InputAdornment,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Tabs,
  Tab,
  LinearProgress,
  Tooltip,
} from '@mui/material';
import {
  Search as SearchIcon,
  Star,
  ForkRight,
  Lock,
  Public,
  MoreVert,
  AutoAwesome as AIIcon,
  BubbleChart as GraphIcon,
  Schedule,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { colors } from '../theme';
import type { Repository } from '../types';

const mockRepositories: Partial<Repository>[] = [
  {
    id: '1',
    name: 'cv-git',
    fullName: 'team/cv-git',
    description: 'AI-native version control platform with knowledge graph and semantic search',
    visibility: 'private',
    language: 'TypeScript',
    stars: 128,
    forks: 24,
    openIssues: 12,
    openPRs: 3,
    lastUpdated: '2024-01-15T10:30:00Z',
    healthScore: 92,
    aiInsightsEnabled: true,
    knowledgeGraphSynced: true,
  },
  {
    id: '2',
    name: 'api-service',
    fullName: 'team/api-service',
    description: 'Backend REST API service with GraphQL support',
    visibility: 'private',
    language: 'Go',
    stars: 45,
    forks: 8,
    openIssues: 5,
    openPRs: 2,
    lastUpdated: '2024-01-14T15:00:00Z',
    healthScore: 87,
    aiInsightsEnabled: true,
    knowledgeGraphSynced: true,
  },
  {
    id: '3',
    name: 'web-frontend',
    fullName: 'team/web-frontend',
    description: 'React-based web frontend with Material UI',
    visibility: 'public',
    language: 'TypeScript',
    stars: 32,
    forks: 12,
    openIssues: 8,
    openPRs: 1,
    lastUpdated: '2024-01-13T09:00:00Z',
    healthScore: 78,
    aiInsightsEnabled: true,
    knowledgeGraphSynced: false,
  },
  {
    id: '4',
    name: 'ml-pipeline',
    fullName: 'team/ml-pipeline',
    description: 'Machine learning data processing and model training pipeline',
    visibility: 'private',
    language: 'Python',
    stars: 89,
    forks: 15,
    openIssues: 3,
    openPRs: 4,
    lastUpdated: '2024-01-12T18:00:00Z',
    healthScore: 95,
    aiInsightsEnabled: true,
    knowledgeGraphSynced: true,
  },
  {
    id: '5',
    name: 'infrastructure',
    fullName: 'team/infrastructure',
    description: 'Terraform and Kubernetes infrastructure definitions',
    visibility: 'private',
    language: 'HCL',
    stars: 15,
    forks: 3,
    openIssues: 2,
    openPRs: 0,
    lastUpdated: '2024-01-10T12:00:00Z',
    healthScore: 84,
    aiInsightsEnabled: false,
    knowledgeGraphSynced: false,
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
    HCL: '#844fba',
  };
  return langColors[lang] || colors.navyLighter;
};

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return `${Math.floor(diffDays / 30)} months ago`;
};

export default function Repositories() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [tabValue, setTabValue] = useState(0);
  const [anchorEl, setAnchorEl] = useState<{ element: HTMLElement; repoId: string } | null>(null);

  const filteredRepos = mockRepositories.filter((repo) => {
    const matchesSearch =
      repo.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      repo.description?.toLowerCase().includes(searchQuery.toLowerCase());

    if (tabValue === 0) return matchesSearch;
    if (tabValue === 1) return matchesSearch && repo.visibility === 'public';
    if (tabValue === 2) return matchesSearch && repo.visibility === 'private';
    if (tabValue === 3) return matchesSearch && repo.aiInsightsEnabled;
    return matchesSearch;
  });

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
            Repositories
          </Typography>
          <Typography variant="body1" sx={{ color: colors.textMuted }}>
            {mockRepositories.length} repositories, {mockRepositories.filter((r) => r.aiInsightsEnabled).length} with AI insights
          </Typography>
        </Box>
        <Box
          onClick={() => navigate('/repositories/new')}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 3,
            py: 1.5,
            borderRadius: 2,
            background: `linear-gradient(135deg, ${colors.orange} 0%, ${colors.coral} 100%)`,
            color: colors.navy,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            '&:hover': {
              transform: 'translateY(-1px)',
              boxShadow: `0 4px 15px ${colors.amberGlow}`,
            },
          }}
        >
          New Repository
        </Box>
      </Box>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <TextField
          placeholder="Find a repository..."
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
          sx={{
            minHeight: 40,
            '& .MuiTab-root': { minHeight: 40, py: 0 },
          }}
        >
          <Tab label="All" />
          <Tab label="Public" />
          <Tab label="Private" />
          <Tab label="AI Enabled" icon={<AIIcon sx={{ fontSize: 16 }} />} iconPosition="start" />
        </Tabs>
      </Box>

      {/* Repository Grid */}
      <Grid container spacing={3}>
        {filteredRepos.map((repo) => (
          <Grid size={{ xs: 12, md: 6, xl: 4 }} key={repo.id}>
            <Card
              onClick={() => navigate(`/repositories/${repo.fullName}`)}
              sx={{ cursor: 'pointer', height: '100%' }}
            >
              <CardContent sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                {/* Header */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {repo.visibility === 'private' ? (
                      <Lock sx={{ fontSize: 18, color: colors.textMuted }} />
                    ) : (
                      <Public sx={{ fontSize: 18, color: colors.textMuted }} />
                    )}
                    <Typography variant="h6" sx={{ fontWeight: 600, color: colors.orange }}>
                      {repo.name}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {repo.aiInsightsEnabled && (
                      <Tooltip title="AI Insights Enabled">
                        <AIIcon sx={{ fontSize: 18, color: colors.orange }} />
                      </Tooltip>
                    )}
                    {repo.knowledgeGraphSynced && (
                      <Tooltip title="Knowledge Graph Synced">
                        <GraphIcon sx={{ fontSize: 18, color: colors.purple }} />
                      </Tooltip>
                    )}
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAnchorEl({ element: e.currentTarget, repoId: repo.id! });
                      }}
                    >
                      <MoreVert sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Box>
                </Box>

                {/* Description */}
                <Typography
                  variant="body2"
                  sx={{
                    color: colors.textMuted,
                    mb: 2,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  {repo.description}
                </Typography>

                {/* Language & Stats */}
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
                  {repo.language && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box
                        sx={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          backgroundColor: getLanguageColor(repo.language),
                        }}
                      />
                      <Typography variant="caption" sx={{ color: colors.textMuted }}>
                        {repo.language}
                      </Typography>
                    </Box>
                  )}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Star sx={{ fontSize: 14, color: colors.textMuted }} />
                    <Typography variant="caption" sx={{ color: colors.textMuted }}>
                      {repo.stars}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <ForkRight sx={{ fontSize: 14, color: colors.textMuted }} />
                    <Typography variant="caption" sx={{ color: colors.textMuted }}>
                      {repo.forks}
                    </Typography>
                  </Box>
                </Box>

                {/* Health Score */}
                <Box sx={{ mb: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="caption" sx={{ color: colors.textMuted }}>
                      Health Score
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        fontWeight: 600,
                        color:
                          repo.healthScore! >= 90
                            ? colors.green
                            : repo.healthScore! >= 70
                            ? colors.orange
                            : colors.coral,
                      }}
                    >
                      {repo.healthScore}%
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={repo.healthScore}
                    sx={{
                      height: 4,
                      borderRadius: 2,
                      backgroundColor: colors.navyLighter,
                      '& .MuiLinearProgress-bar': {
                        background:
                          repo.healthScore! >= 90
                            ? colors.green
                            : repo.healthScore! >= 70
                            ? `linear-gradient(90deg, ${colors.orange} 0%, ${colors.coral} 100%)`
                            : colors.coral,
                        borderRadius: 2,
                      },
                    }}
                  />
                </Box>

                {/* Footer */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Chip
                      label={`${repo.openPRs} PRs`}
                      size="small"
                      sx={{ fontSize: '0.7rem', height: 22 }}
                    />
                    <Chip
                      label={`${repo.openIssues} Issues`}
                      size="small"
                      sx={{ fontSize: '0.7rem', height: 22 }}
                    />
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Schedule sx={{ fontSize: 14, color: colors.textMuted }} />
                    <Typography variant="caption" sx={{ color: colors.textMuted }}>
                      {formatDate(repo.lastUpdated!)}
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Context Menu */}
      <Menu
        anchorEl={anchorEl?.element}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
      >
        <MenuItem onClick={() => setAnchorEl(null)}>Open in new tab</MenuItem>
        <MenuItem onClick={() => setAnchorEl(null)}>Clone repository</MenuItem>
        <MenuItem onClick={() => setAnchorEl(null)}>Enable AI Insights</MenuItem>
        <MenuItem onClick={() => setAnchorEl(null)}>Sync Knowledge Graph</MenuItem>
        <MenuItem onClick={() => setAnchorEl(null)} sx={{ color: colors.coral }}>
          Delete
        </MenuItem>
      </Menu>
    </Box>
  );
}
