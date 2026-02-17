import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  AppBar,
  Toolbar,
  Button,
  Card,
  CardContent,
  CardActionArea,
} from '@mui/material';
import {
  Login as LoginIcon,
  ArrowBack as ArrowBackIcon,
} from '@mui/icons-material';
import { colors } from '../../theme';
import { brand } from '../../config/brand';
import { blogPosts } from '../../content/blog';

const bgColor = '#1a2433';
const borderColor = colors.navyLighter;

export default function BlogList() {
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
              sx={{
                fontWeight: 700,
                background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.cyan} 100%)`,
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
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
          Blog
        </Typography>
        <Typography variant="body1" sx={{ color: colors.textMuted, mb: 5 }}>
          Thinking on version control, knowledge graphs, and the AI coding era.
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {blogPosts.map((post) => (
            <Card
              key={post.slug}
              sx={{
                backgroundColor: colors.navy,
                border: `1px solid ${borderColor}`,
                '&:hover': {
                  borderColor: colors.orange,
                  transform: 'translateY(-2px)',
                },
                transition: 'all 0.2s ease',
              }}
            >
              <CardActionArea onClick={() => navigate(`/blog/${post.slug}`)}>
                <CardContent sx={{ p: 3 }}>
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
                    variant="h5"
                    sx={{ fontWeight: 700, mt: 0.5, mb: 1, color: colors.textLight }}
                  >
                    {post.title}
                  </Typography>
                  <Typography variant="body1" sx={{ color: colors.textMuted, lineHeight: 1.7 }}>
                    {post.excerpt}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
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
