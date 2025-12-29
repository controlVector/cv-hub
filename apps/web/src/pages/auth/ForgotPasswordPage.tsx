import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
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

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await api.post('/auth/forgot-password', { email });
      setSuccess(true);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to send reset email');
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
            Reset Password
          </Typography>
          <Typography variant="body2" align="center" sx={{ mb: 3, color: 'rgba(255,255,255,0.7)' }}>
            Enter your email to receive a reset link
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {success ? (
            <>
              <Alert severity="success" sx={{ mb: 2 }}>
                If an account with that email exists, we've sent a password reset link.
              </Alert>
              <Typography variant="body2" align="center" sx={{ mt: 3, color: 'rgba(255,255,255,0.7)' }}>
                <Link component={RouterLink} to="/login" sx={{ color: '#f5a623' }}>
                  Back to Sign In
                </Link>
              </Typography>
            </>
          ) : (
            <form onSubmit={handleSubmit}>
              <TextField
                fullWidth
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                margin="normal"
                required
                autoComplete="email"
                autoFocus
              />

              <Button
                fullWidth
                type="submit"
                variant="contained"
                size="large"
                disabled={loading}
                sx={{ mt: 3 }}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : 'Send Reset Link'}
              </Button>

              <Typography variant="body2" align="center" sx={{ mt: 3, color: 'rgba(255,255,255,0.7)' }}>
                Remember your password?{' '}
                <Link component={RouterLink} to="/login" sx={{ color: '#f5a623' }}>
                  Sign in
                </Link>
              </Typography>
            </form>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
