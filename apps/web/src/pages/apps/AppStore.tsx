import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  TextField,
  InputAdornment,
  Chip,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Skeleton,
  Alert,
  Avatar,
  Tooltip,
} from '@mui/material';
import {
  Search as SearchIcon,
  Download as DownloadIcon,
  Star as StarIcon,
  Code as CodeIcon,
  Build as DevToolsIcon,
  Speed as SpeedIcon,
  Memory as MemoryIcon,
  Message as MessageIcon,
  MoreHoriz as OtherIcon,
  Verified as VerifiedIcon,
  Business as BusinessIcon,
} from '@mui/icons-material';
import { colors } from '../../theme';
import { api } from '../../lib/api';

// Types matching the backend
interface Release {
  id: string;
  version: string;
  publishedAt: string;
  downloadCount: number;
}

interface AppOrganization {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  isVerified: boolean;
}

interface OrganizationWithAppCount extends AppOrganization {
  appCount: number;
}

interface App {
  id: string;
  name: string;
  description: string;
  iconUrl?: string;
  category: string;
  homepageUrl?: string;
  repositoryUrl?: string;
  isFeatured: boolean;
  totalDownloads: number;
  latestRelease?: Release | null;
  organization?: AppOrganization | null;
}

interface AppStoreStats {
  totalApps: number;
  totalDownloads: number;
  totalReleases: number;
}

interface AppsResponse {
  apps: App[];
  stats: AppStoreStats;
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

const CATEGORIES = [
  { value: '', label: 'All Categories', icon: <CodeIcon /> },
  { value: 'developer-tools', label: 'Developer Tools', icon: <DevToolsIcon /> },
  { value: 'productivity', label: 'Productivity', icon: <SpeedIcon /> },
  { value: 'ai-ml', label: 'AI & ML', icon: <MemoryIcon /> },
  { value: 'utilities', label: 'Utilities', icon: <OtherIcon /> },
  { value: 'communication', label: 'Communication', icon: <MessageIcon /> },
  { value: 'other', label: 'Other', icon: <OtherIcon /> },
];

function getCategoryIcon(category: string) {
  const found = CATEGORIES.find(c => c.value === category);
  return found?.icon || <OtherIcon />;
}

function formatDownloads(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

export default function AppStore() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [category, setCategory] = useState(searchParams.get('category') || '');
  const [organization, setOrganization] = useState(searchParams.get('organization') || '');
  const featured = searchParams.get('featured') === 'true';

  // Fetch organizations for filter dropdown
  const { data: orgsData } = useQuery<{ organizations: OrganizationWithAppCount[] }>({
    queryKey: ['app-organizations'],
    queryFn: async () => {
      const response = await api.get('/v1/apps/organizations');
      return response.data;
    },
  });

  const { data, isLoading, error } = useQuery<AppsResponse>({
    queryKey: ['apps', { search, category, organization, featured }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (category) params.set('category', category);
      if (organization) params.set('organization', organization);
      if (featured) params.set('featured', 'true');

      const response = await api.get(`/v1/apps?${params.toString()}`);
      return response.data;
    },
  });

  const handleSearch = (value: string) => {
    setSearch(value);
    const params = new URLSearchParams(searchParams);
    if (value) params.set('search', value);
    else params.delete('search');
    setSearchParams(params);
  };

  const handleCategoryChange = (value: string) => {
    setCategory(value);
    const params = new URLSearchParams(searchParams);
    if (value) params.set('category', value);
    else params.delete('category');
    setSearchParams(params);
  };

  const handleOrganizationChange = (value: string) => {
    setOrganization(value);
    const params = new URLSearchParams(searchParams);
    if (value) params.set('organization', value);
    else params.delete('organization');
    setSearchParams(params);
  };

  const featuredApps = data?.apps.filter(app => app.isFeatured) || [];
  const allApps = data?.apps || [];
  const availableOrgs = orgsData?.organizations || [];

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
          App Store
        </Typography>
        <Typography variant="body1" sx={{ color: colors.textMuted }}>
          Discover and download Control Vector applications
        </Typography>
      </Box>

      {/* Stats */}
      {data?.stats && (
        <Grid container spacing={2} sx={{ mb: 4 }}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Card sx={{ '&:hover': { transform: 'none', boxShadow: 'none' } }}>
              <CardContent sx={{ textAlign: 'center', py: 2 }}>
                <Typography variant="h4" sx={{ fontWeight: 700, color: colors.orange }}>
                  {data.stats.totalApps}
                </Typography>
                <Typography variant="body2" sx={{ color: colors.textMuted }}>
                  Applications
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Card sx={{ '&:hover': { transform: 'none', boxShadow: 'none' } }}>
              <CardContent sx={{ textAlign: 'center', py: 2 }}>
                <Typography variant="h4" sx={{ fontWeight: 700, color: colors.orange }}>
                  {formatDownloads(data.stats.totalDownloads)}
                </Typography>
                <Typography variant="body2" sx={{ color: colors.textMuted }}>
                  Total Downloads
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Card sx={{ '&:hover': { transform: 'none', boxShadow: 'none' } }}>
              <CardContent sx={{ textAlign: 'center', py: 2 }}>
                <Typography variant="h4" sx={{ fontWeight: 700, color: colors.orange }}>
                  {data.stats.totalReleases}
                </Typography>
                <Typography variant="body2" sx={{ color: colors.textMuted }}>
                  Releases
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Search and Filters */}
      <Box sx={{ display: 'flex', gap: 2, mb: 4, flexWrap: 'wrap' }}>
        <TextField
          placeholder="Search applications..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          sx={{ flex: 1, minWidth: 200 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ color: colors.textMuted }} />
              </InputAdornment>
            ),
          }}
        />
        <FormControl sx={{ minWidth: 200 }}>
          <InputLabel>Organization</InputLabel>
          <Select
            value={organization}
            label="Organization"
            onChange={(e) => handleOrganizationChange(e.target.value)}
          >
            <MenuItem value="">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <BusinessIcon sx={{ fontSize: 20 }} />
                All Organizations
              </Box>
            </MenuItem>
            {availableOrgs.map((org) => (
              <MenuItem key={org.slug} value={org.slug}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Avatar
                    src={org.logoUrl || undefined}
                    sx={{ width: 20, height: 20 }}
                  >
                    <BusinessIcon sx={{ fontSize: 14 }} />
                  </Avatar>
                  {org.name}
                  {org.isVerified && (
                    <VerifiedIcon sx={{ fontSize: 14, color: colors.orange }} />
                  )}
                  <Chip
                    label={org.appCount}
                    size="small"
                    sx={{ height: 18, fontSize: '0.7rem', ml: 'auto' }}
                  />
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl sx={{ minWidth: 200 }}>
          <InputLabel>Category</InputLabel>
          <Select
            value={category}
            label="Category"
            onChange={(e) => handleCategoryChange(e.target.value)}
          >
            {CATEGORIES.map((cat) => (
              <MenuItem key={cat.value} value={cat.value}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {cat.icon}
                  {cat.label}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load applications. Please try again.
        </Alert>
      )}

      {/* Featured Applications */}
      {featuredApps.length > 0 && !search && !category && !organization && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <StarIcon sx={{ color: colors.orange }} />
            Featured Applications
          </Typography>
          <Grid container spacing={3}>
            {featuredApps.map((app) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={app.id}>
                <AppCard
                  app={app}
                  onClick={() => navigate(`/apps/${app.id}`)}
                  onOrgClick={handleOrganizationChange}
                  featured
                />
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      {/* All Applications */}
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
          {search || category || organization ? 'Search Results' : 'All Applications'}
        </Typography>

        {isLoading ? (
          <Grid container spacing={3}>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={i}>
                <Card>
                  <CardContent>
                    <Skeleton variant="circular" width={48} height={48} sx={{ mb: 2 }} />
                    <Skeleton variant="text" width="60%" height={28} />
                    <Skeleton variant="text" width="100%" />
                    <Skeleton variant="text" width="80%" />
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        ) : allApps.length === 0 ? (
          <Card>
            <CardContent sx={{ textAlign: 'center', py: 6 }}>
              <CodeIcon sx={{ fontSize: 48, color: colors.textMuted, mb: 2 }} />
              <Typography variant="h6" sx={{ color: colors.textMuted }}>
                No applications found
              </Typography>
              <Typography variant="body2" sx={{ color: colors.textMuted }}>
                {search ? 'Try a different search term' : 'Check back later for new apps'}
              </Typography>
            </CardContent>
          </Card>
        ) : (
          <Grid container spacing={3}>
            {allApps.map((app) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={app.id}>
                <AppCard
                  app={app}
                  onClick={() => navigate(`/apps/${app.id}`)}
                  onOrgClick={handleOrganizationChange}
                />
              </Grid>
            ))}
          </Grid>
        )}
      </Box>
    </Box>
  );
}

interface AppCardProps {
  app: App;
  onClick: () => void;
  onOrgClick?: (slug: string) => void;
  featured?: boolean;
}

function AppCard({ app, onClick, onOrgClick, featured }: AppCardProps) {
  const handleOrgClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (app.organization && onOrgClick) {
      onOrgClick(app.organization.slug);
    }
  };

  return (
    <Card
      onClick={onClick}
      sx={{
        cursor: 'pointer',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        border: featured ? `2px solid ${colors.orange}` : undefined,
        position: 'relative',
      }}
    >
      {featured && (
        <Box
          sx={{
            position: 'absolute',
            top: 12,
            right: 12,
          }}
        >
          <Tooltip title="Featured">
            <VerifiedIcon sx={{ color: colors.orange }} />
          </Tooltip>
        </Box>
      )}
      <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <Avatar
            src={app.iconUrl}
            sx={{
              width: 48,
              height: 48,
              backgroundColor: colors.navyLighter,
            }}
          >
            {getCategoryIcon(app.category)}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }} noWrap>
              {app.name}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
              <Chip
                label={app.category.replace('-', ' ')}
                size="small"
                sx={{
                  fontSize: '0.7rem',
                  height: 20,
                  textTransform: 'capitalize',
                }}
              />
              {app.organization && (
                <Chip
                  avatar={
                    <Avatar
                      src={app.organization.logoUrl || undefined}
                      sx={{ width: 16, height: 16 }}
                    >
                      <BusinessIcon sx={{ fontSize: 10 }} />
                    </Avatar>
                  }
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {app.organization.name}
                      {app.organization.isVerified && (
                        <VerifiedIcon sx={{ fontSize: 12, color: colors.orange }} />
                      )}
                    </Box>
                  }
                  size="small"
                  onClick={handleOrgClick}
                  sx={{
                    fontSize: '0.7rem',
                    height: 20,
                    backgroundColor: colors.navyLighter,
                    '&:hover': {
                      backgroundColor: colors.navy,
                    },
                  }}
                />
              )}
            </Box>
          </Box>
        </Box>

        <Typography
          variant="body2"
          sx={{
            color: colors.textMuted,
            flex: 1,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            mb: 2,
          }}
        >
          {app.description}
        </Typography>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {app.latestRelease ? (
            <Chip
              label={`v${app.latestRelease.version}`}
              size="small"
              sx={{
                backgroundColor: colors.navyLighter,
                fontSize: '0.75rem',
              }}
            />
          ) : (
            <Box />
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: colors.textMuted }}>
            <DownloadIcon sx={{ fontSize: 16 }} />
            <Typography variant="caption">
              {formatDownloads(app.totalDownloads)}
            </Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
