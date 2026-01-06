import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Skeleton,
  Alert,
  Avatar,
  Chip,
  Button,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Business as BusinessIcon,
  Apps as AppsIcon,
  People as PeopleIcon,
  Language as WebsiteIcon,
  Settings as SettingsIcon,
  Download as DownloadIcon,
  Verified as VerifiedIcon,
  ArrowBack as BackIcon,
  Code as CodeIcon,
  Star as StarIcon,
} from '@mui/icons-material';
import { colors } from '../../theme';
import { getOrganization, getOrganizationApps, getMyOrganizations } from '../../services/organization';
import { useAuth } from '../../contexts/AuthContext';

interface App {
  id: string;
  name: string;
  description: string;
  iconUrl?: string;
  category: string;
  isFeatured: boolean;
  totalDownloads: number;
  latestRelease?: {
    version: string;
    publishedAt: string;
  } | null;
}

function formatDownloads(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

export default function OrganizationStorefront() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const { data: org, isLoading: orgLoading, error: orgError } = useQuery({
    queryKey: ['organization', slug],
    queryFn: () => getOrganization(slug!),
    enabled: !!slug,
  });

  const { data: apps, isLoading: appsLoading } = useQuery<App[]>({
    queryKey: ['organization-apps', slug],
    queryFn: () => getOrganizationApps(slug!),
    enabled: !!slug,
  });

  // Check if user is a member (for showing settings button)
  const { data: myOrgs } = useQuery({
    queryKey: ['my-organizations'],
    queryFn: getMyOrganizations,
    enabled: isAuthenticated,
  });

  const isMember = myOrgs?.some((o) => o.slug === slug);

  if (orgError) {
    return (
      <Box>
        <Button startIcon={<BackIcon />} onClick={() => navigate('/orgs')} sx={{ mb: 2 }}>
          Back to Organizations
        </Button>
        <Alert severity="error">
          Organization not found or you don't have access.
        </Alert>
      </Box>
    );
  }

  const featuredApps = apps?.filter((app) => app.isFeatured) || [];
  const otherApps = apps?.filter((app) => !app.isFeatured) || [];

  return (
    <Box>
      {/* Back Button */}
      <Button startIcon={<BackIcon />} onClick={() => navigate('/orgs')} sx={{ mb: 2 }}>
        Back to Organizations
      </Button>

      {/* Organization Header */}
      {orgLoading ? (
        <Card sx={{ mb: 4 }}>
          <CardContent>
            <Box sx={{ display: 'flex', gap: 3 }}>
              <Skeleton variant="circular" width={96} height={96} />
              <Box sx={{ flex: 1 }}>
                <Skeleton variant="text" width="40%" height={40} />
                <Skeleton variant="text" width="60%" />
                <Skeleton variant="text" width="30%" />
              </Box>
            </Box>
          </CardContent>
        </Card>
      ) : org ? (
        <Card sx={{ mb: 4 }}>
          <CardContent>
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              <Avatar
                src={org.logoUrl || undefined}
                sx={{
                  width: 96,
                  height: 96,
                  backgroundColor: colors.navyLighter,
                }}
              >
                <BusinessIcon sx={{ fontSize: 48 }} />
              </Avatar>

              <Box sx={{ flex: 1, minWidth: 200 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Typography variant="h4" sx={{ fontWeight: 700 }}>
                    {org.name}
                  </Typography>
                  {org.isVerified && (
                    <Tooltip title="Verified Organization">
                      <VerifiedIcon sx={{ fontSize: 28, color: colors.orange }} />
                    </Tooltip>
                  )}
                </Box>

                <Typography variant="body1" sx={{ color: colors.textMuted, mb: 2 }}>
                  @{org.slug}
                </Typography>

                {org.description && (
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {org.description}
                  </Typography>
                )}

                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Chip
                    icon={<AppsIcon sx={{ fontSize: 16 }} />}
                    label={`${org.appCount} applications`}
                    sx={{ backgroundColor: colors.navyLighter }}
                  />
                  <Chip
                    icon={<PeopleIcon sx={{ fontSize: 16 }} />}
                    label={`${org.memberCount} members`}
                    sx={{ backgroundColor: colors.navyLighter }}
                  />
                  {org.websiteUrl && (
                    <Button
                      size="small"
                      startIcon={<WebsiteIcon />}
                      href={org.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Website
                    </Button>
                  )}
                </Box>
              </Box>

              {isMember && (
                <Box>
                  <Tooltip title="Organization Settings">
                    <IconButton onClick={() => navigate(`/orgs/${slug}/settings`)}>
                      <SettingsIcon />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}
            </Box>
          </CardContent>
        </Card>
      ) : null}

      {/* Featured Apps */}
      {featuredApps.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <StarIcon sx={{ color: colors.orange }} />
            Featured Applications
          </Typography>
          <Grid container spacing={3}>
            {featuredApps.map((app) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={app.id}>
                <AppCard app={app} onClick={() => navigate(`/apps/${app.id}`)} featured />
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      {/* All Apps */}
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
          All Applications
        </Typography>

        {appsLoading ? (
          <Grid container spacing={3}>
            {[1, 2, 3].map((i) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={i}>
                <Card>
                  <CardContent>
                    <Skeleton variant="circular" width={48} height={48} sx={{ mb: 2 }} />
                    <Skeleton variant="text" width="60%" height={28} />
                    <Skeleton variant="text" width="100%" />
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        ) : apps && apps.length > 0 ? (
          <Grid container spacing={3}>
            {(otherApps.length > 0 ? otherApps : apps).map((app) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={app.id}>
                <AppCard app={app} onClick={() => navigate(`/apps/${app.id}`)} />
              </Grid>
            ))}
          </Grid>
        ) : (
          <Card>
            <CardContent sx={{ textAlign: 'center', py: 6 }}>
              <CodeIcon sx={{ fontSize: 48, color: colors.textMuted, mb: 2 }} />
              <Typography variant="h6" sx={{ color: colors.textMuted }}>
                No applications yet
              </Typography>
              <Typography variant="body2" sx={{ color: colors.textMuted }}>
                This organization hasn't published any applications.
              </Typography>
            </CardContent>
          </Card>
        )}
      </Box>
    </Box>
  );
}

interface AppCardProps {
  app: App;
  onClick: () => void;
  featured?: boolean;
}

function AppCard({ app, onClick, featured }: AppCardProps) {
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
        <Box sx={{ position: 'absolute', top: 12, right: 12 }}>
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
            <CodeIcon />
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }} noWrap>
              {app.name}
            </Typography>
            <Chip
              label={app.category.replace('-', ' ')}
              size="small"
              sx={{
                fontSize: '0.7rem',
                height: 20,
                textTransform: 'capitalize',
              }}
            />
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
