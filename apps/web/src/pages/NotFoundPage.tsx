import { Box, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { colors } from '../theme';

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        textAlign: 'center',
        px: 3,
      }}
    >
      <Typography
        variant="h1"
        sx={{
          fontWeight: 800,
          fontSize: '8rem',
          background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.cyan} 100%)`,
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          lineHeight: 1,
          mb: 2,
        }}
      >
        404
      </Typography>
      <Typography
        variant="h5"
        sx={{ color: colors.textLight, fontWeight: 600, mb: 1 }}
      >
        Page not found
      </Typography>
      <Typography
        variant="body1"
        sx={{ color: colors.textMuted, mb: 4, maxWidth: 420 }}
      >
        The page you're looking for doesn't exist or has been moved.
      </Typography>
      <Button variant="contained" onClick={() => navigate('/dashboard')}>
        Go to Dashboard
      </Button>
    </Box>
  );
}
