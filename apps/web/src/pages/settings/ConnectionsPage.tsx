import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  Alert,
  CircularProgress,
  Avatar,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
} from '@mui/material';
import {
  Link as LinkIcon,
  GitHub as GitHubIcon,
  Check as CheckIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { api } from '../../lib/api';

interface GitHubConnection {
  id: string;
  provider: 'github';
  providerUsername: string | null;
  email: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
  scopes: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface GitHubStatus {
  configured: boolean;
  connected: boolean;
  connection?: GitHubConnection;
}

interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  private: boolean;
  htmlUrl: string;
  stars: number;
  language: string | null;
  updatedAt: string;
}

export default function ConnectionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [githubStatus, setGithubStatus] = useState<GitHubStatus | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [reposLoading, setReposLoading] = useState(false);
  const [connectLoading, setConnectLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Check for success/error from OAuth callback
  useEffect(() => {
    const successParam = searchParams.get('success');
    const errorParam = searchParams.get('error');

    if (successParam === 'github') {
      setSuccess('GitHub connected successfully!');
      setSearchParams({});
    } else if (errorParam) {
      const errorMessages: Record<string, string> = {
        invalid_state: 'OAuth session expired. Please try again.',
        oauth_failed: 'GitHub authorization failed. Please try again.',
      };
      setError(errorMessages[errorParam] || 'Connection failed. Please try again.');
      setSearchParams({});
    }
  }, [searchParams, setSearchParams]);

  const fetchGitHubStatus = async () => {
    try {
      const res = await api.get('/github/status');
      setGithubStatus(res.data);

      // If connected, fetch repos
      if (res.data.connected) {
        fetchRepos();
      }
    } catch (err) {
      console.error('Failed to fetch GitHub status:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRepos = async () => {
    setReposLoading(true);
    try {
      const res = await api.get('/github/repos', {
        params: { per_page: 10, type: 'owner' },
      });
      setRepos(res.data.repos);
    } catch (err) {
      console.error('Failed to fetch repos:', err);
    } finally {
      setReposLoading(false);
    }
  };

  useEffect(() => {
    fetchGitHubStatus();
  }, []);

  const handleConnectGitHub = async () => {
    setConnectLoading(true);
    setError(null);
    try {
      const res = await api.get('/github/connect');
      // Redirect to GitHub OAuth
      window.location.href = res.data.authUrl;
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to start GitHub connection');
      setConnectLoading(false);
    }
  };

  const handleDisconnectGitHub = async () => {
    if (!confirm('Are you sure you want to disconnect GitHub?')) return;
    try {
      await api.delete('/github/disconnect');
      setGithubStatus({ configured: true, connected: false });
      setRepos([]);
      setSuccess('GitHub disconnected');
    } catch (err) {
      setError('Failed to disconnect GitHub');
    }
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
        <LinkIcon /> Connected Accounts
      </Typography>

      <Typography color="text.secondary" paragraph>
        Connect external services to import repositories and sync data.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)} icon={<ErrorIcon />}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess(null)} icon={<CheckIcon />}>
          {success}
        </Alert>
      )}

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Git Providers
        </Typography>

        {/* GitHub Connection Card */}
        <Card sx={{ bgcolor: 'background.default' }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Avatar sx={{ bgcolor: '#24292e', width: 48, height: 48 }}>
                <GitHubIcon />
              </Avatar>
              <Box sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="h6">GitHub</Typography>
                  {githubStatus?.connected ? (
                    <Chip label="Connected" size="small" color="success" />
                  ) : githubStatus?.configured ? (
                    <Chip label="Not Connected" size="small" color="default" />
                  ) : (
                    <Chip label="Not Configured" size="small" color="warning" />
                  )}
                </Box>

                {githubStatus?.connected && githubStatus.connection ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                    {githubStatus.connection.avatarUrl && (
                      <Avatar
                        src={githubStatus.connection.avatarUrl}
                        sx={{ width: 20, height: 20 }}
                      />
                    )}
                    <Typography variant="body2" color="text.secondary">
                      Connected as{' '}
                      <strong>@{githubStatus.connection.providerUsername}</strong>
                    </Typography>
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Connect your GitHub account to import and sync repositories.
                  </Typography>
                )}
              </Box>
            </Box>
          </CardContent>

          <CardActions sx={{ px: 2, pb: 2 }}>
            {githubStatus?.connected ? (
              <>
                <Button
                  variant="outlined"
                  onClick={fetchRepos}
                  disabled={reposLoading}
                >
                  {reposLoading ? <CircularProgress size={20} /> : 'Refresh Repos'}
                </Button>
                <Button color="error" onClick={handleDisconnectGitHub}>
                  Disconnect
                </Button>
              </>
            ) : githubStatus?.configured ? (
              <Button
                variant="contained"
                startIcon={<GitHubIcon />}
                onClick={handleConnectGitHub}
                disabled={connectLoading}
              >
                {connectLoading ? <CircularProgress size={20} /> : 'Connect GitHub'}
              </Button>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Contact administrator to enable GitHub integration.
              </Typography>
            )}
          </CardActions>
        </Card>
      </Paper>

      {/* GitHub Repositories */}
      {githubStatus?.connected && repos.length > 0 && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Your GitHub Repositories
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            These repositories can be imported to AI Control Fabric.
          </Typography>

          <List>
            {repos.map((repo) => (
              <ListItem
                key={repo.id}
                sx={{
                  bgcolor: 'background.default',
                  borderRadius: 1,
                  mb: 1,
                }}
                secondaryAction={
                  <Button
                    size="small"
                    variant="outlined"
                    href={repo.htmlUrl}
                    target="_blank"
                  >
                    View
                  </Button>
                }
              >
                <ListItemAvatar>
                  <Avatar sx={{ bgcolor: repo.private ? 'warning.main' : 'primary.main' }}>
                    <GitHubIcon />
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {repo.fullName}
                      {repo.private && (
                        <Chip label="Private" size="small" variant="outlined" />
                      )}
                    </Box>
                  }
                  secondary={
                    <>
                      {repo.description && (
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {repo.description}
                        </Typography>
                      )}
                      <Typography variant="caption" color="text.secondary">
                        {repo.language && `${repo.language} • `}
                        {repo.stars} stars • Updated{' '}
                        {new Date(repo.updatedAt).toLocaleDateString()}
                      </Typography>
                    </>
                  }
                />
              </ListItem>
            ))}
          </List>
        </Paper>
      )}
    </Container>
  );
}
