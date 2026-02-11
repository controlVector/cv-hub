import { useState } from 'react';
import { useNavigate, useLocation, useSearchParams, Link as RouterLink } from 'react-router-dom';
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
  Tabs,
  Tab,
  Divider,
} from '@mui/material';
import { startAuthentication } from '@simplewebauthn/browser';
import { useAuth } from '../../contexts/AuthContext';
import { brand } from '../../config/brand';
import { api, setAccessToken } from '../../lib/api';

interface MFAState {
  mfaToken: string;
  userId: string;
  methods: {
    totp: boolean;
    passkey: boolean;
    backupCode: boolean;
  };
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, setAuthenticatedUser } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // MFA state
  const [mfaState, setMfaState] = useState<MFAState | null>(null);
  const [mfaMethod, setMfaMethod] = useState<'totp' | 'passkey' | 'backupCode'>('totp');
  const [mfaCode, setMfaCode] = useState('');

  // Get redirect destination from query param or location state
  const getRedirectDestination = () => {
    // First check for redirect query param (used by OAuth)
    const redirectParam = searchParams.get('redirect');
    if (redirectParam) {
      return redirectParam;
    }
    // Then check location state (used by ProtectedRoute)
    return (location.state as any)?.from?.pathname || '/';
  };

  // Redirect if already authenticated
  if (isAuthenticated) {
    const destination = getRedirectDestination();
    // For external URLs (OAuth), use window.location
    if (destination.startsWith('http')) {
      window.location.href = destination;
    } else {
      navigate(destination, { replace: true });
    }
    return null;
  }

  const redirectToDestination = () => {
    const destination = getRedirectDestination();
    // For external URLs (OAuth), use window.location
    if (destination.startsWith('http')) {
      window.location.href = destination;
    } else {
      navigate(destination, { replace: true });
    }
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await api.post('/auth/login', { email, password });

      if (res.data.mfaRequired) {
        // MFA required - show verification step
        setMfaState({
          mfaToken: res.data.mfaToken,
          userId: res.data.userId,
          methods: res.data.methods,
        });
        // Select first available method
        if (res.data.methods.totp) setMfaMethod('totp');
        else if (res.data.methods.passkey) setMfaMethod('passkey');
        else if (res.data.methods.backupCode) setMfaMethod('backupCode');
      } else {
        // No MFA - complete login
        setAccessToken(res.data.accessToken);
        setAuthenticatedUser(res.data.user);
        redirectToDestination();
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleMFAVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaState) return;
    setError('');
    setLoading(true);

    try {
      let payload: any = {
        mfaToken: mfaState.mfaToken,
        method: mfaMethod,
      };

      if (mfaMethod === 'passkey') {
        // Get passkey authentication options
        const optionsRes = await api.post('/mfa/verify/passkey/options', { userId: mfaState.userId });
        const credential = await startAuthentication({ optionsJSON: optionsRes.data });
        payload.passkeyResponse = credential;
      } else {
        payload.code = mfaCode;
      }

      const res = await api.post('/auth/login/mfa', payload);
      setAccessToken(res.data.accessToken);
      setAuthenticatedUser(res.data.user);
      redirectToDestination();
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError('Passkey authentication was cancelled');
      } else {
        setError(err.response?.data?.error?.message || 'Verification failed');
      }
    } finally {
      setLoading(false);
    }
  }

  // MFA Verification Step
  if (mfaState) {
    const availableMethods: { value: 'totp' | 'passkey' | 'backupCode'; label: string }[] = [];
    if (mfaState.methods.totp) availableMethods.push({ value: 'totp', label: 'Authenticator' });
    if (mfaState.methods.passkey) availableMethods.push({ value: 'passkey', label: 'Passkey' });
    if (mfaState.methods.backupCode) availableMethods.push({ value: 'backupCode', label: 'Backup Code' });

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
            <Typography variant="h5" align="center" gutterBottom sx={{ color: '#fff' }}>
              Two-Factor Authentication
            </Typography>
            <Typography variant="body2" align="center" sx={{ mb: 3, color: 'rgba(255,255,255,0.7)' }}>
              Enter your verification code to continue
            </Typography>

            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            {availableMethods.length > 1 && (
              <Tabs
                value={mfaMethod}
                onChange={(_, v) => { setMfaMethod(v); setMfaCode(''); }}
                variant="fullWidth"
                sx={{ mb: 2 }}
              >
                {availableMethods.map((m) => (
                  <Tab key={m.value} value={m.value} label={m.label} />
                ))}
              </Tabs>
            )}

            <form onSubmit={handleMFAVerify}>
              {mfaMethod === 'totp' && (
                <TextField
                  fullWidth
                  label="6-digit code"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  margin="normal"
                  required
                  autoFocus
                  inputProps={{ maxLength: 6 }}
                  placeholder="000000"
                />
              )}

              {mfaMethod === 'backupCode' && (
                <TextField
                  fullWidth
                  label="Backup code"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.toUpperCase())}
                  margin="normal"
                  required
                  autoFocus
                  placeholder="XXXX-XXXX"
                />
              )}

              {mfaMethod === 'passkey' && (
                <Typography variant="body2" sx={{ my: 2, color: 'rgba(255,255,255,0.7)', textAlign: 'center' }}>
                  Click verify to use your passkey
                </Typography>
              )}

              <Button
                fullWidth
                type="submit"
                variant="contained"
                size="large"
                disabled={loading || (mfaMethod !== 'passkey' && mfaCode.length === 0)}
                sx={{ mt: 3 }}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : 'Verify'}
              </Button>
            </form>

            <Divider sx={{ my: 3 }} />

            <Button
              fullWidth
              variant="text"
              onClick={() => {
                setMfaState(null);
                setMfaCode('');
                setError('');
              }}
              sx={{ color: 'rgba(255,255,255,0.7)' }}
            >
              Use a different account
            </Button>
          </CardContent>
        </Card>
      </Box>
    );
  }

  // Initial Login Form
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
            Sign In
          </Typography>
          <Typography variant="body2" align="center" sx={{ mb: 3, color: 'rgba(255,255,255,0.7)' }}>
            Welcome back to {brand.companyName}
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

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
            <TextField
              fullWidth
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              margin="normal"
              required
              autoComplete="current-password"
            />

            <Box sx={{ mt: 2, textAlign: 'right' }}>
              <Link component={RouterLink} to="/forgot-password" variant="body2" sx={{ color: '#f5a623' }}>
                Forgot password?
              </Link>
            </Box>

            <Button
              fullWidth
              type="submit"
              variant="contained"
              size="large"
              disabled={loading}
              sx={{ mt: 3 }}
            >
              {loading ? <CircularProgress size={24} color="inherit" /> : 'Sign In'}
            </Button>
          </form>

          <Typography variant="body2" align="center" sx={{ mt: 3, color: 'rgba(255,255,255,0.7)' }}>
            Don't have an account?{' '}
            <Link component={RouterLink} to="/register" sx={{ color: '#f5a623' }}>
              Sign up
            </Link>
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
