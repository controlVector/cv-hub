import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Button,
  Card,
  CardContent,
  Grid,
  Link,
  AppBar,
  Toolbar,
} from '@mui/material';
import {
  GitHub as GitHubIcon,
  AutoStories as ReadIcon,
  Login as LoginIcon,
  PersonAdd as RegisterIcon,
  AccountTree as GraphIcon,
  Search as SearchIcon,
  Shield as ShieldIcon,
} from '@mui/icons-material';
import { colors } from '../theme';
import { brand } from '../config/brand';

const extendedColors = {
  navyDark: '#1a2433',
  text: colors.textLight,
  orangeHover: '#e09518',
  border: colors.navyLighter,
};

const valueProps = [
  {
    icon: <GraphIcon sx={{ fontSize: 36 }} />,
    title: 'Beyond Prompt Logs',
    description:
      'AI coding tools capture what the AI said. CV-Git captures the semantic relationships, causal chains, and design decisions that give your codebase its meaning.',
  },
  {
    icon: <SearchIcon sx={{ fontSize: 36 }} />,
    title: 'Five Queries Others Can\'t Answer',
    description:
      'Impact analysis. Multi-agent conflict detection. Design decision archaeology. Safety boundary detection. Causal tracing under failure. These require a knowledge graph - not a text search.',
  },
  {
    icon: <ShieldIcon sx={{ fontSize: 36 }} />,
    title: 'Built for Regulated Industries',
    description:
      'Defense. Automotive. Aerospace. Medical devices. When compliance requires traceable reasoning chains from design decision to deployed code, prompt logs don\'t cut it.',
  },
];

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: extendedColors.navyDark }}>
      {/* Navigation */}
      <AppBar position="static" sx={{ backgroundColor: 'transparent', boxShadow: 'none' }}>
        <Toolbar sx={{ justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <img src={brand.logoPath} alt={brand.appName} style={{ height: 36, borderRadius: 8 }} />
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                color: colors.orange,
              }}
            >
              {brand.appName}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
              onClick={() => navigate('/blog')}
              sx={{ color: colors.orange, fontWeight: 600 }}
            >
              Blog
            </Button>
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
      <Container maxWidth="md" sx={{ pt: { xs: 6, md: 10 }, pb: { xs: 6, md: 10 } }}>
        <Box sx={{ textAlign: 'center', mb: 8 }}>
          <Typography
            variant="h2"
            sx={{
              fontWeight: 800,
              mb: 3,
              fontSize: { xs: '2rem', md: '3rem' },
              lineHeight: 1.15,
              background: `linear-gradient(135deg, ${extendedColors.text} 0%, ${colors.orange} 100%)`,
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Knowledge Graph Version Control for AI-Generated Code
          </Typography>
          <Typography
            variant="h5"
            sx={{
              color: colors.textMuted,
              mb: 5,
              maxWidth: 680,
              mx: 'auto',
              fontSize: { xs: '1.1rem', md: '1.35rem' },
              lineHeight: 1.6,
            }}
          >
            Metadata is not understanding. CV-Git captures why your code exists - not just what conversation produced it.
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              size="large"
              startIcon={<ReadIcon />}
              onClick={() => navigate('/blog/metadata-is-not-understanding')}
              sx={{
                backgroundColor: colors.orange,
                px: 4,
                py: 1.5,
                fontSize: '1rem',
                '&:hover': {
                  backgroundColor: extendedColors.orangeHover,
                },
              }}
            >
              Read the Technical Case
            </Button>
            <Button
              variant="outlined"
              size="large"
              startIcon={<GitHubIcon />}
              component="a"
              href="https://github.com/controlVector/cv-git"
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                borderColor: extendedColors.border,
                color: extendedColors.text,
                px: 4,
                py: 1.5,
                fontSize: '1rem',
                '&:hover': {
                  borderColor: colors.orange,
                  backgroundColor: 'rgba(245, 166, 35, 0.1)',
                },
              }}
            >
              View on GitHub
            </Button>
          </Box>
        </Box>

        {/* Value Props */}
        <Grid container spacing={3} sx={{ mb: 10 }}>
          {valueProps.map((prop, index) => (
            <Grid size={{ xs: 12, md: 4 }} key={index}>
              <Card
                sx={{
                  height: '100%',
                  backgroundColor: colors.navy,
                  border: `1px solid ${extendedColors.border}`,
                  '&:hover': {
                    borderColor: colors.orange,
                  },
                  transition: 'border-color 0.2s ease',
                }}
              >
                <CardContent sx={{ p: 3 }}>
                  <Box sx={{ color: colors.orange, mb: 2 }}>
                    {prop.icon}
                  </Box>
                  <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
                    {prop.title}
                  </Typography>
                  <Typography variant="body2" sx={{ color: colors.textMuted, lineHeight: 1.7 }}>
                    {prop.description}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        {/* Bottom Section */}
        <Box
          sx={{
            textAlign: 'center',
            py: 4,
            borderTop: `1px solid ${extendedColors.border}`,
          }}
        >
          <Typography variant="body1" sx={{ color: colors.textMuted, mb: 1 }}>
            The Context Manifold paper is available at{' '}
            <Link
              href="https://controlvector.io/research"
              target="_blank"
              rel="noopener noreferrer"
              sx={{ color: colors.orange }}
            >
              controlvector.io/research
            </Link>
          </Typography>
          <Typography variant="body1" sx={{ color: colors.textMuted }}>
            Questions?{' '}
            <Link
              href="mailto:schmotz@controlvector.io"
              sx={{ color: colors.orange }}
            >
              schmotz@controlvector.io
            </Link>
          </Typography>
        </Box>
      </Container>

      {/* Footer */}
      <Box sx={{ borderTop: `1px solid ${extendedColors.border}`, py: 3 }}>
        <Container maxWidth="lg">
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
            <Typography variant="body2" sx={{ color: colors.textMuted }}>
              &copy; {new Date().getFullYear()} {brand.companyName}. All rights reserved.
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button size="small" onClick={() => navigate('/blog')} sx={{ color: colors.textMuted }}>
                Blog
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
