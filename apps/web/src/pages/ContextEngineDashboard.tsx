/**
 * Context Engine Dashboard
 * Overview of context engine sessions, stats, and top files
 */

import { useState } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Skeleton,
  Alert,
  TablePagination,
} from '@mui/material';
import {
  Psychology,
  Bolt,
  Hub,
  LinkRounded,
  InsertDriveFile,
  CheckCircle,
  Cancel,
  Storage,
  Schedule,
  Terminal,
  Group,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { colors } from '../theme';
import {
  getContextEngineStats,
  getContextEngineSessions,
  getContextEngineHealth,
} from '../services/context-engine';

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.5,
      borderRadius: 1.5, backgroundColor: colors.navyLight, border: `1px solid ${colors.navyLighter}`,
      minWidth: 140,
    }}>
      <Box sx={{ color: colors.textMuted, display: 'flex' }}>{icon}</Box>
      <Box>
        <Typography variant="h6" sx={{ fontSize: '1.1rem', fontWeight: 700, lineHeight: 1.1 }}>{value}</Typography>
        <Typography variant="caption" sx={{ color: colors.textMuted, fontSize: '0.65rem' }}>{label}</Typography>
      </Box>
    </Box>
  );
}

function HealthMetric({ label, ok, detail, icon }: {
  label: string; ok: boolean; detail: string; icon: React.ReactNode;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 140 }}>
      <Box sx={{ color: colors.textMuted, display: 'flex' }}>{icon}</Box>
      {ok
        ? <CheckCircle sx={{ fontSize: 14, color: '#22c55e' }} />
        : <Cancel sx={{ fontSize: 14, color: '#ef4444' }} />}
      <Box>
        <Typography variant="body2" sx={{ fontSize: '0.8rem', fontWeight: 600, lineHeight: 1.2 }}>
          {detail}
        </Typography>
        <Typography variant="caption" sx={{ color: colors.textMuted, fontSize: '0.6rem' }}>
          {label}
        </Typography>
      </Box>
    </Box>
  );
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function ContextEngineDashboard() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const { data: stats, isLoading: statsLoading, isError: statsError } = useQuery({
    queryKey: ['ceStats', owner, repo],
    queryFn: () => getContextEngineStats(owner!, repo!),
    enabled: !!owner && !!repo,
    staleTime: 60000,
  });

  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ['ceSessions', owner, repo, page, rowsPerPage],
    queryFn: () => getContextEngineSessions(owner!, repo!, {
      limit: rowsPerPage,
      offset: page * rowsPerPage,
    }),
    enabled: !!owner && !!repo,
    staleTime: 30000,
  });

  const { data: health } = useQuery({
    queryKey: ['ceHealth', owner, repo],
    queryFn: () => getContextEngineHealth(owner!, repo!),
    enabled: !!owner && !!repo,
    staleTime: 30000,
  });

  if (statsLoading) {
    return (
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} variant="rectangular" width={160} height={60} sx={{ borderRadius: 1.5 }} />
          ))}
        </Box>
        <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 2 }} />
      </Box>
    );
  }

  if (statsError) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">
          No context engine data available. Start a Claude Code session with context engine enabled to see data here.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Psychology sx={{ fontSize: 24, color: colors.cyan }} />
        <Typography variant="h5" sx={{ fontWeight: 600 }}>Context Engine</Typography>
      </Box>

      {/* Health Card */}
      {health && (
        <Box sx={{
          p: 2, borderRadius: 1.5, backgroundColor: colors.navyLight,
          border: `1px solid ${colors.navyLighter}`,
        }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5, fontSize: '0.85rem' }}>
            Engine Health
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <HealthMetric
              label="FalkorDB"
              ok={health.graph.connected}
              detail={health.graph.connected ? `${health.graph.latencyMs}ms` : 'unreachable'}
              icon={<Storage sx={{ fontSize: 16 }} />}
            />
            <HealthMetric
              label="SK Nodes"
              ok={health.skNodeCount > 0}
              detail={String(health.skNodeCount)}
              icon={<Hub sx={{ fontSize: 16 }} />}
            />
            <HealthMetric
              label="Last Egress"
              ok={health.lastEgressTimestamp !== null}
              detail={health.lastEgressTimestamp
                ? formatRelativeTime(new Date(health.lastEgressTimestamp).toISOString())
                : 'none'}
              icon={<Schedule sx={{ fontSize: 16 }} />}
            />
            <HealthMetric
              label="Hooks"
              ok={health.hooksInstalled}
              detail={health.hooksInstalled ? 'installed' : 'missing'}
              icon={<Terminal sx={{ fontSize: 16 }} />}
            />
            <HealthMetric
              label="Active Sessions"
              ok={health.activeSessions > 0}
              detail={String(health.activeSessions)}
              icon={<Group sx={{ fontSize: 16 }} />}
            />
          </Box>
        </Box>
      )}

      {/* Stats Row */}
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <StatCard
          label="Total Sessions"
          value={stats?.totalSessions ?? 0}
          icon={<Psychology sx={{ fontSize: 18 }} />}
        />
        <StatCard
          label="Active (24h)"
          value={stats?.activeSessions ?? 0}
          icon={<Bolt sx={{ fontSize: 18 }} />}
        />
        <StatCard
          label="Knowledge Nodes"
          value={stats?.totalKnowledgeNodes ?? 0}
          icon={<Hub sx={{ fontSize: 18 }} />}
        />
        <StatCard
          label="ABOUT Edges"
          value={stats?.totalAboutEdges ?? 0}
          icon={<LinkRounded sx={{ fontSize: 18 }} />}
        />
      </Box>

      {/* Top Files */}
      {stats?.topFiles && stats.topFiles.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ color: colors.textMuted, mb: 1, fontSize: '0.8rem' }}>
            Most Referenced Files
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {stats.topFiles.map((f) => (
              <Chip
                key={f.file}
                icon={<InsertDriveFile sx={{ fontSize: 12 }} />}
                label={`${f.file} (${f.mentions})`}
                size="small"
                sx={{ fontSize: '0.7rem', fontFamily: 'monospace' }}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* Sessions Table */}
      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
          Sessions
        </Typography>
        <TableContainer component={Paper} sx={{ backgroundColor: colors.navyLight, borderRadius: 1.5 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Session ID</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Concern</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Turns</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Tokens</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Last Activity</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sessionsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <TableCell key={j}><Skeleton /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : sessionsData?.sessions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} sx={{ textAlign: 'center', color: colors.textMuted, py: 3 }}>
                    No sessions found
                  </TableCell>
                </TableRow>
              ) : (
                sessionsData?.sessions.map((s) => (
                  <TableRow
                    key={s.sessionId}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(
                      `/dashboard/repositories/${owner}/${repo}/context-engine/sessions/${encodeURIComponent(s.sessionId)}`,
                    )}
                  >
                    <TableCell sx={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>
                      {s.sessionId.length > 24 ? `${s.sessionId.slice(0, 24)}...` : s.sessionId}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={s.activeConcern}
                        size="small"
                        sx={{ fontSize: '0.65rem', height: 20 }}
                      />
                    </TableCell>
                    <TableCell align="right" sx={{ fontSize: '0.75rem' }}>{s.lastTurnCount}</TableCell>
                    <TableCell align="right" sx={{ fontSize: '0.75rem' }}>
                      {s.lastTokenEst > 0 ? `${Math.round(s.lastTokenEst / 1000)}k` : '-'}
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', color: colors.textMuted }}>
                      {formatRelativeTime(s.lastActivityAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {sessionsData && sessionsData.pagination.total > rowsPerPage && (
            <TablePagination
              component="div"
              count={sessionsData.pagination.total}
              page={page}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[10, 25, 50]}
              sx={{ '& .MuiTablePagination-toolbar': { minHeight: 40 } }}
            />
          )}
        </TableContainer>
      </Box>
    </Box>
  );
}
