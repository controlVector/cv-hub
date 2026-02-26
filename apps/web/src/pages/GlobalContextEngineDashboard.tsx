/**
 * Global Context Engine Dashboard
 * Top-level page showing aggregate stats, cross-repo sessions, and quick links
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
  Card,
  CardActionArea,
} from '@mui/material';
import {
  Psychology,
  Bolt,
  Hub,
  LinkRounded,
  Storage,
  ArrowForward,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { colors } from '../theme';
import {
  getGlobalContextEngineStats,
  getGlobalContextEngineSessions,
} from '../services/context-engine';

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, py: 2,
      borderRadius: 2, backgroundColor: colors.navyLight, border: `1px solid ${colors.navyLighter}`,
      minWidth: 160,
    }}>
      <Box sx={{ color: colors.cyan, display: 'flex' }}>{icon}</Box>
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.1 }}>{value}</Typography>
        <Typography variant="caption" sx={{ color: colors.textMuted, fontSize: '0.7rem' }}>{label}</Typography>
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

export default function GlobalContextEngineDashboard() {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const { data: stats, isLoading: statsLoading, isError: statsError } = useQuery({
    queryKey: ['ceGlobalStats'],
    queryFn: () => getGlobalContextEngineStats(),
    staleTime: 60000,
  });

  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ['ceGlobalSessions', page, rowsPerPage],
    queryFn: () => getGlobalContextEngineSessions({
      limit: rowsPerPage,
      offset: page * rowsPerPage,
    }),
    staleTime: 30000,
  });

  // Derive unique repos from sessions for quick links
  const uniqueRepos = new Map<string, { owner: string; slug: string; name: string }>();
  if (sessionsData) {
    for (const s of sessionsData.sessions) {
      const key = `${s.repoOwner}/${s.repoSlug}`;
      if (!uniqueRepos.has(key)) {
        uniqueRepos.set(key, { owner: s.repoOwner, slug: s.repoSlug, name: s.repoName });
      }
    }
  }

  if (statsLoading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          {[1, 2, 3, 4, 5].map(i => (
            <Skeleton key={i} variant="rectangular" width={170} height={64} sx={{ borderRadius: 2 }} />
          ))}
        </Box>
        <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 2 }} />
      </Box>
    );
  }

  if (statsError) {
    return (
      <Box>
        <Alert severity="info">
          No context engine data yet. Start a Claude Code session with context engine enabled to see data here.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Header */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <Psychology sx={{ fontSize: 28, color: colors.cyan }} />
          <Typography variant="h4" sx={{ fontWeight: 700 }}>Context Engine</Typography>
        </Box>
        <Typography variant="body2" sx={{ color: colors.textMuted }}>
          Session knowledge across all your repositories
        </Typography>
      </Box>

      {/* Stats Row */}
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <StatCard
          label="Total Sessions"
          value={stats?.totalSessions ?? 0}
          icon={<Psychology sx={{ fontSize: 20 }} />}
        />
        <StatCard
          label="Active (24h)"
          value={stats?.activeSessions ?? 0}
          icon={<Bolt sx={{ fontSize: 20 }} />}
        />
        <StatCard
          label="Knowledge Nodes"
          value={stats?.totalKnowledgeNodes ?? 0}
          icon={<Hub sx={{ fontSize: 20 }} />}
        />
        <StatCard
          label="ABOUT Edges"
          value={stats?.totalAboutEdges ?? 0}
          icon={<LinkRounded sx={{ fontSize: 20 }} />}
        />
        <StatCard
          label="Repositories"
          value={stats?.repoCount ?? 0}
          icon={<Storage sx={{ fontSize: 20 }} />}
        />
      </Box>

      {/* Quick Links to Repo Dashboards */}
      {uniqueRepos.size > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ color: colors.textMuted, mb: 1, fontSize: '0.8rem' }}>
            Repositories with Context Engine
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {Array.from(uniqueRepos.entries()).map(([key, repo]) => (
              <Card key={key} sx={{ backgroundColor: colors.navyLight, border: `1px solid ${colors.navyLighter}` }}>
                <CardActionArea
                  onClick={() => navigate(`/dashboard/repositories/${repo.owner}/${repo.slug}/context-engine`)}
                  sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}
                >
                  <Psychology sx={{ fontSize: 16, color: colors.cyan }} />
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {repo.owner}/{repo.name}
                  </Typography>
                  <ArrowForward sx={{ fontSize: 14, color: colors.textMuted }} />
                </CardActionArea>
              </Card>
            ))}
          </Box>
        </Box>
      )}

      {/* Sessions Table */}
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
          Recent Sessions
        </Typography>
        <TableContainer component={Paper} sx={{ backgroundColor: colors.navyLight, borderRadius: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Repository</TableCell>
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
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><Skeleton /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : !sessionsData?.sessions.length ? (
                <TableRow>
                  <TableCell colSpan={6} sx={{ textAlign: 'center', color: colors.textMuted, py: 4 }}>
                    No sessions found. Start a Claude Code session with context engine enabled.
                  </TableCell>
                </TableRow>
              ) : (
                sessionsData.sessions.map((s) => (
                  <TableRow
                    key={`${s.repositoryId}:${s.sessionId}`}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(
                      `/dashboard/repositories/${s.repoOwner}/${s.repoSlug}/context-engine/sessions/${encodeURIComponent(s.sessionId)}`,
                    )}
                  >
                    <TableCell sx={{ fontSize: '0.75rem' }}>
                      <Chip
                        label={`${s.repoOwner}/${s.repoName}`}
                        size="small"
                        sx={{ fontSize: '0.65rem', height: 20, cursor: 'pointer' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/dashboard/repositories/${s.repoOwner}/${s.repoSlug}/context-engine`);
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>
                      {s.sessionId.length > 20 ? `${s.sessionId.slice(0, 20)}...` : s.sessionId}
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
