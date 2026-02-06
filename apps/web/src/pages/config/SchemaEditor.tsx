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
  Breadcrumbs,
  Link,
  Grid,
  Divider,
  CircularProgress,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import { colors } from '../../theme';

interface SchemaKey {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'json' | 'secret';
  required?: boolean;
  default?: unknown;
  description?: string;
  pattern?: string;
  enum?: string[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  deprecated?: boolean;
  deprecationMessage?: string;
}

interface Schema {
  id: string;
  name: string;
  description?: string;
  version: number;
  definition: {
    version: string;
    keys: SchemaKey[];
  };
}

export default function SchemaEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const [schema, setSchema] = useState<Schema | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [keys, setKeys] = useState<SchemaKey[]>([]);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<SchemaKey | null>(null);
  const [editingKeyIndex, setEditingKeyIndex] = useState<number>(-1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state for key editor
  const [keyName, setKeyName] = useState('');
  const [keyType, setKeyType] = useState<SchemaKey['type']>('string');
  const [keyRequired, setKeyRequired] = useState(false);
  const [keyDefault, setKeyDefault] = useState('');
  const [keyDescription, setKeyDescription] = useState('');
  const [keyPattern, setKeyPattern] = useState('');
  const [keyEnum, setKeyEnum] = useState('');
  const [keyMin, setKeyMin] = useState('');
  const [keyMax, setKeyMax] = useState('');
  const [keyMinLength, setKeyMinLength] = useState('');
  const [keyMaxLength, setKeyMaxLength] = useState('');
  const [keyDeprecated, setKeyDeprecated] = useState(false);
  const [keyDeprecationMessage, setKeyDeprecationMessage] = useState('');

  // Mock data
  useEffect(() => {
    if (!isNew) {
      setSchema({
        id: id!,
        name: 'App Config',
        description: 'Configuration schema for the main application',
        version: 3,
        definition: {
          version: '1.0',
          keys: [
            { key: 'DATABASE_URL', type: 'secret', required: true, description: 'Primary database connection string' },
            { key: 'NODE_ENV', type: 'string', required: true, enum: ['development', 'staging', 'production'], default: 'development' },
            { key: 'LOG_LEVEL', type: 'string', enum: ['debug', 'info', 'warn', 'error'], default: 'info' },
            { key: 'MAX_CONNECTIONS', type: 'number', min: 1, max: 1000, default: 100 },
            { key: 'ENABLE_CACHE', type: 'boolean', default: true },
            { key: 'API_TIMEOUT', type: 'number', min: 1000, max: 60000, default: 30000, description: 'API timeout in milliseconds' },
            { key: 'OLD_SETTING', type: 'string', deprecated: true, deprecationMessage: 'Use NEW_SETTING instead' },
          ],
        },
      });
      setName('App Config');
      setDescription('Configuration schema for the main application');
      setKeys([
        { key: 'DATABASE_URL', type: 'secret', required: true, description: 'Primary database connection string' },
        { key: 'NODE_ENV', type: 'string', required: true, enum: ['development', 'staging', 'production'], default: 'development' },
        { key: 'LOG_LEVEL', type: 'string', enum: ['debug', 'info', 'warn', 'error'], default: 'info' },
        { key: 'MAX_CONNECTIONS', type: 'number', min: 1, max: 1000, default: 100 },
        { key: 'ENABLE_CACHE', type: 'boolean', default: true },
        { key: 'API_TIMEOUT', type: 'number', min: 1000, max: 60000, default: 30000, description: 'API timeout in milliseconds' },
        { key: 'OLD_SETTING', type: 'string', deprecated: true, deprecationMessage: 'Use NEW_SETTING instead' },
      ]);
    }
  }, [id, isNew]);

  const handleAddKey = () => {
    setEditingKey(null);
    setEditingKeyIndex(-1);
    resetKeyForm();
    setEditDialogOpen(true);
  };

  const handleEditKey = (key: SchemaKey, index: number) => {
    setEditingKey(key);
    setEditingKeyIndex(index);
    setKeyName(key.key);
    setKeyType(key.type);
    setKeyRequired(key.required ?? false);
    setKeyDefault(key.default !== undefined ? String(key.default) : '');
    setKeyDescription(key.description ?? '');
    setKeyPattern(key.pattern ?? '');
    setKeyEnum(key.enum?.join(', ') ?? '');
    setKeyMin(key.min !== undefined ? String(key.min) : '');
    setKeyMax(key.max !== undefined ? String(key.max) : '');
    setKeyMinLength(key.minLength !== undefined ? String(key.minLength) : '');
    setKeyMaxLength(key.maxLength !== undefined ? String(key.maxLength) : '');
    setKeyDeprecated(key.deprecated ?? false);
    setKeyDeprecationMessage(key.deprecationMessage ?? '');
    setEditDialogOpen(true);
  };

  const resetKeyForm = () => {
    setKeyName('');
    setKeyType('string');
    setKeyRequired(false);
    setKeyDefault('');
    setKeyDescription('');
    setKeyPattern('');
    setKeyEnum('');
    setKeyMin('');
    setKeyMax('');
    setKeyMinLength('');
    setKeyMaxLength('');
    setKeyDeprecated(false);
    setKeyDeprecationMessage('');
  };

  const handleSaveKey = () => {
    const newKey: SchemaKey = {
      key: keyName,
      type: keyType,
      required: keyRequired || undefined,
      default: keyDefault || undefined,
      description: keyDescription || undefined,
      pattern: keyPattern || undefined,
      enum: keyEnum ? keyEnum.split(',').map(s => s.trim()) : undefined,
      min: keyMin ? parseFloat(keyMin) : undefined,
      max: keyMax ? parseFloat(keyMax) : undefined,
      minLength: keyMinLength ? parseInt(keyMinLength) : undefined,
      maxLength: keyMaxLength ? parseInt(keyMaxLength) : undefined,
      deprecated: keyDeprecated || undefined,
      deprecationMessage: keyDeprecationMessage || undefined,
    };

    if (editingKeyIndex >= 0) {
      const updated = [...keys];
      updated[editingKeyIndex] = newKey;
      setKeys(updated);
    } else {
      setKeys([...keys, newKey]);
    }

    setEditDialogOpen(false);
  };

  const handleDeleteKey = (index: number) => {
    setKeys(keys.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // API call would go here
      await new Promise(resolve => setTimeout(resolve, 500));
      navigate('/dashboard/config/schemas');
    } catch (err) {
      setError('Failed to save schema');
    } finally {
      setSaving(false);
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'secret': return colors.rose;
      case 'number': return colors.cyan;
      case 'boolean': return colors.green;
      case 'json': return colors.amber;
      default: return colors.violet;
    }
  };

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
          onClick={() => navigate('/dashboard/config/schemas')}
          sx={{ color: colors.textMuted, textDecoration: 'none', '&:hover': { color: colors.violet } }}
        >
          Schemas
        </Link>
        <Typography color="text.primary">
          {isNew ? 'New Schema' : schema?.name}
        </Typography>
      </Breadcrumbs>

      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={600} gutterBottom>
            {isNew ? 'Create Config Schema' : 'Edit Config Schema'}
          </Typography>
          <Typography color="text.secondary">
            Define the structure and validation rules for your configuration
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
          onClick={handleSave}
          disabled={saving || !name || keys.length === 0}
          sx={{
            background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.purple} 100%)`,
          }}
        >
          {saving ? 'Saving...' : 'Save Schema'}
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Schema Info */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper sx={{ bgcolor: colors.slateLight, p: 3 }}>
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Schema Details
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label="Schema Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                fullWidth
                required
                placeholder="e.g., App Config"
              />
              <TextField
                label="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                fullWidth
                multiline
                rows={3}
                placeholder="Describe what this schema is for"
              />
              {schema && (
                <Box sx={{ p: 2, bgcolor: colors.slateLighter, borderRadius: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Version: {schema.version}
                  </Typography>
                </Box>
              )}
            </Box>
          </Paper>

          <Paper sx={{ bgcolor: colors.slateLight, p: 3, mt: 3 }}>
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Summary
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">Total Keys</Typography>
                <Typography fontWeight={500}>{keys.length}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">Required</Typography>
                <Typography fontWeight={500}>{keys.filter(k => k.required).length}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">Secrets</Typography>
                <Typography fontWeight={500}>{keys.filter(k => k.type === 'secret').length}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">Deprecated</Typography>
                <Typography fontWeight={500} color={colors.amber}>
                  {keys.filter(k => k.deprecated).length}
                </Typography>
              </Box>
            </Box>
          </Paper>
        </Grid>

        {/* Keys Table */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Paper sx={{ bgcolor: colors.slateLight, p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" fontWeight={600}>
                Schema Keys
              </Typography>
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={handleAddKey}
              >
                Add Key
              </Button>
            </Box>

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Key</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 100 }}>Type</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 80 }}>Required</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Default</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Constraints</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 100 }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {keys.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                        <Typography color="text.secondary">
                          No keys defined yet
                        </Typography>
                        <Button
                          startIcon={<AddIcon />}
                          onClick={handleAddKey}
                          sx={{ mt: 2 }}
                        >
                          Add your first key
                        </Button>
                      </TableCell>
                    </TableRow>
                  ) : (
                    keys.map((key, index) => (
                      <TableRow key={key.key} hover sx={{ opacity: key.deprecated ? 0.6 : 1 }}>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography fontFamily="monospace" fontWeight={500}>
                              {key.key}
                            </Typography>
                            {key.deprecated && (
                              <Tooltip title={key.deprecationMessage || 'Deprecated'}>
                                <WarningIcon sx={{ fontSize: 16, color: colors.amber }} />
                              </Tooltip>
                            )}
                          </Box>
                          {key.description && (
                            <Typography variant="caption" color="text.secondary">
                              {key.description}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={key.type}
                            size="small"
                            sx={{
                              bgcolor: `${getTypeColor(key.type)}20`,
                              color: getTypeColor(key.type),
                              fontSize: '0.7rem',
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          {key.required ? (
                            <Chip label="Yes" size="small" color="primary" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : (
                            <Typography variant="caption" color="text.secondary">No</Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" fontFamily="monospace">
                            {key.default !== undefined ? String(key.default) : '-'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                            {key.enum && (
                              <Chip
                                label={`enum: ${key.enum.length} values`}
                                size="small"
                                sx={{ height: 18, fontSize: '0.65rem' }}
                              />
                            )}
                            {key.pattern && (
                              <Chip label="pattern" size="small" sx={{ height: 18, fontSize: '0.65rem' }} />
                            )}
                            {(key.min !== undefined || key.max !== undefined) && (
                              <Chip
                                label={`${key.min ?? '∞'} - ${key.max ?? '∞'}`}
                                size="small"
                                sx={{ height: 18, fontSize: '0.65rem' }}
                              />
                            )}
                            {(key.minLength !== undefined || key.maxLength !== undefined) && (
                              <Chip
                                label={`len: ${key.minLength ?? 0} - ${key.maxLength ?? '∞'}`}
                                size="small"
                                sx={{ height: 18, fontSize: '0.65rem' }}
                              />
                            )}
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            <IconButton size="small" onClick={() => handleEditKey(key, index)}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={() => handleDeleteKey(index)}
                              sx={{ color: colors.rose }}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>

      {/* Key Editor Dialog */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingKey ? 'Edit Schema Key' : 'Add Schema Key'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Key Name"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
                fullWidth
                required
                disabled={!!editingKey}
                placeholder="e.g., DATABASE_URL"
                helperText="Use UPPER_SNAKE_CASE"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth required>
                <InputLabel>Type</InputLabel>
                <Select
                  value={keyType}
                  label="Type"
                  onChange={(e) => setKeyType(e.target.value as SchemaKey['type'])}
                >
                  <MenuItem value="string">String</MenuItem>
                  <MenuItem value="number">Number</MenuItem>
                  <MenuItem value="boolean">Boolean</MenuItem>
                  <MenuItem value="json">JSON</MenuItem>
                  <MenuItem value="secret">Secret</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Description"
                value={keyDescription}
                onChange={(e) => setKeyDescription(e.target.value)}
                fullWidth
                placeholder="Describe what this configuration is for"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Default Value"
                value={keyDefault}
                onChange={(e) => setKeyDefault(e.target.value)}
                fullWidth
                placeholder="Default value if not set"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={keyRequired}
                    onChange={(e) => setKeyRequired(e.target.checked)}
                  />
                }
                label="Required"
              />
            </Grid>

            <Grid size={{ xs: 12 }}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2" gutterBottom>
                Validation Rules
              </Typography>
            </Grid>

            {keyType === 'string' && (
              <>
                <Grid size={{ xs: 12 }}>
                  <TextField
                    label="Allowed Values (comma-separated)"
                    value={keyEnum}
                    onChange={(e) => setKeyEnum(e.target.value)}
                    fullWidth
                    placeholder="e.g., development, staging, production"
                  />
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <TextField
                    label="Regex Pattern"
                    value={keyPattern}
                    onChange={(e) => setKeyPattern(e.target.value)}
                    fullWidth
                    placeholder="e.g., ^[a-z]+$"
                  />
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <TextField
                    label="Min Length"
                    value={keyMinLength}
                    onChange={(e) => setKeyMinLength(e.target.value)}
                    fullWidth
                    type="number"
                  />
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <TextField
                    label="Max Length"
                    value={keyMaxLength}
                    onChange={(e) => setKeyMaxLength(e.target.value)}
                    fullWidth
                    type="number"
                  />
                </Grid>
              </>
            )}

            {keyType === 'number' && (
              <>
                <Grid size={{ xs: 6 }}>
                  <TextField
                    label="Minimum Value"
                    value={keyMin}
                    onChange={(e) => setKeyMin(e.target.value)}
                    fullWidth
                    type="number"
                  />
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <TextField
                    label="Maximum Value"
                    value={keyMax}
                    onChange={(e) => setKeyMax(e.target.value)}
                    fullWidth
                    type="number"
                  />
                </Grid>
              </>
            )}

            <Grid size={{ xs: 12 }}>
              <Divider sx={{ my: 1 }} />
              <FormControlLabel
                control={
                  <Switch
                    checked={keyDeprecated}
                    onChange={(e) => setKeyDeprecated(e.target.checked)}
                  />
                }
                label="Mark as deprecated"
              />
            </Grid>
            {keyDeprecated && (
              <Grid size={{ xs: 12 }}>
                <TextField
                  label="Deprecation Message"
                  value={keyDeprecationMessage}
                  onChange={(e) => setKeyDeprecationMessage(e.target.value)}
                  fullWidth
                  placeholder="e.g., Use NEW_KEY instead"
                />
              </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSaveKey}
            disabled={!keyName}
          >
            {editingKey ? 'Update' : 'Add'} Key
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
