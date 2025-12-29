import { useState, useEffect } from 'react';
import { useSearchParams, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Alert,
  Link,
  CircularProgress,
} from '@mui/material';
import { api } from '../../lib/api';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    async function verifyEmail() {
      if (!token) {
        setStatus('error');
        setError('Invalid verification link');
        return;
      }

      try {
        await api.post('/auth/verify-email', { token });
        setStatus('success');
      } catch (err: any) {
        setStatus('error');
        setError(err.response?.data?.error?.message || 'Failed to verify email');
      }
    }

    verifyEmail();
  }, [token]);

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
        <CardContent sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h4" gutterBottom sx={{ color: '#fff' }}>
            Email Verification
          </Typography>

          {status === 'loading' && (
            <>
              <CircularProgress sx={{ my: 3, color: '#f5a623' }} />
              <Typography sx={{ color: 'rgba(255,255,255,0.7)' }}>
                Verifying your email...
              </Typography>
            </>
          )}

          {status === 'success' && (
            <>
              <Alert severity="success" sx={{ my: 2 }}>
                Your email has been verified successfully!
              </Alert>
              <Typography sx={{ mt: 2, color: 'rgba(255,255,255,0.7)' }}>
                <Link component={RouterLink} to="/login" sx={{ color: '#f5a623' }}>
                  Continue to Sign In
                </Link>
              </Typography>
            </>
          )}

          {status === 'error' && (
            <>
              <Alert severity="error" sx={{ my: 2 }}>
                {error}
              </Alert>
              <Typography sx={{ mt: 2, color: 'rgba(255,255,255,0.7)' }}>
                <Link component={RouterLink} to="/login" sx={{ color: '#f5a623' }}>
                  Back to Sign In
                </Link>
              </Typography>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
