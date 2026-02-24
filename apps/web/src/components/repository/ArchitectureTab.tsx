/**
 * ArchitectureTab Component
 * Container with view mode selector, graph canvas, toolbar, and node detail panel
 */

import { useState, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  IconButton,
  Tooltip,
  TextField,
  InputAdornment,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Alert,
} from '@mui/material';
import {
  AccountTree,
  DeviceHub,
  ViewModule,
  Whatshot,
  Search,
  Refresh,
  AutoAwesome as AIIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { colors } from '../../theme';
import { getArchitectureViz, getHeatmapViz, getRepositorySummaryApi, triggerGraphSync } from '../../services/repository';
import type { VizData, VizNode } from '../../services/repository';
import GraphCanvas, { type ColorMode } from './GraphCanvas';
import NodeDetailPanel from './NodeDetailPanel';

type ViewMode = 'dependencies' | 'calls' | 'modules' | 'complexity';

const VIEW_MODES: { value: ViewMode; label: string; icon: React.ReactNode; description: string }[] = [
  { value: 'dependencies', label: 'Dependencies', icon: <AccountTree sx={{ fontSize: 16 }} />, description: 'File import relationships' },
  { value: 'calls', label: 'Call Graph', icon: <DeviceHub sx={{ fontSize: 16 }} />, description: 'Function call relationships' },
  { value: 'modules', label: 'Modules', icon: <ViewModule sx={{ fontSize: 16 }} />, description: 'Directory/module hierarchy' },
  { value: 'complexity', label: 'Complexity', icon: <Whatshot sx={{ fontSize: 16 }} />, description: 'Complexity heatmap' },
];

interface ArchitectureTabProps {
  owner: string;
  repo: string;
}

export function ArchitectureTab({ owner, repo }: ArchitectureTabProps) {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>('dependencies');
  const [colorMode, setColorMode] = useState<ColorMode>('default');
  const [selectedNode, setSelectedNode] = useState<VizNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [callSymbol, setCallSymbol] = useState('');
  const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Build query params based on view mode
  const queryParams: Record<string, string> = {};
  if (viewMode === 'calls' && callSymbol) {
    queryParams.symbol = callSymbol;
  }

  // Fetch viz data
  const { data: vizData, isLoading, isError: vizError, error: vizErrorDetail, refetch } = useQuery({
    queryKey: ['architectureViz', owner, repo, viewMode, JSON.stringify(queryParams)],
    queryFn: () => getArchitectureViz(owner, repo, viewMode, queryParams),
    staleTime: 60000,
  });

  // Fetch heatmap overlay data when a heatmap color mode is active
  const { data: heatmapData } = useQuery({
    queryKey: ['heatmapViz', owner, repo, colorMode],
    queryFn: () => getHeatmapViz(owner, repo, colorMode as 'recency' | 'frequency' | 'churn'),
    enabled: colorMode !== 'default',
    staleTime: 60000,
  });

  // Fetch repo summary
  const { data: repoSummary } = useQuery({
    queryKey: ['repoSummary', owner, repo],
    queryFn: () => getRepositorySummaryApi(owner, repo),
    staleTime: 300000,
  });

  // Merge heatmap data into viz data when active (memoized)
  const displayData = useMemo<VizData | null>(() => {
    if (!vizData) return null;
    if (colorMode === 'default' || !heatmapData) return vizData;

    const heatmapMap = new Map(heatmapData.nodes.map(n => [n.id, n]));
    return {
      ...vizData,
      nodes: vizData.nodes.map(n => {
        const heatNode = heatmapMap.get(n.id);
        if (heatNode) {
          return {
            ...n,
            lastModifiedCommit: heatNode.lastModifiedCommit,
            lastModifiedTimestamp: heatNode.lastModifiedTimestamp,
            modificationCount: heatNode.modificationCount,
          };
        }
        return n;
      }),
    };
  }, [vizData, colorMode, heatmapData]);

  const handleNodeSelect = useCallback((node: VizNode | null) => {
    setSelectedNode(node);
  }, []);

  const handleSyncGraph = async () => {
    setSyncMessage(null);
    try {
      await triggerGraphSync(owner, repo);
      setSyncMessage({ type: 'success', text: 'Graph sync started. Data will refresh shortly.' });
      setTimeout(() => {
        refetch();
        setSyncMessage(null);
      }, 5000);
    } catch (err) {
      setSyncMessage({ type: 'error', text: 'Failed to trigger graph sync.' });
    }
  };

  // Filter nodes by search (memoized)
  const filteredData = useMemo<VizData | null>(() => {
    if (!displayData || !searchQuery.trim()) return displayData;
    const q = searchQuery.toLowerCase();
    const matchingIds = new Set(
      displayData.nodes
        .filter(n => n.label.toLowerCase().includes(q) || n.path?.toLowerCase().includes(q))
        .map(n => n.id)
    );
    return {
      ...displayData,
      nodes: displayData.nodes.filter(n => matchingIds.has(n.id)),
      edges: displayData.edges.filter(e => matchingIds.has(e.source) && matchingIds.has(e.target)),
      meta: { ...displayData.meta, nodeCount: matchingIds.size },
    };
  }, [displayData, searchQuery]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Repo Summary */}
      {repoSummary && (
        <Box
          sx={{
            p: 2,
            borderRadius: 2,
            backgroundColor: 'rgba(139, 92, 246, 0.05)',
            border: `1px solid ${colors.navyLighter}`,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
            <AIIcon sx={{ fontSize: 14, color: colors.orange }} />
            <Typography variant="caption" sx={{ fontWeight: 600, color: colors.textMuted }}>
              AI Repository Summary
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ fontSize: '0.85rem', lineHeight: 1.6, mb: 1 }}>
            {repoSummary.summary}
          </Typography>
          {repoSummary.technologies?.length > 0 && (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {repoSummary.technologies.map((tech: string) => (
                <Chip key={tech} label={tech} size="small" sx={{ fontSize: '0.65rem', height: 20 }} />
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* Error state */}
      {vizError && (
        <Alert severity="error" sx={{ mb: 1 }}>
          Failed to load graph data{vizErrorDetail instanceof Error ? `: ${vizErrorDetail.message}` : ''}
        </Alert>
      )}

      {/* Sync feedback */}
      {syncMessage && (
        <Alert severity={syncMessage.type} onClose={() => setSyncMessage(null)}>
          {syncMessage.text}
        </Alert>
      )}

      {/* Toolbar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        {/* View Mode Selector */}
        <ToggleButtonGroup
          value={viewMode}
          exclusive
          onChange={(_, val) => val && setViewMode(val)}
          size="small"
          sx={{ '& .MuiToggleButton-root': { textTransform: 'none', px: 1.5, py: 0.5 } }}
        >
          {VIEW_MODES.map(({ value, label, icon, description }) => (
            <ToggleButton key={value} value={value} aria-label={description}>
              <Tooltip title={description}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {icon}
                  <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>{label}</Typography>
                </Box>
              </Tooltip>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        {/* Color Mode (Heatmap overlay) */}
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel sx={{ fontSize: '0.75rem' }}>Color</InputLabel>
          <Select
            value={colorMode}
            label="Color"
            onChange={(e) => setColorMode(e.target.value as ColorMode)}
            sx={{ fontSize: '0.75rem', height: 32 }}
          >
            <MenuItem value="default">Default</MenuItem>
            <MenuItem value="recency">Recency</MenuItem>
            <MenuItem value="frequency">Frequency</MenuItem>
            <MenuItem value="churn">Churn</MenuItem>
          </Select>
        </FormControl>

        {/* Call graph symbol filter */}
        {viewMode === 'calls' && (
          <TextField
            size="small"
            placeholder="Filter by symbol..."
            value={callSymbol}
            onChange={(e) => setCallSymbol(e.target.value)}
            sx={{ width: 200, '& input': { fontSize: '0.8rem', py: 0.5 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <DeviceHub sx={{ fontSize: 16 }} />
                </InputAdornment>
              ),
            }}
            onKeyDown={(e) => e.key === 'Enter' && refetch()}
          />
        )}

        {/* Search */}
        <TextField
          size="small"
          placeholder="Search nodes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          sx={{ width: 180, '& input': { fontSize: '0.8rem', py: 0.5 } }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search sx={{ fontSize: 16 }} />
              </InputAdornment>
            ),
          }}
        />

        <Box sx={{ flex: 1 }} />

        {/* Stats */}
        {vizData && (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Chip
              label={`${vizData.meta.nodeCount} nodes`}
              size="small"
              sx={{ fontSize: '0.7rem', height: 22 }}
            />
            <Chip
              label={`${vizData.meta.edgeCount} edges`}
              size="small"
              sx={{ fontSize: '0.7rem', height: 22 }}
            />
          </Box>
        )}

        {/* Sync button */}
        <Tooltip title="Sync Graph">
          <IconButton size="small" onClick={handleSyncGraph} aria-label="Sync graph">
            <Refresh sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Graph + Detail Panel */}
      <Box sx={{ display: 'flex', gap: 2, minHeight: 500 }}>
        <GraphCanvas
          data={filteredData}
          colorMode={colorMode}
          isLoading={isLoading}
          onNodeSelect={handleNodeSelect}
          selectedNodeId={selectedNode?.id}
        />

        {selectedNode && (
          <NodeDetailPanel
            node={selectedNode}
            owner={owner}
            repo={repo}
            onClose={() => setSelectedNode(null)}
            onNavigateToFile={(path) => {
              navigate(`/dashboard/repositories/${owner}/${repo}/blob/main/${path}`);
            }}
          />
        )}
      </Box>
    </Box>
  );
}

export default ArchitectureTab;
