import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  FormControlLabel,
  RadioGroup,
  Radio,
  TextField,
  Switch,
  Box,
  Typography,
  Alert,
  CircularProgress,
  Select,
  MenuItem,
  InputLabel,
  Divider,
} from '@mui/material';
import {
  Download as DownloadIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material';
import { colors } from '../../theme';

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  configSetId: string;
  configSetName: string;
}

type ExportFormat = 'dotenv' | 'json' | 'yaml' | 'k8s_configmap' | 'k8s_secret' | 'terraform';

const formatDescriptions: Record<ExportFormat, string> = {
  dotenv: 'Standard .env file format for Node.js, Python, etc.',
  json: 'JSON object with key-value pairs',
  yaml: 'YAML format for configuration files',
  k8s_configmap: 'Kubernetes ConfigMap manifest',
  k8s_secret: 'Kubernetes Secret manifest (base64 encoded)',
  terraform: 'Terraform variable definitions',
};

export default function ExportDialog({
  open,
  onClose,
  configSetId,
  configSetName,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('dotenv');
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [keyPrefix, setKeyPrefix] = useState('');
  const [keyTransform, setKeyTransform] = useState<'none' | 'uppercase' | 'lowercase'>('none');
  const [exporting, setExporting] = useState(false);
  const [exportedContent, setExportedContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        format,
        includeSecrets: String(includeSecrets),
      });
      if (keyPrefix) params.append('keyPrefix', keyPrefix);
      if (keyTransform !== 'none') params.append('keyTransform', keyTransform);

      const response = await fetch(
        `/api/v1/config/sets/${configSetId}/export?${params}`,
        {
          method: 'POST',
          credentials: 'include',
        }
      );

      if (!response.ok) {
        throw new Error('Failed to export configuration');
      }

      const content = await response.text();
      setExportedContent(content);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleDownload = () => {
    if (!exportedContent) return;

    const extensions: Record<ExportFormat, string> = {
      dotenv: '.env',
      json: '.json',
      yaml: '.yaml',
      k8s_configmap: '-configmap.yaml',
      k8s_secret: '-secret.yaml',
      terraform: '.tf',
    };

    const blob = new Blob([exportedContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${configSetName}${extensions[format]}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopy = () => {
    if (exportedContent) {
      navigator.clipboard.writeText(exportedContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setExportedContent(null);
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>Export Configuration</DialogTitle>
      <DialogContent>
        {!exportedContent ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
            {/* Format Selection */}
            <FormControl>
              <Typography variant="subtitle2" gutterBottom>
                Export Format
              </Typography>
              <RadioGroup
                value={format}
                onChange={(e) => setFormat(e.target.value as ExportFormat)}
              >
                {(Object.keys(formatDescriptions) as ExportFormat[]).map((fmt) => (
                  <FormControlLabel
                    key={fmt}
                    value={fmt}
                    control={<Radio />}
                    label={
                      <Box>
                        <Typography fontWeight={500}>
                          {fmt.replace('_', ' ').toUpperCase()}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatDescriptions[fmt]}
                        </Typography>
                      </Box>
                    }
                    sx={{ mb: 1 }}
                  />
                ))}
              </RadioGroup>
            </FormControl>

            <Divider />

            {/* Options */}
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Options
              </Typography>

              <FormControlLabel
                control={
                  <Switch
                    checked={includeSecrets}
                    onChange={(e) => setIncludeSecrets(e.target.checked)}
                  />
                }
                label="Include secret values"
              />
              {includeSecrets && (
                <Alert severity="warning" sx={{ mt: 1, mb: 2 }}>
                  Secret values will be included in plain text. Handle with care.
                </Alert>
              )}

              <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                <TextField
                  label="Key Prefix"
                  value={keyPrefix}
                  onChange={(e) => setKeyPrefix(e.target.value)}
                  placeholder="e.g., APP_"
                  size="small"
                  sx={{ flex: 1 }}
                  helperText="Prefix to add to all keys"
                />
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel>Key Transform</InputLabel>
                  <Select
                    value={keyTransform}
                    label="Key Transform"
                    onChange={(e) => setKeyTransform(e.target.value as typeof keyTransform)}
                  >
                    <MenuItem value="none">None</MenuItem>
                    <MenuItem value="uppercase">UPPERCASE</MenuItem>
                    <MenuItem value="lowercase">lowercase</MenuItem>
                  </Select>
                </FormControl>
              </Box>
            </Box>

            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
          </Box>
        ) : (
          <Box sx={{ mt: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="subtitle2">
                Exported {format.toUpperCase()}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  size="small"
                  startIcon={<CopyIcon />}
                  onClick={handleCopy}
                  color={copied ? 'success' : 'inherit'}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
                <Button
                  size="small"
                  startIcon={<DownloadIcon />}
                  onClick={handleDownload}
                  variant="contained"
                >
                  Download
                </Button>
              </Box>
            </Box>
            <Box
              component="pre"
              sx={{
                bgcolor: colors.slateLighter,
                p: 2,
                borderRadius: 1,
                overflow: 'auto',
                maxHeight: 400,
                fontSize: '0.85rem',
                fontFamily: 'monospace',
              }}
            >
              {exportedContent}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>
          {exportedContent ? 'Close' : 'Cancel'}
        </Button>
        {!exportedContent && (
          <Button
            variant="contained"
            onClick={handleExport}
            disabled={exporting}
            startIcon={exporting ? <CircularProgress size={16} /> : <DownloadIcon />}
          >
            {exporting ? 'Exporting...' : 'Export'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
