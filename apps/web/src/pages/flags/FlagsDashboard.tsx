import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Chip,
  CircularProgress,
  Alert,
  IconButton,
  Menu,
  MenuItem,
  Divider,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemSecondaryAction,
  Switch,
  TextField,
  InputAdornment,
  Tabs,
  Tab,
  Stack,
} from '@mui/material';
import {
  Add as AddIcon,
  Flag as FlagIcon,
  People as SegmentIcon,
  VpnKey as KeyIcon,
  MoreVert as MoreVertIcon,
  Search as SearchIcon,
  Archive as ArchiveIcon,
  History as HistoryIcon,
  ContentCopy as CopyIcon,
  RestoreFromTrash as RestoreIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { colors } from '../../theme';
import { useAuth } from '../../contexts/AuthContext';

interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description?: string;
  valueType: 'boolean' | 'string' | 'number' | 'json';
  defaultValue: unknown;
  tags: string[];
  isArchived: boolean;
  createdAt: string;
  environments?: Array<{
    environment: string;
    isEnabled: boolean;
    rolloutPercentage?: number;
  }>;
}

interface Segment {
  id: string;
  key: string;
  name: string;
  description?: string;
  rules: Array<{
    attribute: string;
    operator: string;
    values: unknown[];
  }>;
  matchMode: 'all' | 'any';
}

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  environment: string;
  canWrite: boolean;
  isActive: boolean;
  lastUsedAt?: string;
  usageCount: number;
}

// API functions
async function fetchFlags(orgId: string, includeArchived = false): Promise<{ flags: FeatureFlag[]; total: number }> {
  const response = await fetch(`/api/v1/flags?organizationId=${orgId}&includeArchived=${includeArchived}`);
  if (!response.ok) throw new Error('Failed to fetch flags');
  return response.json();
}

async function fetchSegments(orgId: string): Promise<{ segments: Segment[] }> {
  const response = await fetch(`/api/v1/flags/segments?organizationId=${orgId}`);
  if (!response.ok) throw new Error('Failed to fetch segments');
  return response.json();
}

async function fetchApiKeys(orgId: string): Promise<{ apiKeys: ApiKey[] }> {
  const response = await fetch(`/api/v1/flags/api-keys?organizationId=${orgId}`);
  if (!response.ok) throw new Error('Failed to fetch API keys');
  return response.json();
}

async function toggleFlag(flagKey: string, orgId: string, env: string, enabled: boolean): Promise<void> {
  const response = await fetch(`/api/v1/flags/${flagKey}/environments/${env}?organizationId=${orgId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isEnabled: enabled }),
  });
  if (!response.ok) throw new Error('Failed to toggle flag');
}

async function archiveFlag(flagKey: string, orgId: string): Promise<void> {
  const response = await fetch(`/api/v1/flags/${flagKey}?organizationId=${orgId}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to archive flag');
}

export default function FlagsDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  useAuth(); // Ensure user is authenticated
  const [tabIndex, setTabIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; flag: FeatureFlag } | null>(null);

  // Get org ID from URL or use default
  const orgId = searchParams.get('organizationId') || 'default-org';

  const { data: flagsData, isLoading: flagsLoading, error: flagsError } = useQuery({
    queryKey: ['feature-flags', orgId, showArchived],
    queryFn: () => fetchFlags(orgId, showArchived),
    enabled: tabIndex === 0,
  });

  const { data: segmentsData, isLoading: segmentsLoading } = useQuery({
    queryKey: ['feature-flag-segments', orgId],
    queryFn: () => fetchSegments(orgId),
    enabled: tabIndex === 1,
  });

  const { data: apiKeysData, isLoading: apiKeysLoading } = useQuery({
    queryKey: ['feature-flag-api-keys', orgId],
    queryFn: () => fetchApiKeys(orgId),
    enabled: tabIndex === 2,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ flagKey, env, enabled }: { flagKey: string; env: string; enabled: boolean }) =>
      toggleFlag(flagKey, orgId, env, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feature-flags'] });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (flagKey: string) => archiveFlag(flagKey, orgId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feature-flags'] });
    },
  });

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, flag: FeatureFlag) => {
    event.stopPropagation();
    setMenuAnchor({ el: event.currentTarget, flag });
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
  };

  const handleToggle = (flag: FeatureFlag, env: string, enabled: boolean) => {
    toggleMutation.mutate({ flagKey: flag.key, env, enabled });
  };

  const handleArchive = () => {
    if (menuAnchor?.flag) {
      archiveMutation.mutate(menuAnchor.flag.key);
    }
    handleMenuClose();
  };

  const getValueTypeColor = (type: string) => {
    switch (type) {
      case 'boolean': return colors.green;
      case 'string': return colors.amber;
      case 'number': return colors.cyan;
      case 'json': return colors.violet;
      default: return colors.textMuted;
    }
  };

  const filteredFlags = flagsData?.flags.filter((flag) =>
    flag.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
    flag.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const filteredSegments = segmentsData?.segments.filter((seg) =>
    seg.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
    seg.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, color: colors.textLight }}>
            Feature Flags
          </Typography>
          <Typography variant="body2" sx={{ color: colors.textMuted, mt: 0.5 }}>
            Control feature rollouts and A/B tests across environments
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => navigate('/dashboard/flags/new')}
          sx={{
            background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.purple} 100%)`,
          }}
        >
          New Flag
        </Button>
      </Box>

      {/* Tabs */}
      <Paper sx={{ mb: 3 }}>
        <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)}>
          <Tab icon={<FlagIcon />} iconPosition="start" label="Flags" />
          <Tab icon={<SegmentIcon />} iconPosition="start" label="Segments" />
          <Tab icon={<KeyIcon />} iconPosition="start" label="API Keys" />
        </Tabs>
      </Paper>

      {/* Search and Filters */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center' }}>
        <TextField
          placeholder={tabIndex === 0 ? 'Search flags...' : tabIndex === 1 ? 'Search segments...' : 'Search keys...'}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          size="small"
          sx={{ flex: 1, maxWidth: 400 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ color: colors.textMuted }} />
              </InputAdornment>
            ),
          }}
        />
        {tabIndex === 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Switch
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              size="small"
            />
            <Typography variant="body2" sx={{ color: colors.textMuted }}>
              Show archived
            </Typography>
          </Box>
        )}
      </Box>

      {/* Flags Tab */}
      {tabIndex === 0 && (
        <>
          {flagsLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          )}

          {flagsError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              Failed to load feature flags
            </Alert>
          )}

          {!flagsLoading && filteredFlags.length === 0 && (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
              <FlagIcon sx={{ fontSize: 48, color: colors.textMuted, mb: 2 }} />
              <Typography variant="h6" sx={{ color: colors.textLight, mb: 1 }}>
                No feature flags yet
              </Typography>
              <Typography variant="body2" sx={{ color: colors.textMuted, mb: 2 }}>
                Create your first feature flag to start controlling rollouts
              </Typography>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => navigate('/dashboard/flags/new')}
              >
                Create Flag
              </Button>
            </Paper>
          )}

          <Stack spacing={2}>
            {filteredFlags.map((flag) => (
              <Box key={flag.id}>
                <Card
                  sx={{
                    cursor: 'pointer',
                    opacity: flag.isArchived ? 0.6 : 1,
                    '&:hover': { borderColor: colors.violet },
                  }}
                  onClick={() => navigate(`/dashboard/flags/${flag.key}?organizationId=${orgId}`)}
                >
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <Box sx={{ flex: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <Typography
                            variant="h6"
                            sx={{ fontWeight: 600, color: colors.textLight, fontFamily: 'monospace' }}
                          >
                            {flag.key}
                          </Typography>
                          <Chip
                            label={flag.valueType}
                            size="small"
                            sx={{
                              height: 20,
                              fontSize: '0.7rem',
                              backgroundColor: `${getValueTypeColor(flag.valueType)}20`,
                              color: getValueTypeColor(flag.valueType),
                            }}
                          />
                          {flag.isArchived && (
                            <Chip
                              label="Archived"
                              size="small"
                              icon={<ArchiveIcon sx={{ fontSize: 14 }} />}
                              sx={{ height: 20, fontSize: '0.7rem' }}
                            />
                          )}
                        </Box>
                        <Typography variant="body2" sx={{ color: colors.textMuted }}>
                          {flag.name}
                        </Typography>
                        {flag.description && (
                          <Typography variant="caption" sx={{ color: colors.textMuted, display: 'block', mt: 0.5 }}>
                            {flag.description}
                          </Typography>
                        )}
                        {flag.tags.length > 0 && (
                          <Box sx={{ display: 'flex', gap: 0.5, mt: 1 }}>
                            {flag.tags.map((tag) => (
                              <Chip key={tag} label={tag} size="small" sx={{ height: 20, fontSize: '0.65rem' }} />
                            ))}
                          </Box>
                        )}
                      </Box>

                      {/* Environment toggles */}
                      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                        {['development', 'staging', 'production'].map((env) => {
                          const envConfig = flag.environments?.find((e) => e.environment === env);
                          const isEnabled = envConfig?.isEnabled ?? false;

                          return (
                            <Box key={env} sx={{ textAlign: 'center' }}>
                              <Typography
                                variant="caption"
                                sx={{
                                  color: colors.textMuted,
                                  display: 'block',
                                  textTransform: 'capitalize',
                                  fontSize: '0.65rem',
                                }}
                              >
                                {env.slice(0, 3)}
                              </Typography>
                              <Switch
                                checked={isEnabled}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  handleToggle(flag, env, e.target.checked);
                                }}
                                size="small"
                                disabled={flag.isArchived}
                                sx={{
                                  '& .MuiSwitch-track': {
                                    backgroundColor: colors.slateLighter,
                                  },
                                  '& .Mui-checked .MuiSwitch-thumb': {
                                    backgroundColor: colors.green,
                                  },
                                  '& .Mui-checked + .MuiSwitch-track': {
                                    backgroundColor: `${colors.green}50`,
                                  },
                                }}
                              />
                            </Box>
                          );
                        })}

                        <IconButton onClick={(e) => handleMenuOpen(e, flag)}>
                          <MoreVertIcon />
                        </IconButton>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </Box>
            ))}
          </Stack>

          {/* Flag context menu */}
          <Menu anchorEl={menuAnchor?.el} open={Boolean(menuAnchor)} onClose={handleMenuClose}>
            <MenuItem onClick={() => { handleMenuClose(); navigate(`/dashboard/flags/${menuAnchor?.flag.key}/history?organizationId=${orgId}`); }}>
              <ListItemIcon><HistoryIcon fontSize="small" /></ListItemIcon>
              View History
            </MenuItem>
            <MenuItem onClick={() => { navigator.clipboard.writeText(menuAnchor?.flag.key || ''); handleMenuClose(); }}>
              <ListItemIcon><CopyIcon fontSize="small" /></ListItemIcon>
              Copy Key
            </MenuItem>
            <Divider />
            {menuAnchor?.flag.isArchived ? (
              <MenuItem onClick={handleMenuClose}>
                <ListItemIcon><RestoreIcon fontSize="small" /></ListItemIcon>
                Restore
              </MenuItem>
            ) : (
              <MenuItem onClick={handleArchive} sx={{ color: colors.rose }}>
                <ListItemIcon><ArchiveIcon fontSize="small" sx={{ color: colors.rose }} /></ListItemIcon>
                Archive
              </MenuItem>
            )}
          </Menu>
        </>
      )}

      {/* Segments Tab */}
      {tabIndex === 1 && (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => navigate('/dashboard/flags/segments/new')}
            >
              New Segment
            </Button>
          </Box>

          {segmentsLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          )}

          {!segmentsLoading && filteredSegments.length === 0 && (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
              <SegmentIcon sx={{ fontSize: 48, color: colors.textMuted, mb: 2 }} />
              <Typography variant="h6" sx={{ color: colors.textLight, mb: 1 }}>
                No segments yet
              </Typography>
              <Typography variant="body2" sx={{ color: colors.textMuted, mb: 2 }}>
                Create segments to group users for targeted rollouts
              </Typography>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => navigate('/dashboard/flags/segments/new')}
              >
                Create Segment
              </Button>
            </Paper>
          )}

          <List>
            {filteredSegments.map((segment) => (
              <ListItem
                key={segment.id}
                component={Paper}
                sx={{ mb: 1, cursor: 'pointer' }}
                onClick={() => navigate(`/dashboard/flags/segments/${segment.id}`)}
              >
                <ListItemIcon>
                  <SegmentIcon sx={{ color: colors.violet }} />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{segment.key}</Typography>
                      <Chip
                        label={`${segment.rules.length} rules`}
                        size="small"
                        sx={{ height: 18, fontSize: '0.65rem' }}
                      />
                      <Chip
                        label={segment.matchMode === 'all' ? 'Match All' : 'Match Any'}
                        size="small"
                        variant="outlined"
                        sx={{ height: 18, fontSize: '0.65rem' }}
                      />
                    </Box>
                  }
                  secondary={segment.description || segment.name}
                />
              </ListItem>
            ))}
          </List>
        </>
      )}

      {/* API Keys Tab */}
      {tabIndex === 2 && (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => navigate('/dashboard/flags/api-keys/new')}
            >
              New API Key
            </Button>
          </Box>

          {apiKeysLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          )}

          {!apiKeysLoading && (!apiKeysData?.apiKeys || apiKeysData.apiKeys.length === 0) && (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
              <KeyIcon sx={{ fontSize: 48, color: colors.textMuted, mb: 2 }} />
              <Typography variant="h6" sx={{ color: colors.textLight, mb: 1 }}>
                No API keys yet
              </Typography>
              <Typography variant="body2" sx={{ color: colors.textMuted, mb: 2 }}>
                Create API keys to integrate feature flags in your applications
              </Typography>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => navigate('/dashboard/flags/api-keys/new')}
              >
                Create API Key
              </Button>
            </Paper>
          )}

          <List>
            {apiKeysData?.apiKeys.map((apiKey) => (
              <ListItem key={apiKey.id} component={Paper} sx={{ mb: 1 }}>
                <ListItemIcon>
                  <KeyIcon sx={{ color: apiKey.isActive ? colors.green : colors.textMuted }} />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography sx={{ fontWeight: 600 }}>{apiKey.name}</Typography>
                      <Chip
                        label={apiKey.environment}
                        size="small"
                        sx={{ height: 18, fontSize: '0.65rem' }}
                      />
                      {apiKey.canWrite && (
                        <Chip
                          label="Write"
                          size="small"
                          color="warning"
                          sx={{ height: 18, fontSize: '0.65rem' }}
                        />
                      )}
                      {!apiKey.isActive && (
                        <Chip
                          label="Revoked"
                          size="small"
                          color="error"
                          sx={{ height: 18, fontSize: '0.65rem' }}
                        />
                      )}
                    </Box>
                  }
                  secondary={
                    <Typography variant="caption" sx={{ color: colors.textMuted }}>
                      {apiKey.keyPrefix}*** | {apiKey.usageCount.toLocaleString()} requests
                      {apiKey.lastUsedAt && ` | Last used: ${new Date(apiKey.lastUsedAt).toLocaleDateString()}`}
                    </Typography>
                  }
                />
                <ListItemSecondaryAction>
                  <IconButton edge="end">
                    <MoreVertIcon />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        </>
      )}
    </Box>
  );
}
