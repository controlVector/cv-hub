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
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Divider,
  Tabs,
  Tab,
  InputAdornment,
  Tooltip,
} from '@mui/material';
import {
  Code as CodeIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  ContentCopy as CopyIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Refresh as RefreshIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import { api } from '../../lib/api';

interface OAuthClient {
  id: string;
  clientId: string;
  name: string;
  description?: string;
  logoUrl?: string;
  websiteUrl?: string;
  redirectUris: string[];
  allowedScopes: string[];
  isConfidential: boolean;
  requirePkce: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AuthorizedApp {
  id: string;
  clientId: string;
  clientName: string;
  clientDescription?: string;
  clientLogoUrl?: string;
  clientWebsiteUrl?: string;
  scopes: string[];
  grantedAt: string;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div hidden={value !== index} {...other}>
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
}

export default function DeveloperPage() {
  const [tabValue, setTabValue] = useState(0);
  const [clients, setClients] = useState<OAuthClient[]>([]);
  const [authorizedApps, setAuthorizedApps] = useState<AuthorizedApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create client dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newClient, setNewClient] = useState({
    name: '',
    description: '',
    websiteUrl: '',
    redirectUris: [''],
    isConfidential: true,
  });
  const [createdClient, setCreatedClient] = useState<{ clientId: string; clientSecret?: string } | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  // Edit client dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<OAuthClient | null>(null);
  const [updating, setUpdating] = useState(false);

  const fetchClients = async () => {
    try {
      const res = await api.get('/oauth/clients');
      setClients(res.data.clients);
    } catch (err) {
      setError('Failed to load OAuth applications');
    }
  };

  const fetchAuthorizedApps = async () => {
    try {
      const res = await api.get('/oauth/clients/authorizations');
      setAuthorizedApps(res.data.authorizations);
    } catch (err) {
      // Ignore errors for authorized apps
    }
  };

  useEffect(() => {
    Promise.all([fetchClients(), fetchAuthorizedApps()]).finally(() => setLoading(false));
  }, []);

  const handleCreateClient = async () => {
    setCreating(true);
    setError(null);

    try {
      const res = await api.post('/oauth/clients', {
        name: newClient.name,
        description: newClient.description || undefined,
        websiteUrl: newClient.websiteUrl || undefined,
        redirectUris: newClient.redirectUris.filter(Boolean),
        isConfidential: newClient.isConfidential,
      });

      setCreatedClient({
        clientId: res.data.client.clientId,
        clientSecret: res.data.client.clientSecret,
      });
      await fetchClients();
      setNewClient({
        name: '',
        description: '',
        websiteUrl: '',
        redirectUris: [''],
        isConfidential: true,
      });
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to create application');
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateClient = async () => {
    if (!editingClient) return;
    setUpdating(true);
    setError(null);

    try {
      await api.patch(`/oauth/clients/${editingClient.clientId}`, {
        name: editingClient.name,
        description: editingClient.description || null,
        websiteUrl: editingClient.websiteUrl || null,
        redirectUris: editingClient.redirectUris.filter(Boolean),
        isActive: editingClient.isActive,
      });
      await fetchClients();
      setEditDialogOpen(false);
      setEditingClient(null);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to update application');
    } finally {
      setUpdating(false);
    }
  };

  const handleDeleteClient = async (clientId: string) => {
    if (!confirm('Are you sure you want to delete this application? This cannot be undone.')) {
      return;
    }

    try {
      await api.delete(`/oauth/clients/${clientId}`);
      await fetchClients();
    } catch (err) {
      setError('Failed to delete application');
    }
  };

  const handleRotateSecret = async (clientId: string) => {
    if (!confirm('Are you sure you want to rotate the client secret? The old secret will stop working immediately.')) {
      return;
    }

    try {
      const res = await api.post(`/oauth/clients/${clientId}/rotate-secret`);
      setCreatedClient({
        clientId,
        clientSecret: res.data.clientSecret,
      });
      setCreateDialogOpen(true);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to rotate secret');
    }
  };

  const handleRevokeAuthorization = async (clientId: string) => {
    if (!confirm('Revoke access for this application?')) return;

    try {
      await api.delete(`/oauth/clients/authorizations/${clientId}`);
      await fetchAuthorizedApps();
    } catch (err) {
      setError('Failed to revoke authorization');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const addRedirectUri = () => {
    setNewClient({
      ...newClient,
      redirectUris: [...newClient.redirectUris, ''],
    });
  };

  const removeRedirectUri = (index: number) => {
    setNewClient({
      ...newClient,
      redirectUris: newClient.redirectUris.filter((_, i) => i !== index),
    });
  };

  const updateRedirectUri = (index: number, value: string) => {
    const uris = [...newClient.redirectUris];
    uris[index] = value;
    setNewClient({ ...newClient, redirectUris: uris });
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <CodeIcon /> Developer Settings
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper sx={{ mt: 3 }}>
        <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)}>
          <Tab label="OAuth Applications" />
          <Tab label="Authorized Apps" />
        </Tabs>

        <Box sx={{ p: 3 }}>
          {/* OAuth Applications Tab */}
          <TabPanel value={tabValue} index={0}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Typography variant="h6">Your OAuth Applications</Typography>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => {
                  setCreatedClient(null);
                  setCreateDialogOpen(true);
                }}
              >
                Create Application
              </Button>
            </Box>

            {clients.length === 0 ? (
              <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
                <Typography color="text.secondary">
                  You haven't created any OAuth applications yet.
                </Typography>
                <Button
                  sx={{ mt: 2 }}
                  startIcon={<AddIcon />}
                  onClick={() => setCreateDialogOpen(true)}
                >
                  Create Your First App
                </Button>
              </Paper>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {clients.map((client) => (
                  <Card key={client.id} variant="outlined">
                    <CardContent>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                            <Typography variant="h6">{client.name}</Typography>
                            <Chip
                              label={client.isActive ? 'Active' : 'Inactive'}
                              size="small"
                              color={client.isActive ? 'success' : 'default'}
                            />
                            <Chip
                              label={client.isConfidential ? 'Confidential' : 'Public'}
                              size="small"
                              variant="outlined"
                            />
                          </Box>
                          {client.description && (
                            <Typography variant="body2" color="text.secondary" paragraph>
                              {client.description}
                            </Typography>
                          )}
                        </Box>
                        <Box>
                          <Tooltip title="Edit">
                            <IconButton
                              onClick={() => {
                                setEditingClient(client);
                                setEditDialogOpen(true);
                              }}
                            >
                              <EditIcon />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete">
                            <IconButton color="error" onClick={() => handleDeleteClient(client.clientId)}>
                              <DeleteIcon />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </Box>

                      <Divider sx={{ my: 2 }} />

                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Client ID
                          </Typography>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                              {client.clientId}
                            </Typography>
                            <IconButton size="small" onClick={() => copyToClipboard(client.clientId)}>
                              <CopyIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        </Box>

                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Redirect URIs
                          </Typography>
                          {client.redirectUris.map((uri, i) => (
                            <Typography key={i} variant="body2" sx={{ fontFamily: 'monospace' }}>
                              {uri}
                            </Typography>
                          ))}
                        </Box>
                      </Box>
                    </CardContent>
                    {client.isConfidential && (
                      <CardActions>
                        <Button
                          size="small"
                          startIcon={<RefreshIcon />}
                          onClick={() => handleRotateSecret(client.clientId)}
                        >
                          Rotate Secret
                        </Button>
                      </CardActions>
                    )}
                  </Card>
                ))}
              </Box>
            )}
          </TabPanel>

          {/* Authorized Apps Tab */}
          <TabPanel value={tabValue} index={1}>
            <Typography variant="h6" gutterBottom>
              Applications You've Authorized
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              These applications have access to your account. You can revoke access at any time.
            </Typography>

            {authorizedApps.length === 0 ? (
              <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
                <Typography color="text.secondary">
                  You haven't authorized any applications yet.
                </Typography>
              </Paper>
            ) : (
              <List>
                {authorizedApps.map((app) => (
                  <ListItem key={app.id} divider>
                    <ListItemText
                      primary={app.clientName}
                      secondary={
                        <>
                          {app.clientDescription && (
                            <Typography variant="body2" component="span" display="block">
                              {app.clientDescription}
                            </Typography>
                          )}
                          <Typography variant="caption" color="text.secondary">
                            Authorized {new Date(app.grantedAt).toLocaleDateString()} &bull;{' '}
                            Scopes: {app.scopes.join(', ')}
                          </Typography>
                        </>
                      }
                    />
                    <ListItemSecondaryAction>
                      <Button
                        color="error"
                        onClick={() => handleRevokeAuthorization(app.clientId)}
                      >
                        Revoke
                      </Button>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            )}
          </TabPanel>
        </Box>
      </Paper>

      {/* Create/Show Secret Dialog */}
      <Dialog open={createDialogOpen} onClose={() => !createdClient && setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{createdClient ? 'Application Credentials' : 'Create OAuth Application'}</DialogTitle>
        <DialogContent>
          {createdClient ? (
            <>
              <Alert severity="warning" sx={{ mb: 2 }}>
                Save your client secret now - it will not be shown again!
              </Alert>
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  Client ID
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TextField
                    fullWidth
                    value={createdClient.clientId}
                    InputProps={{ readOnly: true }}
                    size="small"
                  />
                  <IconButton onClick={() => copyToClipboard(createdClient.clientId)}>
                    <CopyIcon />
                  </IconButton>
                </Box>
              </Box>
              {createdClient.clientSecret && (
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Client Secret
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <TextField
                      fullWidth
                      type={showSecret ? 'text' : 'password'}
                      value={createdClient.clientSecret}
                      InputProps={{
                        readOnly: true,
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton onClick={() => setShowSecret(!showSecret)}>
                              {showSecret ? <VisibilityOffIcon /> : <VisibilityIcon />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                      size="small"
                    />
                    <IconButton onClick={() => copyToClipboard(createdClient.clientSecret!)}>
                      <CopyIcon />
                    </IconButton>
                  </Box>
                </Box>
              )}
            </>
          ) : (
            <>
              <TextField
                fullWidth
                label="Application Name"
                value={newClient.name}
                onChange={(e) => setNewClient({ ...newClient, name: e.target.value })}
                margin="normal"
                required
              />
              <TextField
                fullWidth
                label="Description"
                value={newClient.description}
                onChange={(e) => setNewClient({ ...newClient, description: e.target.value })}
                margin="normal"
                multiline
                rows={2}
              />
              <TextField
                fullWidth
                label="Website URL"
                value={newClient.websiteUrl}
                onChange={(e) => setNewClient({ ...newClient, websiteUrl: e.target.value })}
                margin="normal"
                type="url"
              />

              <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
                Redirect URIs *
              </Typography>
              {newClient.redirectUris.map((uri, index) => (
                <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                  <TextField
                    fullWidth
                    value={uri}
                    onChange={(e) => updateRedirectUri(index, e.target.value)}
                    placeholder="https://example.com/callback"
                    size="small"
                  />
                  {newClient.redirectUris.length > 1 && (
                    <IconButton onClick={() => removeRedirectUri(index)}>
                      <DeleteIcon />
                    </IconButton>
                  )}
                </Box>
              ))}
              <Button size="small" onClick={addRedirectUri} startIcon={<AddIcon />}>
                Add Redirect URI
              </Button>
            </>
          )}
        </DialogContent>
        <DialogActions>
          {createdClient ? (
            <Button
              onClick={() => {
                setCreateDialogOpen(false);
                setCreatedClient(null);
                setShowSecret(false);
              }}
              variant="contained"
            >
              Done
            </Button>
          ) : (
            <>
              <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={handleCreateClient}
                variant="contained"
                disabled={creating || !newClient.name || !newClient.redirectUris.some(Boolean)}
              >
                {creating ? <CircularProgress size={20} /> : 'Create'}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Application</DialogTitle>
        <DialogContent>
          {editingClient && (
            <>
              <TextField
                fullWidth
                label="Application Name"
                value={editingClient.name}
                onChange={(e) => setEditingClient({ ...editingClient, name: e.target.value })}
                margin="normal"
              />
              <TextField
                fullWidth
                label="Description"
                value={editingClient.description || ''}
                onChange={(e) => setEditingClient({ ...editingClient, description: e.target.value })}
                margin="normal"
                multiline
                rows={2}
              />
              <TextField
                fullWidth
                label="Website URL"
                value={editingClient.websiteUrl || ''}
                onChange={(e) => setEditingClient({ ...editingClient, websiteUrl: e.target.value })}
                margin="normal"
              />

              <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
                Redirect URIs
              </Typography>
              {editingClient.redirectUris.map((uri, index) => (
                <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                  <TextField
                    fullWidth
                    value={uri}
                    onChange={(e) => {
                      const uris = [...editingClient.redirectUris];
                      uris[index] = e.target.value;
                      setEditingClient({ ...editingClient, redirectUris: uris });
                    }}
                    size="small"
                  />
                  {editingClient.redirectUris.length > 1 && (
                    <IconButton
                      onClick={() => {
                        setEditingClient({
                          ...editingClient,
                          redirectUris: editingClient.redirectUris.filter((_, i) => i !== index),
                        });
                      }}
                    >
                      <DeleteIcon />
                    </IconButton>
                  )}
                </Box>
              ))}
              <Button
                size="small"
                onClick={() => setEditingClient({
                  ...editingClient,
                  redirectUris: [...editingClient.redirectUris, ''],
                })}
                startIcon={<AddIcon />}
              >
                Add Redirect URI
              </Button>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleUpdateClient} variant="contained" disabled={updating}>
            {updating ? <CircularProgress size={20} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
