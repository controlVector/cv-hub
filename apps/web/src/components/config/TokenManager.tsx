import { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  ContentCopy as CopyIcon,
  VpnKey as KeyIcon,
} from '@mui/icons-material';
import { colors } from '../../theme';

// Simple time ago formatter (fallback for date-fns)
function formatDistanceToNow(date: Date, _options?: { addSuffix?: boolean }): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} months ago`;
}

interface ConfigToken {
  id: string;
  name: string;
  description?: string;
  tokenPrefix: string;
  permission: 'read' | 'write' | 'admin';
  isActive: boolean;
  expiresAt?: Date;
  lastUsedAt?: Date;
  usageCount: number;
  createdAt: Date;
}

interface TokenManagerProps {
  configSetId: string;
  tokens: ConfigToken[];
  onCreateToken: (token: {
    name: string;
    description?: string;
    permission: 'read' | 'write' | 'admin';
    expiresAt?: Date;
  }) => Promise<{ token: ConfigToken; plainToken: string }>;
  onRevokeToken: (tokenId: string) => Promise<void>;
  loading?: boolean;
}

export default function TokenManager({
  configSetId: _configSetId, // Used for future API calls
  tokens,
  onCreateToken,
  onRevokeToken,
  loading = false,
}: TokenManagerProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTokenResult, setNewTokenResult] = useState<{ token: ConfigToken; plainToken: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permission, setPermission] = useState<'read' | 'write' | 'admin'>('read');
  const [expiresIn, setExpiresIn] = useState<string>('never');

  const handleCreateToken = async () => {
    setCreating(true);
    setError(null);

    try {
      let expiresAt: Date | undefined;
      if (expiresIn !== 'never') {
        expiresAt = new Date();
        switch (expiresIn) {
          case '7d': expiresAt.setDate(expiresAt.getDate() + 7); break;
          case '30d': expiresAt.setDate(expiresAt.getDate() + 30); break;
          case '90d': expiresAt.setDate(expiresAt.getDate() + 90); break;
          case '1y': expiresAt.setFullYear(expiresAt.getFullYear() + 1); break;
        }
      }

      const result = await onCreateToken({
        name,
        description: description || undefined,
        permission,
        expiresAt,
      });

      setNewTokenResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create token');
    } finally {
      setCreating(false);
    }
  };

  const handleRevokeToken = async (tokenId: string) => {
    if (!confirm('Are you sure you want to revoke this token? This cannot be undone.')) {
      return;
    }

    setRevoking(tokenId);
    try {
      await onRevokeToken(tokenId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke token');
    } finally {
      setRevoking(null);
    }
  };

  const handleCopyToken = () => {
    if (newTokenResult?.plainToken) {
      navigator.clipboard.writeText(newTokenResult.plainToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCloseDialog = () => {
    setCreateDialogOpen(false);
    setNewTokenResult(null);
    setName('');
    setDescription('');
    setPermission('read');
    setExpiresIn('never');
    setError(null);
  };

  const getPermissionColor = (perm: string) => {
    switch (perm) {
      case 'admin': return colors.rose;
      case 'write': return colors.amber;
      case 'read': return colors.green;
      default: return colors.textMuted;
    }
  };

  const isExpired = (expiresAt?: Date) => expiresAt && new Date(expiresAt) < new Date();

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={600}>
          Access Tokens
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateDialogOpen(true)}
          size="small"
        >
          Create Token
        </Button>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Access tokens allow CI/CD pipelines and other services to read configuration values.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper} sx={{ bgcolor: colors.slateLight }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Token</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Permission</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Expires</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Last Used</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 80 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            ) : tokens.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                  <KeyIcon sx={{ fontSize: 48, color: colors.textMuted, mb: 1 }} />
                  <Typography color="text.secondary">
                    No access tokens yet
                  </Typography>
                  <Button
                    startIcon={<AddIcon />}
                    onClick={() => setCreateDialogOpen(true)}
                    sx={{ mt: 2 }}
                  >
                    Create your first token
                  </Button>
                </TableCell>
              </TableRow>
            ) : (
              tokens.map((token) => (
                <TableRow
                  key={token.id}
                  sx={{ opacity: !token.isActive || isExpired(token.expiresAt) ? 0.5 : 1 }}
                >
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography fontWeight={500}>{token.name}</Typography>
                      {!token.isActive && (
                        <Chip label="Revoked" size="small" color="error" sx={{ height: 18 }} />
                      )}
                      {isExpired(token.expiresAt) && (
                        <Chip label="Expired" size="small" color="warning" sx={{ height: 18 }} />
                      )}
                    </Box>
                    {token.description && (
                      <Typography variant="caption" color="text.secondary">
                        {token.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography fontFamily="monospace" color="text.secondary">
                      {token.tokenPrefix}••••••••
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={token.permission}
                      size="small"
                      sx={{
                        bgcolor: `${getPermissionColor(token.permission)}20`,
                        color: getPermissionColor(token.permission),
                        textTransform: 'capitalize',
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    {token.expiresAt ? (
                      <Typography
                        variant="body2"
                        color={isExpired(token.expiresAt) ? 'error' : 'text.secondary'}
                      >
                        {formatDistanceToNow(new Date(token.expiresAt), { addSuffix: true })}
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        Never
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {token.lastUsedAt
                        ? formatDistanceToNow(new Date(token.lastUsedAt), { addSuffix: true })
                        : 'Never'}
                    </Typography>
                    {token.usageCount > 0 && (
                      <Typography variant="caption" color="text.secondary">
                        ({token.usageCount} uses)
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Tooltip title="Revoke Token">
                      <IconButton
                        size="small"
                        onClick={() => handleRevokeToken(token.id)}
                        disabled={!token.isActive || revoking === token.id}
                        sx={{ color: colors.rose }}
                      >
                        {revoking === token.id ? (
                          <CircularProgress size={16} />
                        ) : (
                          <DeleteIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Create Token Dialog */}
      <Dialog open={createDialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {newTokenResult ? 'Token Created' : 'Create Access Token'}
        </DialogTitle>
        <DialogContent>
          {newTokenResult ? (
            <Box sx={{ mt: 1 }}>
              <Alert severity="warning" sx={{ mb: 3 }}>
                <strong>Copy your token now!</strong> You won't be able to see it again.
              </Alert>

              <Typography variant="subtitle2" gutterBottom>
                Your new access token:
              </Typography>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  p: 2,
                  bgcolor: colors.slateLighter,
                  borderRadius: 1,
                  mb: 2,
                }}
              >
                <Typography
                  fontFamily="monospace"
                  sx={{ flex: 1, wordBreak: 'break-all' }}
                >
                  {newTokenResult.plainToken}
                </Typography>
                <Tooltip title={copied ? 'Copied!' : 'Copy'}>
                  <IconButton onClick={handleCopyToken} color={copied ? 'success' : 'default'}>
                    <CopyIcon />
                  </IconButton>
                </Tooltip>
              </Box>

              <Typography variant="body2" color="text.secondary">
                Use this token in your CI/CD pipeline or API requests:
              </Typography>
              <Box
                component="pre"
                sx={{
                  bgcolor: colors.slateLighter,
                  p: 2,
                  borderRadius: 1,
                  fontSize: '0.85rem',
                  overflow: 'auto',
                }}
              >
                {`curl -H "Authorization: Bearer ${newTokenResult.plainToken}" \\
  /api/v1/config/inject`}
              </Box>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              <TextField
                label="Token Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                fullWidth
                required
                placeholder="e.g., GitHub Actions"
              />
              <TextField
                label="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                fullWidth
                placeholder="What is this token used for?"
              />
              <FormControl fullWidth>
                <InputLabel>Permission</InputLabel>
                <Select
                  value={permission}
                  label="Permission"
                  onChange={(e) => setPermission(e.target.value as typeof permission)}
                >
                  <MenuItem value="read">Read - Can read configuration values</MenuItem>
                  <MenuItem value="write">Write - Can read and update values</MenuItem>
                  <MenuItem value="admin">Admin - Full access including tokens</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel>Expires</InputLabel>
                <Select
                  value={expiresIn}
                  label="Expires"
                  onChange={(e) => setExpiresIn(e.target.value)}
                >
                  <MenuItem value="7d">In 7 days</MenuItem>
                  <MenuItem value="30d">In 30 days</MenuItem>
                  <MenuItem value="90d">In 90 days</MenuItem>
                  <MenuItem value="1y">In 1 year</MenuItem>
                  <MenuItem value="never">Never</MenuItem>
                </Select>
              </FormControl>

              {error && (
                <Alert severity="error" onClose={() => setError(null)}>
                  {error}
                </Alert>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>
            {newTokenResult ? 'Done' : 'Cancel'}
          </Button>
          {!newTokenResult && (
            <Button
              variant="contained"
              onClick={handleCreateToken}
              disabled={!name || creating}
              startIcon={creating ? <CircularProgress size={16} /> : <KeyIcon />}
            >
              {creating ? 'Creating...' : 'Create Token'}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}
