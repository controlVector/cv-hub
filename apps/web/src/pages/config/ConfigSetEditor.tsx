import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Button,
  TextField,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Switch,
  FormControlLabel,
  Select,
  MenuItem,
  InputLabel,
  FormControl,
  Alert,
  Tooltip,
  Menu,
  Divider,
  InputAdornment,
  CircularProgress,
  Breadcrumbs,
  Link,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Lock as LockIcon,
  Save as SaveIcon,
  Download as DownloadIcon,
  Upload as UploadIcon,
  History as HistoryIcon,
  ContentCopy as CopyIcon,
  MoreVert as MoreVertIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { colors } from '../../theme';

interface ConfigValue {
  id: string;
  key: string;
  value: unknown;
  valueType: string;
  isSecret: boolean;
  version: number;
  description?: string;
  source?: {
    setId: string;
    setName: string;
    scope: string;
  };
}

interface ConfigSet {
  id: string;
  name: string;
  description?: string;
  environment?: string;
  scope: string;
  isLocked: boolean;
  lockedReason?: string;
}

export default function ConfigSetEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const [configSet, setConfigSet] = useState<ConfigSet | null>(null);
  const [values, setValues] = useState<ConfigValue[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSecrets, setShowSecrets] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingValue, setEditingValue] = useState<ConfigValue | null>(null);
  const [newValueKey, setNewValueKey] = useState('');
  const [newValueValue, setNewValueValue] = useState('');
  const [newValueType, setNewValueType] = useState<string>('string');
  const [newValueIsSecret, setNewValueIsSecret] = useState(false);
  const [newValueDescription, setNewValueDescription] = useState('');
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mock data
  useEffect(() => {
    if (!isNew) {
      setConfigSet({
        id: id!,
        name: 'production',
        description: 'Production environment configuration',
        environment: 'production',
        scope: 'organization',
        isLocked: false,
      });
      setValues([
        { id: '1', key: 'DATABASE_URL', value: 'postgres://...', valueType: 'secret', isSecret: true, version: 3, description: 'Primary database connection string' },
        { id: '2', key: 'API_KEY', value: 'sk-...', valueType: 'secret', isSecret: true, version: 1 },
        { id: '3', key: 'NODE_ENV', value: 'production', valueType: 'string', isSecret: false, version: 1 },
        { id: '4', key: 'LOG_LEVEL', value: 'info', valueType: 'string', isSecret: false, version: 2 },
        { id: '5', key: 'MAX_CONNECTIONS', value: 100, valueType: 'number', isSecret: false, version: 1 },
        { id: '6', key: 'ENABLE_CACHE', value: true, valueType: 'boolean', isSecret: false, version: 1 },
      ]);
    }
  }, [id, isNew]);

  const filteredValues = values.filter(v =>
    v.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (typeof v.value === 'string' && v.value.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleAddValue = () => {
    setEditingValue(null);
    setNewValueKey('');
    setNewValueValue('');
    setNewValueType('string');
    setNewValueIsSecret(false);
    setNewValueDescription('');
    setEditDialogOpen(true);
  };

  const handleEditValue = (value: ConfigValue) => {
    setEditingValue(value);
    setNewValueKey(value.key);
    setNewValueValue(String(value.value));
    setNewValueType(value.valueType);
    setNewValueIsSecret(value.isSecret);
    setNewValueDescription(value.description || '');
    setEditDialogOpen(true);
  };

  const handleSaveValue = async () => {
    setSaving(true);
    try {
      // API call would go here
      await new Promise(resolve => setTimeout(resolve, 500));

      if (editingValue) {
        setValues(values.map(v =>
          v.id === editingValue.id
            ? { ...v, key: newValueKey, value: newValueValue, valueType: newValueType, isSecret: newValueIsSecret, description: newValueDescription, version: v.version + 1 }
            : v
        ));
      } else {
        setValues([...values, {
          id: Date.now().toString(),
          key: newValueKey,
          value: newValueValue,
          valueType: newValueType,
          isSecret: newValueIsSecret,
          version: 1,
          description: newValueDescription,
        }]);
      }

      setEditDialogOpen(false);
    } catch (err) {
      setError('Failed to save value');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteValue = async (valueId: string) => {
    setValues(values.filter(v => v.id !== valueId));
  };

  const handleCopyValue = (value: unknown) => {
    navigator.clipboard.writeText(String(value));
  };

  const getDisplayValue = (value: ConfigValue) => {
    if (value.isSecret && !showSecrets) {
      return '••••••••';
    }
    if (typeof value.value === 'boolean') {
      return value.value ? 'true' : 'false';
    }
    if (typeof value.value === 'object') {
      return JSON.stringify(value.value);
    }
    return String(value.value);
  };

  const getValueTypeColor = (type: string) => {
    switch (type) {
      case 'secret': return colors.rose;
      case 'number': return colors.cyan;
      case 'boolean': return colors.green;
      case 'json': return colors.amber;
      default: return colors.violet;
    }
  };

  if (!isNew && !configSet) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Breadcrumbs */}
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link
          component="button"
          onClick={() => navigate('/dashboard/config')}
          sx={{ color: colors.textMuted, textDecoration: 'none', '&:hover': { color: colors.violet } }}
        >
          Config
        </Link>
        <Link
          component="button"
          onClick={() => navigate('/dashboard/config/sets')}
          sx={{ color: colors.textMuted, textDecoration: 'none', '&:hover': { color: colors.violet } }}
        >
          Config Sets
        </Link>
        <Typography color="text.primary">
          {isNew ? 'New Config Set' : configSet?.name}
        </Typography>
      </Breadcrumbs>

      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
            <Typography variant="h4" fontWeight={600}>
              {isNew ? 'New Config Set' : configSet?.name}
            </Typography>
            {configSet?.environment && (
              <Chip
                label={configSet.environment}
                size="small"
                sx={{
                  bgcolor: configSet.environment === 'production' ? `${colors.rose}20` : `${colors.green}20`,
                  color: configSet.environment === 'production' ? colors.rose : colors.green,
                }}
              />
            )}
            {configSet?.isLocked && (
              <Tooltip title={configSet.lockedReason || 'Locked'}>
                <LockIcon sx={{ color: colors.amber }} />
              </Tooltip>
            )}
          </Box>
          {configSet?.description && (
            <Typography color="text.secondary">
              {configSet.description}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={<UploadIcon />}
            onClick={() => {/* Import dialog */}}
          >
            Import
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={() => {/* Export dialog */}}
          >
            Export
          </Button>
          <IconButton onClick={(e) => setMenuAnchor(e.currentTarget)}>
            <MoreVertIcon />
          </IconButton>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Toolbar */}
      <Paper sx={{ bgcolor: colors.slateLight, p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <TextField
              size="small"
              placeholder="Search keys..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: colors.textMuted }} />
                  </InputAdornment>
                ),
              }}
              sx={{ width: 300 }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={showSecrets}
                  onChange={(e) => setShowSecrets(e.target.checked)}
                  size="small"
                />
              }
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {showSecrets ? <VisibilityIcon fontSize="small" /> : <VisibilityOffIcon fontSize="small" />}
                  <Typography variant="body2">Show secrets</Typography>
                </Box>
              }
            />
          </Box>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleAddValue}
            disabled={configSet?.isLocked}
            sx={{
              background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.purple} 100%)`,
            }}
          >
            Add Value
          </Button>
        </Box>
      </Paper>

      {/* Values Table */}
      <TableContainer component={Paper} sx={{ bgcolor: colors.slateLight }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>Key</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Value</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 100 }}>Type</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 80 }}>Version</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 120 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredValues.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">
                    {searchQuery ? 'No matching values found' : 'No configuration values yet'}
                  </Typography>
                  {!searchQuery && (
                    <Button
                      startIcon={<AddIcon />}
                      onClick={handleAddValue}
                      sx={{ mt: 2 }}
                    >
                      Add your first value
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              filteredValues.map((value) => (
                <TableRow key={value.id} hover>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography fontFamily="monospace" fontWeight={500}>
                        {value.key}
                      </Typography>
                      {value.isSecret && (
                        <LockIcon sx={{ fontSize: 14, color: colors.rose }} />
                      )}
                    </Box>
                    {value.description && (
                      <Typography variant="caption" color="text.secondary">
                        {value.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography
                        fontFamily="monospace"
                        sx={{
                          maxWidth: 400,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {getDisplayValue(value)}
                      </Typography>
                      <IconButton
                        size="small"
                        onClick={() => handleCopyValue(value.value)}
                        sx={{ opacity: 0.5, '&:hover': { opacity: 1 } }}
                      >
                        <CopyIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={value.valueType}
                      size="small"
                      sx={{
                        bgcolor: `${getValueTypeColor(value.valueType)}20`,
                        color: getValueTypeColor(value.valueType),
                        fontSize: '0.7rem',
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      v{value.version}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <Tooltip title="Edit">
                        <IconButton
                          size="small"
                          onClick={() => handleEditValue(value)}
                          disabled={configSet?.isLocked}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="History">
                        <IconButton size="small">
                          <HistoryIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          onClick={() => handleDeleteValue(value.id)}
                          disabled={configSet?.isLocked}
                          sx={{ color: colors.rose }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Edit/Add Dialog */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingValue ? 'Edit Configuration Value' : 'Add Configuration Value'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="Key"
              value={newValueKey}
              onChange={(e) => setNewValueKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
              fullWidth
              placeholder="e.g., DATABASE_URL"
              disabled={!!editingValue}
              helperText="Use UPPER_SNAKE_CASE"
            />
            <FormControl fullWidth>
              <InputLabel>Type</InputLabel>
              <Select
                value={newValueType}
                label="Type"
                onChange={(e) => setNewValueType(e.target.value)}
              >
                <MenuItem value="string">String</MenuItem>
                <MenuItem value="number">Number</MenuItem>
                <MenuItem value="boolean">Boolean</MenuItem>
                <MenuItem value="json">JSON</MenuItem>
                <MenuItem value="secret">Secret</MenuItem>
              </Select>
            </FormControl>
            {newValueType === 'boolean' ? (
              <FormControlLabel
                control={
                  <Switch
                    checked={newValueValue === 'true'}
                    onChange={(e) => setNewValueValue(e.target.checked ? 'true' : 'false')}
                  />
                }
                label="Value"
              />
            ) : (
              <TextField
                label="Value"
                value={newValueValue}
                onChange={(e) => setNewValueValue(e.target.value)}
                fullWidth
                multiline={newValueType === 'json'}
                rows={newValueType === 'json' ? 4 : 1}
                type={newValueType === 'secret' && !showSecrets ? 'password' : 'text'}
                placeholder={
                  newValueType === 'json' ? '{"key": "value"}' :
                  newValueType === 'number' ? '123' :
                  newValueType === 'secret' ? 'Enter secret value...' :
                  'Enter value...'
                }
              />
            )}
            <TextField
              label="Description (optional)"
              value={newValueDescription}
              onChange={(e) => setNewValueDescription(e.target.value)}
              fullWidth
              placeholder="Describe what this value is used for"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={newValueIsSecret || newValueType === 'secret'}
                  onChange={(e) => setNewValueIsSecret(e.target.checked)}
                  disabled={newValueType === 'secret'}
                />
              }
              label="Mark as secret (will be encrypted and masked)"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSaveValue}
            disabled={!newValueKey || saving}
            startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* More Menu */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
      >
        <MenuItem onClick={() => {
          setMenuAnchor(null);
          // Navigate to compare
        }}>
          Compare with another set
        </MenuItem>
        <MenuItem onClick={() => {
          setMenuAnchor(null);
          // Clone action
        }}>
          Clone this set
        </MenuItem>
        <MenuItem onClick={() => {
          setMenuAnchor(null);
          // Validate action
        }}>
          Validate against schema
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => {
          setMenuAnchor(null);
          // Toggle lock
        }}>
          {configSet?.isLocked ? 'Unlock' : 'Lock'} config set
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => setMenuAnchor(null)}
          sx={{ color: colors.rose }}
        >
          Delete config set
        </MenuItem>
      </Menu>
    </Box>
  );
}
