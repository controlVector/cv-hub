import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  CircularProgress,
} from '@mui/material';
import {
  Lock,
  Public,
  ArrowBack,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { colors } from '../theme';
import { createRepository } from '../services/repository';
import { getMyOrganizations } from '../services/organization';
import TierLimitAlert from '../components/TierLimitAlert';
import { isTierLimitError } from '../lib/api';

export default function NewRepository() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectOrgSlug = searchParams.get('org');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [ownerId, setOwnerId] = useState<string>('personal');

  const { data: orgs } = useQuery({
    queryKey: ['myOrganizations'],
    queryFn: getMyOrganizations,
  });

  // Pre-select the org from the ?org=<slug> query param (used by "New Repository"
  // buttons on org detail pages). Only fires once the user's org list loads.
  useEffect(() => {
    if (!preselectOrgSlug || !orgs) return;
    const match = orgs.find((o) => o.slug === preselectOrgSlug);
    if (match && ownerId === 'personal') {
      setOwnerId(match.id);
    }
  }, [preselectOrgSlug, orgs, ownerId]);

  const createMutation = useMutation({
    mutationFn: () =>
      createRepository({
        name,
        description: description || undefined,
        visibility,
        organizationId: ownerId !== 'personal' ? ownerId : undefined,
      }),
    onSuccess: (repo) => {
      const ownerSlug = ownerId !== 'personal'
        ? orgs?.find((o) => o.id === ownerId)?.slug
        : undefined;
      // Navigate to the new repo
      const fullName = ownerSlug ? `${ownerSlug}/${repo.slug}` : `${repo.owner?.slug || 'me'}/${repo.slug}`;
      navigate(`/dashboard/repositories/${fullName}`);
    },
  });

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const isValid = name.length >= 1 && name.length <= 100;

  return (
    <Box sx={{ maxWidth: 700, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 4 }}>
        <Box
          onClick={() => navigate('/dashboard/repositories')}
          sx={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
        >
          <ArrowBack sx={{ color: colors.textMuted }} />
        </Box>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            Create a new repository
          </Typography>
          <Typography variant="body2" sx={{ color: colors.textMuted, mt: 0.5 }}>
            A repository contains all project files, including the revision history.
          </Typography>
        </Box>
      </Box>

      <Card>
        <CardContent sx={{ p: 4 }}>
          {/* Owner */}
          <FormControl fullWidth sx={{ mb: 3 }}>
            <InputLabel>Owner</InputLabel>
            <Select
              value={ownerId}
              label="Owner"
              onChange={(e) => setOwnerId(e.target.value)}
            >
              <MenuItem value="personal">Personal account</MenuItem>
              {orgs?.map((org) => (
                <MenuItem key={org.id} value={org.id}>
                  {org.name} ({org.slug})
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Name */}
          <TextField
            label="Repository name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
            sx={{ mb: 1 }}
            helperText={slug ? `Will be created as: ${slug}` : 'Required'}
            error={name.length > 100}
          />

          {/* Description */}
          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={2}
            sx={{ mb: 3, mt: 2 }}
            helperText="Optional short description"
          />

          {/* Visibility */}
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
                  '&:hover': {
                    borderColor: colors.violet,
                  },
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

          {/* Tier limit error */}
          <TierLimitAlert
            error={createMutation.error}
            orgSlug={ownerId !== 'personal' ? orgs?.find((o) => o.id === ownerId)?.slug : undefined}
          />

          {/* Generic error */}
          {createMutation.error && !isTierLimitError(createMutation.error) && (
            <Alert severity="error" sx={{ mb: 2 }}>
              Failed to create repository. Please try again.
            </Alert>
          )}

          {/* Submit */}
          <Box
            onClick={() => {
              if (isValid && !createMutation.isPending) {
                createMutation.mutate();
              }
            }}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              px: 4,
              py: 1.5,
              borderRadius: 2,
              background: isValid
                ? `linear-gradient(135deg, ${colors.violet} 0%, ${colors.purple} 100%)`
                : colors.slateLighter,
              color: isValid ? '#fff' : colors.textMuted,
              fontWeight: 600,
              cursor: isValid ? 'pointer' : 'not-allowed',
              opacity: createMutation.isPending ? 0.7 : 1,
              transition: 'all 0.2s ease',
              '&:hover': isValid
                ? {
                    transform: 'translateY(-1px)',
                    boxShadow: `0 4px 15px rgba(124, 58, 237, 0.3)`,
                  }
                : {},
            }}
          >
            {createMutation.isPending && <CircularProgress size={18} sx={{ color: '#fff' }} />}
            Create repository
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
