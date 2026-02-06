import { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  Chip,
  Divider,
  IconButton,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Alert,
  CircularProgress,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  ExpandMore as ExpandIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { colors } from '../../theme';
import { useAuth } from '../../contexts/AuthContext';

interface FlagRule {
  id: string;
  conditions: Array<{
    attribute: string;
    operator: string;
    values: unknown[];
  }>;
  segmentId?: string;
  percentage?: number;
  serveValue: unknown;
  priority: number;
}

interface FlagEnvironment {
  id: string;
  environment: string;
  isEnabled: boolean;
  overrideValue?: unknown;
  rolloutPercentage?: number;
  rules: FlagRule[];
}

interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description?: string;
  valueType: 'boolean' | 'string' | 'number' | 'json';
  defaultValue: unknown;
  tags: string[];
  isArchived: boolean;
  environments: FlagEnvironment[];
}

interface Segment {
  id: string;
  key: string;
  name: string;
}

const OPERATORS = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'in', label: 'is in list' },
  { value: 'notIn', label: 'is not in list' },
  { value: 'contains', label: 'contains' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'endsWith', label: 'ends with' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'exists', label: 'exists' },
  { value: 'notExists', label: 'does not exist' },
  { value: 'semverGt', label: 'semver >' },
  { value: 'semverGte', label: 'semver >=' },
  { value: 'semverLt', label: 'semver <' },
  { value: 'semverLte', label: 'semver <=' },
  { value: 'semverEq', label: 'semver =' },
];

// API functions
async function fetchFlag(orgId: string, key: string): Promise<{ flag: FeatureFlag }> {
  const response = await fetch(`/api/v1/flags/${key}?organizationId=${orgId}`);
  if (!response.ok) throw new Error('Failed to fetch flag');
  return response.json();
}

async function createFlag(orgId: string, data: Partial<FeatureFlag>): Promise<{ flag: FeatureFlag }> {
  const response = await fetch('/api/v1/flags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, organizationId: orgId }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create flag');
  }
  return response.json();
}

async function updateFlag(orgId: string, key: string, data: Partial<FeatureFlag>): Promise<{ flag: FeatureFlag }> {
  const response = await fetch(`/api/v1/flags/${key}?organizationId=${orgId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to update flag');
  return response.json();
}

async function updateEnvironment(
  orgId: string,
  key: string,
  env: string,
  data: Partial<FlagEnvironment>
): Promise<void> {
  const response = await fetch(`/api/v1/flags/${key}/environments/${env}?organizationId=${orgId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to update environment');
}

async function addRule(orgId: string, key: string, env: string, rule: Partial<FlagRule>): Promise<void> {
  const response = await fetch(`/api/v1/flags/${key}/environments/${env}/rules?organizationId=${orgId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  });
  if (!response.ok) throw new Error('Failed to add rule');
}

async function deleteRule(orgId: string, key: string, env: string, ruleId: string): Promise<void> {
  const response = await fetch(`/api/v1/flags/${key}/environments/${env}/rules/${ruleId}?organizationId=${orgId}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete rule');
}

async function fetchSegments(orgId: string): Promise<{ segments: Segment[] }> {
  const response = await fetch(`/api/v1/flags/segments?organizationId=${orgId}`);
  if (!response.ok) return { segments: [] };
  return response.json();
}

export default function FlagEditor() {
  const navigate = useNavigate();
  const { key } = useParams<{ key: string }>();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  useAuth(); // Ensure user is authenticated

  const isNew = key === 'new';
  const orgId = searchParams.get('organizationId') || 'default-org';

  // Form state
  const [flagKey, setFlagKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [valueType, setValueType] = useState<'boolean' | 'string' | 'number' | 'json'>('boolean');
  const [defaultValue, setDefaultValue] = useState<string>('false');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [expandedEnv, setExpandedEnv] = useState<string | false>('production');
  const [addRuleDialogOpen, setAddRuleDialogOpen] = useState(false);
  const [ruleEnvironment, setRuleEnvironment] = useState('');
  const [newRule, setNewRule] = useState<Partial<FlagRule>>({
    conditions: [{ attribute: '', operator: 'eq', values: [] }],
    serveValue: true,
  });

  // Fetch existing flag if editing
  const { data: flagData, isLoading } = useQuery({
    queryKey: ['feature-flag', orgId, key],
    queryFn: () => fetchFlag(orgId, key!),
    enabled: !isNew && !!key && !!orgId,
  });

  const { data: segmentsData } = useQuery({
    queryKey: ['feature-flag-segments', orgId],
    queryFn: () => fetchSegments(orgId),
    enabled: !!orgId,
  });

  // Populate form when flag data loads
  useEffect(() => {
    if (flagData?.flag) {
      const flag = flagData.flag;
      setFlagKey(flag.key);
      setName(flag.name);
      setDescription(flag.description || '');
      setValueType(flag.valueType);
      setDefaultValue(JSON.stringify(flag.defaultValue));
      setTags(flag.tags);
    }
  }, [flagData]);

  const createMutation = useMutation({
    mutationFn: (data: Partial<FeatureFlag>) => createFlag(orgId, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['feature-flags'] });
      navigate(`/dashboard/flags/${result.flag.key}?organizationId=${orgId}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<FeatureFlag>) => updateFlag(orgId, key!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feature-flags'] });
      queryClient.invalidateQueries({ queryKey: ['feature-flag', orgId, key] });
    },
  });

  const envMutation = useMutation({
    mutationFn: ({ env, data }: { env: string; data: Partial<FlagEnvironment> }) =>
      updateEnvironment(orgId, key!, env, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feature-flag', orgId, key] });
    },
  });

  const addRuleMutation = useMutation({
    mutationFn: ({ env, rule }: { env: string; rule: Partial<FlagRule> }) =>
      addRule(orgId, key!, env, rule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feature-flag', orgId, key] });
      setAddRuleDialogOpen(false);
      setNewRule({ conditions: [{ attribute: '', operator: 'eq', values: [] }], serveValue: true });
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: ({ env, ruleId }: { env: string; ruleId: string }) =>
      deleteRule(orgId, key!, env, ruleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feature-flag', orgId, key] });
    },
  });

  const handleSubmit = () => {
    let parsedDefault: unknown;
    try {
      parsedDefault = JSON.parse(defaultValue);
    } catch {
      parsedDefault = defaultValue;
    }

    const data: Partial<FeatureFlag> = {
      key: flagKey,
      name,
      description: description || undefined,
      valueType,
      defaultValue: parsedDefault,
      tags,
    };

    if (isNew) {
      createMutation.mutate(data);
    } else {
      updateMutation.mutate(data);
    }
  };

  const handleAddTag = () => {
    if (tagInput && !tags.includes(tagInput)) {
      setTags([...tags, tagInput]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleToggleEnv = (env: string, enabled: boolean) => {
    envMutation.mutate({ env, data: { isEnabled: enabled } });
  };

  const handleRolloutChange = (env: string, percentage: number | null) => {
    envMutation.mutate({ env, data: { rolloutPercentage: percentage ?? undefined } });
  };

  const openAddRuleDialog = (env: string) => {
    setRuleEnvironment(env);
    setAddRuleDialogOpen(true);
  };

  const handleAddRule = () => {
    addRuleMutation.mutate({ env: ruleEnvironment, rule: newRule });
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  const environments = ['development', 'staging', 'production'];
  const flag = flagData?.flag;

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <IconButton onClick={() => navigate('/dashboard/flags')}>
          <BackIcon />
        </IconButton>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 700, color: colors.textLight }}>
            {isNew ? 'Create Feature Flag' : `Edit ${flag?.key || key}`}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          onClick={handleSubmit}
          disabled={createMutation.isPending || updateMutation.isPending || !flagKey || !name}
          sx={{
            background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.purple} 100%)`,
          }}
        >
          {isNew ? 'Create' : 'Save Changes'}
        </Button>
      </Box>

      {(createMutation.isError || updateMutation.isError) && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {(createMutation.error as Error)?.message || (updateMutation.error as Error)?.message || 'An error occurred'}
        </Alert>
      )}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
        {/* Basic Info */}
        <Box sx={{ flex: 1 }}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
              Basic Information
            </Typography>

            <TextField
              label="Flag Key"
              value={flagKey}
              onChange={(e) => setFlagKey(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
              fullWidth
              required
              disabled={!isNew}
              helperText="Unique identifier (lowercase, alphanumeric, dashes, underscores)"
              sx={{ mb: 2 }}
            />

            <TextField
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              required
              sx={{ mb: 2 }}
            />

            <TextField
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              fullWidth
              multiline
              rows={2}
              sx={{ mb: 2 }}
            />

            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Value Type</InputLabel>
              <Select
                value={valueType}
                onChange={(e) => setValueType(e.target.value as typeof valueType)}
                label="Value Type"
                disabled={!isNew}
              >
                <MenuItem value="boolean">Boolean</MenuItem>
                <MenuItem value="string">String</MenuItem>
                <MenuItem value="number">Number</MenuItem>
                <MenuItem value="json">JSON</MenuItem>
              </Select>
            </FormControl>

            <TextField
              label="Default Value"
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
              fullWidth
              helperText={valueType === 'boolean' ? 'true or false' : valueType === 'json' ? 'Valid JSON' : ''}
              sx={{ mb: 2 }}
            />

            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" sx={{ mb: 1, color: colors.textMuted }}>
                Tags
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                {tags.map((tag) => (
                  <Chip key={tag} label={tag} onDelete={() => handleRemoveTag(tag)} size="small" />
                ))}
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  size="small"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="Add tag..."
                  onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
                />
                <Button variant="outlined" size="small" onClick={handleAddTag}>
                  Add
                </Button>
              </Box>
            </Box>

            {!isNew && flag?.key && (
              <Box sx={{ mt: 2, p: 2, backgroundColor: colors.slate, borderRadius: 1 }}>
                <Typography variant="caption" sx={{ color: colors.textMuted }}>
                  SDK Usage Example
                </Typography>
                <Box
                  sx={{
                    mt: 1,
                    p: 1,
                    backgroundColor: colors.slateLight,
                    borderRadius: 1,
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <code>{`flags.isEnabled('${flag.key}')`}</code>
                  <IconButton
                    size="small"
                    onClick={() => navigator.clipboard.writeText(`flags.isEnabled('${flag.key}')`)}
                  >
                    <CopyIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Box>
            )}
          </Paper>
        </Box>

        {/* Environment Configuration */}
        {!isNew && (
          <Box sx={{ flex: 1 }}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                Environment Configuration
              </Typography>

              {environments.map((env) => {
                const envConfig = flag?.environments?.find((e) => e.environment === env);
                const isEnabled = envConfig?.isEnabled ?? false;
                const rollout = envConfig?.rolloutPercentage;
                const rules = envConfig?.rules || [];

                return (
                  <Accordion
                    key={env}
                    expanded={expandedEnv === env}
                    onChange={(_, expanded) => setExpandedEnv(expanded ? env : false)}
                    sx={{ mb: 1 }}
                  >
                    <AccordionSummary expandIcon={<ExpandIcon />}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1 }}>
                        <Switch
                          checked={isEnabled}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleToggleEnv(env, e.target.checked);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <Typography sx={{ textTransform: 'capitalize', fontWeight: 600 }}>
                          {env}
                        </Typography>
                        <Chip
                          label={isEnabled ? 'ON' : 'OFF'}
                          size="small"
                          color={isEnabled ? 'success' : 'default'}
                          sx={{ height: 20, fontSize: '0.7rem' }}
                        />
                        {rollout !== undefined && rollout !== null && (
                          <Chip
                            label={`${rollout}% rollout`}
                            size="small"
                            sx={{ height: 20, fontSize: '0.7rem' }}
                          />
                        )}
                        {rules.length > 0 && (
                          <Chip
                            label={`${rules.length} rules`}
                            size="small"
                            sx={{ height: 20, fontSize: '0.7rem' }}
                          />
                        )}
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="body2" sx={{ color: colors.textMuted, mb: 1 }}>
                          Rollout Percentage
                        </Typography>
                        <TextField
                          type="number"
                          size="small"
                          value={rollout ?? ''}
                          onChange={(e) => {
                            const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                            handleRolloutChange(env, val);
                          }}
                          inputProps={{ min: 0, max: 100 }}
                          placeholder="100% (default)"
                          sx={{ width: 150 }}
                        />
                      </Box>

                      <Divider sx={{ my: 2 }} />

                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          Targeting Rules
                        </Typography>
                        <Button
                          size="small"
                          startIcon={<AddIcon />}
                          onClick={() => openAddRuleDialog(env)}
                        >
                          Add Rule
                        </Button>
                      </Box>

                      {rules.length === 0 ? (
                        <Typography variant="body2" sx={{ color: colors.textMuted, fontStyle: 'italic' }}>
                          No targeting rules. All users will receive the default/override value.
                        </Typography>
                      ) : (
                        <List dense>
                          {rules.map((rule) => (
                            <ListItem key={rule.id} sx={{ backgroundColor: colors.slate, borderRadius: 1, mb: 0.5 }}>
                              <ListItemText
                                primary={
                                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                    {rule.conditions.map((c) => `${c.attribute} ${c.operator} ${JSON.stringify(c.values)}`).join(' AND ')}
                                    {rule.percentage !== undefined && ` (${rule.percentage}%)`}
                                  </Typography>
                                }
                                secondary={`Serve: ${JSON.stringify(rule.serveValue)} | Priority: ${rule.priority}`}
                              />
                              <ListItemSecondaryAction>
                                <IconButton
                                  size="small"
                                  onClick={() => deleteRuleMutation.mutate({ env, ruleId: rule.id })}
                                >
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </ListItemSecondaryAction>
                            </ListItem>
                          ))}
                        </List>
                      )}
                    </AccordionDetails>
                  </Accordion>
                );
              })}
            </Paper>
          </Box>
        )}
      </Stack>

      {/* Add Rule Dialog */}
      <Dialog open={addRuleDialogOpen} onClose={() => setAddRuleDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Targeting Rule for {ruleEnvironment}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" sx={{ mb: 1, fontWeight: 600 }}>
              Conditions (AND)
            </Typography>
            {newRule.conditions?.map((condition, idx) => (
              <Box key={idx} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                <TextField
                  size="small"
                  placeholder="Attribute (e.g., userId)"
                  value={condition.attribute}
                  onChange={(e) => {
                    const updated = [...(newRule.conditions || [])];
                    updated[idx] = { ...condition, attribute: e.target.value };
                    setNewRule({ ...newRule, conditions: updated });
                  }}
                  sx={{ flex: 1 }}
                />
                <FormControl size="small" sx={{ minWidth: 120 }}>
                  <Select
                    value={condition.operator}
                    onChange={(e) => {
                      const updated = [...(newRule.conditions || [])];
                      updated[idx] = { ...condition, operator: e.target.value };
                      setNewRule({ ...newRule, conditions: updated });
                    }}
                  >
                    {OPERATORS.map((op) => (
                      <MenuItem key={op.value} value={op.value}>{op.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  size="small"
                  placeholder="Values (comma-sep)"
                  value={(condition.values as string[])?.join(', ') || ''}
                  onChange={(e) => {
                    const updated = [...(newRule.conditions || [])];
                    updated[idx] = { ...condition, values: e.target.value.split(',').map((v) => v.trim()) };
                    setNewRule({ ...newRule, conditions: updated });
                  }}
                  sx={{ flex: 1 }}
                />
                {idx > 0 && (
                  <IconButton
                    size="small"
                    onClick={() => {
                      const updated = newRule.conditions?.filter((_, i) => i !== idx);
                      setNewRule({ ...newRule, conditions: updated });
                    }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                )}
              </Box>
            ))}
            <Button
              size="small"
              onClick={() => {
                setNewRule({
                  ...newRule,
                  conditions: [...(newRule.conditions || []), { attribute: '', operator: 'eq', values: [] }],
                });
              }}
            >
              Add Condition
            </Button>

            <Divider sx={{ my: 2 }} />

            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                size="small"
                label="Serve Value"
                value={JSON.stringify(newRule.serveValue)}
                onChange={(e) => {
                  try {
                    setNewRule({ ...newRule, serveValue: JSON.parse(e.target.value) });
                  } catch {
                    setNewRule({ ...newRule, serveValue: e.target.value });
                  }
                }}
                helperText="Value to serve when rule matches"
              />
              <TextField
                size="small"
                label="Percentage"
                type="number"
                value={newRule.percentage ?? ''}
                onChange={(e) => setNewRule({ ...newRule, percentage: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                inputProps={{ min: 0, max: 100 }}
                helperText="Optional % of matching users"
              />
            </Box>

            {segmentsData?.segments && segmentsData.segments.length > 0 && (
              <FormControl fullWidth size="small" sx={{ mt: 2 }}>
                <InputLabel>Use Segment (optional)</InputLabel>
                <Select
                  value={newRule.segmentId || ''}
                  onChange={(e) => setNewRule({ ...newRule, segmentId: e.target.value || undefined })}
                  label="Use Segment (optional)"
                >
                  <MenuItem value="">None</MenuItem>
                  {segmentsData.segments.map((seg) => (
                    <MenuItem key={seg.id} value={seg.id}>{seg.name} ({seg.key})</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddRuleDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleAddRule}
            disabled={addRuleMutation.isPending || !newRule.conditions?.some((c) => c.attribute)}
          >
            Add Rule
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
