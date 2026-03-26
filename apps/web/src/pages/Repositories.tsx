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
  Tabs,
  Tab,
  Skeleton,
  Alert,
} from '@mui/material';
import {
  Search as SearchIcon,
  Star,
  ForkRight,
  Lock,
  Public,
  BubbleChart as GraphIcon,
  Schedule,
  Add as AddIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { colors } from '../theme';
import { useRepositories } from '../hooks/api';
import type { RepositoryListItem } from '../services/repository';

const getLanguageColor = (lang: string) => {
  const langColors: Record<string, string> = {
    TypeScript: '#3178c6',
    JavaScript: '#f7df1e',
    Python: '#3776ab',
    Go: '#00add8',
    Rust: '#dea584',
    Java: '#b07219',
    HCL: '#844fba',
    Ruby: '#701516',
    C: '#555555',
    'C++': '#f34b7d',
    Shell: '#89e051',
  };
  return langColors[lang] || colors.slateLighter;
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

function getFullName(repo: RepositoryListItem): string {
  const ownerSlug = repo.owner?.slug || 'unknown';
  return `${ownerSlug}/${repo.slug}`;
}

export default function Repositories() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [tabValue, setTabValue] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    clearTimeout((window as any).__repoSearchTimeout);
    (window as any).__repoSearchTimeout = setTimeout(() => {
      setDebouncedSearch(value);
    }, 300);
  };

  const visibilityFilter = tabValue === 1 ? 'public' : tabValue === 2 ? 'private' : undefined;

  const { data, isLoading, error } = useRepositories({
    search: debouncedSearch || undefined,
    visibility: visibilityFilter,
    limit: 100,
  });

  const repos = data?.repositories || [];

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
            Repositories
          </Typography>
          <Typography variant="body1" sx={{ color: colors.textMuted }}>
            {repos.length} repositories
          </Typography>
        </Box>
        <Box
          onClick={() => navigate('/dashboard/repositories/new')}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 3,
            py: 1.5,
            borderRadius: 2,
            background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.purple} 100%)`,
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            '&:hover': {
              transform: 'translateY(-1px)',
              boxShadow: `0 4px 15px ${colors.violetGlow}`,
            },
          }}
        >
          <AddIcon sx={{ fontSize: 20 }} />
          New Repository
        </Box>
      </Box>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <TextField
          placeholder="Find a repository..."
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
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
        </Tabs>
      </Box>

      {/* Error */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load repositories. Please try again.
        </Alert>
      )}

      {/* Loading */}
      {isLoading && (
        <Grid container spacing={3}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Grid size={{ xs: 12, md: 6, xl: 4 }} key={i}>
              <Card>
                <CardContent>
                  <Skeleton variant="text" width="60%" height={32} />
                  <Skeleton variant="text" width="100%" height={20} sx={{ mt: 1 }} />
                  <Skeleton variant="text" width="40%" height={20} sx={{ mt: 2 }} />
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Empty state */}
      {!isLoading && !error && repos.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Typography variant="h6" sx={{ color: colors.textMuted, mb: 2 }}>
            {debouncedSearch ? 'No repositories match your search' : 'No repositories yet'}
          </Typography>
          {!debouncedSearch && (
            <Typography variant="body2" sx={{ color: colors.textMuted }}>
              Create your first repository to get started.
            </Typography>
          )}
        </Box>
      )}

      {/* Repository Grid */}
      {!isLoading && (
        <Grid container spacing={3}>
          {repos.map((repo) => (
            <Grid size={{ xs: 12, md: 6, xl: 4 }} key={repo.id}>
              <Card
                onClick={() => navigate(`/dashboard/repositories/${getFullName(repo)}`)}
                sx={{ cursor: 'pointer', height: '100%' }}
              >
                <CardContent sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  {/* Header */}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                      {repo.visibility === 'private' ? (
                        <Lock sx={{ fontSize: 18, color: colors.textMuted, flexShrink: 0 }} />
                      ) : (
                        <Public sx={{ fontSize: 18, color: colors.textMuted, flexShrink: 0 }} />
                      )}
                      <Typography
                        variant="h6"
                        sx={{
                          fontWeight: 600,
                          color: colors.violet,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {repo.name}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                      {repo.graphSyncStatus === 'synced' && (
                        <Chip
                          icon={<GraphIcon sx={{ fontSize: 14 }} />}
                          label="Graph"
                          size="small"
                          sx={{ fontSize: '0.65rem', height: 22 }}
                        />
                      )}
                    </Box>
                  </Box>

                  {/* Owner */}
                  {repo.owner && (
                    <Typography variant="caption" sx={{ color: colors.textMuted, mb: 1 }}>
                      {repo.owner.slug}
                    </Typography>
                  )}

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
                    {repo.description || 'No description'}
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
                    {(repo.starCount ?? 0) > 0 && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Star sx={{ fontSize: 14, color: colors.textMuted }} />
                        <Typography variant="caption" sx={{ color: colors.textMuted }}>
                          {repo.starCount}
                        </Typography>
                      </Box>
                    )}
                    {(repo.forkCount ?? 0) > 0 && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <ForkRight sx={{ fontSize: 14, color: colors.textMuted }} />
                        <Typography variant="caption" sx={{ color: colors.textMuted }}>
                          {repo.forkCount}
                        </Typography>
                      </Box>
                    )}
                  </Box>

                  {/* Footer */}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      {(repo.openPrCount ?? 0) > 0 && (
                        <Chip
                          label={`${repo.openPrCount} PRs`}
                          size="small"
                          sx={{ fontSize: '0.7rem', height: 22 }}
                        />
                      )}
                      {(repo.openIssueCount ?? 0) > 0 && (
                        <Chip
                          label={`${repo.openIssueCount} Issues`}
                          size="small"
                          sx={{ fontSize: '0.7rem', height: 22 }}
                        />
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Schedule sx={{ fontSize: 14, color: colors.textMuted }} />
                      <Typography variant="caption" sx={{ color: colors.textMuted }}>
                        {formatDate(repo.updatedAt)}
                      </Typography>
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}
