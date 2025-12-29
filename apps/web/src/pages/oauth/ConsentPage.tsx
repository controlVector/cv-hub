import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Paper,
  Button,
  Avatar,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Alert,
  CircularProgress,
  Divider,
  Link,
  FormControlLabel,
  Checkbox,
  Chip,
} from '@mui/material';
import {
  CheckCircle as CheckIcon,
  Person as PersonIcon,
  Email as EmailIcon,
  VpnKey as KeyIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';

interface ClientInfo {
  clientId: string;
  name: string;
  description?: string;
  logoUrl?: string;
  websiteUrl?: string;
  privacyPolicyUrl?: string;
  termsOfServiceUrl?: string;
  isFirstParty: boolean;
  createdAt: string;  // ISO date string
}


const SCOPE_ICONS: Record<string, React.ReactNode> = {
  openid: <KeyIcon />,
  profile: <PersonIcon />,
  email: <EmailIcon />,
  offline_access: <RefreshIcon />,
};

const SCOPE_LABELS: Record<string, string> = {
  openid: 'Verify your identity',
  profile: 'Access your profile information (name, username, avatar)',
  email: 'Access your email address',
  offline_access: 'Stay connected when you\'re not using the app',
};

export default function ConsentPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [client, setClient] = useState<ClientInfo | null>(null);
  const [scopes, setScopes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rememberConsent, setRememberConsent] = useState(true);

  // Get params from URL
  const clientId = searchParams.get('client_id');
  const redirectUri = searchParams.get('redirect_uri');
  const scope = searchParams.get('scope');
  const state = searchParams.get('state');
  const codeChallenge = searchParams.get('code_challenge');
  const codeChallengeMethod = searchParams.get('code_challenge_method');
  const nonce = searchParams.get('nonce');

  useEffect(() => {
    // If not authenticated, redirect to login with return URL
    if (!authLoading && !isAuthenticated) {
      const returnUrl = window.location.href;
      navigate(`/login?redirect=${encodeURIComponent(returnUrl)}`);
      return;
    }

    if (!clientId || !redirectUri) {
      setError('Invalid authorization request: missing required parameters');
      setLoading(false);
      return;
    }

    // Fetch client info
    const fetchClientInfo = async () => {
      try {
        const res = await api.get(`/oauth/clients/${clientId}`);
        setClient(res.data.client);
        setScopes(scope?.split(' ').filter(Boolean) || ['openid']);
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to load application info');
      } finally {
        setLoading(false);
      }
    };

    if (isAuthenticated) {
      fetchClientInfo();
    }
  }, [clientId, redirectUri, scope, isAuthenticated, authLoading, navigate]);

  const handleConsent = async (allow: boolean) => {
    setSubmitting(true);
    setError(null);

    try {
      const res = await api.post('/oauth/authorize', {
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: scopes.join(' '),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
        nonce,
        consent: allow ? 'allow' : 'deny',
        remember: allow ? rememberConsent : false,  // Only remember if allowing
      });

      // Redirect to the callback URL
      window.location.href = res.data.redirect;
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to process authorization');
      setSubmitting(false);
    }
  };

  // Format date for display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  };

  if (authLoading || loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error && !client) {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Alert severity="error">{error}</Alert>
        <Button onClick={() => navigate('/')} sx={{ mt: 2 }}>
          Return to Dashboard
        </Button>
      </Container>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: 'background.default',
        display: 'flex',
        alignItems: 'center',
        py: 4,
      }}
    >
      <Container maxWidth="sm">
        <Paper sx={{ p: 4 }}>
          {/* Header */}
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 2, mb: 2 }}>
              {client?.logoUrl ? (
                <Avatar src={client.logoUrl} sx={{ width: 64, height: 64 }} />
              ) : (
                <Avatar sx={{ width: 64, height: 64, bgcolor: 'primary.main' }}>
                  {client?.name?.[0]?.toUpperCase() || '?'}
                </Avatar>
              )}
            </Box>
            <Typography variant="h5" gutterBottom>
              {client?.name} wants to access your account
            </Typography>
            {client?.description && (
              <Typography color="text.secondary" variant="body2">
                {client.description}
              </Typography>
            )}
            {client?.createdAt && (
              <Chip
                label={`Registered ${formatDate(client.createdAt)}`}
                size="small"
                variant="outlined"
                sx={{ mt: 1 }}
              />
            )}
          </Box>

          <Divider sx={{ my: 3 }} />

          {/* User info */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <Avatar src={user?.avatarUrl} sx={{ width: 40, height: 40 }}>
              {user?.displayName?.[0] || user?.username?.[0]}
            </Avatar>
            <Box>
              <Typography variant="body2" color="text.secondary">
                Signed in as
              </Typography>
              <Typography fontWeight="medium">
                {user?.displayName || user?.username}
              </Typography>
            </Box>
          </Box>

          {/* Requested permissions */}
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            This application will be able to:
          </Typography>
          <List dense>
            {scopes.map((scopeName) => (
              <ListItem key={scopeName}>
                <ListItemIcon sx={{ minWidth: 40 }}>
                  {SCOPE_ICONS[scopeName] || <CheckIcon color="success" />}
                </ListItemIcon>
                <ListItemText
                  primary={SCOPE_LABELS[scopeName] || scopeName}
                />
              </ListItem>
            ))}
          </List>

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}

          {/* Remember consent checkbox */}
          <FormControlLabel
            control={
              <Checkbox
                checked={rememberConsent}
                onChange={(e) => setRememberConsent(e.target.checked)}
              />
            }
            label={
              <Typography variant="body2" color="text.secondary">
                Remember my decision (skip this screen next time)
              </Typography>
            }
            sx={{ mt: 2 }}
          />

          {/* Actions */}
          <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
            <Button
              fullWidth
              variant="outlined"
              onClick={() => handleConsent(false)}
              disabled={submitting}
            >
              Deny
            </Button>
            <Button
              fullWidth
              variant="contained"
              onClick={() => handleConsent(true)}
              disabled={submitting}
            >
              {submitting ? <CircularProgress size={24} /> : 'Authorize'}
            </Button>
          </Box>

          {/* Footer links */}
          <Box sx={{ mt: 3, textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              By authorizing, you allow this app to access your data in accordance with their{' '}
              {client?.privacyPolicyUrl ? (
                <Link href={client.privacyPolicyUrl} target="_blank" rel="noopener">
                  privacy policy
                </Link>
              ) : (
                'privacy policy'
              )}
              {client?.termsOfServiceUrl && (
                <>
                  {' '}and{' '}
                  <Link href={client.termsOfServiceUrl} target="_blank" rel="noopener">
                    terms of service
                  </Link>
                </>
              )}
              .
            </Typography>
          </Box>

          {/* Website link */}
          {client?.websiteUrl && (
            <Box sx={{ mt: 2, textAlign: 'center' }}>
              <Link href={client.websiteUrl} target="_blank" rel="noopener" variant="body2">
                Learn more about {client.name}
              </Link>
            </Box>
          )}
        </Paper>

        {/* Account switcher hint */}
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 2 }}>
          Not you?{' '}
          <Link href="/login" onClick={(e) => { e.preventDefault(); navigate('/login'); }}>
            Sign in with a different account
          </Link>
        </Typography>
      </Container>
    </Box>
  );
}
