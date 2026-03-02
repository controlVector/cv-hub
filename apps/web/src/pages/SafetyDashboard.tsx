import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Box,
  Typography,
  Paper,
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  LinearProgress,
} from '@mui/material';
import {
  Shield as ShieldIcon,
  PlayArrow as RunIcon,
  Warning as WarningIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { colors } from '../theme';
import { api } from '../lib/api';

// ── Types ───────────────────────────────────────────────────────────────────

interface SafetyReport {
  risk_level: 'low' | 'medium' | 'high';
  stats: {
    files: number;
    symbols: number;
    functions: number;
    relationships: number;
  };
  dead_code: { name: string; kind: string; file: string; line: number }[];
  dead_code_total: number;
  complexity_hotspots: { name: string; complexity: number; file: string; line: number }[];
  circular_imports: { file_a: string; file_b: string }[];
  orphan_files: { path: string; language: string }[];
  checked_at: string;
}

interface RepoListItem {
  id: string;
  slug: string;
  name: string;
  organization?: { slug: string };
}

const RISK_CONFIG = {
  low: { label: 'Low Risk', color: colors.green, icon: <CheckIcon /> },
  medium: { label: 'Medium Risk', color: '#f59e0b', icon: <WarningIcon /> },
  high: { label: 'High Risk', color: '#ef4444', icon: <ErrorIcon /> },
};

// ── Component ───────────────────────────────────────────────────────────────

export default function SafetyDashboard() {
  const [selectedRepo, setSelectedRepo] = useState('');
  const [report, setReport] = useState<SafetyReport | null>(null);

  // Fetch repos for selector
  const { data: reposData } = useQuery<{ repositories: RepoListItem[] }>({
    queryKey: ['repositories', '', '', 100],
    queryFn: async () => {
      const res = await api.get('/v1/repos?limit=100');
      return res.data;
    },
  });

  const repos = reposData?.repositories ?? [];

  // Parse selected repo into owner/slug
  const parsedRepo = selectedRepo ? selectedRepo.split('/') : null;
  const owner = parsedRepo?.[0] ?? '';
  const repoSlug = parsedRepo?.[1] ?? '';

  // Run safety check mutation
  const runCheck = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/v1/repos/${owner}/${repoSlug}/safety/check`, {});
      return res.data.report as SafetyReport;
    },
    onSuccess: (data) => {
      setReport(data);
    },
  });

  const riskCfg = report ? RISK_CONFIG[report.risk_level] : null;

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <ShieldIcon sx={{ fontSize: 36, color: colors.violet }} />
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Safety Dashboard
          </Typography>
          <Typography variant="body2" sx={{ color: colors.textMuted, mt: 0.5 }}>
            Analyze code quality, detect dead code, and review architecture
          </Typography>
        </Box>
      </Box>

      {/* Controls */}
      <Paper sx={{ p: 2, mb: 3, backgroundColor: colors.slateLight, display: 'flex', gap: 2, alignItems: 'center' }}>
        <FormControl sx={{ minWidth: 250 }}>
          <InputLabel id="safety-repo-label">Repository</InputLabel>
          <Select
            labelId="safety-repo-label"
            id="safety-repo-select"
            value={selectedRepo}
            label="Repository"
            onChange={(e) => {
              setSelectedRepo(e.target.value);
              setReport(null);
            }}
          >
            {repos.map((r) => {
              const key = `${r.organization?.slug ?? r.slug}/${r.slug}`;
              return (
                <MenuItem key={r.id} value={key}>
                  {key}
                </MenuItem>
              );
            })}
          </Select>
        </FormControl>

        <Button
          variant="contained"
          startIcon={<RunIcon />}
          disabled={!selectedRepo || runCheck.isPending}
          onClick={() => runCheck.mutate()}
          sx={{
            background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.purple} 100%)`,
          }}
        >
          {runCheck.isPending ? 'Analyzing...' : 'Run Safety Check'}
        </Button>
      </Paper>

      {runCheck.isPending && <LinearProgress sx={{ mb: 2 }} />}

      {runCheck.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Safety check failed. Ensure the repository graph has been synced.
        </Alert>
      )}

      {/* No repo selected state */}
      {!selectedRepo && !report && (
        <Paper sx={{ p: 6, textAlign: 'center', backgroundColor: colors.slateLight }}>
          <ShieldIcon sx={{ fontSize: 64, color: colors.textMuted, mb: 2 }} />
          <Typography variant="h6" sx={{ color: colors.textMuted }}>
            Select a repository to run safety analysis
          </Typography>
          <Typography variant="body2" sx={{ color: colors.textMuted, mt: 1 }}>
            Analyzes dead code, complexity hotspots, circular imports, and orphan files
          </Typography>
        </Paper>
      )}

      {/* Report */}
      {report && riskCfg && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Risk badge + stats */}
          <Paper sx={{ p: 3, backgroundColor: colors.slateLight }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {riskCfg.icon}
                <Chip
                  label={riskCfg.label}
                  sx={{
                    backgroundColor: riskCfg.color,
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                  }}
                />
              </Box>
              <Typography variant="caption" sx={{ color: colors.textMuted }}>
                Checked: {new Date(report.checked_at).toLocaleString()}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 3 }}>
              {[
                { label: 'Files', value: report.stats.files },
                { label: 'Symbols', value: report.stats.symbols },
                { label: 'Functions', value: report.stats.functions },
                { label: 'Relationships', value: report.stats.relationships },
              ].map((s) => (
                <Box key={s.label} sx={{ textAlign: 'center' }}>
                  <Typography variant="h5" fontWeight={700}>{s.value}</Typography>
                  <Typography variant="caption" sx={{ color: colors.textMuted }}>{s.label}</Typography>
                </Box>
              ))}
            </Box>
          </Paper>

          {/* Dead code */}
          <Paper sx={{ p: 2, backgroundColor: colors.slateLight }}>
            <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>
              Dead Code ({report.dead_code_total} symbols)
            </Typography>
            {report.dead_code.length === 0 ? (
              <Typography variant="body2" sx={{ color: colors.textMuted }}>
                No dead code detected
              </Typography>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Symbol</TableCell>
                      <TableCell>Kind</TableCell>
                      <TableCell>File</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.dead_code.map((d, i) => (
                      <TableRow key={i}>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{d.name}</TableCell>
                        <TableCell>{d.kind}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{d.file}:{d.line}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>

          {/* Complexity hotspots */}
          <Paper sx={{ p: 2, backgroundColor: colors.slateLight }}>
            <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>
              Complexity Hotspots ({report.complexity_hotspots.length})
            </Typography>
            {report.complexity_hotspots.length === 0 ? (
              <Typography variant="body2" sx={{ color: colors.textMuted }}>
                No complexity hotspots detected
              </Typography>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Symbol</TableCell>
                      <TableCell>Complexity</TableCell>
                      <TableCell>File</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.complexity_hotspots.map((h, i) => (
                      <TableRow key={i}>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{h.name}</TableCell>
                        <TableCell>
                          <Chip
                            label={h.complexity}
                            size="small"
                            sx={{
                              backgroundColor: h.complexity > 20 ? '#ef4444' : h.complexity > 15 ? '#f59e0b' : '#3b82f6',
                              color: '#fff',
                            }}
                          />
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{h.file}:{h.line}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>

          {/* Circular imports */}
          <Paper sx={{ p: 2, backgroundColor: colors.slateLight }}>
            <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>
              Circular Imports ({report.circular_imports.length})
            </Typography>
            {report.circular_imports.length === 0 ? (
              <Typography variant="body2" sx={{ color: colors.textMuted }}>
                No circular imports detected
              </Typography>
            ) : (
              <Box>
                {report.circular_imports.map((c, i) => (
                  <Typography key={i} variant="body2" sx={{ fontFamily: 'monospace', mb: 0.5 }}>
                    {c.file_a} &harr; {c.file_b}
                  </Typography>
                ))}
              </Box>
            )}
          </Paper>

          {/* Orphan files */}
          <Paper sx={{ p: 2, backgroundColor: colors.slateLight }}>
            <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>
              Orphan Files ({report.orphan_files.length})
            </Typography>
            {report.orphan_files.length === 0 ? (
              <Typography variant="body2" sx={{ color: colors.textMuted }}>
                No orphan files detected
              </Typography>
            ) : (
              <Box>
                {report.orphan_files.map((f, i) => (
                  <Typography key={i} variant="body2" sx={{ fontFamily: 'monospace', mb: 0.5 }}>
                    {f.path} ({f.language || 'unknown'})
                  </Typography>
                ))}
              </Box>
            )}
          </Paper>
        </Box>
      )}
    </Box>
  );
}
