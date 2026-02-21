import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  AppBar,
  Toolbar,
  Button,
  Paper,
  Chip,
  Link,
} from '@mui/material';
import {
  Login as LoginIcon,
  ArrowBack as ArrowBackIcon,
  Download as DownloadIcon,
  Article as ArticleIcon,
} from '@mui/icons-material';
import { colors } from '../theme';
import { brand } from '../config/brand';

const bgColor = '#1a2433';
const borderColor = colors.navyLighter;

export default function ResearchPage() {
  const navigate = useNavigate();

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: bgColor }}>
      <AppBar position="static" sx={{ backgroundColor: 'transparent', boxShadow: 'none' }}>
        <Toolbar sx={{ justifyContent: 'space-between' }}>
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, cursor: 'pointer' }}
            onClick={() => navigate('/')}
          >
            <img src={brand.logoPath} alt={brand.appName} style={{ height: 36, borderRadius: 8 }} />
            <Typography
              variant="h6"
              sx={{ fontWeight: 700, color: colors.orange }}
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
                  borderColor: '#e09518',
                  backgroundColor: 'rgba(245, 166, 35, 0.1)',
                },
              }}
            >
              Sign In
            </Button>
          </Box>
        </Toolbar>
      </AppBar>

      <Container maxWidth="md" sx={{ pt: 6, pb: 10 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/')}
          sx={{ color: colors.textMuted, mb: 4 }}
        >
          Home
        </Button>

        <Typography
          variant="h3"
          sx={{
            fontWeight: 800,
            mb: 1,
            background: `linear-gradient(135deg, ${colors.textLight} 0%, ${colors.orange} 100%)`,
            backgroundClip: 'text',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          Research
        </Typography>
        <Typography variant="body1" sx={{ color: colors.textMuted, mb: 5 }}>
          Papers and technical foundations behind Control Vector.
        </Typography>

        {/* Context Manifold Paper */}
        <Paper
          sx={{
            backgroundColor: colors.navy,
            border: `1px solid ${borderColor}`,
            p: 4,
            mb: 4,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
            <ArticleIcon sx={{ color: colors.orange, fontSize: 48, mt: 0.5, flexShrink: 0 }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="h5" sx={{ fontWeight: 700, color: colors.textLight, mb: 1 }}>
                Context Manifold: Adaptive Hybrid Graph-Vector Retrieval for Code Intelligence
              </Typography>
              <Typography variant="body2" sx={{ color: colors.textMuted, mb: 2 }}>
                John Schmotzer &middot; December 2025 (v4)
              </Typography>

              <Box sx={{ display: 'flex', gap: 1, mb: 3, flexWrap: 'wrap' }}>
                <Chip label="Knowledge Graphs" size="small" sx={{ backgroundColor: 'rgba(245, 166, 35, 0.15)', color: colors.orange }} />
                <Chip label="Vector Retrieval" size="small" sx={{ backgroundColor: 'rgba(245, 166, 35, 0.15)', color: colors.orange }} />
                <Chip label="RAG" size="small" sx={{ backgroundColor: 'rgba(245, 166, 35, 0.15)', color: colors.orange }} />
                <Chip label="Code Intelligence" size="small" sx={{ backgroundColor: 'rgba(245, 166, 35, 0.15)', color: colors.orange }} />
              </Box>

              <Typography variant="body1" sx={{ color: colors.textMuted, lineHeight: 1.8, mb: 3 }}>
                Retrieval-augmented generation (RAG) for code intelligence is commonly implemented
                as vector similarity search over embedded code chunks. However, software repositories
                also contain explicit structural relationships (e.g., function calls and type references)
                that can be exploited for context selection. We present <strong style={{ color: colors.textLight }}>Context Manifold</strong>, a
                hybrid retrieval formulation that combines normalized graph distance and normalized
                embedding distance in a single metric.
              </Typography>

              <Typography variant="body1" sx={{ color: colors.textMuted, lineHeight: 1.8, mb: 3 }}>
                Evaluated on 70 real-world Python repositories with 44,488 function-level queries,
                results show strong heterogeneity by repository structure: high-coupling systems
                gain +4.1% dependency coverage with graph-augmented retrieval, while low-coupling
                utility libraries regress -5.2%, indicating that hybrid retrieval should be applied
                selectively via adaptive routing.
              </Typography>

              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Button
                  variant="contained"
                  startIcon={<DownloadIcon />}
                  href="/papers/context-manifold-v4.pdf"
                  target="_blank"
                  sx={{
                    backgroundColor: colors.orange,
                    color: '#000',
                    fontWeight: 600,
                    '&:hover': { backgroundColor: '#e09518' },
                  }}
                >
                  Download PDF
                </Button>
                <Button
                  variant="outlined"
                  onClick={() => navigate('/blog/metadata-is-not-understanding')}
                  sx={{
                    borderColor: borderColor,
                    color: colors.textMuted,
                    '&:hover': {
                      borderColor: colors.orange,
                      color: colors.orange,
                    },
                  }}
                >
                  Read the Blog Post
                </Button>
              </Box>
            </Box>
          </Box>
        </Paper>

        {/* Inline PDF viewer */}
        <Paper
          sx={{
            backgroundColor: colors.navy,
            border: `1px solid ${borderColor}`,
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              p: 2,
              borderBottom: `1px solid ${borderColor}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Typography variant="subtitle2" sx={{ color: colors.textMuted }}>
              Paper Preview
            </Typography>
            <Link
              href="/papers/context-manifold-v4.pdf"
              target="_blank"
              sx={{ color: colors.orange, fontSize: '0.875rem' }}
            >
              Open in new tab
            </Link>
          </Box>
          <Box
            component="iframe"
            src="/papers/context-manifold-v4.pdf"
            sx={{
              width: '100%',
              height: '80vh',
              border: 'none',
              display: 'block',
            }}
          />
        </Paper>
      </Container>

      <Box sx={{ borderTop: `1px solid ${borderColor}`, py: 3 }}>
        <Container maxWidth="md">
          <Typography variant="body2" sx={{ color: colors.textMuted, textAlign: 'center' }}>
            &copy; {new Date().getFullYear()} {brand.companyName}. All rights reserved.
          </Typography>
        </Container>
      </Box>
    </Box>
  );
}
