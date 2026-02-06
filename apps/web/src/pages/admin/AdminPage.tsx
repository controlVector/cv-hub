import { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Paper,
  Box,
  Tabs,
  Tab,
  CircularProgress,
  Alert,
  Chip,
  TextField,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  AdminPanelSettings as AdminIcon,
  BugReport as ErrataIcon,
  NewReleases as ReleasesIcon,
  PersonAdd as AddAdminIcon,
  PersonRemove as RemoveAdminIcon,
} from '@mui/icons-material';
import ReactMarkdown from 'react-markdown';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { colors } from '../../theme';

interface AdminUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  createdAt: string;
}

export default function AdminPage() {
  const { user } = useAuth();
  const [tabValue, setTabValue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Documents
  const [errataContent, setErrataContent] = useState<string>('');
  const [releasesContent, setReleasesContent] = useState<string>('');

  // Admin users
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [grantDialogOpen, setGrantDialogOpen] = useState(false);
  const [grantEmail, setGrantEmail] = useState('');
  const [grantLoading, setGrantLoading] = useState(false);

  useEffect(() => {
    checkAdminStatus();
  }, []);

  const checkAdminStatus = async () => {
    try {
      const res = await api.get('/admin/status');
      setIsAdmin(res.data.isAdmin);
      if (res.data.isAdmin) {
        await loadDocuments();
        await loadAdmins();
      }
    } catch (err) {
      setError('Failed to check admin status');
    } finally {
      setLoading(false);
    }
  };

  const loadDocuments = async () => {
    try {
      const [errataRes, releasesRes] = await Promise.all([
        api.get('/admin/docs/errata'),
        api.get('/admin/docs/releases'),
      ]);
      setErrataContent(errataRes.data.content);
      setReleasesContent(releasesRes.data.content);
    } catch (err) {
      setError('Failed to load documents');
    }
  };

  const loadAdmins = async () => {
    try {
      const res = await api.get('/admin/users');
      setAdmins(res.data.admins);
    } catch (err) {
      console.error('Failed to load admins:', err);
    }
  };

  const handleGrantAdmin = async () => {
    setGrantLoading(true);
    try {
      await api.post('/admin/grant', { email: grantEmail });
      setGrantDialogOpen(false);
      setGrantEmail('');
      await loadAdmins();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to grant admin access');
    } finally {
      setGrantLoading(false);
    }
  };

  const handleRevokeAdmin = async (email: string) => {
    if (!confirm(`Revoke admin access from ${email}?`)) return;
    try {
      await api.post('/admin/revoke', { email });
      await loadAdmins();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to revoke admin access');
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isAdmin) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Alert severity="error">
          You do not have admin access. Contact an administrator if you believe this is an error.
        </Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <AdminIcon sx={{ fontSize: 32, color: colors.violet }} />
        <Typography variant="h4">Admin Dashboard</Typography>
        <Chip label="Admin" color="secondary" size="small" />
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box sx={{ borderBottom: `1px solid ${colors.slateLighter}`, mb: 3 }}>
        <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)}>
          <Tab icon={<ErrataIcon />} iconPosition="start" label="Errata" />
          <Tab icon={<ReleasesIcon />} iconPosition="start" label="Release Notes" />
          <Tab icon={<AdminIcon />} iconPosition="start" label="Admin Users" />
        </Tabs>
      </Box>

      {tabValue === 0 && (
        <Paper sx={{ p: 3 }}>
          <Box
            sx={{
              '& h1': { fontSize: '1.75rem', fontWeight: 700, mb: 2, mt: 0 },
              '& h2': { fontSize: '1.5rem', fontWeight: 600, mb: 2, mt: 3, color: colors.violet },
              '& h3': { fontSize: '1.25rem', fontWeight: 600, mb: 1.5, mt: 2 },
              '& ul': { pl: 3 },
              '& li': { mb: 0.5 },
              '& code': {
                backgroundColor: colors.slate,
                px: 0.5,
                py: 0.25,
                borderRadius: 1,
                fontSize: '0.9em',
              },
              '& blockquote': {
                borderLeft: `3px solid ${colors.violet}`,
                pl: 2,
                ml: 0,
                color: colors.textMuted,
              },
              '& hr': { border: 'none', borderTop: `1px solid ${colors.slateLighter}`, my: 3 },
              '& input[type="checkbox"]': { mr: 1 },
            }}
          >
            <ReactMarkdown>{errataContent}</ReactMarkdown>
          </Box>
        </Paper>
      )}

      {tabValue === 1 && (
        <Paper sx={{ p: 3 }}>
          <Box
            sx={{
              '& h1': { fontSize: '1.75rem', fontWeight: 700, mb: 2, mt: 0 },
              '& h2': { fontSize: '1.5rem', fontWeight: 600, mb: 2, mt: 3, color: colors.cyan },
              '& h3': { fontSize: '1.25rem', fontWeight: 600, mb: 1.5, mt: 2 },
              '& ul': { pl: 3 },
              '& li': { mb: 0.5 },
              '& code': {
                backgroundColor: colors.slate,
                px: 0.5,
                py: 0.25,
                borderRadius: 1,
                fontSize: '0.9em',
              },
              '& pre': {
                backgroundColor: colors.slate,
                p: 2,
                borderRadius: 1,
                overflow: 'auto',
              },
              '& blockquote': {
                borderLeft: `3px solid ${colors.cyan}`,
                pl: 2,
                ml: 0,
                color: colors.textMuted,
              },
              '& hr': { border: 'none', borderTop: `1px solid ${colors.slateLighter}`, my: 3 },
            }}
          >
            <ReactMarkdown>{releasesContent}</ReactMarkdown>
          </Box>
        </Paper>
      )}

      {tabValue === 2 && (
        <Paper sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h6">Admin Users</Typography>
            <Button
              variant="contained"
              startIcon={<AddAdminIcon />}
              onClick={() => setGrantDialogOpen(true)}
            >
              Grant Admin Access
            </Button>
          </Box>

          <List>
            {admins.map((admin) => (
              <ListItem key={admin.id} divider>
                <ListItemText
                  primary={admin.displayName || admin.username}
                  secondary={
                    <>
                      @{admin.username} &bull; {admin.email}
                      {admin.id === user?.id && (
                        <Chip label="You" size="small" sx={{ ml: 1 }} />
                      )}
                    </>
                  }
                />
                <ListItemSecondaryAction>
                  {admin.id !== user?.id && (
                    <IconButton
                      edge="end"
                      color="error"
                      onClick={() => handleRevokeAdmin(admin.email)}
                    >
                      <RemoveAdminIcon />
                    </IconButton>
                  )}
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>

          {admins.length === 0 && (
            <Typography variant="body2" sx={{ color: colors.textMuted, textAlign: 'center', py: 4 }}>
              No admin users found
            </Typography>
          )}
        </Paper>
      )}

      {/* Grant Admin Dialog */}
      <Dialog open={grantDialogOpen} onClose={() => setGrantDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Grant Admin Access</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Enter the email address of the user to grant admin access to.
          </Typography>
          <TextField
            fullWidth
            label="Email Address"
            value={grantEmail}
            onChange={(e) => setGrantEmail(e.target.value)}
            placeholder="user@example.com"
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGrantDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleGrantAdmin}
            disabled={!grantEmail || grantLoading}
          >
            {grantLoading ? <CircularProgress size={20} /> : 'Grant Access'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
