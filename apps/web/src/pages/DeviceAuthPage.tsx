import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Paper,
  Button,
  TextField,
  Alert,
  CircularProgress,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Avatar,
} from '@mui/material';
import {
  Terminal as TerminalIcon,
  CheckCircle as CheckIcon,
  Cancel as CancelIcon,
  VpnKey as KeyIcon,
  Person as PersonIcon,
  Email as EmailIcon,
  Refresh as RefreshIcon,
  Code as CodeIcon,
  Storage as StorageIcon,
  AdminPanelSettings as AdminIcon,
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { colors } from '../theme';

const SCOPE_ICONS: Record<string, React.ReactNode> = {
  openid: <KeyIcon />,
  profile: <PersonIcon />,
  email: <EmailIcon />,
  offline_access: <RefreshIcon />,
  'repo:read': <CodeIcon />,
  'repo:write': <StorageIcon />,
  'repo:admin': <AdminIcon />,
  'mcp:tools': <TerminalIcon />,
  'mcp:tasks': <TerminalIcon />,
  'mcp:threads': <TerminalIcon />,
  'mcp:execute': <TerminalIcon />,
};

const SCOPE_LABELS: Record<string, string> = {
  openid: 'Verify your identity',
  profile: 'Access your profile information',
  email: 'Access your email address',
  offline_access: 'Stay connected (refresh token)',
  'repo:read': 'Clone and fetch repositories',
  'repo:write': 'Push to repositories',
  'repo:admin': 'Manage repository settings',
  'mcp:tools': 'Access MCP tools',
  'mcp:tasks': 'Create and manage tasks',
  'mcp:threads': 'Access workflow threads',
  'mcp:execute': 'Execute code via agents',
};

interface DeviceStatus {
  client_name: string;
  client_id: string;
  scopes: string[];
  scope_descriptions: Record<string, string>;
}

export default function DeviceAuthPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const codeFromUrl = searchParams.get('code') || '';
  const [userCode, setUserCode] = useState(codeFromUrl);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Auto-lookup if code is in URL
  useEffect(() => {
    if (codeFromUrl && isAuthenticated) {
      lookupCode(codeFromUrl);
    }
  }, [codeFromUrl, isAuthenticated]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      const returnUrl = window.location.href;
      navigate(`/login?redirect=${encodeURIComponent(returnUrl)}`);
    }
  }, [authLoading, isAuthenticated, navigate]);

  async function lookupCode(code: string) {
    setLoading(true);
    setError(null);
    setDeviceStatus(null);
    setSuccess(null);

    try {
      const res = await api.get(`/oauth/device/status?code=${encodeURIComponent(code)}`);
      setDeviceStatus(res.data);
    } catch (err: any) {
      const msg = err.response?.data?.error_description || err.response?.data?.error || 'Invalid or expired code';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(action: 'approve' | 'deny') {
    setSubmitting(true);
    setError(null);

    try {
      const res = await api.post('/oauth/device/verify', {
        user_code: userCode,
        action,
        scopes: deviceStatus?.scopes,
      });
      setSuccess(res.data.message);
      setDeviceStatus(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to process authorization');
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    if (userCode.trim().length >= 8) {
      lookupCode(userCode.trim());
    }
  }

  // Format code input with dash
  function handleCodeChange(value: string) {
    // Allow letters, digits, and dashes
    const clean = value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    setUserCode(clean);
  }

  if (authLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', bgcolor: colors.slate }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: colors.slate,
        display: 'flex',
        alignItems: 'center',
        py: 4,
      }}
    >
      <Container maxWidth="sm">
        <Paper
          sx={{
            p: 4,
            bgcolor: colors.slateLight,
            border: `1px solid ${colors.slateLighter}`,
          }}
        >
          {/* Header */}
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <Box
              sx={{
                width: 64,
                height: 64,
                borderRadius: 2,
                background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.cyan} 100%)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
                mb: 2,
              }}
            >
              <TerminalIcon sx={{ fontSize: 32, color: '#fff' }} />
            </Box>
            <Typography variant="h5" sx={{ color: colors.textLight, fontWeight: 600 }}>
              Device Authorization
            </Typography>
            <Typography variant="body2" sx={{ color: colors.textMuted, mt: 1 }}>
              Enter the code shown in your terminal to authorize the application
            </Typography>
          </Box>

          {/* Signed-in user info */}
          {user && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, px: 1 }}>
              <Avatar src={user.avatarUrl} sx={{ width: 36, height: 36 }}>
                {user.displayName?.[0] || user.username?.[0]}
              </Avatar>
              <Box>
                <Typography variant="body2" sx={{ color: colors.textMuted }}>
                  Signed in as
                </Typography>
                <Typography variant="body2" sx={{ color: colors.textLight, fontWeight: 500 }}>
                  {user.displayName || user.username}
                </Typography>
              </Box>
            </Box>
          )}

          <Divider sx={{ borderColor: colors.slateLighter, mb: 3 }} />

          {/* Success state */}
          {success && (
            <Box sx={{ textAlign: 'center', py: 3 }}>
              <CheckIcon sx={{ fontSize: 64, color: colors.green, mb: 2 }} />
              <Typography variant="h6" sx={{ color: colors.textLight, mb: 1 }}>
                {success}
              </Typography>
              <Typography variant="body2" sx={{ color: colors.textMuted, mb: 3 }}>
                You can close this window and return to your terminal.
              </Typography>
              <Button variant="outlined" onClick={() => navigate('/dashboard')}>
                Go to Dashboard
              </Button>
            </Box>
          )}

          {/* Code entry form */}
          {!success && !deviceStatus && (
            <Box component="form" onSubmit={handleSubmitCode}>
              <TextField
                fullWidth
                label="Enter code"
                placeholder="XXXX-XXXX"
                value={userCode}
                onChange={(e) => handleCodeChange(e.target.value)}
                inputProps={{
                  maxLength: 9,
                  style: {
                    textAlign: 'center',
                    fontSize: '1.5rem',
                    letterSpacing: '0.3rem',
                    fontFamily: 'monospace',
                  },
                }}
                sx={{ mb: 2 }}
              />
              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              )}
              <Button
                fullWidth
                variant="contained"
                type="submit"
                disabled={loading || userCode.trim().length < 8}
              >
                {loading ? <CircularProgress size={24} /> : 'Continue'}
              </Button>
            </Box>
          )}

          {/* Approval view */}
          {!success && deviceStatus && (
            <Box>
              <Box sx={{ textAlign: 'center', mb: 2 }}>
                <Typography variant="subtitle1" sx={{ color: colors.textLight, fontWeight: 600 }}>
                  {deviceStatus.client_name}
                </Typography>
                <Typography variant="body2" sx={{ color: colors.textMuted }}>
                  wants to access your ControlVector Hub account
                </Typography>
              </Box>

              <Typography variant="subtitle2" sx={{ color: colors.textMuted, mt: 2, mb: 1 }}>
                This application will be able to:
              </Typography>
              <List dense>
                {deviceStatus.scopes.map((scope) => (
                  <ListItem key={scope} sx={{ py: 0.5 }}>
                    <ListItemIcon sx={{ minWidth: 36, color: colors.textMuted }}>
                      {SCOPE_ICONS[scope] || <CheckIcon />}
                    </ListItemIcon>
                    <ListItemText
                      primary={SCOPE_LABELS[scope] || deviceStatus.scope_descriptions[scope] || scope}
                      primaryTypographyProps={{ variant: 'body2', color: colors.textLight }}
                    />
                  </ListItem>
                ))}
              </List>

              {error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {error}
                </Alert>
              )}

              <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
                <Button
                  fullWidth
                  variant="outlined"
                  color="error"
                  startIcon={<CancelIcon />}
                  onClick={() => handleAction('deny')}
                  disabled={submitting}
                >
                  Deny
                </Button>
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={submitting ? undefined : <CheckIcon />}
                  onClick={() => handleAction('approve')}
                  disabled={submitting}
                >
                  {submitting ? <CircularProgress size={24} /> : 'Authorize'}
                </Button>
              </Box>
            </Box>
          )}
        </Paper>

        {/* Footer */}
        <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 2, color: colors.textMuted }}>
          Only authorize applications you trust.
        </Typography>
      </Container>
    </Box>
  );
}
