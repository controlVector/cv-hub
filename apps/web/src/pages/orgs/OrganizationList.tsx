import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  TextField,
  InputAdornment,
  Skeleton,
  Alert,
  Avatar,
  Chip,
  Button,
} from '@mui/material';
import {
  Search as SearchIcon,
  Business as BusinessIcon,
  Apps as AppsIcon,
  People as PeopleIcon,
  Add as AddIcon,
  Verified as VerifiedIcon,
} from '@mui/icons-material';
import { colors } from '../../theme';
import { listOrganizations } from '../../services/organization';
import type { OrganizationWithStats } from '../../types/organization';

export default function OrganizationList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') || '');

  const { data, isLoading, error } = useQuery({
    queryKey: ['organizations', { search }],
    queryFn: () => listOrganizations({ search: search || undefined }),
  });

  const handleSearch = (value: string) => {
    setSearch(value);
    const params = new URLSearchParams(searchParams);
    if (value) params.set('search', value);
    else params.delete('search');
    setSearchParams(params);
  };

  const organizations = data?.organizations || [];

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 4 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
            Organizations
          </Typography>
          <Typography variant="body1" sx={{ color: colors.textMuted }}>
            Browse organizations and their application storefronts
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => navigate('/orgs/new')}
        >
          Create Organization
        </Button>
      </Box>

      {/* Search */}
      <Box sx={{ mb: 4 }}>
        <TextField
          placeholder="Search organizations..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          fullWidth
          sx={{ maxWidth: 400 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ color: colors.textMuted }} />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load organizations. Please try again.
        </Alert>
      )}

      {isLoading ? (
        <Grid container spacing={3}>
          {[1, 2, 3, 4].map((i) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={i}>
              <Card>
                <CardContent>
                  <Skeleton variant="circular" width={64} height={64} sx={{ mb: 2 }} />
                  <Skeleton variant="text" width="60%" height={28} />
                  <Skeleton variant="text" width="100%" />
                  <Skeleton variant="text" width="40%" />
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      ) : organizations.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 6 }}>
            <BusinessIcon sx={{ fontSize: 48, color: colors.textMuted, mb: 2 }} />
            <Typography variant="h6" sx={{ color: colors.textMuted }}>
              No organizations found
            </Typography>
            <Typography variant="body2" sx={{ color: colors.textMuted, mb: 3 }}>
              {search ? 'Try a different search term' : 'Be the first to create an organization'}
            </Typography>
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => navigate('/orgs/new')}
            >
              Create Organization
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Grid container spacing={3}>
          {organizations.map((org) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={org.id}>
              <OrganizationCard org={org} onClick={() => navigate(`/orgs/${org.slug}`)} />
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}

interface OrganizationCardProps {
  org: OrganizationWithStats;
  onClick: () => void;
}

function OrganizationCard({ org, onClick }: OrganizationCardProps) {
  return (
    <Card
      onClick={onClick}
      sx={{
        cursor: 'pointer',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'flex-start' }}>
          <Avatar
            src={org.logoUrl || undefined}
            sx={{
              width: 64,
              height: 64,
              backgroundColor: colors.navyLighter,
            }}
          >
            <BusinessIcon sx={{ fontSize: 32 }} />
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 600 }} noWrap>
                {org.name}
              </Typography>
              {org.isVerified && (
                <VerifiedIcon sx={{ fontSize: 18, color: colors.orange }} />
              )}
            </Box>
            <Typography variant="body2" sx={{ color: colors.textMuted }}>
              @{org.slug}
            </Typography>
          </Box>
        </Box>

        {org.description && (
          <Typography
            variant="body2"
            sx={{
              color: colors.textMuted,
              flex: 1,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              mb: 2,
            }}
          >
            {org.description}
          </Typography>
        )}

        <Box sx={{ display: 'flex', gap: 2, mt: 'auto' }}>
          <Chip
            icon={<AppsIcon sx={{ fontSize: 16 }} />}
            label={`${org.appCount} apps`}
            size="small"
            sx={{ backgroundColor: colors.navyLighter }}
          />
          <Chip
            icon={<PeopleIcon sx={{ fontSize: 16 }} />}
            label={`${org.memberCount} members`}
            size="small"
            sx={{ backgroundColor: colors.navyLighter }}
          />
        </Box>
      </CardContent>
    </Card>
  );
}
