/**
 * PipelineRunsPage
 * Displays list of runs for a specific pipeline
 */

import {
  Box,
  Typography,
  Button,
  Card,
  IconButton,
  Tooltip,
  CircularProgress,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  alpha,
  Breadcrumbs,
  Link,
} from '@mui/material';
import {
  PlayArrow,
  ArrowBack,
  Edit,
  Refresh,
  Schedule,
  Person,
  Commit,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import { colors } from '../../theme';
import { getPipeline, listRuns, triggerRun, cicdQueryKeys } from '../../services/ci-cd';
import { StatusBadge } from '../../components/ci-cd/StatusBadge';
import type { PipelineRun, TriggerType } from '../../types/ci-cd';

const triggerLabels: Record<TriggerType, string> = {
  push: 'Push',
  pull_request: 'PR',
  schedule: 'Scheduled',
  manual: 'Manual',
  api: 'API',
  tag: 'Tag',
  release: 'Release',
};

const triggerColors: Record<TriggerType, string> = {
  push: colors.violet,
  pull_request: colors.cyan,
  schedule: colors.amber,
  manual: colors.green,
  api: colors.blue,
  tag: colors.purple,
  release: colors.teal,
};

export function PipelineRunsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { owner, repo, slug } = useParams<{ owner: string; repo: string; slug: string }>();

  // Fetch pipeline details
  const { data: pipeline, isLoading: pipelineLoading } = useQuery({
    queryKey: cicdQueryKeys.pipeline(owner!, repo!, slug!),
    queryFn: () => getPipeline(owner!, repo!, slug!),
    enabled: !!owner && !!repo && !!slug,
  });

  // Fetch runs
  const { data: runsData, isLoading: runsLoading, error } = useQuery({
    queryKey: cicdQueryKeys.runs(owner!, repo!, slug!),
    queryFn: () => listRuns(owner!, repo!, slug!),
    enabled: !!owner && !!repo && !!slug,
    refetchInterval: 10000, // Auto-refresh every 10 seconds
  });

  // Trigger run mutation
  const triggerMutation = useMutation({
    mutationFn: () => triggerRun(owner!, repo!, slug!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cicdQueryKeys.runs(owner!, repo!, slug!) });
    },
  });

  const formatDuration = (ms: number | null): string => {
    if (!ms) return '-';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const formatTime = (date: string | null): string => {
    if (!date) return '-';
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

  const handleViewRun = (runNumber: number) => {
    navigate(`/repositories/${owner}/${repo}/pipelines/${slug}/runs/${runNumber}`);
  };

  const handleEditPipeline = () => {
    navigate(`/repositories/${owner}/${repo}/pipelines/${slug}/edit`);
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: cicdQueryKeys.runs(owner!, repo!, slug!) });
  };

  const isLoading = pipelineLoading || runsLoading;

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
          Failed to load pipeline runs
        </Typography>
        <Button variant="outlined" onClick={handleRefresh}>
          Retry
        </Button>
      </Box>
    );
  }

  const runs = runsData?.runs || [];

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
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
          to={`/repositories/${owner}/${repo}`}
          state={{ tab: 3 }}
          sx={{ color: colors.textMuted, textDecoration: 'none', '&:hover': { color: colors.violet } }}
        >
          Actions
        </Link>
        <Typography sx={{ color: colors.textLight }}>{pipeline?.name}</Typography>
      </Breadcrumbs>

      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 4 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
            <IconButton
              onClick={() => navigate(`/repositories/${owner}/${repo}`)}
              sx={{ backgroundColor: colors.slateLighter }}
            >
              <ArrowBack />
            </IconButton>
            <Typography variant="h4" sx={{ fontWeight: 700 }}>
              {pipeline?.name}
            </Typography>
            {!pipeline?.isActive && (
              <Chip
                label="Disabled"
                size="small"
                sx={{
                  backgroundColor: alpha(colors.amber, 0.15),
                  color: colors.amber,
                }}
              />
            )}
          </Box>
          <Typography variant="body2" sx={{ color: colors.textMuted, ml: 7 }}>
            {runs.length} total runs
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Refresh">
            <IconButton onClick={handleRefresh} sx={{ backgroundColor: colors.slateLighter }}>
              <Refresh />
            </IconButton>
          </Tooltip>
          <Button
            variant="outlined"
            startIcon={<Edit />}
            onClick={handleEditPipeline}
          >
            Edit
          </Button>
          <Button
            variant="contained"
            startIcon={<PlayArrow />}
            onClick={() => triggerMutation.mutate()}
            disabled={triggerMutation.isPending || !pipeline?.isActive}
          >
            {triggerMutation.isPending ? 'Starting...' : 'Run Pipeline'}
          </Button>
        </Box>
      </Box>

      {/* Runs Table */}
      {runs.length === 0 ? (
        <Card sx={{ p: 6, textAlign: 'center' }}>
          <Schedule sx={{ fontSize: 48, color: colors.textMuted, mb: 2 }} />
          <Typography variant="h6" sx={{ mb: 1 }}>
            No runs yet
          </Typography>
          <Typography variant="body2" sx={{ color: colors.textMuted, mb: 3 }}>
            This pipeline hasn't been triggered yet. Click "Run Pipeline" to start your first run.
          </Typography>
          <Button
            variant="contained"
            startIcon={<PlayArrow />}
            onClick={() => triggerMutation.mutate()}
            disabled={triggerMutation.isPending || !pipeline?.isActive}
          >
            Run Pipeline
          </Button>
        </Card>
      ) : (
        <TableContainer component={Card}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Run</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Trigger</TableCell>
                <TableCell>Branch/Tag</TableCell>
                <TableCell>Commit</TableCell>
                <TableCell>Duration</TableCell>
                <TableCell>Started</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.map((run: PipelineRun) => (
                <TableRow
                  key={run.id}
                  hover
                  onClick={() => handleViewRun(run.number)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      #{run.number}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={run.status} />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={triggerLabels[run.trigger]}
                      size="small"
                      sx={{
                        backgroundColor: alpha(triggerColors[run.trigger], 0.15),
                        color: triggerColors[run.trigger],
                        fontWeight: 500,
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {run.ref}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Tooltip title={run.message || 'No commit message'}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Commit sx={{ fontSize: 16, color: colors.textMuted }} />
                        <Typography
                          variant="body2"
                          sx={{
                            fontFamily: 'monospace',
                            color: colors.cyan,
                            '&:hover': { textDecoration: 'underline' },
                          }}
                        >
                          {run.sha.substring(0, 7)}
                        </Typography>
                      </Box>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ color: colors.textMuted }}>
                      {formatDuration(run.durationMs)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Schedule sx={{ fontSize: 16, color: colors.textMuted }} />
                      <Typography variant="body2" sx={{ color: colors.textMuted }}>
                        {formatTime(run.startedAt)}
                      </Typography>
                    </Box>
                    {run.triggeredBy && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                        <Person sx={{ fontSize: 14, color: colors.textMuted }} />
                        <Typography variant="caption" sx={{ color: colors.textMuted }}>
                          {run.triggeredBy}
                        </Typography>
                      </Box>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}

export default PipelineRunsPage;
