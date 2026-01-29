/**
 * RunDetailPage
 * Displays detailed information about a pipeline run including jobs, logs, and AI analysis
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
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Breadcrumbs,
  Link,
  LinearProgress,
  alpha,
} from '@mui/material';
import {
  ArrowBack,
  Refresh,
  StopCircle,
  Replay,
  ExpandMore,
  Schedule,
  Timer,
  Commit,
  Person,
  AutoAwesome as AIIcon,
  Lightbulb,
  Code,
  Terminal,
  ContentCopy,
  CheckCircle,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import { colors } from '../../theme';
import { getRun, cancelRun, rerunFailedJobs, getJobLogs, cicdQueryKeys } from '../../services/ci-cd';
import { StatusBadge } from '../../components/ci-cd/StatusBadge';
import { LogViewer } from '../../components/ci-cd/LogViewer';
import type { PipelineJob, AIFailureAnalysis, AISuggestedFix } from '../../types/ci-cd';

const categoryLabels: Record<AIFailureAnalysis['category'], { label: string; color: string }> = {
  build: { label: 'Build Error', color: colors.rose },
  test: { label: 'Test Failure', color: colors.amber },
  dependency: { label: 'Dependency Issue', color: colors.purple },
  config: { label: 'Configuration Error', color: colors.blue },
  infrastructure: { label: 'Infrastructure Issue', color: colors.cyan },
  unknown: { label: 'Unknown', color: colors.textMuted },
};

export function RunDetailPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { owner, repo, slug, number } = useParams<{
    owner: string;
    repo: string;
    slug: string;
    number: string;
  }>();

  const runNumber = parseInt(number!, 10);

  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [jobLogs, setJobLogs] = useState<Record<string, string>>({});
  const [loadingLogs, setLoadingLogs] = useState<Record<string, boolean>>({});
  const [copiedFix, setCopiedFix] = useState<number | null>(null);

  // Fetch run details
  const { data: run, isLoading, error } = useQuery({
    queryKey: cicdQueryKeys.run(owner!, repo!, slug!, runNumber),
    queryFn: () => getRun(owner!, repo!, slug!, runNumber),
    enabled: !!owner && !!repo && !!slug && !isNaN(runNumber),
    refetchInterval: (query) => {
      // Auto-refresh if run is still in progress
      const data = query.state.data;
      if (data?.status === 'pending' || data?.status === 'running') {
        return 5000;
      }
      return false;
    },
  });

  // Cancel run mutation
  const cancelMutation = useMutation({
    mutationFn: () => cancelRun(owner!, repo!, slug!, runNumber),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cicdQueryKeys.run(owner!, repo!, slug!, runNumber) });
    },
  });

  // Rerun failed jobs mutation
  const rerunMutation = useMutation({
    mutationFn: () => rerunFailedJobs(owner!, repo!, slug!, runNumber),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cicdQueryKeys.run(owner!, repo!, slug!, runNumber) });
    },
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: cicdQueryKeys.run(owner!, repo!, slug!, runNumber) });
  };

  const handleExpandJob = async (jobId: string) => {
    if (expandedJob === jobId) {
      setExpandedJob(null);
      return;
    }

    setExpandedJob(jobId);

    // Load logs if not already loaded
    if (!jobLogs[jobId] && !loadingLogs[jobId]) {
      setLoadingLogs((prev) => ({ ...prev, [jobId]: true }));
      try {
        const logs = await getJobLogs(owner!, repo!, slug!, runNumber, jobId);
        setJobLogs((prev) => ({ ...prev, [jobId]: logs }));
      } catch (err) {
        console.error('Failed to load logs:', err);
      } finally {
        setLoadingLogs((prev) => ({ ...prev, [jobId]: false }));
      }
    }
  };

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
    return new Date(date).toLocaleString();
  };

  const handleCopyCommand = async (command: string, index: number) => {
    await navigator.clipboard.writeText(command);
    setCopiedFix(index);
    setTimeout(() => setCopiedFix(null), 2000);
  };

  if (isLoading) {
    return (
      <Box sx={{ py: 8, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !run) {
    return (
      <Box sx={{ py: 4, textAlign: 'center' }}>
        <Typography variant="body1" sx={{ color: colors.rose, mb: 2 }}>
          Failed to load run details
        </Typography>
        <Button variant="outlined" onClick={handleRefresh}>
          Retry
        </Button>
      </Box>
    );
  }

  const isRunning = run.status === 'pending' || run.status === 'running';
  const hasFailed = run.status === 'failure';

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
          to={`/repositories/${owner}/${repo}/pipelines/${slug}`}
          sx={{ color: colors.textMuted, textDecoration: 'none', '&:hover': { color: colors.violet } }}
        >
          {slug}
        </Link>
        <Typography sx={{ color: colors.textLight }}>Run #{runNumber}</Typography>
      </Breadcrumbs>

      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 4 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
            <IconButton
              onClick={() => navigate(`/repositories/${owner}/${repo}/pipelines/${slug}`)}
              sx={{ backgroundColor: colors.slateLighter }}
            >
              <ArrowBack />
            </IconButton>
            <Typography variant="h4" sx={{ fontWeight: 700 }}>
              Run #{runNumber}
            </Typography>
            <StatusBadge status={run.status} size="medium" />
          </Box>

          {/* Run metadata */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, ml: 7, color: colors.textMuted }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Commit sx={{ fontSize: 16 }} />
              <Typography variant="body2" sx={{ fontFamily: 'monospace', color: colors.cyan }}>
                {run.sha.substring(0, 7)}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Schedule sx={{ fontSize: 16 }} />
              <Typography variant="body2">{formatTime(run.startedAt)}</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Timer sx={{ fontSize: 16 }} />
              <Typography variant="body2">{formatDuration(run.durationMs)}</Typography>
            </Box>
            {run.triggeredBy && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Person sx={{ fontSize: 16 }} />
                <Typography variant="body2">{run.triggeredBy}</Typography>
              </Box>
            )}
          </Box>

          {run.message && (
            <Typography variant="body2" sx={{ color: colors.textMuted, ml: 7, mt: 1, fontStyle: 'italic' }}>
              "{run.message}"
            </Typography>
          )}
        </Box>

        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Refresh">
            <IconButton onClick={handleRefresh} sx={{ backgroundColor: colors.slateLighter }}>
              <Refresh />
            </IconButton>
          </Tooltip>
          {isRunning && (
            <Button
              variant="outlined"
              color="error"
              startIcon={<StopCircle />}
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            >
              Cancel
            </Button>
          )}
          {hasFailed && (
            <Button
              variant="contained"
              startIcon={<Replay />}
              onClick={() => rerunMutation.mutate()}
              disabled={rerunMutation.isPending}
            >
              Rerun Failed
            </Button>
          )}
        </Box>
      </Box>

      {/* Progress bar for running jobs */}
      {isRunning && (
        <Box sx={{ mb: 4 }}>
          <LinearProgress
            sx={{
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.slateLighter,
              '& .MuiLinearProgress-bar': {
                backgroundColor: colors.cyan,
              },
            }}
          />
        </Box>
      )}

      {/* AI Analysis Section (if failed) */}
      {hasFailed && run.aiFailureAnalysis && (
        <Card sx={{ mb: 4, borderColor: colors.rose, borderWidth: 1, borderStyle: 'solid' }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <AIIcon sx={{ color: colors.violet }} />
              <Typography variant="h6">AI Failure Analysis</Typography>
              <Chip
                label={`${Math.round(run.aiFailureAnalysis.confidence * 100)}% confidence`}
                size="small"
                sx={{
                  ml: 'auto',
                  backgroundColor: alpha(colors.violet, 0.15),
                  color: colors.violet,
                }}
              />
            </Box>

            {/* Category Badge */}
            <Chip
              label={categoryLabels[run.aiFailureAnalysis.category].label}
              size="small"
              sx={{
                mb: 2,
                backgroundColor: alpha(categoryLabels[run.aiFailureAnalysis.category].color, 0.15),
                color: categoryLabels[run.aiFailureAnalysis.category].color,
              }}
            />

            {/* Summary */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ color: colors.textMuted, mb: 0.5 }}>
                Summary
              </Typography>
              <Typography variant="body1">{run.aiFailureAnalysis.summary}</Typography>
            </Box>

            {/* Root Cause */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ color: colors.textMuted, mb: 0.5 }}>
                Root Cause
              </Typography>
              <Box
                sx={{
                  p: 2,
                  backgroundColor: colors.slate,
                  borderRadius: 1,
                  border: `1px solid ${colors.slateLighter}`,
                }}
              >
                <Typography
                  variant="body2"
                  sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}
                >
                  {run.aiFailureAnalysis.rootCause}
                </Typography>
              </Box>
            </Box>

            {/* Related Logs */}
            {run.aiFailureAnalysis.relatedLogs.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ color: colors.textMuted, mb: 0.5 }}>
                  Related Log Lines
                </Typography>
                <Box
                  sx={{
                    p: 2,
                    backgroundColor: colors.slate,
                    borderRadius: 1,
                    border: `1px solid ${colors.slateLighter}`,
                    fontFamily: 'monospace',
                    fontSize: '0.8125rem',
                  }}
                >
                  {run.aiFailureAnalysis.relatedLogs.map((log, idx) => (
                    <Typography
                      key={idx}
                      variant="body2"
                      sx={{
                        fontFamily: 'monospace',
                        color: colors.rose,
                        '&:not(:last-child)': { mb: 0.5 },
                      }}
                    >
                      {log}
                    </Typography>
                  ))}
                </Box>
              </Box>
            )}
          </CardContent>
        </Card>
      )}

      {/* Suggested Fixes (if available) */}
      {hasFailed && run.aiSuggestedFixes && run.aiSuggestedFixes.length > 0 && (
        <Card sx={{ mb: 4 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Lightbulb sx={{ color: colors.amber }} />
              <Typography variant="h6">Suggested Fixes</Typography>
            </Box>

            {run.aiSuggestedFixes.map((fix: AISuggestedFix, index: number) => (
              <Box
                key={index}
                sx={{
                  p: 2,
                  mb: 2,
                  backgroundColor: colors.slate,
                  borderRadius: 1,
                  border: `1px solid ${colors.slateLighter}`,
                  '&:last-child': { mb: 0 },
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {fix.title}
                  </Typography>
                  <Chip
                    label={`${Math.round(fix.confidence * 100)}%`}
                    size="small"
                    sx={{
                      backgroundColor: alpha(colors.green, 0.15),
                      color: colors.green,
                    }}
                  />
                </Box>
                <Typography variant="body2" sx={{ color: colors.textMuted, mb: 2 }}>
                  {fix.description}
                </Typography>

                {/* Code Changes */}
                {fix.codeChanges && fix.codeChanges.length > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" sx={{ color: colors.textMuted, display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                      <Code sx={{ fontSize: 14 }} /> Code Changes
                    </Typography>
                    {fix.codeChanges.map((change, cIdx) => (
                      <Box
                        key={cIdx}
                        sx={{
                          p: 1.5,
                          backgroundColor: colors.slateLight,
                          borderRadius: 1,
                          mb: 1,
                        }}
                      >
                        <Typography variant="caption" sx={{ color: colors.cyan, fontFamily: 'monospace' }}>
                          {change.file}
                        </Typography>
                        <Box
                          sx={{
                            mt: 1,
                            p: 1,
                            backgroundColor: colors.slate,
                            borderRadius: 1,
                            fontFamily: 'monospace',
                            fontSize: '0.75rem',
                            whiteSpace: 'pre-wrap',
                            overflow: 'auto',
                          }}
                        >
                          {change.diff}
                        </Box>
                      </Box>
                    ))}
                  </Box>
                )}

                {/* Commands */}
                {fix.commands && fix.commands.length > 0 && (
                  <Box>
                    <Typography variant="caption" sx={{ color: colors.textMuted, display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                      <Terminal sx={{ fontSize: 14 }} /> Commands
                    </Typography>
                    {fix.commands.map((cmd, cIdx) => (
                      <Box
                        key={cIdx}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          p: 1,
                          backgroundColor: colors.slateLight,
                          borderRadius: 1,
                          mb: 0.5,
                        }}
                      >
                        <Typography
                          variant="body2"
                          sx={{ fontFamily: 'monospace', flex: 1, color: colors.green }}
                        >
                          $ {cmd}
                        </Typography>
                        <Tooltip title={copiedFix === index + cIdx ? 'Copied!' : 'Copy'}>
                          <IconButton
                            size="small"
                            onClick={() => handleCopyCommand(cmd, index + cIdx)}
                          >
                            {copiedFix === index + cIdx ? (
                              <CheckCircle sx={{ fontSize: 16, color: colors.green }} />
                            ) : (
                              <ContentCopy sx={{ fontSize: 16 }} />
                            )}
                          </IconButton>
                        </Tooltip>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Jobs Section */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Jobs ({run.jobs.length})
        </Typography>

        {run.jobs.map((job: PipelineJob) => (
          <Accordion
            key={job.id}
            expanded={expandedJob === job.id}
            onChange={() => handleExpandJob(job.id)}
            sx={{
              backgroundColor: colors.slateLight,
              border: `1px solid ${colors.slateLighter}`,
              '&:before': { display: 'none' },
              mb: 1,
            }}
          >
            <AccordionSummary
              expandIcon={<ExpandMore />}
              sx={{
                '& .MuiAccordionSummary-content': {
                  alignItems: 'center',
                  gap: 2,
                },
              }}
            >
              <StatusBadge status={job.status} size="small" />
              <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
                {job.name}
              </Typography>
              <Typography variant="body2" sx={{ color: colors.textMuted, ml: 'auto', mr: 2 }}>
                {formatDuration(job.durationMs)}
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <LogViewer
                logs={jobLogs[job.id] || job.logs || null}
                isLoading={loadingLogs[job.id]}
                maxHeight={400}
              />
            </AccordionDetails>
          </Accordion>
        ))}
      </Box>
    </Box>
  );
}

export default RunDetailPage;
