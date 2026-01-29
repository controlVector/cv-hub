/**
 * PipelinesList Component
 * Displays list of pipelines for a repository with status and actions
 */

import { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  IconButton,
  Tooltip,
  CircularProgress,
  Menu,
  MenuItem,
  Divider,
  LinearProgress,
  alpha,
} from '@mui/material';
import {
  Add,
  PlayArrow,
  MoreVert,
  AutoAwesome as AIIcon,
  AccountTree,
  Schedule,
  CheckCircle,
  Cancel,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { colors } from '../../theme';
import { listPipelines, triggerRun, deletePipeline, cicdQueryKeys } from '../../services/ci-cd';
import { StatusBadge } from './StatusBadge';
import type { Pipeline } from '../../types/ci-cd';

interface PipelinesListProps {
  owner: string;
  repo: string;
}

export function PipelinesList({ owner, repo }: PipelinesListProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [menuAnchorEl, setMenuAnchorEl] = useState<{ el: HTMLElement; pipeline: Pipeline } | null>(null);

  // Fetch pipelines
  const { data: pipelines, isLoading, error } = useQuery({
    queryKey: cicdQueryKeys.pipelines(owner, repo),
    queryFn: () => listPipelines(owner, repo),
  });

  // Trigger run mutation
  const triggerMutation = useMutation({
    mutationFn: (slug: string) => triggerRun(owner, repo, slug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cicdQueryKeys.pipelines(owner, repo) });
    },
  });

  // Delete pipeline mutation
  const deleteMutation = useMutation({
    mutationFn: (slug: string) => deletePipeline(owner, repo, slug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cicdQueryKeys.pipelines(owner, repo) });
      setMenuAnchorEl(null);
    },
  });

  const handleNewPipeline = () => {
    navigate(`/repositories/${owner}/${repo}/pipelines/new`);
  };

  const handleViewPipeline = (slug: string) => {
    navigate(`/repositories/${owner}/${repo}/pipelines/${slug}`);
  };

  const handleRunPipeline = (e: React.MouseEvent, slug: string) => {
    e.stopPropagation();
    triggerMutation.mutate(slug);
  };

  const handleMenuOpen = (e: React.MouseEvent<HTMLElement>, pipeline: Pipeline) => {
    e.stopPropagation();
    setMenuAnchorEl({ el: e.currentTarget, pipeline });
  };

  const handleEditPipeline = () => {
    if (menuAnchorEl) {
      navigate(`/repositories/${owner}/${repo}/pipelines/${menuAnchorEl.pipeline.slug}/edit`);
      setMenuAnchorEl(null);
    }
  };

  const handleDeletePipeline = () => {
    if (menuAnchorEl) {
      if (window.confirm(`Are you sure you want to delete pipeline "${menuAnchorEl.pipeline.name}"?`)) {
        deleteMutation.mutate(menuAnchorEl.pipeline.slug);
      }
    }
  };

  const getSuccessRate = (pipeline: Pipeline): number => {
    if (pipeline.totalRuns === 0) return 0;
    return Math.round((pipeline.successfulRuns / pipeline.totalRuns) * 100);
  };

  const formatLastRun = (date: string | null): string => {
    if (!date) return 'Never';
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString();
  };

  if (isLoading) {
    return (
      <Box sx={{ py: 8, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ py: 4, textAlign: 'center' }}>
        <Typography variant="body1" sx={{ color: colors.rose, mb: 2 }}>
          Failed to load pipelines
        </Typography>
        <Button variant="outlined" onClick={() => queryClient.invalidateQueries({ queryKey: cicdQueryKeys.pipelines(owner, repo) })}>
          Retry
        </Button>
      </Box>
    );
  }

  // Empty state
  if (!pipelines || pipelines.length === 0) {
    return (
      <Box
        sx={{
          py: 8,
          textAlign: 'center',
          backgroundColor: colors.slateLight,
          borderRadius: 2,
          border: `1px dashed ${colors.slateLighter}`,
        }}
      >
        <AccountTree sx={{ fontSize: 48, color: colors.textMuted, mb: 2 }} />
        <Typography variant="h6" sx={{ mb: 1 }}>
          No pipelines yet
        </Typography>
        <Typography variant="body2" sx={{ color: colors.textMuted, mb: 3, maxWidth: 400, mx: 'auto' }}>
          Create your first CI/CD pipeline to automate builds, tests, and deployments. Our AI can help you get started quickly.
        </Typography>
        <Button
          variant="contained"
          startIcon={<AIIcon />}
          onClick={handleNewPipeline}
          sx={{ mr: 2 }}
        >
          Create with AI
        </Button>
        <Button variant="outlined" startIcon={<Add />} onClick={handleNewPipeline}>
          Manual Setup
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h6">
          Pipelines
        </Typography>
        <Button variant="contained" startIcon={<Add />} onClick={handleNewPipeline}>
          New Pipeline
        </Button>
      </Box>

      {/* Pipeline Cards */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {pipelines.map((pipeline) => {
          const successRate = getSuccessRate(pipeline);

          return (
            <Card
              key={pipeline.id}
              onClick={() => handleViewPipeline(pipeline.slug)}
              sx={{
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                '&:hover': {
                  borderColor: colors.violet,
                  transform: 'translateY(-2px)',
                },
              }}
            >
              <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  {/* Pipeline Info */}
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        {pipeline.name}
                      </Typography>
                      {pipeline.lastRunStatus && (
                        <StatusBadge status={pipeline.lastRunStatus} size="small" />
                      )}
                      {!pipeline.isActive && (
                        <Typography
                          variant="caption"
                          sx={{
                            px: 1,
                            py: 0.25,
                            borderRadius: 1,
                            backgroundColor: alpha(colors.amber, 0.15),
                            color: colors.amber,
                          }}
                        >
                          Disabled
                        </Typography>
                      )}
                    </Box>

                    {/* Stats Row */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, color: colors.textMuted }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Schedule sx={{ fontSize: 16 }} />
                        <Typography variant="body2">
                          {formatLastRun(pipeline.lastRunAt)}
                        </Typography>
                      </Box>

                      {pipeline.totalRuns > 0 && (
                        <>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <CheckCircle sx={{ fontSize: 16, color: colors.green }} />
                            <Typography variant="body2">{pipeline.successfulRuns}</Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Cancel sx={{ fontSize: 16, color: colors.rose }} />
                            <Typography variant="body2">{pipeline.failedRuns}</Typography>
                          </Box>
                        </>
                      )}

                      <Typography variant="body2">
                        {pipeline.totalRuns} runs
                      </Typography>
                    </Box>

                    {/* Success Rate Bar */}
                    {pipeline.totalRuns > 0 && (
                      <Box sx={{ mt: 1.5, maxWidth: 200 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                          <Typography variant="caption" sx={{ color: colors.textMuted }}>
                            Success rate
                          </Typography>
                          <Typography variant="caption" sx={{ color: successRate >= 80 ? colors.green : successRate >= 50 ? colors.amber : colors.rose }}>
                            {successRate}%
                          </Typography>
                        </Box>
                        <LinearProgress
                          variant="determinate"
                          value={successRate}
                          sx={{
                            height: 4,
                            borderRadius: 2,
                            backgroundColor: colors.slateLighter,
                            '& .MuiLinearProgress-bar': {
                              backgroundColor: successRate >= 80 ? colors.green : successRate >= 50 ? colors.amber : colors.rose,
                              borderRadius: 2,
                            },
                          }}
                        />
                      </Box>
                    )}
                  </Box>

                  {/* Actions */}
                  <Box sx={{ display: 'flex', gap: 1, ml: 2 }}>
                    <Tooltip title="Run Pipeline">
                      <IconButton
                        size="small"
                        onClick={(e) => handleRunPipeline(e, pipeline.slug)}
                        disabled={triggerMutation.isPending || !pipeline.isActive}
                        sx={{
                          backgroundColor: alpha(colors.green, 0.1),
                          '&:hover': { backgroundColor: alpha(colors.green, 0.2) },
                        }}
                      >
                        {triggerMutation.isPending ? (
                          <CircularProgress size={18} />
                        ) : (
                          <PlayArrow sx={{ color: colors.green }} />
                        )}
                      </IconButton>
                    </Tooltip>
                    <IconButton
                      size="small"
                      onClick={(e) => handleMenuOpen(e, pipeline)}
                      sx={{
                        backgroundColor: colors.slateLighter,
                        '&:hover': { backgroundColor: alpha(colors.violet, 0.1) },
                      }}
                    >
                      <MoreVert />
                    </IconButton>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          );
        })}
      </Box>

      {/* Pipeline Menu */}
      <Menu
        anchorEl={menuAnchorEl?.el}
        open={Boolean(menuAnchorEl)}
        onClose={() => setMenuAnchorEl(null)}
      >
        <MenuItem onClick={() => {
          if (menuAnchorEl) {
            handleViewPipeline(menuAnchorEl.pipeline.slug);
            setMenuAnchorEl(null);
          }
        }}>
          View Runs
        </MenuItem>
        <MenuItem onClick={handleEditPipeline}>
          Edit Pipeline
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleDeletePipeline} sx={{ color: colors.rose }}>
          Delete Pipeline
        </MenuItem>
      </Menu>
    </Box>
  );
}

export default PipelinesList;
