import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  AppBar,
  Toolbar,
  Button,
} from '@mui/material';
import {
  Login as LoginIcon,
  ArrowBack as ArrowBackIcon,
} from '@mui/icons-material';
import { colors } from '../../theme';
import { brand } from '../../config/brand';
import { getPostBySlug } from '../../content/blog';
import Markdown from '../../components/Markdown';

const bgColor = '#1a2433';
const borderColor = colors.navyLighter;

export default function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const post = slug ? getPostBySlug(slug) : undefined;

  if (!post) {
    return (
      <Box sx={{ minHeight: '100vh', backgroundColor: bgColor }}>
        <Container maxWidth="md" sx={{ pt: 12, textAlign: 'center' }}>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 2 }}>
            Post not found
          </Typography>
          <Button
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate('/blog')}
            sx={{ color: colors.orange }}
          >
            Back to Blog
          </Button>
        </Container>
      </Box>
    );
  }

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
          onClick={() => navigate('/blog')}
          sx={{ color: colors.textMuted, mb: 4 }}
        >
          Back to Blog
        </Button>

        <Box sx={{ mb: 4 }}>
          <Typography variant="caption" sx={{ color: colors.textMuted }}>
            {new Date(post.date).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
            {' \u00B7 '}
            {post.author}
          </Typography>
          <Typography
            variant="h3"
            sx={{
              fontWeight: 800,
              mt: 1,
              mb: 2,
              lineHeight: 1.2,
              background: `linear-gradient(135deg, ${colors.textLight} 0%, ${colors.orange} 100%)`,
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {post.title}
          </Typography>
        </Box>

        <Box
          sx={{
            maxWidth: 720,
            '& > *:first-of-type': { mt: 0 },
          }}
        >
          <Markdown>{post.content}</Markdown>
        </Box>
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
