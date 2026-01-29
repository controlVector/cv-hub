/**
 * PipelineEditorPage
 * Page for editing an existing pipeline's YAML configuration
 */

import { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Breadcrumbs,
  Link,
  CircularProgress,
  Alert,
  IconButton,
} from '@mui/material';
import { ArrowBack, Save, PlayArrow } from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import { colors } from '../../theme';
import { getPipeline, updatePipeline, triggerRun, cicdQueryKeys } from '../../services/ci-cd';
import { PipelineEditor } from '../../components/ci-cd/PipelineEditor';

export function PipelineEditorPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { owner, repo, slug } = useParams<{ owner: string; repo: string; slug: string }>();
  const [yamlContent, setYamlContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch pipeline
  const { data: pipeline, isLoading } = useQuery({
    queryKey: cicdQueryKeys.pipeline(owner!, repo!, slug!),
    queryFn: () => getPipeline(owner!, repo!, slug!),
    enabled: !!owner && !!repo && !!slug,
  });

  // Update pipeline mutation
  const updateMutation = useMutation({
    mutationFn: (yaml: string) => updatePipeline(owner!, repo!, slug!, yaml),
    onSuccess: () => {
      setHasChanges(false);
      setError(null);
      queryClient.invalidateQueries({ queryKey: cicdQueryKeys.pipeline(owner!, repo!, slug!) });
    },
    onError: (err: any) => {
      setError(err.message || 'Failed to save pipeline');
    },
  });

  // Trigger run mutation
  const triggerMutation = useMutation({
    mutationFn: () => triggerRun(owner!, repo!, slug!),
    onSuccess: (run) => {
      navigate(`/repositories/${owner}/${repo}/pipelines/${slug}/runs/${run.number}`);
    },
    onError: (err: any) => {
      setError(err.message || 'Failed to trigger run');
    },
  });

  const handleYamlChange = (value: string) => {
    setYamlContent(value);
    setHasChanges(true);
  };

  const handleSave = () => {
    updateMutation.mutate(yamlContent);
  };

  const handleRun = () => {
    if (hasChanges) {
      // Save first, then run
      updateMutation.mutate(yamlContent, {
        onSuccess: () => {
          triggerMutation.mutate();
        },
      });
    } else {
      triggerMutation.mutate();
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ py: 8, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', py: 3 }}>
      {/* Breadcrumbs */}
      <Breadcrumbs sx={{ mb: 3 }}>
        <Link
          component={RouterLink}
          to={`/repositories/${owner}/${repo}`}
          sx={{ color: colors.textMuted, textDecoration: 'none', '&:hover': { color: colors.violet } }}
        >
          {owner}/{repo}
        </Link>
        <Link
          component={RouterLink}
          to={`/repositories/${owner}/${repo}/pipelines/${slug}`}
          sx={{ color: colors.textMuted, textDecoration: 'none', '&:hover': { color: colors.violet } }}
        >
          {pipeline?.name || slug}
        </Link>
        <Typography sx={{ color: colors.textLight }}>Edit</Typography>
      </Breadcrumbs>

      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconButton
            onClick={() => navigate(`/repositories/${owner}/${repo}/pipelines/${slug}`)}
            sx={{ backgroundColor: colors.slateLighter }}
          >
            <ArrowBack />
          </IconButton>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              Edit Pipeline
            </Typography>
            <Typography variant="body2" sx={{ color: colors.textMuted }}>
              {pipeline?.name}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={updateMutation.isPending ? <CircularProgress size={16} /> : <Save />}
            onClick={handleSave}
            disabled={!hasChanges || updateMutation.isPending}
          >
            {updateMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
          <Button
            variant="contained"
            startIcon={triggerMutation.isPending ? <CircularProgress size={16} color="inherit" /> : <PlayArrow />}
            onClick={handleRun}
            disabled={triggerMutation.isPending}
          >
            {hasChanges ? 'Save & Run' : 'Run'}
          </Button>
        </Box>
      </Box>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Unsaved Changes Warning */}
      {hasChanges && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          You have unsaved changes. Don't forget to save before leaving.
        </Alert>
      )}

      {/* Editor */}
      <PipelineEditor
        value={yamlContent || '# Loading pipeline configuration...'}
        onChange={handleYamlChange}
        onSave={handleSave}
        onRun={handleRun}
        isSaving={updateMutation.isPending}
        isRunning={triggerMutation.isPending}
        error={error}
        height={600}
        showActions={false}
      />
    </Box>
  );
}

export default PipelineEditorPage;
