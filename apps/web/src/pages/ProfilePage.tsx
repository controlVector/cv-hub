import { useState } from 'react';
import {
  Container,
  Typography,
  Paper,
  Avatar,
  TextField,
  Button,
  Grid,
  Alert,
  CircularProgress,
  Box,
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { colors } from '../theme';

export default function ProfilePage() {
  const { user, refreshAuth } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    displayName: user?.displayName || '',
  });

  const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await api.patch('/auth/profile', formData);
      await refreshAuth();
      setSuccess('Profile updated successfully');
      setIsEditing(false);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setFormData({
      displayName: user?.displayName || '',
    });
    setIsEditing(false);
    setError(null);
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom>
        Your Profile
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      <Paper sx={{ p: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 4, mb: 4 }}>
          <Avatar
            src={user?.avatarUrl}
            sx={{
              width: 100,
              height: 100,
              background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.cyan} 100%)`,
              fontSize: '2.5rem',
            }}
          >
            {user?.displayName?.[0]?.toUpperCase() || user?.username?.[0]?.toUpperCase() || 'U'}
          </Avatar>

          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" gutterBottom>
              {user?.displayName || user?.username}
            </Typography>
            <Typography variant="body2" sx={{ color: colors.textMuted, mb: 1 }}>
              @{user?.username}
            </Typography>
            <Typography variant="body2" sx={{ color: colors.textMuted }}>
              {user?.email}
            </Typography>
          </Box>

          {!isEditing && (
            <Button variant="outlined" onClick={() => setIsEditing(true)}>
              Edit Profile
            </Button>
          )}
        </Box>

        <Grid container spacing={3}>
          <Grid size={{ xs: 12 }}>
            <TextField
              label="Display Name"
              value={formData.displayName}
              onChange={handleChange('displayName')}
              fullWidth
              disabled={!isEditing}
            />
          </Grid>
        </Grid>

        {isEditing && (
          <Box sx={{ display: 'flex', gap: 2, mt: 4, justifyContent: 'flex-end' }}>
            <Button variant="outlined" onClick={handleCancel} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? <CircularProgress size={20} /> : 'Save Changes'}
            </Button>
          </Box>
        )}
      </Paper>

      <Paper sx={{ p: 4, mt: 3 }}>
        <Typography variant="h6" gutterBottom>
          Account Information
        </Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Typography variant="body2" sx={{ color: colors.textMuted }}>
              Username
            </Typography>
            <Typography variant="body1">@{user?.username}</Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Typography variant="body2" sx={{ color: colors.textMuted }}>
              Email
            </Typography>
            <Typography variant="body1">{user?.email}</Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Typography variant="body2" sx={{ color: colors.textMuted }}>
              Member Since
            </Typography>
            <Typography variant="body1">
              {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown'}
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Typography variant="body2" sx={{ color: colors.textMuted }}>
              Two-Factor Authentication
            </Typography>
            <Typography variant="body1">
              {user?.mfaEnabled ? 'Enabled' : 'Not enabled'}
            </Typography>
          </Grid>
        </Grid>
      </Paper>
    </Container>
  );
}
