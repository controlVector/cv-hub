/**
 * Repository Settings Page
 * Manage repository visibility, danger zone (delete/transfer)
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  IconButton,
  Chip,
  CircularProgress,
} from '@mui/material';
import {
  Lock,
  Public,
  Delete as DeleteIcon,
  Warning,
  PersonAdd,
  PersonRemove,
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

// ============================================================================
// Collaborators Section
// ============================================================================

interface Member {
  id: string;
  userId: string;
  role: string;
  user?: { username: string; email: string; avatarUrl?: string };
  createdAt: string;
}

function CollaboratorsSection({ owner, repo }: { owner: string; repo: string }) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('write');
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');

  // Fetch current members
  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ['repo-members', owner, repo],
    queryFn: async () => {
      const res = await api.get(`/v1/repos/${owner}/${repo}/members`);
      return res.data.members as Member[];
    },
  });

  // Search users
  const { data: searchResults } = useQuery({
    queryKey: ['user-search', searchQuery],
    queryFn: async () => {
      if (!searchQuery || searchQuery.length < 2) return [];
      const res = await api.get(`/v1/users/search?q=${encodeURIComponent(searchQuery)}&limit=10`);
      return res.data.users as Array<{ id: string; username: string; email: string }>;
    },
    enabled: searchQuery.length >= 2,
  });

  // Add member
  const addMutation = useMutation({
    mutationFn: async (userId: string) => {
      await api.post(`/v1/repos/${owner}/${repo}/members`, {
        userId,
        role: selectedRole,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repo-members', owner, repo] });
      setAddSuccess('Collaborator added');
      setAddOpen(false);
      setSearchQuery('');
      setTimeout(() => setAddSuccess(''), 3000);
    },
    onError: (err: any) => {
      setAddError(err.response?.data?.error?.message || 'Failed to add collaborator');
    },
  });

  // Remove member
  const removeMutation = useMutation({
    mutationFn: async (memberId: string) => {
      await api.delete(`/v1/repos/${owner}/${repo}/members/${memberId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repo-members', owner, repo] });
    },
  });

  // Update role
  const updateRoleMutation = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: string }) => {
      await api.put(`/v1/repos/${owner}/${repo}/members/${memberId}`, { role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repo-members', owner, repo] });
    },
  });

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            Collaborators
          </Typography>
          <Button
            variant="outlined"
            size="small"
            startIcon={<PersonAdd />}
            onClick={() => { setAddOpen(true); setAddError(''); }}
          >
            Add collaborator
          </Button>
        </Box>

        {addSuccess && (
          <Alert severity="success" sx={{ mb: 2 }}>{addSuccess}</Alert>
        )}

        {membersLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : members && members.length > 0 ? (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>User</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Added</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {member.user?.username || 'Unknown'}
                      </Typography>
                      <Typography variant="caption" sx={{ color: colors.textMuted }}>
                        {member.user?.email || ''}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={member.role}
                      size="small"
                      sx={{ minWidth: 100 }}
                      onChange={(e) => updateRoleMutation.mutate({
                        memberId: member.id,
                        role: e.target.value,
                      })}
                    >
                      <MenuItem value="read">Read</MenuItem>
                      <MenuItem value="write">Write</MenuItem>
                      <MenuItem value="admin">Admin</MenuItem>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ color: colors.textMuted }}>
                      {new Date(member.createdAt).toLocaleDateString()}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => removeMutation.mutate(member.id)}
                      disabled={removeMutation.isPending}
                    >
                      <PersonRemove fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Typography variant="body2" sx={{ color: colors.textMuted, py: 2, textAlign: 'center' }}>
            No collaborators yet. Add someone to give them access to this repository.
          </Typography>
        )}
      </CardContent>

      {/* Add Collaborator Dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Collaborator</DialogTitle>
        <DialogContent>
          <TextField
            label="Search by username or email"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setAddError(''); }}
            fullWidth
            autoFocus
            sx={{ mt: 1, mb: 2 }}
            placeholder="Type at least 2 characters..."
          />

          {searchResults && searchResults.length > 0 && (
            <Box sx={{ mb: 2 }}>
              {searchResults.map((user) => (
                <Box
                  key={user.id}
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    p: 1.5,
                    borderRadius: 1,
                    '&:hover': { bgcolor: `${colors.violet}10` },
                    cursor: 'pointer',
                  }}
                  onClick={() => addMutation.mutate(user.id)}
                >
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {user.username}
                    </Typography>
                    <Typography variant="caption" sx={{ color: colors.textMuted }}>
                      {user.email}
                    </Typography>
                  </Box>
                  <Chip label={`Add as ${selectedRole}`} size="small" color="primary" variant="outlined" />
                </Box>
              ))}
            </Box>
          )}

          {searchQuery.length >= 2 && searchResults?.length === 0 && (
            <Typography variant="body2" sx={{ color: colors.textMuted, textAlign: 'center', py: 2 }}>
              No users found matching "{searchQuery}"
            </Typography>
          )}

          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>Role</InputLabel>
            <Select
              value={selectedRole}
              label="Role"
              onChange={(e) => setSelectedRole(e.target.value)}
            >
              <MenuItem value="read">Read — Can view and clone</MenuItem>
              <MenuItem value="write">Write — Can push and create PRs</MenuItem>
              <MenuItem value="admin">Admin — Full access including settings</MenuItem>
            </Select>
          </FormControl>

          {addError && (
            <Alert severity="error" sx={{ mt: 2 }}>{addError}</Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

// ============================================================================
// Main Settings Component
// ============================================================================

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

      {/* Collaborators */}
      <CollaboratorsSection owner={owner} repo={repo} />

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
