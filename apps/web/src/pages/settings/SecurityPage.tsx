import { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Typography,
  Paper,
  Button,
  Card,
  CardContent,
  CardActions,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Divider,
} from '@mui/material';
import {
  Security as SecurityIcon,
  Key as KeyIcon,
  Smartphone as SmartphoneIcon,
  ContentCopy as CopyIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import { startRegistration } from '@simplewebauthn/browser';

interface MFAStatus {
  mfaEnabled: boolean;
  methods: { type: string; enabled: boolean; primary: boolean; lastUsedAt: string | null }[];
  totp: { enabled: boolean };
  passkeys: { enabled: boolean; count: number };
  backupCodes: { remaining: number };
}

interface Passkey {
  id: string;
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  backupEligible: boolean;
}

export default function SecurityPage() {
  const { refreshAuth } = useAuth();
  const [mfaStatus, setMfaStatus] = useState<MFAStatus | null>(null);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // TOTP setup dialog
  const [totpDialogOpen, setTotpDialogOpen] = useState(false);
  const [totpSetup, setTotpSetup] = useState<{ qrCode: string; secret: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpLoading, setTotpLoading] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  // Passkey setup dialog
  const [passkeyDialogOpen, setPasskeyDialogOpen] = useState(false);
  const [passkeyName, setPasskeyName] = useState('');
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  // Backup codes dialog
  const [backupCodesDialogOpen, setBackupCodesDialogOpen] = useState(false);
  const [newBackupCodes, setNewBackupCodes] = useState<string[] | null>(null);

  const fetchMFAStatus = async () => {
    try {
      const [statusRes, passkeysRes] = await Promise.all([
        api.get('/mfa/status'),
        api.get('/mfa/passkeys'),
      ]);
      setMfaStatus(statusRes.data);
      setPasskeys(passkeysRes.data.passkeys);
    } catch (err) {
      setError('Failed to load MFA status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMFAStatus();
  }, []);

  // TOTP Setup
  const handleStartTOTPSetup = async () => {
    setTotpLoading(true);
    try {
      const res = await api.post('/mfa/totp/setup');
      setTotpSetup({ qrCode: res.data.qrCode, secret: res.data.secret });
      setTotpDialogOpen(true);
    } catch (err) {
      setError('Failed to start TOTP setup');
    } finally {
      setTotpLoading(false);
    }
  };

  const handleVerifyTOTP = async () => {
    setTotpLoading(true);
    try {
      const res = await api.post('/mfa/totp/verify', { code: totpCode });
      setBackupCodes(res.data.backupCodes);
      setTotpDialogOpen(false);
      setTotpCode('');
      setTotpSetup(null);
      await fetchMFAStatus();
      await refreshAuth();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Invalid code');
    } finally {
      setTotpLoading(false);
    }
  };

  const handleDisableTOTP = async () => {
    if (!confirm('Are you sure you want to disable TOTP?')) return;
    try {
      await api.delete('/mfa/totp');
      await fetchMFAStatus();
      await refreshAuth();
    } catch (err) {
      setError('Failed to disable TOTP');
    }
  };

  // Passkey Setup
  const handleAddPasskey = async () => {
    setPasskeyLoading(true);
    try {
      // Get registration options
      const optionsRes = await api.post('/mfa/passkeys/register/options');
      const options = optionsRes.data;

      // Start WebAuthn registration
      const credential = await startRegistration({ optionsJSON: options });

      // Verify with server
      await api.post('/mfa/passkeys/register/verify', {
        response: credential,
        deviceName: passkeyName || 'Passkey',
      });

      setPasskeyDialogOpen(false);
      setPasskeyName('');
      await fetchMFAStatus();
      await refreshAuth();
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError('Passkey registration was cancelled');
      } else {
        setError(err.response?.data?.error?.message || 'Failed to add passkey');
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  const handleDeletePasskey = async (id: string) => {
    if (!confirm('Are you sure you want to delete this passkey?')) return;
    try {
      await api.delete(`/mfa/passkeys/${id}`);
      await fetchMFAStatus();
    } catch (err) {
      setError('Failed to delete passkey');
    }
  };

  // Backup Codes
  const handleGenerateBackupCodes = async () => {
    try {
      const res = await api.post('/mfa/backup-codes/generate');
      setNewBackupCodes(res.data.codes);
      setBackupCodesDialogOpen(true);
      await fetchMFAStatus();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to generate backup codes');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <SecurityIcon /> Security Settings
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {backupCodes && (
        <Alert severity="success" sx={{ mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom>
            TOTP enabled! Save these backup codes securely:
          </Typography>
          <Box sx={{ fontFamily: 'monospace', mt: 1, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1 }}>
            {backupCodes.map((code, i) => (
              <Typography key={i}>{code}</Typography>
            ))}
          </Box>
          <Button size="small" onClick={() => copyToClipboard(backupCodes.join('\n'))} sx={{ mt: 1 }}>
            Copy All
          </Button>
        </Alert>
      )}

      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h6">Two-Factor Authentication</Typography>
          <Chip
            label={mfaStatus?.mfaEnabled ? 'Enabled' : 'Disabled'}
            color={mfaStatus?.mfaEnabled ? 'success' : 'default'}
          />
        </Box>
        <Typography color="text.secondary" paragraph>
          Add an extra layer of security to your account by requiring a second form of authentication.
        </Typography>

        {/* TOTP Card */}
        <Card sx={{ mb: 2, bgcolor: 'background.default' }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <SmartphoneIcon />
              <Typography variant="subtitle1">Authenticator App</Typography>
              {mfaStatus?.totp.enabled && <Chip label="Active" size="small" color="success" />}
            </Box>
            <Typography variant="body2" color="text.secondary">
              Use an authenticator app like Google Authenticator, Authy, or 1Password to generate codes.
            </Typography>
          </CardContent>
          <CardActions>
            {mfaStatus?.totp.enabled ? (
              <Button color="error" onClick={handleDisableTOTP}>
                Disable
              </Button>
            ) : (
              <Button onClick={handleStartTOTPSetup} disabled={totpLoading}>
                {totpLoading ? <CircularProgress size={20} /> : 'Set Up'}
              </Button>
            )}
          </CardActions>
        </Card>

        {/* Passkeys Card */}
        <Card sx={{ mb: 2, bgcolor: 'background.default' }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <KeyIcon />
              <Typography variant="subtitle1">Passkeys</Typography>
              {mfaStatus?.passkeys.enabled && (
                <Chip label={`${mfaStatus.passkeys.count} registered`} size="small" color="success" />
              )}
            </Box>
            <Typography variant="body2" color="text.secondary" paragraph>
              Use biometrics (Touch ID, Face ID) or security keys for passwordless authentication.
            </Typography>

            {passkeys.length > 0 && (
              <List dense>
                {passkeys.map((passkey) => (
                  <ListItem key={passkey.id}>
                    <ListItemText
                      primary={passkey.deviceName || 'Passkey'}
                      secondary={`Added ${new Date(passkey.createdAt).toLocaleDateString()}`}
                    />
                    <ListItemSecondaryAction>
                      <IconButton edge="end" onClick={() => handleDeletePasskey(passkey.id)}>
                        <DeleteIcon />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            )}
          </CardContent>
          <CardActions>
            <Button onClick={() => setPasskeyDialogOpen(true)}>Add Passkey</Button>
          </CardActions>
        </Card>

        {/* Backup Codes Card */}
        <Card sx={{ bgcolor: 'background.default' }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <RefreshIcon />
              <Typography variant="subtitle1">Backup Codes</Typography>
              {(mfaStatus?.backupCodes.remaining ?? 0) > 0 && (
                <Chip label={`${mfaStatus?.backupCodes.remaining} remaining`} size="small" color="info" />
              )}
            </Box>
            <Typography variant="body2" color="text.secondary">
              One-time use codes for account recovery if you lose access to your other 2FA methods.
            </Typography>
          </CardContent>
          <CardActions>
            <Button
              onClick={handleGenerateBackupCodes}
              disabled={!mfaStatus?.mfaEnabled}
            >
              {(mfaStatus?.backupCodes.remaining ?? 0) > 0 ? 'Regenerate' : 'Generate'} Codes
            </Button>
          </CardActions>
        </Card>
      </Paper>

      {/* TOTP Setup Dialog */}
      <Dialog open={totpDialogOpen} onClose={() => setTotpDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Set Up Authenticator App</DialogTitle>
        <DialogContent>
          {totpSetup && (
            <>
              <Typography paragraph>
                Scan this QR code with your authenticator app:
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
                <img src={totpSetup.qrCode} alt="QR Code" style={{ maxWidth: 256 }} />
              </Box>
              <Typography variant="body2" color="text.secondary" paragraph>
                Or enter this code manually: <code>{totpSetup.secret}</code>
                <IconButton size="small" onClick={() => copyToClipboard(totpSetup.secret)}>
                  <CopyIcon fontSize="small" />
                </IconButton>
              </Typography>
              <Divider sx={{ my: 2 }} />
              <Typography paragraph>
                Enter the 6-digit code from your app to verify:
              </Typography>
              <TextField
                fullWidth
                label="Verification Code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                inputProps={{ maxLength: 6, pattern: '[0-9]*' }}
                autoFocus
              />
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTotpDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleVerifyTOTP}
            variant="contained"
            disabled={totpCode.length !== 6 || totpLoading}
          >
            {totpLoading ? <CircularProgress size={20} /> : 'Verify & Enable'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Passkey Setup Dialog */}
      <Dialog open={passkeyDialogOpen} onClose={() => setPasskeyDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Passkey</DialogTitle>
        <DialogContent>
          <Typography paragraph>
            Your browser will prompt you to set up a passkey using biometrics or a security key.
          </Typography>
          <TextField
            fullWidth
            label="Passkey Name (optional)"
            value={passkeyName}
            onChange={(e) => setPasskeyName(e.target.value)}
            placeholder="e.g., MacBook Pro"
            helperText="Give this passkey a name to identify it later"
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPasskeyDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleAddPasskey} variant="contained" disabled={passkeyLoading}>
            {passkeyLoading ? <CircularProgress size={20} /> : 'Add Passkey'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Backup Codes Dialog */}
      <Dialog open={backupCodesDialogOpen} onClose={() => setBackupCodesDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Backup Codes</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Save these codes in a secure location. Each code can only be used once.
          </Alert>
          {newBackupCodes && (
            <Box sx={{ fontFamily: 'monospace', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1 }}>
              {newBackupCodes.map((code, i) => (
                <Typography key={i} sx={{ p: 1, bgcolor: 'background.default', borderRadius: 1 }}>
                  {code}
                </Typography>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => copyToClipboard(newBackupCodes?.join('\n') || '')}>
            <CopyIcon sx={{ mr: 1 }} /> Copy All
          </Button>
          <Button onClick={() => setBackupCodesDialogOpen(false)} variant="contained">
            Done
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
