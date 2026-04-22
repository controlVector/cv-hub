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
  AutoStories as ReadIcon,
  Login as LoginIcon,
  PersonAdd as RegisterIcon,
  AccountTree as GraphIcon,
  Search as SearchIcon,
  Shield as ShieldIcon,
  Forum as ThreadIcon,
  ArrowOutward as ExternalIcon,
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
            {brand.features.blog && (
              <Button
                onClick={() => navigate('/blog')}
                sx={{ color: colors.orange, fontWeight: 600 }}
              >
                Blog
              </Button>
            )}
            {brand.features.pricing && (
              <Button
                onClick={() => navigate('/pricing')}
                sx={{ color: colors.orange, fontWeight: 600 }}
              >
                Pricing
              </Button>
            )}
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
            {brand.features.blog && (
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
            )}
            {brand.features.pricing && (
              <Button
                variant="outlined"
                size="large"
                onClick={() => navigate('/pricing')}
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
                View Pricing
              </Button>
            )}
            <Button
              variant="outlined"
              size="large"
              component="a"
              href={brand.products.thread.url}
              target="_blank"
              rel="noopener noreferrer"
              endIcon={<ExternalIcon sx={{ fontSize: 16 }} />}
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
              Try {brand.products.thread.name}
            </Button>
          </Box>
        </Box>

        {/* cv-thread spotlight — prominent product cross-link */}
        <Box sx={{ mb: 10 }}>
          <Card
            component="a"
            href={brand.products.thread.url}
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              display: 'block',
              textDecoration: 'none',
              background: `linear-gradient(135deg, ${colors.navy} 0%, ${extendedColors.navyDark} 100%)`,
              border: `1px solid ${extendedColors.border}`,
              transition: 'border-color 160ms, transform 160ms',
              '&:hover': {
                borderColor: colors.orange,
                transform: 'translateY(-2px)',
              },
            }}
          >
            <CardContent sx={{ p: { xs: 3, md: 4 }, display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 64,
                  height: 64,
                  borderRadius: 2,
                  backgroundColor: 'rgba(245, 166, 35, 0.12)',
                  color: colors.orange,
                  flexShrink: 0,
                }}
              >
                <ThreadIcon sx={{ fontSize: 36 }} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 260 }}>
                <Typography
                  variant="overline"
                  sx={{ color: colors.orange, fontWeight: 700, letterSpacing: 1.5 }}
                >
                  New · sibling product
                </Typography>
                <Typography
                  variant="h5"
                  sx={{ color: extendedColors.text, fontWeight: 700, mt: 0.5, mb: 0.5 }}
                >
                  {brand.products.thread.name} — {brand.products.thread.tagline}
                </Typography>
                <Typography variant="body1" sx={{ color: colors.textMuted }}>
                  Separate app, same account. Open it at{' '}
                  <Box component="span" sx={{ color: colors.orange, fontFamily: 'monospace' }}>
                    {brand.products.thread.url.replace(/^https?:\/\//, '')}
                  </Box>
                </Typography>
              </Box>
              <ExternalIcon sx={{ color: colors.textMuted, fontSize: 28, flexShrink: 0 }} />
            </CardContent>
          </Card>
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
          {brand.features.research && (
            <Typography variant="body1" sx={{ color: colors.textMuted, mb: 1 }}>
              The Context Manifold paper is available at{' '}
              <Link
                href="/research"
                sx={{ color: colors.orange, cursor: 'pointer' }}
              >
                {brand.domain}/research
              </Link>
            </Typography>
          )}
          <Typography variant="body1" sx={{ color: colors.textMuted }}>
            Questions?{' '}
            <Link
              href={`mailto:${brand.contactEmail}`}
              sx={{ color: colors.orange }}
            >
              {brand.contactEmail}
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
              {brand.features.blog && (
                <Button size="small" onClick={() => navigate('/blog')} sx={{ color: colors.textMuted }}>
                  Blog
                </Button>
              )}
              {brand.features.pricing && (
                <Button size="small" onClick={() => navigate('/pricing')} sx={{ color: colors.textMuted }}>
                  Pricing
                </Button>
              )}
              {brand.features.research && (
                <Button size="small" onClick={() => navigate('/research')} sx={{ color: colors.textMuted }}>
                  Research
                </Button>
              )}
            </Box>
          </Box>
        </Container>
      </Box>
    </Box>
  );
}
