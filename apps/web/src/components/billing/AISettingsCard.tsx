import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Alert,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  TextField,
  FormControlLabel,
  Switch,
  Divider,
  LinearProgress,
  Chip,
  Menu,
} from '@mui/material';
import {
  Save as SaveIcon,
  Delete as DeleteIcon,
  ShoppingCart as CartIcon,
} from '@mui/icons-material';
import { colors } from '../../theme';
import { api } from '../../lib/api';
import SecretInput from '../config/SecretInput';

interface AISettingsCardProps {
  organizationId: string;
  orgSlug: string;
  isAdmin: boolean;
  tier: string;
}

interface EmbeddingConfig {
  provider: string | null;
  model: string | null;
  hasKey: boolean;
  enabled: boolean;
  semanticSearchEnabled: boolean;
  aiAssistantEnabled: boolean;
  credits: {
    balance: number;
    monthlyAllowance: number;
  };
}

const PROVIDER_MODELS: Record<string, string> = {
  openrouter: 'openai/text-embedding-3-small',
  openai: 'text-embedding-3-small',
  anthropic: 'claude-3-haiku-20240307',
};

const CREDIT_PACKS = [
  { pack: '500', credits: 500, price: '$5' },
  { pack: '2000', credits: 2000, price: '$15' },
  { pack: '5000', credits: 5000, price: '$30' },
] as const;

export default function AISettingsCard({
  organizationId,
  orgSlug,
  isAdmin,
  tier,
}: AISettingsCardProps) {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('openrouter');
  const [model, setModel] = useState('');
  const [semanticSearch, setSemanticSearch] = useState(true);
  const [aiAssistant, setAiAssistant] = useState(true);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [buyMenuAnchor, setBuyMenuAnchor] = useState<null | HTMLElement>(null);
  const [buyLoading, setBuyLoading] = useState(false);

  const { data: config } = useQuery<EmbeddingConfig>({
    queryKey: ['embedding-config', orgSlug],
    queryFn: async () => {
      const res = await api.get(`/api/v1/orgs/${orgSlug}/embedding-config`);
      return res.data;
    },
    enabled: !!orgSlug,
  });

  // Initialize form from config
  useEffect(() => {
    if (config) {
      setProvider(config.provider || 'openrouter');
      setModel(config.model || '');
      setSemanticSearch(config.semanticSearchEnabled);
      setAiAssistant(config.aiAssistantEnabled);
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, any> = {
        provider,
        semanticSearchEnabled: semanticSearch,
        aiAssistantEnabled: aiAssistant,
      };
      if (apiKey) body.apiKey = apiKey;
      if (model) body.model = model;
      await api.put(`/api/v1/orgs/${orgSlug}/embedding-config`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['embedding-config', orgSlug] });
      setApiKey('');
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => api.delete(`/api/v1/orgs/${orgSlug}/embedding-config`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['embedding-config', orgSlug] });
      setApiKey('');
    },
  });

  const handleBuyCredits = async (pack: string) => {
    setBuyMenuAnchor(null);
    setBuyLoading(true);
    try {
      const res = await api.post('/api/stripe/buy-credits', {
        organizationId,
        pack,
        successUrl: `${window.location.origin}/orgs/${orgSlug}/settings?checkout=success`,
        cancelUrl: `${window.location.origin}/orgs/${orgSlug}/settings?checkout=canceled`,
      });
      window.location.href = res.data.url;
    } catch {
      setBuyLoading(false);
    }
  };

  const balance = config?.credits?.balance ?? 0;
  const monthlyAllowance = config?.credits?.monthlyAllowance ?? 0;
  const isPaidTier = tier === 'pro' || tier === 'enterprise';
  const lowBalance = balance < 50 && balance > 0;

  return (
    <Card sx={{ mb: 4 }}>
      <CardContent>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
          AI & Embeddings
        </Typography>

        {/* Credits Section */}
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Credits
            </Typography>
            {isPaidTier && (
              <Chip
                label={`${monthlyAllowance.toLocaleString()} credits/month included`}
                size="small"
                sx={{ backgroundColor: colors.green, color: 'white' }}
              />
            )}
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1 }}>
            <Typography variant="h4" sx={{ fontWeight: 700 }}>
              {balance.toLocaleString()}
            </Typography>
            <Typography variant="body2" sx={{ color: colors.textMuted }}>
              credits remaining
            </Typography>
          </Box>

          {monthlyAllowance > 0 && (
            <LinearProgress
              variant="determinate"
              value={Math.min(100, (balance / monthlyAllowance) * 100)}
              sx={{
                mb: 1,
                height: 6,
                borderRadius: 3,
                backgroundColor: 'rgba(255,255,255,0.1)',
                '& .MuiLinearProgress-bar': {
                  backgroundColor: lowBalance ? colors.coral : colors.green,
                  borderRadius: 3,
                },
              }}
            />
          )}

          {lowBalance && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Low balance! Purchase more credits to continue using platform AI.
            </Alert>
          )}

          {balance === 0 && !config?.hasKey && (
            <Alert severity="info" sx={{ mb: 2 }}>
              No credits remaining. Buy a credit pack or add your own API key (BYOK) to use AI features.
            </Alert>
          )}

          {isAdmin && (
            <Box>
              <Button
                variant="outlined"
                size="small"
                startIcon={<CartIcon />}
                onClick={(e) => setBuyMenuAnchor(e.currentTarget)}
                disabled={buyLoading}
              >
                {buyLoading ? 'Redirecting...' : 'Buy Credits'}
              </Button>
              <Menu
                anchorEl={buyMenuAnchor}
                open={!!buyMenuAnchor}
                onClose={() => setBuyMenuAnchor(null)}
              >
                {CREDIT_PACKS.map((p) => (
                  <MenuItem key={p.pack} onClick={() => handleBuyCredits(p.pack)}>
                    {p.credits.toLocaleString()} credits &mdash; {p.price}
                  </MenuItem>
                ))}
              </Menu>
            </Box>
          )}
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* BYOK Section */}
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2 }}>
            Bring Your Own Key (BYOK)
          </Typography>

          <Typography variant="body2" sx={{ color: colors.textMuted, mb: 2 }}>
            Use your own API key for embeddings and AI features. No credits consumed when using your own key.
          </Typography>

          {config?.hasKey && (
            <Alert severity="success" sx={{ mb: 2 }}>
              BYOK key configured ({config.provider}). AI usage does not consume credits.
            </Alert>
          )}

          {saveSuccess && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Configuration saved.
            </Alert>
          )}

          {saveMutation.error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              Failed to save configuration.
            </Alert>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Provider</InputLabel>
              <Select
                value={provider}
                label="Provider"
                onChange={(e) => {
                  setProvider(e.target.value);
                  setModel(PROVIDER_MODELS[e.target.value] || '');
                }}
                disabled={!isAdmin}
              >
                <MenuItem value="openrouter">OpenRouter (recommended)</MenuItem>
                <MenuItem value="openai">OpenAI</MenuItem>
                <MenuItem value="anthropic">Anthropic</MenuItem>
              </Select>
            </FormControl>

            <SecretInput
              label="API Key"
              value={apiKey}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)}
              placeholder={config?.hasKey ? 'Key configured (enter new to replace)' : `Enter ${provider} API key`}
              fullWidth
              size="small"
              showCopyButton={false}
              disabled={!isAdmin}
            />

            <TextField
              label="Model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={PROVIDER_MODELS[provider] || 'Model identifier'}
              fullWidth
              size="small"
              helperText="Leave blank for default"
              disabled={!isAdmin}
            />

            <Box sx={{ display: 'flex', gap: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={semanticSearch}
                    onChange={(e) => setSemanticSearch(e.target.checked)}
                    disabled={!isAdmin}
                    size="small"
                  />
                }
                label="Semantic Search"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={aiAssistant}
                    onChange={(e) => setAiAssistant(e.target.checked)}
                    disabled={!isAdmin}
                    size="small"
                  />
                }
                label="AI Assistant"
              />
            </Box>

            {isAdmin && (
              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                {config?.hasKey && (
                  <Button
                    variant="outlined"
                    color="error"
                    size="small"
                    startIcon={<DeleteIcon />}
                    onClick={() => removeMutation.mutate()}
                    disabled={removeMutation.isPending}
                  >
                    Remove Key
                  </Button>
                )}
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<SaveIcon />}
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? 'Saving...' : 'Save'}
                </Button>
              </Box>
            )}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
