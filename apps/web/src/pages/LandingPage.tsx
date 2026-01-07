import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Container,
  Typography,
  Button,
  Card,
  CardContent,
  Grid,
  Avatar,
  Chip,
  Skeleton,
  AppBar,
  Toolbar,
} from '@mui/material';
import {
  Download as DownloadIcon,
  GitHub as GitHubIcon,
  Code as CodeIcon,
  Memory as AIIcon,
  Search as SearchIcon,
  AccountTree as GraphIcon,
  Verified as VerifiedIcon,
  ArrowForward as ArrowForwardIcon,
  Login as LoginIcon,
  PersonAdd as RegisterIcon,
} from '@mui/icons-material';
import { colors } from '../theme';
import { api } from '../lib/api';

// Extended colors for landing page
const extendedColors = {
  ...colors,
  navyDark: '#1a2433',
  text: colors.textLight,
  orangeHover: '#e09518',
  border: colors.navyLighter,
};

interface App {
  id: string;
  name: string;
  description: string;
  iconUrl?: string;
  category: string;
  isFeatured: boolean;
  isActive: boolean;
  totalDownloads: number;
  latestRelease?: {
    version: string;
  } | null;
  organization?: {
    slug: string;
    name: string;
    logoUrl: string | null;
    isVerified: boolean;
  } | null;
}

interface AppsResponse {
  apps: App[];
  stats: {
    totalApps: number;
    totalDownloads: number;
    totalReleases: number;
  };
}

const features = [
  {
    icon: <GitHubIcon sx={{ fontSize: 40 }} />,
    title: 'Git Hosting',
    description: 'Host your repositories with a familiar GitHub-like experience.',
  },
  {
    icon: <AIIcon sx={{ fontSize: 40 }} />,
    title: 'AI-Powered',
    description: 'Intelligent code analysis, semantic search, and smart suggestions.',
  },
  {
    icon: <GraphIcon sx={{ fontSize: 40 }} />,
    title: 'Knowledge Graphs',
    description: 'Visualize code relationships and understand your codebase structure.',
  },
  {
    icon: <SearchIcon sx={{ fontSize: 40 }} />,
    title: 'Semantic Search',
    description: 'Find code using natural language across all your repositories.',
  },
];

export default function LandingPage() {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery<AppsResponse>({
    queryKey: ['featured-apps'],
    queryFn: async () => {
      const response = await api.get('/v1/apps?featured=true');
      return response.data;
    },
  });

  const featuredApps = data?.apps.filter(app => app.isFeatured) || [];

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: extendedColors.navyDark }}>
      {/* Navigation */}
      <AppBar position="static" sx={{ backgroundColor: 'transparent', boxShadow: 'none' }}>
        <Toolbar sx={{ justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <img src="/logo.png" alt="CV-Hub" style={{ height: 32 }} />
            <Typography variant="h6" sx={{ fontWeight: 700, color: extendedColors.text }}>
              CV-Hub
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
              variant="outlined"
              startIcon={<LoginIcon />}
              onClick={() => navigate('/login')}
              sx={{
                borderColor: colors.orange,
                color: colors.orange,
                '&:hover': {
                  borderColor: extendedColors.orangeHover,
                  backgroundColor: 'rgba(245, 166, 35, 0.1)',
                },
              }}
            >
              Sign In
            </Button>
            <Button
              variant="contained"
              startIcon={<RegisterIcon />}
              onClick={() => navigate('/register')}
              sx={{
                backgroundColor: colors.orange,
                '&:hover': {
                  backgroundColor: extendedColors.orangeHover,
                },
              }}
            >
              Get Started
            </Button>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Hero Section */}
      <Container maxWidth="lg" sx={{ pt: 8, pb: 12 }}>
        <Box sx={{ textAlign: 'center', mb: 8 }}>
          <Typography
            variant="h2"
            sx={{
              fontWeight: 800,
              mb: 2,
              background: `linear-gradient(135deg, ${extendedColors.text} 0%, ${colors.orange} 100%)`,
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            AI-Native Git Platform
          </Typography>
          <Typography
            variant="h5"
            sx={{ color: colors.textMuted, mb: 4, maxWidth: 600, mx: 'auto' }}
          >
            Host repositories, explore code with knowledge graphs, and search semantically.
            Built for developers who want more from their Git platform.
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
            <Button
              variant="contained"
              size="large"
              onClick={() => navigate('/register')}
              sx={{
                backgroundColor: colors.orange,
                px: 4,
                py: 1.5,
                fontSize: '1.1rem',
                '&:hover': {
                  backgroundColor: extendedColors.orangeHover,
                },
              }}
            >
              Start for Free
            </Button>
            <Button
              variant="outlined"
              size="large"
              onClick={() => navigate('/apps')}
              sx={{
                borderColor: extendedColors.border,
                color: extendedColors.text,
                px: 4,
                py: 1.5,
                fontSize: '1.1rem',
                '&:hover': {
                  borderColor: colors.orange,
                  backgroundColor: 'rgba(245, 166, 35, 0.1)',
                },
              }}
            >
              Browse Apps
            </Button>
          </Box>
        </Box>

        {/* Features Grid */}
        <Grid container spacing={3} sx={{ mb: 8 }}>
          {features.map((feature, index) => (
            <Grid size={{ xs: 12, sm: 6, md: 3 }} key={index}>
              <Card
                sx={{
                  height: '100%',
                  textAlign: 'center',
                  backgroundColor: colors.navy,
                  border: `1px solid ${extendedColors.border}`,
                  '&:hover': {
                    borderColor: colors.orange,
                    transform: 'translateY(-4px)',
                  },
                  transition: 'all 0.2s ease',
                }}
              >
                <CardContent sx={{ p: 3 }}>
                  <Box sx={{ color: colors.orange, mb: 2 }}>
                    {feature.icon}
                  </Box>
                  <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
                    {feature.title}
                  </Typography>
                  <Typography variant="body2" sx={{ color: colors.textMuted }}>
                    {feature.description}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        {/* Featured Apps Section */}
        <Box sx={{ mb: 8 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h4" sx={{ fontWeight: 700 }}>
              Featured Apps
            </Typography>
            <Button
              endIcon={<ArrowForwardIcon />}
              onClick={() => navigate('/apps')}
              sx={{ color: colors.orange }}
            >
              View All
            </Button>
          </Box>

          {isLoading ? (
            <Grid container spacing={3}>
              {[1, 2, 3].map((i) => (
                <Grid size={{ xs: 12, md: 4 }} key={i}>
                  <Card sx={{ backgroundColor: colors.navy }}>
                    <CardContent>
                      <Skeleton variant="circular" width={48} height={48} sx={{ mb: 2 }} />
                      <Skeleton variant="text" width="60%" height={28} />
                      <Skeleton variant="text" width="100%" />
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          ) : (
            <Grid container spacing={3}>
              {featuredApps.map((app) => (
                <Grid size={{ xs: 12, md: 4 }} key={app.id}>
                  <Card
                    onClick={() => navigate(`/apps/${app.id}`)}
                    sx={{
                      cursor: 'pointer',
                      height: '100%',
                      backgroundColor: colors.navy,
                      border: `1px solid ${extendedColors.border}`,
                      '&:hover': {
                        borderColor: colors.orange,
                        transform: 'translateY(-4px)',
                      },
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <CardContent>
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
                        <Box>
                          <Typography variant="h6" sx={{ fontWeight: 600 }}>
                            {app.name}
                          </Typography>
                          {app.organization && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Typography variant="caption" sx={{ color: colors.textMuted }}>
                                by {app.organization.name}
                              </Typography>
                              {app.organization.isVerified && (
                                <VerifiedIcon sx={{ fontSize: 14, color: colors.orange }} />
                              )}
                            </Box>
                          )}
                        </Box>
                      </Box>
                      <Typography
                        variant="body2"
                        sx={{
                          color: colors.textMuted,
                          mb: 2,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {app.description}
                      </Typography>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        {!app.isActive ? (
                          <Chip
                            label="Coming Soon"
                            size="small"
                            sx={{
                              backgroundColor: 'transparent',
                              border: `1px solid ${colors.orange}`,
                              color: colors.orange,
                            }}
                          />
                        ) : app.latestRelease ? (
                          <Chip
                            label={`v${app.latestRelease.version}`}
                            size="small"
                            sx={{ backgroundColor: colors.navyLighter }}
                          />
                        ) : null}
                        {app.isActive && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: colors.textMuted }}>
                            <DownloadIcon sx={{ fontSize: 16 }} />
                            <Typography variant="caption">{app.totalDownloads}</Typography>
                          </Box>
                        )}
                      </Box>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}
        </Box>

        {/* CTA Section */}
        <Card
          sx={{
            backgroundColor: colors.navy,
            border: `2px solid ${colors.orange}`,
            textAlign: 'center',
            p: 4,
          }}
        >
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 2 }}>
            Ready to get started?
          </Typography>
          <Typography variant="body1" sx={{ color: colors.textMuted, mb: 3 }}>
            Join developers using CV-Hub to build better software with AI assistance.
          </Typography>
          <Button
            variant="contained"
            size="large"
            onClick={() => navigate('/register')}
            sx={{
              backgroundColor: colors.orange,
              px: 6,
              py: 1.5,
              fontSize: '1.1rem',
              '&:hover': {
                backgroundColor: extendedColors.orangeHover,
              },
            }}
          >
            Create Free Account
          </Button>
        </Card>
      </Container>

      {/* Footer */}
      <Box sx={{ borderTop: `1px solid ${extendedColors.border}`, py: 3 }}>
        <Container maxWidth="lg">
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body2" sx={{ color: colors.textMuted }}>
              &copy; 2026 ControlVector. All rights reserved.
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button size="small" sx={{ color: colors.textMuted }}>
                Documentation
              </Button>
              <Button size="small" sx={{ color: colors.textMuted }}>
                Privacy
              </Button>
              <Button size="small" sx={{ color: colors.textMuted }}>
                Terms
              </Button>
            </Box>
          </Box>
        </Container>
      </Box>
    </Box>
  );
}
