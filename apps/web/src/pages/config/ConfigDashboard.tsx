import { useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Button,
  Chip,
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
} from '@mui/material';
import {
  Add as AddIcon,
  Schema as SchemaIcon,
  Storage as StorageIcon,
  Settings as SettingsIcon,
  MoreVert as MoreVertIcon,
  Lock as LockIcon,
  VpnKey as KeyIcon,
  Folder as FolderIcon,
  CloudQueue as CloudIcon,
  History as HistoryIcon,
} from '@mui/icons-material';
import { colors } from '../../theme';
import { useAuth } from '../../contexts/AuthContext';

interface ConfigSet {
  id: string;
  name: string;
  environment?: string;
  scope: string;
  isLocked: boolean;
  valueCount?: number;
  updatedAt: string;
}

interface ConfigStore {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
  lastTestSuccess?: boolean;
}

interface ConfigSchema {
  id: string;
  name: string;
  version: number;
  keyCount: number;
}

export default function ConfigDashboard() {
  const navigate = useNavigate();
  useAuth(); // Ensure authenticated
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; id: string } | null>(null);

  // Mock data for now - would come from API
  const configSets: ConfigSet[] = [
    { id: '1', name: 'development', environment: 'development', scope: 'organization', isLocked: false, valueCount: 15, updatedAt: '2024-01-15' },
    { id: '2', name: 'staging', environment: 'staging', scope: 'organization', isLocked: false, valueCount: 18, updatedAt: '2024-01-14' },
    { id: '3', name: 'production', environment: 'production', scope: 'organization', isLocked: true, valueCount: 20, updatedAt: '2024-01-10' },
  ];

  const stores: ConfigStore[] = [
    { id: '1', name: 'CV-Hub Store', type: 'builtin', isDefault: true, lastTestSuccess: true },
  ];

  const schemas: ConfigSchema[] = [
    { id: '1', name: 'App Config', version: 3, keyCount: 25 },
  ];

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, id: string) => {
    setMenuAnchor({ el: event.currentTarget, id });
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
  };

  const getEnvironmentColor = (env?: string) => {
    switch (env) {
      case 'production': return colors.rose;
      case 'staging': return colors.amber;
      case 'development': return colors.green;
      default: return colors.textMuted;
    }
  };

  const getStoreTypeIcon = (type: string) => {
    switch (type) {
      case 'builtin': return <StorageIcon />;
      case 'aws_ssm': return <CloudIcon />;
      case 'hashicorp_vault': return <LockIcon />;
      default: return <CloudIcon />;
    }
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" fontWeight={600} gutterBottom>
            Configuration Management
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Manage environment variables, secrets, and configuration across your organization
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => navigate('/dashboard/config/sets/new')}
          sx={{
            background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.purple} 100%)`,
          }}
        >
          New Config Set
        </Button>
      </Box>

      {/* Quick Stats */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ bgcolor: colors.slateLight }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: `${colors.violet}20`,
                  }}
                >
                  <FolderIcon sx={{ color: colors.violet }} />
                </Box>
                <Box>
                  <Typography variant="h4" fontWeight={600}>
                    {configSets.length}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Config Sets
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ bgcolor: colors.slateLight }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: `${colors.cyan}20`,
                  }}
                >
                  <KeyIcon sx={{ color: colors.cyan }} />
                </Box>
                <Box>
                  <Typography variant="h4" fontWeight={600}>
                    {configSets.reduce((sum, s) => sum + (s.valueCount || 0), 0)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Config Values
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ bgcolor: colors.slateLight }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: `${colors.green}20`,
                  }}
                >
                  <StorageIcon sx={{ color: colors.green }} />
                </Box>
                <Box>
                  <Typography variant="h4" fontWeight={600}>
                    {stores.length}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Config Stores
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ bgcolor: colors.slateLight }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: `${colors.amber}20`,
                  }}
                >
                  <SchemaIcon sx={{ color: colors.amber }} />
                </Box>
                <Box>
                  <Typography variant="h4" fontWeight={600}>
                    {schemas.length}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Schemas
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        {/* Config Sets */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Paper sx={{ bgcolor: colors.slateLight, p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" fontWeight={600}>
                Config Sets
              </Typography>
              <Button
                size="small"
                component={RouterLink}
                to="/dashboard/config/sets"
              >
                View All
              </Button>
            </Box>
            <List>
              {configSets.map((set, index) => (
                <Box key={set.id}>
                  {index > 0 && <Divider sx={{ my: 1 }} />}
                  <ListItem
                    sx={{
                      borderRadius: 1,
                      cursor: 'pointer',
                      '&:hover': { bgcolor: colors.slateLighter },
                    }}
                    onClick={() => navigate(`/dashboard/config/sets/${set.id}`)}
                  >
                    <ListItemIcon>
                      <FolderIcon sx={{ color: getEnvironmentColor(set.environment) }} />
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography fontWeight={500}>{set.name}</Typography>
                          {set.isLocked && (
                            <LockIcon sx={{ fontSize: 16, color: colors.textMuted }} />
                          )}
                        </Box>
                      }
                      secondary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                          <Chip
                            label={set.environment || set.scope}
                            size="small"
                            sx={{
                              height: 20,
                              fontSize: '0.7rem',
                              bgcolor: `${getEnvironmentColor(set.environment)}20`,
                              color: getEnvironmentColor(set.environment),
                            }}
                          />
                          <Typography variant="caption" color="text.secondary">
                            {set.valueCount} values
                          </Typography>
                        </Box>
                      }
                    />
                    <ListItemSecondaryAction>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMenuOpen(e, set.id);
                        }}
                      >
                        <MoreVertIcon />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                </Box>
              ))}
            </List>
          </Paper>
        </Grid>

        {/* Sidebar */}
        <Grid size={{ xs: 12, md: 4 }}>
          {/* Stores */}
          <Paper sx={{ bgcolor: colors.slateLight, p: 3, mb: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" fontWeight={600}>
                Config Stores
              </Typography>
              <Button size="small" startIcon={<AddIcon />}>
                Add
              </Button>
            </Box>
            <List dense>
              {stores.map((store) => (
                <ListItem key={store.id}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    {getStoreTypeIcon(store.type)}
                  </ListItemIcon>
                  <ListItemText
                    primary={store.name}
                    secondary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="caption" color="text.secondary">
                          {store.type}
                        </Typography>
                        {store.isDefault && (
                          <Chip label="Default" size="small" sx={{ height: 16, fontSize: '0.65rem' }} />
                        )}
                      </Box>
                    }
                  />
                  {store.lastTestSuccess !== undefined && (
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: store.lastTestSuccess ? colors.green : colors.rose,
                      }}
                    />
                  )}
                </ListItem>
              ))}
            </List>
          </Paper>

          {/* Schemas */}
          <Paper sx={{ bgcolor: colors.slateLight, p: 3, mb: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" fontWeight={600}>
                Schemas
              </Typography>
              <Button
                size="small"
                startIcon={<AddIcon />}
                component={RouterLink}
                to="/dashboard/config/schemas/new"
              >
                New
              </Button>
            </Box>
            <List dense>
              {schemas.map((schema) => (
                <ListItem
                  key={schema.id}
                  sx={{
                    cursor: 'pointer',
                    borderRadius: 1,
                    '&:hover': { bgcolor: colors.slateLighter },
                  }}
                  onClick={() => navigate(`/dashboard/config/schemas/${schema.id}`)}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <SchemaIcon sx={{ color: colors.amber }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={schema.name}
                    secondary={`v${schema.version} · ${schema.keyCount} keys`}
                  />
                </ListItem>
              ))}
            </List>
          </Paper>

          {/* Quick Actions */}
          <Paper sx={{ bgcolor: colors.slateLight, p: 3 }}>
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Quick Actions
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<HistoryIcon />}
                sx={{ justifyContent: 'flex-start' }}
              >
                View Change History
              </Button>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<KeyIcon />}
                sx={{ justifyContent: 'flex-start' }}
              >
                Manage Access Tokens
              </Button>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<SettingsIcon />}
                sx={{ justifyContent: 'flex-start' }}
              >
                Config Settings
              </Button>
            </Box>
          </Paper>
        </Grid>
      </Grid>

      {/* Context Menu */}
      <Menu
        anchorEl={menuAnchor?.el}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={() => {
          navigate(`/dashboard/config/sets/${menuAnchor?.id}`);
          handleMenuClose();
        }}>
          Edit
        </MenuItem>
        <MenuItem onClick={() => {
          // Clone action
          handleMenuClose();
        }}>
          Clone
        </MenuItem>
        <MenuItem onClick={() => {
          // Export action
          handleMenuClose();
        }}>
          Export
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={handleMenuClose}
          sx={{ color: colors.rose }}
        >
          Delete
        </MenuItem>
      </Menu>
    </Box>
  );
}
