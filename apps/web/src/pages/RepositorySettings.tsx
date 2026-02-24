/**
 * Repository Settings Page
 * Manage repository visibility, danger zone (delete/transfer)
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
} from '@mui/material';
import {
  Lock,
  Public,
  Delete as DeleteIcon,
  Warning,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { colors } from '../theme';
import { api } from '../lib/api';

interface RepositorySettingsProps {
  owner: string;
  repo: string;
  repository?: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    visibility: string;
    defaultBranch: string;
  } | null;
}

export default function RepositorySettings({ owner, repo, repository }: RepositorySettingsProps) {
  const navigate = useNavigate();
  const [description, setDescription] = useState(repository?.description || '');
  const [visibility, setVisibility] = useState(repository?.visibility || 'private');
  const [defaultBranch, setDefaultBranch] = useState(repository?.defaultBranch || 'main');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const updateMutation = useMutation({
    mutationFn: async () => {
      await api.put(`/v1/repos/${owner}/${repo}`, {
        description: description || null,
        visibility,
        defaultBranch,
      });
    },
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/v1/repos/${owner}/${repo}`);
    },
    onSuccess: () => {
      navigate('/dashboard/repositories');
    },
  });

  return (
    <Box sx={{ maxWidth: 700 }}>
      {/* General Settings */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
            General
          </Typography>

          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={2}
            sx={{ mb: 3 }}
            helperText="A short description of this repository"
          />

          <FormControl fullWidth sx={{ mb: 3 }}>
            <InputLabel>Default Branch</InputLabel>
            <Select
              value={defaultBranch}
              label="Default Branch"
              onChange={(e) => setDefaultBranch(e.target.value)}
            >
              <MenuItem value="main">main</MenuItem>
              <MenuItem value="master">master</MenuItem>
              <MenuItem value="develop">develop</MenuItem>
            </Select>
          </FormControl>

          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
            Visibility
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
            {(['public', 'private'] as const).map((v) => (
              <Box
                key={v}
                onClick={() => setVisibility(v)}
                sx={{
                  flex: 1,
                  p: 2,
                  borderRadius: 2,
                  border: `2px solid ${visibility === v ? colors.violet : colors.slateLighter}`,
                  backgroundColor: visibility === v ? `${colors.violet}15` : 'transparent',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  '&:hover': { borderColor: colors.violet },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  {v === 'public' ? (
                    <Public sx={{ fontSize: 20, color: visibility === v ? colors.violet : colors.textMuted }} />
                  ) : (
                    <Lock sx={{ fontSize: 20, color: visibility === v ? colors.violet : colors.textMuted }} />
                  )}
                  <Typography variant="subtitle2" sx={{ textTransform: 'capitalize' }}>
                    {v}
                  </Typography>
                </Box>
                <Typography variant="caption" sx={{ color: colors.textMuted }}>
                  {v === 'public'
                    ? 'Anyone can see this repository.'
                    : 'Only you and collaborators can see this repository.'}
                </Typography>
              </Box>
            ))}
          </Box>

          {saved && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Settings saved.
            </Alert>
          )}
          {updateMutation.error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              Failed to save settings. Please try again.
            </Alert>
          )}

          <Button
            variant="contained"
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card sx={{ border: `1px solid ${colors.coral}40` }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
            <Warning sx={{ color: colors.coral }} />
            <Typography variant="h6" sx={{ fontWeight: 600, color: colors.coral }}>
              Danger Zone
            </Typography>
          </Box>

          <Divider sx={{ mb: 3 }} />

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box>
              <Typography sx={{ fontWeight: 600 }}>Delete this repository</Typography>
              <Typography variant="body2" sx={{ color: colors.textMuted }}>
                Once deleted, this cannot be undone. All data will be permanently removed.
              </Typography>
            </Box>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => setDeleteOpen(true)}
            >
              Delete
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ color: colors.coral }}>Delete Repository</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            This will permanently delete <b>{owner}/{repo}</b> and all associated data
            including issues, pull requests, and graph data.
          </Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Type <b>{repo}</b> to confirm:
          </Typography>
          <TextField
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            fullWidth
            placeholder={repo}
            size="small"
          />
          {deleteMutation.error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              Failed to delete repository.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteConfirm !== repo || deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete Repository'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
