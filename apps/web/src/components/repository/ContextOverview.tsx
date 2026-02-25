/**
 * ContextOverview Component
 * Displays structured repository context: summary, key files/symbols,
 * dependencies, recent changes, dead code, and complexity hotspots.
 */

import { useState } from 'react';
import {
  Box,
  Typography,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Tabs,
  Tab,
  Tooltip,
  Skeleton,
  Alert,
} from '@mui/material';
import {
  AutoAwesome as AIIcon,
  Code,
  Functions,
  FolderOpen,
  History,
  Warning,
  Whatshot,
  CallSplit,
  TrendingUp,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { colors } from '../../theme';
import { getRepoContext } from '../../services/repository';

interface ContextOverviewProps {
  owner: string;
  repo: string;
  onNavigateToFile?: (path: string) => void;
}

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.5,
      borderRadius: 1.5, backgroundColor: colors.navyLight, border: `1px solid ${colors.navyLighter}`,
      minWidth: 120,
    }}>
      <Box sx={{ color: colors.textMuted, display: 'flex' }}>{icon}</Box>
      <Box>
        <Typography variant="h6" sx={{ fontSize: '1.1rem', fontWeight: 700, lineHeight: 1.1 }}>{value}</Typography>
        <Typography variant="caption" sx={{ color: colors.textMuted, fontSize: '0.65rem' }}>{label}</Typography>
      </Box>
    </Box>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1.5, mt: 3 }}>
      <Box sx={{ color: colors.violet, display: 'flex' }}>{icon}</Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: '0.9rem' }}>{children}</Typography>
    </Box>
  );
}

export function ContextOverview({ owner, repo, onNavigateToFile }: ContextOverviewProps) {
  const [subTab, setSubTab] = useState(0);

  const { data: ctx, isLoading, isError } = useQuery({
    queryKey: ['repoContext', owner, repo],
    queryFn: () => getRepoContext(owner, repo),
    staleTime: 120000,
  });

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 2 }}>
        <Skeleton variant="rectangular" height={80} sx={{ borderRadius: 2 }} />
        <Box sx={{ display: 'flex', gap: 2 }}>
          {[1, 2, 3, 4].map(i => <Skeleton key={i} variant="rectangular" width={140} height={60} sx={{ borderRadius: 1.5 }} />)}
        </Box>
        <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 2 }} />
      </Box>
    );
  }

  if (isError || !ctx) {
    return (
      <Alert severity="info" sx={{ mt: 1 }}>
        No context data available. Run a graph sync with AI summaries enabled to generate context.
      </Alert>
    );
  }

  const fileLinkSx = onNavigateToFile ? {
    cursor: 'pointer', color: colors.violet, '&:hover': { textDecoration: 'underline' },
  } : {};

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Summary */}
      {ctx.summary && (
        <Box sx={{
          p: 2, borderRadius: 2, mb: 2,
          backgroundColor: 'rgba(139, 92, 246, 0.05)',
          border: `1px solid ${colors.navyLighter}`,
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
            <AIIcon sx={{ fontSize: 14, color: colors.orange }} />
            <Typography variant="caption" sx={{ fontWeight: 600, color: colors.textMuted }}>AI Repository Summary</Typography>
          </Box>
          <Typography variant="body2" sx={{ fontSize: '0.85rem', lineHeight: 1.7, mb: 1.5 }}>
            {ctx.summary}
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            {ctx.technologies.length > 0 && (
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                <Typography variant="caption" sx={{ color: colors.textMuted, mr: 0.5 }}>Tech:</Typography>
                {ctx.technologies.map(t => <Chip key={t} label={t} size="small" sx={{ fontSize: '0.65rem', height: 20 }} />)}
              </Box>
            )}
            {ctx.keyPatterns.length > 0 && (
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                <Typography variant="caption" sx={{ color: colors.textMuted, mr: 0.5 }}>Patterns:</Typography>
                {ctx.keyPatterns.map(p => (
                  <Chip key={p} label={p} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />
                ))}
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* Stats Row */}
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
        <StatCard label="Files" value={ctx.stats.fileCount} icon={<Code sx={{ fontSize: 18 }} />} />
        <StatCard label="Symbols" value={ctx.stats.symbolCount} icon={<Functions sx={{ fontSize: 18 }} />} />
        <StatCard label="Commits" value={ctx.stats.commitCount} icon={<History sx={{ fontSize: 18 }} />} />
        <StatCard label="Modules" value={ctx.stats.moduleCount} icon={<FolderOpen sx={{ fontSize: 18 }} />} />
        {ctx.languages.length > 0 && (
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 0.5, px: 2, py: 1.5,
            borderRadius: 1.5, backgroundColor: colors.navyLight, border: `1px solid ${colors.navyLighter}`,
            flex: 1, minWidth: 200, flexWrap: 'wrap',
          }}>
            {ctx.languages.slice(0, 6).map(l => (
              <Chip key={l.language} label={`${l.language} (${l.count})`} size="small"
                sx={{ fontSize: '0.6rem', height: 18 }} />
            ))}
          </Box>
        )}
      </Box>

      {/* Sub-tabs */}
      <Tabs value={subTab} onChange={(_, v) => setSubTab(v)} sx={{ mt: 1, mb: 0, minHeight: 36,
        '& .MuiTab-root': { minHeight: 36, py: 0, textTransform: 'none', fontSize: '0.8rem' } }}>
        <Tab icon={<Code sx={{ fontSize: 14 }} />} iconPosition="start" label="Key Files" />
        <Tab icon={<Functions sx={{ fontSize: 14 }} />} iconPosition="start" label="Key Symbols" />
        <Tab icon={<CallSplit sx={{ fontSize: 14 }} />} iconPosition="start" label="Dependencies" />
        <Tab icon={<History sx={{ fontSize: 14 }} />} iconPosition="start" label="Recent Changes" />
        <Tab icon={<Whatshot sx={{ fontSize: 14 }} />} iconPosition="start" label="Hotspots" />
        <Tab icon={<Warning sx={{ fontSize: 14 }} />} iconPosition="start" label="Dead Code" />
      </Tabs>

      {/* Key Files */}
      {subTab === 0 && (
        <Box>
          <SectionTitle icon={<Code sx={{ fontSize: 16 }} />}>Top Files by Complexity</SectionTitle>
          {ctx.topFiles.length === 0 ? (
            <Typography variant="body2" sx={{ color: colors.textMuted }}>No file data available.</Typography>
          ) : (
            <TableContainer component={Paper} sx={{ backgroundColor: colors.navyLight, borderRadius: 1.5 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>File</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem' }}>LOC</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Complexity</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Summary</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {ctx.topFiles.map(f => (
                    <TableRow key={f.path} hover>
                      <TableCell sx={{ fontSize: '0.75rem', fontFamily: 'monospace', ...fileLinkSx }}
                        onClick={() => onNavigateToFile?.(f.path)}>
                        {f.path}
                      </TableCell>
                      <TableCell align="right" sx={{ fontSize: '0.75rem' }}>{f.linesOfCode}</TableCell>
                      <TableCell align="right" sx={{ fontSize: '0.75rem' }}>{f.complexity}</TableCell>
                      <TableCell sx={{ fontSize: '0.7rem', color: colors.textMuted, maxWidth: 300 }}>
                        <Tooltip title={f.summary || ''} placement="top">
                          <span>{(f.summary || '').slice(0, 100)}{f.summary && f.summary.length > 100 ? '...' : ''}</span>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {/* Entry Points */}
          {ctx.entryPoints.length > 0 && (
            <>
              <SectionTitle icon={<TrendingUp sx={{ fontSize: 16 }} />}>Entry Points</SectionTitle>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {ctx.entryPoints.map(ep => (
                  <Chip key={ep} label={ep} size="small" variant="outlined"
                    onClick={() => onNavigateToFile?.(ep)}
                    sx={{ fontSize: '0.7rem', fontFamily: 'monospace', cursor: onNavigateToFile ? 'pointer' : 'default' }} />
                ))}
              </Box>
            </>
          )}

          {/* Directory Structure */}
          {ctx.modules.length > 0 && (
            <>
              <SectionTitle icon={<FolderOpen sx={{ fontSize: 16 }} />}>Directory Structure</SectionTitle>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {ctx.modules.map(m => (
                  <Chip key={m.path} label={`${m.path}/ (${m.fileCount})`} size="small"
                    sx={{ fontSize: '0.7rem', fontFamily: 'monospace' }} />
                ))}
              </Box>
            </>
          )}
        </Box>
      )}

      {/* Key Symbols */}
      {subTab === 1 && (
        <Box>
          <SectionTitle icon={<Functions sx={{ fontSize: 16 }} />}>Top Symbols by Complexity</SectionTitle>
          {ctx.topSymbols.length === 0 ? (
            <Typography variant="body2" sx={{ color: colors.textMuted }}>No symbol data available.</Typography>
          ) : (
            <TableContainer component={Paper} sx={{ backgroundColor: colors.navyLight, borderRadius: 1.5 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Symbol</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Kind</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>File</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Complexity</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Summary</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {ctx.topSymbols.map((s, i) => (
                    <TableRow key={`${s.file}:${s.name}:${i}`} hover>
                      <TableCell sx={{ fontSize: '0.75rem', fontFamily: 'monospace', fontWeight: 600 }}>{s.name}</TableCell>
                      <TableCell>
                        <Chip label={s.kind} size="small" sx={{ fontSize: '0.6rem', height: 18 }} />
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.7rem', fontFamily: 'monospace', ...fileLinkSx }}
                        onClick={() => onNavigateToFile?.(s.file)}>
                        {s.file}
                      </TableCell>
                      <TableCell align="right" sx={{ fontSize: '0.75rem' }}>{s.complexity}</TableCell>
                      <TableCell sx={{ fontSize: '0.7rem', color: colors.textMuted, maxWidth: 250 }}>
                        {(s.summary || '').slice(0, 80)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      )}

      {/* Dependencies */}
      {subTab === 2 && (
        <Box>
          <SectionTitle icon={<CallSplit sx={{ fontSize: 16 }} />}>Module Dependencies</SectionTitle>
          {ctx.dependencies.length === 0 ? (
            <Typography variant="body2" sx={{ color: colors.textMuted }}>No cross-module dependencies found.</Typography>
          ) : (
            <TableContainer component={Paper} sx={{ backgroundColor: colors.navyLight, borderRadius: 1.5 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>From</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}></TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>To</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Imports</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {ctx.dependencies.map((d, i) => (
                    <TableRow key={`${d.from}-${d.to}-${i}`} hover>
                      <TableCell sx={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>{d.from}/</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', color: colors.textMuted, textAlign: 'center' }}>&#8594;</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>{d.to}/</TableCell>
                      <TableCell align="right" sx={{ fontSize: '0.75rem' }}>{d.weight}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      )}

      {/* Recent Changes */}
      {subTab === 3 && (
        <Box>
          <SectionTitle icon={<History sx={{ fontSize: 16 }} />}>Recent Changes</SectionTitle>
          {ctx.recentCommits.length === 0 ? (
            <Typography variant="body2" sx={{ color: colors.textMuted }}>No commit history available.</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {ctx.recentCommits.map((c, i) => (
                <Box key={`${c.sha}-${i}`} sx={{
                  p: 1.5, borderRadius: 1.5,
                  backgroundColor: colors.navyLight, border: `1px solid ${colors.navyLighter}`,
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Chip label={c.sha} size="small" sx={{ fontFamily: 'monospace', fontSize: '0.65rem', height: 18 }} />
                    <Typography variant="caption" sx={{ color: colors.textMuted }}>{c.author}</Typography>
                    {c.filesChanged > 0 && (
                      <Chip label={`${c.filesChanged} files`} size="small" variant="outlined"
                        sx={{ fontSize: '0.6rem', height: 16, ml: 'auto' }} />
                    )}
                  </Box>
                  <Typography variant="body2" sx={{ fontSize: '0.8rem', mb: c.files.length > 0 ? 0.5 : 0 }}>
                    {c.message}
                  </Typography>
                  {c.files.length > 0 && (
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {c.files.map(f => (
                        <Chip key={f} label={f} size="small" variant="outlined"
                          onClick={() => onNavigateToFile?.(f)}
                          sx={{ fontSize: '0.6rem', height: 16, fontFamily: 'monospace',
                            cursor: onNavigateToFile ? 'pointer' : 'default' }} />
                      ))}
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* Complexity Hotspots */}
      {subTab === 4 && (
        <Box>
          <SectionTitle icon={<Whatshot sx={{ fontSize: 16 }} />}>Complexity Hotspots</SectionTitle>
          <Typography variant="caption" sx={{ color: colors.textMuted, mb: 1, display: 'block' }}>
            Files with highest complexity density (complexity / lines of code).
          </Typography>
          {ctx.complexityHotspots.length === 0 ? (
            <Typography variant="body2" sx={{ color: colors.textMuted }}>No complexity data available.</Typography>
          ) : (
            <TableContainer component={Paper} sx={{ backgroundColor: colors.navyLight, borderRadius: 1.5 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>File</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Complexity</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem' }}>LOC</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Density</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {ctx.complexityHotspots.map(h => (
                    <TableRow key={h.path} hover>
                      <TableCell sx={{ fontSize: '0.75rem', fontFamily: 'monospace', ...fileLinkSx }}
                        onClick={() => onNavigateToFile?.(h.path)}>
                        {h.path}
                      </TableCell>
                      <TableCell align="right" sx={{ fontSize: '0.75rem' }}>{h.complexity}</TableCell>
                      <TableCell align="right" sx={{ fontSize: '0.75rem' }}>{h.linesOfCode}</TableCell>
                      <TableCell align="right" sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.orange }}>
                        {h.density}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      )}

      {/* Dead Code */}
      {subTab === 5 && (
        <Box>
          <SectionTitle icon={<Warning sx={{ fontSize: 16 }} />}>Dead Code Candidates</SectionTitle>
          <Typography variant="caption" sx={{ color: colors.textMuted, mb: 1, display: 'block' }}>
            Public functions/methods with no callers detected in the knowledge graph.
          </Typography>
          {ctx.deadCode.length === 0 ? (
            <Typography variant="body2" sx={{ color: colors.textMuted }}>No dead code candidates found.</Typography>
          ) : (
            <TableContainer component={Paper} sx={{ backgroundColor: colors.navyLight, borderRadius: 1.5 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Symbol</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Kind</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>File</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Complexity</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {ctx.deadCode.map((d, i) => (
                    <TableRow key={`${d.file}:${d.name}:${i}`} hover>
                      <TableCell sx={{ fontSize: '0.75rem', fontFamily: 'monospace', fontWeight: 600 }}>{d.name}</TableCell>
                      <TableCell><Chip label={d.kind} size="small" sx={{ fontSize: '0.6rem', height: 18 }} /></TableCell>
                      <TableCell sx={{ fontSize: '0.7rem', fontFamily: 'monospace', ...fileLinkSx }}
                        onClick={() => onNavigateToFile?.(d.file)}>
                        {d.file}
                      </TableCell>
                      <TableCell align="right" sx={{ fontSize: '0.75rem' }}>{d.complexity}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      )}
    </Box>
  );
}

export default ContextOverview;
