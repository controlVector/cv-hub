import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  Skeleton,
  Alert,
  IconButton,
  Tooltip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import RefreshIcon from '@mui/icons-material/Refresh';
import ComputerIcon from '@mui/icons-material/Computer';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { api } from '../lib/api';
import { brand } from '../config/brand';
import { useState } from 'react';

interface Executor {
  id: string;
  name: string;
  machine_name: string | null;
  type: string;
  status: 'online' | 'offline' | 'busy' | 'error';
  repos: string[] | null;
  workspace_root: string | null;
  organization_id: string | null;
  repository_id: string | null;
  last_heartbeat_at: string | null;
  last_task_at: string | null;
  created_at: string;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'never';
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'online': return '#10b981';
    case 'busy': return '#f59e0b';
    case 'offline': return '#64748b';
    case 'error': return '#f43f5e';
    default: return '#64748b';
  }
}

const setupCommand = 'npm install -g @controlVector/cv-git && cv auth login && cd your-project && cv init -y && claude';

export default function ExecutorsPage() {
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  // Rename dialog state
  const [renameTarget, setRenameTarget] = useState<Executor | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renaming, setRenaming] = useState(false);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<Executor | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery<{ executors: Executor[] }>({
    queryKey: ['executors'],
    queryFn: async () => {
      const response = await api.get('/v1/executors');
      return response.data;
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const executors = data?.executors || [];
  const online = executors.filter((e) => e.status === 'online');
  const offline = executors.filter((e) => e.status !== 'online');

  const handleCopy = () => {
    navigator.clipboard.writeText(setupCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRename = async () => {
    if (!renameTarget || !renameName.trim()) return;
    setRenaming(true);
    setActionError(null);
    try {
      await api.patch(`/v1/executors/${renameTarget.id}`, {
        name: renameName.trim(),
        machine_name: renameName.trim(),
      });
      setRenameTarget(null);
      queryClient.invalidateQueries({ queryKey: ['executors'] });
    } catch (err: any) {
      setActionError(err.response?.data?.error?.message || 'Failed to rename executor');
    } finally {
      setRenaming(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setActionError(null);
    try {
      await api.delete(`/v1/executors/${deleteTarget.id}`);
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['executors'] });
    } catch (err: any) {
      setActionError(err.response?.data?.error?.message || 'Failed to remove executor');
    } finally {
      setDeleting(false);
    }
  };

  const openRename = (e: Executor) => {
    setRenameName(e.machine_name || e.name);
    setRenameTarget(e);
    setActionError(null);
  };

  const openDelete = (e: Executor) => {
    setDeleteTarget(e);
    setActionError(null);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            Connected Machines
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            Claude Code instances registered via {brand.shortName} hooks
          </Typography>
        </Box>
        <Tooltip title="Refresh">
          <IconButton onClick={() => refetch()} sx={{ color: 'text.secondary' }}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load executors: {(error as Error).message}
        </Alert>
      )}

      {isLoading ? (
        <Grid container spacing={2}>
          {[1, 2, 3].map((i) => (
            <Grid size={{ xs: 12, md: 6, lg: 4 }} key={i}>
              <Card>
                <CardContent>
                  <Skeleton variant="rectangular" height={120} />
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      ) : executors.length === 0 ? (
        /* Empty state */
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <ComputerIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h5" sx={{ mb: 1 }}>
            No machines connected yet
          </Typography>
          <Typography variant="body1" sx={{ color: 'text.secondary', mb: 3, maxWidth: 500, mx: 'auto' }}>
            Connect a Claude Code session to see it here. Once connected, you can link
            Claude.ai conversations to specific machines.
          </Typography>
          <Box sx={{ textAlign: 'left', maxWidth: 500, mx: 'auto', mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Get started in 3 steps:
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', fontFamily: 'monospace', mb: 0.5 }}>
              1. Install: npm install -g @controlVector/cv-git
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', fontFamily: 'monospace', mb: 0.5 }}>
              2. Authenticate: cv auth login && cd your-project && cv init -y
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
              3. Start Claude Code: claude
            </Typography>
          </Box>
          <Button
            variant="outlined"
            startIcon={<ContentCopyIcon />}
            onClick={handleCopy}
            size="small"
          >
            {copied ? 'Copied!' : 'Copy setup command'}
          </Button>
        </Card>
      ) : (
        /* Executor list */
        <>
          {online.length > 0 && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 1.5, textTransform: 'uppercase', letterSpacing: 1 }}>
                Online ({online.length})
              </Typography>
              <Grid container spacing={2}>
                {online.map((e) => (
                  <Grid size={{ xs: 12, md: 6, lg: 4 }} key={e.id}>
                    <ExecutorCard executor={e} onRename={openRename} onDelete={openDelete} />
                  </Grid>
                ))}
              </Grid>
            </Box>
          )}

          {offline.length > 0 && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 1.5, textTransform: 'uppercase', letterSpacing: 1 }}>
                Offline ({offline.length})
              </Typography>
              <Grid container spacing={2}>
                {offline.map((e) => (
                  <Grid size={{ xs: 12, md: 6, lg: 4 }} key={e.id}>
                    <ExecutorCard executor={e} onRename={openRename} onDelete={openDelete} />
                  </Grid>
                ))}
              </Grid>
            </Box>
          )}

          {/* Setup instructions */}
          <Card sx={{ mt: 4, p: 3, bgcolor: 'background.default' }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              How to connect a machine
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 0.5 }}>
              1. Install the CLI: <code>npm install -g @controlVector/cv-git</code>
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 0.5 }}>
              2. Authenticate: <code>cv auth login</code>
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 0.5 }}>
              3. In your project: <code>cv init -y</code>
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
              4. Start Claude Code: <code>claude</code> — your machine appears here automatically
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              To name your machine, add <code>CV_HUB_MACHINE_NAME=my-machine</code> to <code>~/.config/cv-hub/credentials</code>
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
              Then link it from Claude.ai: <em>"Connect me to my-machine"</em>
            </Typography>
          </Card>
        </>
      )}

      {/* Rename Dialog */}
      <Dialog open={!!renameTarget} onClose={() => setRenameTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Rename Executor</DialogTitle>
        <DialogContent>
          {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}
          <TextField
            fullWidth
            label="Machine Name"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            margin="normal"
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameTarget(null)}>Cancel</Button>
          <Button onClick={handleRename} variant="contained" disabled={renaming || !renameName.trim()}>
            {renaming ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Remove Executor</DialogTitle>
        <DialogContent>
          {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}
          <Typography>
            Remove <strong>{deleteTarget?.machine_name || deleteTarget?.name}</strong>? It will need to re-register on its next session.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting}>
            {deleting ? 'Removing...' : 'Remove'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function ExecutorCard({
  executor: e,
  onRename,
  onDelete,
}: {
  executor: Executor;
  onRename: (e: Executor) => void;
  onDelete: (e: Executor) => void;
}) {
  const displayName = e.machine_name || e.name;
  const isOnline = e.status === 'online';

  return (
    <Card
      sx={{
        opacity: isOnline ? 1 : 0.7,
        transition: 'opacity 0.2s',
      }}
    >
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              bgcolor: statusColor(e.status),
              mr: 1.5,
              ...(e.status === 'online' && {
                boxShadow: `0 0 0 3px ${statusColor(e.status)}33`,
              }),
            }}
          />
          <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
            {displayName}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Tooltip title="Rename">
              <IconButton size="small" onClick={() => onRename(e)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Remove">
              <IconButton size="small" color="error" onClick={() => onDelete(e)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Chip
              label={e.status}
              size="small"
              sx={{
                bgcolor: `${statusColor(e.status)}22`,
                color: statusColor(e.status),
                fontWeight: 500,
                fontSize: '0.75rem',
              }}
            />
          </Box>
        </Box>

        {e.repos && e.repos.length > 0 && (
          <Box sx={{ mb: 1 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Repos:{' '}
            </Typography>
            {e.repos.map((repo) => (
              <Chip
                key={repo}
                label={repo}
                size="small"
                variant="outlined"
                sx={{ mr: 0.5, mb: 0.5, fontSize: '0.7rem', height: 22 }}
              />
            ))}
          </Box>
        )}

        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
          Last active: {timeAgo(e.last_heartbeat_at)}
        </Typography>

        {e.workspace_root && (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', fontFamily: 'monospace', fontSize: '0.7rem' }}>
            {e.workspace_root}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
