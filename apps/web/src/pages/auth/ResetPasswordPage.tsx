import { useState } from 'react';
import { useNavigate, useSearchParams, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
  Link,
  CircularProgress,
} from '@mui/material';
import { api } from '../../lib/api';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (!token) {
      setError('Invalid reset link');
      return;
    }

    setLoading(true);

    try {
      await api.post('/auth/reset-password', { token, password });
      navigate('/login', { state: { message: 'Password reset successful. Please sign in.' } });
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#1e2a3a',
        p: 2,
      }}
    >
      <Card sx={{ maxWidth: 400, width: '100%', backgroundColor: '#2a3a4d' }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h4" align="center" gutterBottom sx={{ color: '#fff' }}>
            Set New Password
          </Typography>
          <Typography variant="body2" align="center" sx={{ mb: 3, color: 'rgba(255,255,255,0.7)' }}>
            Enter your new password below
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="New Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              margin="normal"
              required
              autoComplete="new-password"
              autoFocus
              helperText="At least 8 characters with uppercase, lowercase, and number"
            />
            <TextField
              fullWidth
              label="Confirm New Password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              margin="normal"
              required
              autoComplete="new-password"
            />

            <Button
              fullWidth
              type="submit"
              variant="contained"
              size="large"
              disabled={loading}
              sx={{ mt: 3 }}
            >
              {loading ? <CircularProgress size={24} color="inherit" /> : 'Reset Password'}
            </Button>

            <Typography variant="body2" align="center" sx={{ mt: 3, color: 'rgba(255,255,255,0.7)' }}>
              <Link component={RouterLink} to="/login" sx={{ color: '#f5a623' }}>
                Back to Sign In
              </Link>
            </Typography>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}
