import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Alert,
  FormControlLabel,
  Switch,
  InputAdornment,
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Business as BusinessIcon,
} from '@mui/icons-material';
import { colors } from '../../theme';
import { createOrganization } from '../../services/organization';
import type { CreateOrganizationInput } from '../../types/organization';

export default function CreateOrganization() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState<CreateOrganizationInput>({
    slug: '',
    name: '',
    description: '',
    logoUrl: '',
    websiteUrl: '',
    isPublic: true,
  });

  const [slugError, setSlugError] = useState('');

  const createMutation = useMutation({
    mutationFn: createOrganization,
    onSuccess: (org) => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      queryClient.invalidateQueries({ queryKey: ['my-organizations'] });
      navigate(`/orgs/${org.slug}`);
    },
  });

  const handleSlugChange = (value: string) => {
    // Sanitize slug: lowercase, alphanumeric and hyphens only
    const sanitized = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setFormData({ ...formData, slug: sanitized });

    if (sanitized.length < 2) {
      setSlugError('Slug must be at least 2 characters');
    } else if (sanitized.length > 64) {
      setSlugError('Slug must be at most 64 characters');
    } else {
      setSlugError('');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (slugError || !formData.slug || !formData.name) {
      return;
    }

    createMutation.mutate({
      ...formData,
      logoUrl: formData.logoUrl || undefined,
      websiteUrl: formData.websiteUrl || undefined,
      description: formData.description || undefined,
    });
  };

  return (
    <Box>
      <Button startIcon={<BackIcon />} onClick={() => navigate('/orgs')} sx={{ mb: 2 }}>
        Back to Organizations
      </Button>

      <Box sx={{ maxWidth: 600, mx: 'auto' }}>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
          Create Organization
        </Typography>
        <Typography variant="body1" sx={{ color: colors.textMuted, mb: 4 }}>
          Create a new organization to host your applications
        </Typography>

        {createMutation.error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {(createMutation.error as Error).message || 'Failed to create organization'}
          </Alert>
        )}

        <Card>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <TextField
                  label="Organization Name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  fullWidth
                  placeholder="My Organization"
                  helperText="The display name for your organization"
                />

                <TextField
                  label="Slug"
                  value={formData.slug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  required
                  fullWidth
                  placeholder="my-organization"
                  error={!!slugError}
                  helperText={slugError || 'Used in URLs: /orgs/my-organization'}
                  InputProps={{
                    startAdornment: <InputAdornment position="start">@</InputAdornment>,
                  }}
                />

                <TextField
                  label="Description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  fullWidth
                  multiline
                  rows={3}
                  placeholder="A brief description of your organization..."
                />

                <TextField
                  label="Logo URL"
                  value={formData.logoUrl}
                  onChange={(e) => setFormData({ ...formData, logoUrl: e.target.value })}
                  fullWidth
                  type="url"
                  placeholder="https://example.com/logo.png"
                  helperText="URL to your organization's logo image"
                />

                <TextField
                  label="Website URL"
                  value={formData.websiteUrl}
                  onChange={(e) => setFormData({ ...formData, websiteUrl: e.target.value })}
                  fullWidth
                  type="url"
                  placeholder="https://example.com"
                />

                <FormControlLabel
                  control={
                    <Switch
                      checked={formData.isPublic}
                      onChange={(e) => setFormData({ ...formData, isPublic: e.target.checked })}
                    />
                  }
                  label="Public organization"
                />
                <Typography variant="body2" sx={{ color: colors.textMuted, mt: -2 }}>
                  Public organizations are visible to everyone. Private organizations are only visible to members.
                </Typography>

                <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end', mt: 2 }}>
                  <Button variant="outlined" onClick={() => navigate('/orgs')}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="contained"
                    disabled={createMutation.isPending || !!slugError || !formData.slug || !formData.name}
                    startIcon={<BusinessIcon />}
                  >
                    {createMutation.isPending ? 'Creating...' : 'Create Organization'}
                  </Button>
                </Box>
              </Box>
            </form>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
