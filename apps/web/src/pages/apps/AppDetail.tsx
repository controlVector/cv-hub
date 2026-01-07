import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Chip,
  Avatar,
  Tabs,
  Tab,
  Skeleton,
  Alert,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Download as DownloadIcon,
  GitHub as GitHubIcon,
  Home as HomeIcon,
  Code as CodeIcon,
  Description as DocsIcon,
  History as HistoryIcon,
  NewReleases as ReleaseIcon,
  ExpandMore as ExpandIcon,
  Computer as WindowsIcon,
  Apple as AppleIcon,
  Analytics as AnalyticsIcon,
  TrendingUp as TrendingIcon,
  Business as BusinessIcon,
  Verified as VerifiedIcon,
} from '@mui/icons-material';
import { colors } from '../../theme';
import { api, API_BASE_URL } from '../../lib/api';
import DownloadButton from '../../components/DownloadButton';
import Markdown from '../../components/Markdown';

// Types
interface ReleaseAsset {
  id: string;
  platform: string;
  fileName: string;
  fileSize: number;
  downloadUrl: string;
  downloadCount: number;
}

interface Release {
  id: string;
  version: string;
  releaseNotes?: string;
  isPrerelease: boolean;
  isLatest: boolean;
  downloadCount: number;
  publishedAt: string;
  assets: ReleaseAsset[];
}

interface AppOrganization {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  isVerified: boolean;
}

interface App {
  id: string;
  name: string;
  description: string;
  longDescription?: string;
  iconUrl?: string;
  category: string;
  homepageUrl?: string;
  repositoryUrl?: string;
  isFeatured: boolean;
  totalDownloads: number;
  latestRelease?: Release | null;
  organization?: AppOrganization | null;
  createdAt: string;
  updatedAt: string;
}

interface PlatformStats {
  platform: string;
  count: number;
  percentage: number;
}

interface DailyDownloads {
  date: string;
  count: number;
}

interface AppAnalytics {
  totalDownloads: number;
  downloadsLast7Days: number;
  downloadsLast30Days: number;
  platformBreakdown: PlatformStats[];
  dailyDownloads: DailyDownloads[];
  topVersions: { version: string; count: number }[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getPlatformIcon(platform: string) {
  if (platform.startsWith('windows')) return <WindowsIcon />;
  if (platform.startsWith('macos')) return <AppleIcon />;
  return <CodeIcon />; // Linux
}

function getPlatformLabel(platform: string): string {
  const labels: Record<string, string> = {
    'windows-x64': 'Windows (64-bit)',
    'windows-arm64': 'Windows (ARM)',
    'macos-x64': 'macOS (Intel)',
    'macos-arm64': 'macOS (Apple Silicon)',
    'linux-x64': 'Linux (64-bit)',
    'linux-arm64': 'Linux (ARM)',
  };
  return labels[platform] || platform;
}

export default function AppDetail() {
  const { appId } = useParams<{ appId: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState(0);

  const { data: app, isLoading: appLoading, error: appError } = useQuery<App>({
    queryKey: ['app', appId],
    queryFn: async () => {
      const response = await api.get(`/v1/apps/${appId}`);
      return response.data.app;
    },
    enabled: !!appId,
  });

  const { data: releasesData, isLoading: releasesLoading } = useQuery<{ releases: Release[] }>({
    queryKey: ['releases', appId],
    queryFn: async () => {
      const response = await api.get(`/v1/apps/${appId}/releases?includePrerelease=true`);
      return response.data;
    },
    enabled: !!appId,
  });

  const { data: analyticsData, isLoading: analyticsLoading } = useQuery<{ analytics: AppAnalytics }>({
    queryKey: ['analytics', appId],
    queryFn: async () => {
      const response = await api.get(`/v1/apps/${appId}/analytics?days=30`);
      return response.data;
    },
    enabled: !!appId && tab === 3,
  });

  const releases = releasesData?.releases || [];
  const analytics = analyticsData?.analytics;

  if (appLoading) {
    return (
      <Box>
        <Skeleton variant="rectangular" height={200} sx={{ mb: 3, borderRadius: 2 }} />
        <Skeleton variant="text" width="40%" height={40} />
        <Skeleton variant="text" width="100%" />
        <Skeleton variant="text" width="80%" />
      </Box>
    );
  }

  if (appError || !app) {
    return (
      <Alert severity="error" sx={{ mb: 3 }}>
        Failed to load application details.
        <Button onClick={() => navigate('/apps')} sx={{ ml: 2 }}>
          Back to App Store
        </Button>
      </Alert>
    );
  }

  return (
    <Box>
      {/* Back Button */}
      <Button
        startIcon={<BackIcon />}
        onClick={() => navigate('/apps')}
        sx={{ mb: 3, color: colors.textMuted }}
      >
        Back to App Store
      </Button>

      {/* Header Card */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {/* App Icon */}
            <Avatar
              src={app.iconUrl}
              sx={{
                width: 96,
                height: 96,
                backgroundColor: colors.navyLighter,
                fontSize: 40,
              }}
            >
              <CodeIcon sx={{ fontSize: 48 }} />
            </Avatar>

            {/* App Info */}
            <Box sx={{ flex: 1, minWidth: 200 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                <Typography variant="h4" sx={{ fontWeight: 700 }}>
                  {app.name}
                </Typography>
                {app.isFeatured && (
                  <Chip
                    label="Featured"
                    size="small"
                    sx={{
                      background: `linear-gradient(135deg, ${colors.orange} 0%, ${colors.coral} 100%)`,
                      color: colors.navy,
                      fontWeight: 600,
                    }}
                  />
                )}
              </Box>

              <Typography variant="body1" sx={{ color: colors.textMuted, mb: 2 }}>
                {app.description}
              </Typography>

              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                {app.organization && (
                  <Chip
                    avatar={
                      <Avatar
                        src={app.organization.logoUrl || undefined}
                        sx={{ width: 20, height: 20 }}
                      >
                        <BusinessIcon sx={{ fontSize: 12 }} />
                      </Avatar>
                    }
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {app.organization.name}
                        {app.organization.isVerified && (
                          <VerifiedIcon sx={{ fontSize: 14, color: colors.orange }} />
                        )}
                      </Box>
                    }
                    size="small"
                    component="a"
                    href={`/orgs/${app.organization.slug}`}
                    clickable
                    sx={{
                      backgroundColor: colors.navyLighter,
                      '&:hover': {
                        backgroundColor: colors.navy,
                      },
                    }}
                  />
                )}
                {app.latestRelease && (
                  <Chip
                    label={`v${app.latestRelease.version}`}
                    size="small"
                    icon={<ReleaseIcon />}
                    sx={{ backgroundColor: colors.navyLighter }}
                  />
                )}
                <Chip
                  label={app.category.replace('-', ' ')}
                  size="small"
                  sx={{ textTransform: 'capitalize' }}
                />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: colors.textMuted }}>
                  <DownloadIcon sx={{ fontSize: 16 }} />
                  <Typography variant="body2">
                    {app.totalDownloads.toLocaleString()} downloads
                  </Typography>
                </Box>
              </Box>
            </Box>

            {/* Actions */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end' }}>
              {app.latestRelease && (
                <DownloadButton
                  appId={app.id}
                  release={app.latestRelease}
                />
              )}

              <Box sx={{ display: 'flex', gap: 1 }}>
                {app.repositoryUrl && (
                  <Tooltip title="View on GitHub">
                    <IconButton
                      href={app.repositoryUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{ color: colors.textMuted }}
                    >
                      <GitHubIcon />
                    </IconButton>
                  </Tooltip>
                )}
                {app.homepageUrl && (
                  <Tooltip title="Homepage">
                    <IconButton
                      href={app.homepageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{ color: colors.textMuted }}
                    >
                      <HomeIcon />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ mb: 3 }}
      >
        <Tab label="Description" icon={<DocsIcon />} iconPosition="start" />
        <Tab label="Release Notes" icon={<ReleaseIcon />} iconPosition="start" />
        <Tab label="All Versions" icon={<HistoryIcon />} iconPosition="start" />
        <Tab label="Analytics" icon={<AnalyticsIcon />} iconPosition="start" />
      </Tabs>

      {/* Tab Content */}
      {tab === 0 && (
        <Card>
          <CardContent>
            {app.longDescription ? (
              <Markdown>{app.longDescription}</Markdown>
            ) : (
              <Typography sx={{ color: colors.textMuted }}>
                No detailed description available.
              </Typography>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 1 && (
        <Card>
          <CardContent>
            {app.latestRelease?.releaseNotes ? (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                  <Typography variant="h6" sx={{ fontWeight: 600 }}>
                    Version {app.latestRelease.version}
                  </Typography>
                  <Chip
                    label={app.latestRelease.isPrerelease ? 'Pre-release' : 'Latest'}
                    size="small"
                    color={app.latestRelease.isPrerelease ? 'warning' : 'success'}
                  />
                </Box>
                <Typography variant="body2" sx={{ color: colors.textMuted, mb: 2 }}>
                  Released {formatDate(app.latestRelease.publishedAt)}
                </Typography>
                <Divider sx={{ mb: 2 }} />
                <Markdown>{app.latestRelease.releaseNotes}</Markdown>
              </Box>
            ) : (
              <Typography sx={{ color: colors.textMuted }}>
                No release notes available.
              </Typography>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 2 && (
        <Card>
          <CardContent>
            {releasesLoading ? (
              <Box>
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} variant="rectangular" height={80} sx={{ mb: 2, borderRadius: 2 }} />
                ))}
              </Box>
            ) : releases.length === 0 ? (
              <Typography sx={{ color: colors.textMuted }}>
                No releases available.
              </Typography>
            ) : (
              <List disablePadding>
                {releases.map((release, index) => (
                  <Box key={release.id}>
                    {index > 0 && <Divider sx={{ my: 2 }} />}
                    <ReleaseItem release={release} appId={app.id} />
                  </Box>
                ))}
              </List>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 3 && (
        <Box>
          {analyticsLoading ? (
            <Box>
              <Skeleton variant="rectangular" height={150} sx={{ mb: 3, borderRadius: 2 }} />
              <Skeleton variant="rectangular" height={300} sx={{ mb: 3, borderRadius: 2 }} />
            </Box>
          ) : analytics ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Stats Cards */}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2 }}>
                <Card>
                  <CardContent sx={{ textAlign: 'center' }}>
                    <Typography variant="h4" sx={{ fontWeight: 700, color: colors.orange }}>
                      {analytics.totalDownloads.toLocaleString()}
                    </Typography>
                    <Typography variant="body2" sx={{ color: colors.textMuted }}>
                      Total Downloads
                    </Typography>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent sx={{ textAlign: 'center' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                      <TrendingIcon sx={{ color: colors.orange }} />
                      <Typography variant="h4" sx={{ fontWeight: 700 }}>
                        {analytics.downloadsLast7Days.toLocaleString()}
                      </Typography>
                    </Box>
                    <Typography variant="body2" sx={{ color: colors.textMuted }}>
                      Last 7 Days
                    </Typography>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent sx={{ textAlign: 'center' }}>
                    <Typography variant="h4" sx={{ fontWeight: 700 }}>
                      {analytics.downloadsLast30Days.toLocaleString()}
                    </Typography>
                    <Typography variant="body2" sx={{ color: colors.textMuted }}>
                      Last 30 Days
                    </Typography>
                  </CardContent>
                </Card>
              </Box>

              {/* Platform Breakdown */}
              <Card>
                <CardContent>
                  <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                    Platform Breakdown
                  </Typography>
                  {analytics.platformBreakdown.length === 0 ? (
                    <Typography sx={{ color: colors.textMuted }}>
                      No download data yet.
                    </Typography>
                  ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {analytics.platformBreakdown.map((platform) => (
                        <Box key={platform.platform}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              {getPlatformIcon(platform.platform)}
                              <Typography>
                                {getPlatformLabel(platform.platform)}
                              </Typography>
                            </Box>
                            <Typography sx={{ color: colors.textMuted }}>
                              {platform.count.toLocaleString()} ({platform.percentage}%)
                            </Typography>
                          </Box>
                          <Box
                            sx={{
                              height: 8,
                              backgroundColor: colors.navyLighter,
                              borderRadius: 4,
                              overflow: 'hidden',
                            }}
                          >
                            <Box
                              sx={{
                                width: `${platform.percentage}%`,
                                height: '100%',
                                background: `linear-gradient(90deg, ${colors.orange} 0%, ${colors.coral} 100%)`,
                                borderRadius: 4,
                                transition: 'width 0.3s ease',
                              }}
                            />
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  )}
                </CardContent>
              </Card>

              {/* Daily Downloads Chart (Simple bar representation) */}
              <Card>
                <CardContent>
                  <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                    Downloads (Last 30 Days)
                  </Typography>
                  {analytics.dailyDownloads.length === 0 ? (
                    <Typography sx={{ color: colors.textMuted }}>
                      No download data yet.
                    </Typography>
                  ) : (
                    <Box>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'flex-end',
                          gap: '2px',
                          height: 120,
                          px: 1,
                        }}
                      >
                        {analytics.dailyDownloads.map((day) => {
                          const maxCount = Math.max(...analytics.dailyDownloads.map((d) => d.count), 1);
                          const height = (day.count / maxCount) * 100;
                          return (
                            <Tooltip key={day.date} title={`${day.date}: ${day.count} downloads`}>
                              <Box
                                sx={{
                                  flex: 1,
                                  minHeight: 4,
                                  height: `${Math.max(height, 4)}%`,
                                  background: day.count > 0
                                    ? `linear-gradient(180deg, ${colors.orange} 0%, ${colors.coral} 100%)`
                                    : colors.navyLighter,
                                  borderRadius: '2px 2px 0 0',
                                  transition: 'height 0.3s ease',
                                  cursor: 'pointer',
                                  '&:hover': {
                                    opacity: 0.8,
                                  },
                                }}
                              />
                            </Tooltip>
                          );
                        })}
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
                        <Typography variant="caption" sx={{ color: colors.textMuted }}>
                          {analytics.dailyDownloads[0]?.date}
                        </Typography>
                        <Typography variant="caption" sx={{ color: colors.textMuted }}>
                          {analytics.dailyDownloads[analytics.dailyDownloads.length - 1]?.date}
                        </Typography>
                      </Box>
                    </Box>
                  )}
                </CardContent>
              </Card>

              {/* Top Versions */}
              {analytics.topVersions.length > 0 && (
                <Card>
                  <CardContent>
                    <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                      Most Downloaded Versions
                    </Typography>
                    <List dense disablePadding>
                      {analytics.topVersions.map((version, index) => (
                        <ListItem
                          key={version.version}
                          sx={{
                            backgroundColor: colors.navy,
                            borderRadius: 1,
                            mb: 1,
                          }}
                        >
                          <ListItemIcon sx={{ minWidth: 40 }}>
                            <Avatar
                              sx={{
                                width: 24,
                                height: 24,
                                fontSize: 12,
                                backgroundColor: index === 0 ? colors.orange : colors.navyLighter,
                              }}
                            >
                              {index + 1}
                            </Avatar>
                          </ListItemIcon>
                          <ListItemText
                            primary={`v${version.version}`}
                            secondary={`${version.count.toLocaleString()} downloads`}
                          />
                        </ListItem>
                      ))}
                    </List>
                  </CardContent>
                </Card>
              )}
            </Box>
          ) : (
            <Alert severity="info">
              No analytics data available yet. Analytics are tracked when users download the application.
            </Alert>
          )}
        </Box>
      )}
    </Box>
  );
}

interface ReleaseItemProps {
  release: Release;
  appId: string;
}

function ReleaseItem({ release, appId }: ReleaseItemProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          p: 1,
          borderRadius: 1,
          '&:hover': { backgroundColor: colors.navy },
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <ReleaseIcon sx={{ color: release.isLatest ? colors.orange : colors.textMuted }} />
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography sx={{ fontWeight: 600 }}>
                Version {release.version}
              </Typography>
              {release.isLatest && (
                <Chip label="Latest" size="small" color="success" sx={{ height: 20, fontSize: '0.7rem' }} />
              )}
              {release.isPrerelease && (
                <Chip label="Pre-release" size="small" color="warning" sx={{ height: 20, fontSize: '0.7rem' }} />
              )}
            </Box>
            <Typography variant="caption" sx={{ color: colors.textMuted }}>
              Released {formatDate(release.publishedAt)} • {release.downloadCount.toLocaleString()} downloads
            </Typography>
          </Box>
        </Box>
        <IconButton size="small">
          <ExpandIcon sx={{
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s',
          }} />
        </IconButton>
      </Box>

      {expanded && (
        <Box sx={{ pl: 5, pr: 2, pb: 2 }}>
          {release.releaseNotes && (
            <Box sx={{ mb: 2, p: 2, backgroundColor: colors.navy, borderRadius: 2 }}>
              <Markdown>
                {release.releaseNotes.length > 500
                  ? release.releaseNotes.slice(0, 500) + '...'
                  : release.releaseNotes}
              </Markdown>
            </Box>
          )}

          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
            Downloads
          </Typography>
          <List dense disablePadding>
            {release.assets.map((asset) => (
              <ListItem
                key={asset.id}
                component="a"
                href={`${API_BASE_URL}/v1/apps/${appId}/download/${asset.platform}`}
                sx={{
                  backgroundColor: colors.navy,
                  borderRadius: 1,
                  mb: 1,
                  textDecoration: 'none',
                  color: 'inherit',
                  '&:hover': {
                    backgroundColor: colors.navyLighter,
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>
                  {getPlatformIcon(asset.platform)}
                </ListItemIcon>
                <ListItemText
                  primary={getPlatformLabel(asset.platform)}
                  secondary={`${asset.fileName} • ${formatBytes(asset.fileSize)}`}
                />
                <DownloadIcon sx={{ color: colors.orange }} />
              </ListItem>
            ))}
          </List>
        </Box>
      )}
    </Box>
  );
}
