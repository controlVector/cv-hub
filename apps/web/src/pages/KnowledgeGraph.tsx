import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  InputAdornment,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  FormControlLabel,
  Switch,
  Tooltip,
  Button,
  Divider,
  CircularProgress,
  Alert,
} from '@mui/material';
import {
  Search as SearchIcon,
  BubbleChart as GraphIcon,
  FilterList,
  ZoomIn,
  ZoomOut,
  CenterFocusStrong,
  Fullscreen,
  Download,
  Refresh,
  KeyboardArrowDown,
  Circle,
} from '@mui/icons-material';
import { colors } from '../theme';
import { api } from '../lib/api';
import {
  getGraphVisualization,
  triggerGraphSync,
  type GraphNode,
  type GraphEdge,
} from '../services/repository';

interface PositionedNode extends GraphNode {
  x: number;
  y: number;
}

interface Repository {
  id: string;
  slug: string;
  name: string;
  userId?: string;
  organizationId?: string;
  graphSyncStatus: string;
  owner?: { username: string };
  organization?: { slug: string };
}

const nodeTypeColors: Record<string, string> = {
  file: colors.blue,
  function: colors.orange,
  class: colors.purple,
  module: colors.green,
  commit: colors.textMuted,
};

const edgeTypeColors: Record<string, string> = {
  calls: colors.orange,
  imports: colors.blue,
  inherits: colors.purple,
  defines: colors.green,
  modifies: colors.textMuted,
};

// Simple force-directed layout
function layoutNodes(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number): PositionedNode[] {
  if (nodes.length === 0) return [];

  // Initialize positions in a circle
  const positioned: PositionedNode[] = nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    const radius = Math.min(width, height) * 0.35;
    return {
      ...node,
      x: width / 2 + radius * Math.cos(angle),
      y: height / 2 + radius * Math.sin(angle),
    };
  });

  // Simple force simulation (a few iterations)
  const nodeMap = new Map(positioned.map(n => [n.id, n]));

  for (let iter = 0; iter < 50; iter++) {
    // Repulsion between all nodes
    for (let i = 0; i < positioned.length; i++) {
      for (let j = i + 1; j < positioned.length; j++) {
        const dx = positioned[j].x - positioned[i].x;
        const dy = positioned[j].y - positioned[i].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = 5000 / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        positioned[i].x -= fx;
        positioned[i].y -= fy;
        positioned[j].x += fx;
        positioned[j].y += fy;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) continue;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = dist * 0.01;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      source.x += fx;
      source.y += fy;
      target.x -= fx;
      target.y -= fy;
    }

    // Keep nodes within bounds
    for (const node of positioned) {
      node.x = Math.max(50, Math.min(width - 50, node.x));
      node.y = Math.max(50, Math.min(height - 50, node.y));
    }
  }

  return positioned;
}

export default function KnowledgeGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const queryClient = useQueryClient();
  const [selectedNode, setSelectedNode] = useState<PositionedNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [zoom, setZoom] = useState(1);
  const [showLabels, setShowLabels] = useState(true);
  const [filterMenuAnchor, setFilterMenuAnchor] = useState<null | HTMLElement>(null);
  const [selectedRepo, setSelectedRepo] = useState<{ owner: string; repo: string } | null>(null);
  const [repoMenuAnchor, setRepoMenuAnchor] = useState<null | HTMLElement>(null);
  const [nodeFilters, setNodeFilters] = useState({
    file: true,
    function: true,
    class: true,
    module: true,
  });
  const [positionedNodes, setPositionedNodes] = useState<PositionedNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);

  // Fetch repositories
  const { data: reposData, isLoading: reposLoading } = useQuery({
    queryKey: ['repositories'],
    queryFn: async () => {
      const response = await api.get('/v1/repos');
      return response.data.repositories as Repository[];
    },
  });

  // Fetch graph data for selected repo
  const {
    data: graphData,
    isLoading: graphLoading,
    error: graphError,
  } = useQuery({
    queryKey: ['graph', selectedRepo?.owner, selectedRepo?.repo],
    queryFn: () => getGraphVisualization(selectedRepo!.owner, selectedRepo!.repo),
    enabled: !!selectedRepo,
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: () => triggerGraphSync(selectedRepo!.owner, selectedRepo!.repo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph', selectedRepo?.owner, selectedRepo?.repo] });
    },
  });

  // Auto-select first repo if none selected
  useEffect(() => {
    if (reposData?.length && !selectedRepo) {
      const repo = reposData[0];
      const owner = repo.organization?.slug || repo.owner?.username || 'unknown';
      setSelectedRepo({ owner, repo: repo.slug });
    }
  }, [reposData, selectedRepo]);

  // Layout nodes when graph data changes
  useEffect(() => {
    if (graphData) {
      const canvas = canvasRef.current;
      const width = canvas?.width || 800;
      const height = canvas?.height || 600;
      const positioned = layoutNodes(graphData.nodes, graphData.edges, width, height);
      setPositionedNodes(positioned);
      setGraphEdges(graphData.edges);
    }
  }, [graphData]);

  // Draw graph
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = colors.navy;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (positionedNodes.length === 0) {
      // Draw empty state message
      ctx.font = '16px system-ui';
      ctx.fillStyle = colors.textMuted;
      ctx.textAlign = 'center';
      ctx.fillText('No graph data available', canvas.width / 2, canvas.height / 2);
      ctx.font = '12px system-ui';
      ctx.fillText('Select a repository and sync to populate the graph', canvas.width / 2, canvas.height / 2 + 25);
      return;
    }

    // Apply zoom
    ctx.save();
    ctx.scale(zoom, zoom);

    const nodeMap = new Map(positionedNodes.map(n => [n.id, n]));

    // Draw edges
    graphEdges.forEach((edge) => {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) return;

      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.strokeStyle = (edgeTypeColors[edge.type] || colors.textMuted) + '60';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw arrow
      const angle = Math.atan2(target.y - source.y, target.x - source.x);
      const arrowLength = 10;
      const arrowX = target.x - 25 * Math.cos(angle);
      const arrowY = target.y - 25 * Math.sin(angle);

      ctx.beginPath();
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(
        arrowX - arrowLength * Math.cos(angle - Math.PI / 6),
        arrowY - arrowLength * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        arrowX - arrowLength * Math.cos(angle + Math.PI / 6),
        arrowY - arrowLength * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fillStyle = edgeTypeColors[edge.type] || colors.textMuted;
      ctx.fill();
    });

    // Draw nodes
    positionedNodes.forEach((node) => {
      if (!nodeFilters[node.type as keyof typeof nodeFilters]) return;

      const radius = 15 + (node.complexity || 0) / 5;
      const isSelected = selectedNode?.id === node.id;

      // Glow effect for selected node
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 10, 0, Math.PI * 2);
        ctx.fillStyle = (nodeTypeColors[node.type] || colors.textMuted) + '30';
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = nodeTypeColors[node.type] || colors.textMuted;
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = colors.textLight;
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // Label
      if (showLabels) {
        ctx.font = '11px system-ui';
        ctx.fillStyle = colors.textLight;
        ctx.textAlign = 'center';
        ctx.fillText(node.label, node.x, node.y + radius + 15);
      }
    });

    ctx.restore();
  }, [zoom, showLabels, selectedNode, nodeFilters, positionedNodes, graphEdges]);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;

    const clickedNode = positionedNodes.find((node) => {
      const radius = 15 + (node.complexity || 0) / 5;
      const distance = Math.sqrt((x - node.x) ** 2 + (y - node.y) ** 2);
      return distance <= radius;
    });

    setSelectedNode(clickedNode || null);
  }, [zoom, positionedNodes]);

  const getRepoLabel = () => {
    if (!selectedRepo) return 'Select repository';
    return `${selectedRepo.owner}/${selectedRepo.repo}`;
  };

  const stats = graphData?.stats;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
            Knowledge Graph
          </Typography>
          <Typography variant="body2" sx={{ color: colors.textMuted }}>
            Explore code relationships and dependencies
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Box
            onClick={(e) => setRepoMenuAnchor(e.currentTarget)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 2,
              py: 1,
              borderRadius: 2,
              backgroundColor: colors.navyLight,
              border: `1px solid ${colors.navyLighter}`,
              cursor: 'pointer',
              '&:hover': { borderColor: colors.orange },
            }}
          >
            <Typography variant="body2">{getRepoLabel()}</Typography>
            <KeyboardArrowDown sx={{ fontSize: 18, color: colors.textMuted }} />
          </Box>
          <Button
            variant="outlined"
            startIcon={syncMutation.isPending ? <CircularProgress size={16} /> : <Refresh />}
            onClick={() => syncMutation.mutate()}
            disabled={!selectedRepo || syncMutation.isPending}
          >
            {syncMutation.isPending ? 'Syncing...' : 'Sync Graph'}
          </Button>
        </Box>
      </Box>

      {graphError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load graph: {(graphError as Error).message}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 3, flex: 1 }}>
        {/* Graph Canvas */}
        <Card sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {/* Loading overlay */}
          {graphLoading && (
            <Box sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0,0,0,0.5)',
              zIndex: 20,
            }}>
              <CircularProgress />
            </Box>
          )}

          {/* Toolbar */}
          <Box
            sx={{
              position: 'absolute',
              top: 16,
              left: 16,
              right: 16,
              display: 'flex',
              justifyContent: 'space-between',
              zIndex: 10,
            }}
          >
            <TextField
              placeholder="Search nodes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              size="small"
              sx={{
                width: 250,
                backgroundColor: `${colors.navyLight}ee`,
                borderRadius: 1,
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: colors.textMuted }} />
                  </InputAdornment>
                ),
              }}
            />

            <Box sx={{ display: 'flex', gap: 1, backgroundColor: `${colors.navyLight}ee`, borderRadius: 1, p: 0.5 }}>
              <Tooltip title="Zoom In">
                <IconButton size="small" onClick={() => setZoom((z) => Math.min(z + 0.2, 2))}>
                  <ZoomIn />
                </IconButton>
              </Tooltip>
              <Tooltip title="Zoom Out">
                <IconButton size="small" onClick={() => setZoom((z) => Math.max(z - 0.2, 0.5))}>
                  <ZoomOut />
                </IconButton>
              </Tooltip>
              <Tooltip title="Center View">
                <IconButton size="small" onClick={() => setZoom(1)}>
                  <CenterFocusStrong />
                </IconButton>
              </Tooltip>
              <Divider orientation="vertical" flexItem />
              <Tooltip title="Filter Nodes">
                <IconButton size="small" onClick={(e) => setFilterMenuAnchor(e.currentTarget)}>
                  <FilterList />
                </IconButton>
              </Tooltip>
              <Tooltip title="Fullscreen">
                <IconButton size="small">
                  <Fullscreen />
                </IconButton>
              </Tooltip>
              <Tooltip title="Export">
                <IconButton size="small">
                  <Download />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          {/* Canvas */}
          <canvas
            ref={canvasRef}
            width={800}
            height={600}
            onClick={handleCanvasClick}
            style={{
              width: '100%',
              height: '100%',
              cursor: 'pointer',
            }}
          />

          {/* Legend */}
          <Box
            sx={{
              position: 'absolute',
              bottom: 16,
              left: 16,
              display: 'flex',
              gap: 2,
              backgroundColor: `${colors.navyLight}ee`,
              borderRadius: 1,
              p: 1.5,
            }}
          >
            {Object.entries(nodeTypeColors).map(([type, color]) => (
              <Box key={type} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Circle sx={{ fontSize: 12, color }} />
                <Typography variant="caption" sx={{ color: colors.textMuted, textTransform: 'capitalize' }}>
                  {type}
                </Typography>
              </Box>
            ))}
          </Box>
        </Card>

        {/* Side Panel */}
        <Card sx={{ width: 320, flexShrink: 0 }}>
          <CardContent>
            {selectedNode ? (
              <>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <Circle sx={{ fontSize: 16, color: nodeTypeColors[selectedNode.type] }} />
                  <Typography variant="h6" sx={{ fontWeight: 600 }}>
                    {selectedNode.label}
                  </Typography>
                </Box>

                <Chip
                  label={selectedNode.type}
                  size="small"
                  sx={{
                    mb: 2,
                    textTransform: 'capitalize',
                    backgroundColor: `${nodeTypeColors[selectedNode.type]}20`,
                    color: nodeTypeColors[selectedNode.type],
                  }}
                />

                {selectedNode.path && (
                  <Typography variant="body2" sx={{ color: colors.textMuted, mb: 2, wordBreak: 'break-all' }}>
                    {selectedNode.path}
                  </Typography>
                )}

                <Typography variant="subtitle2" sx={{ color: colors.textMuted, mb: 1 }}>
                  Metrics
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 3 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">Complexity</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {selectedNode.complexity || 0}
                    </Typography>
                  </Box>
                </Box>

                <Typography variant="subtitle2" sx={{ color: colors.textMuted, mb: 1 }}>
                  Connections
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 3 }}>
                  {graphEdges
                    .filter((e) => e.source === selectedNode.id || e.target === selectedNode.id)
                    .slice(0, 5)
                    .map((edge, i) => {
                      const isSource = edge.source === selectedNode.id;
                      const otherNode = positionedNodes.find(
                        (n) => n.id === (isSource ? edge.target : edge.source)
                      );
                      return (
                        <Box
                          key={i}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            p: 1,
                            borderRadius: 1,
                            backgroundColor: colors.navy,
                          }}
                        >
                          <Typography variant="caption" sx={{ color: edgeTypeColors[edge.type] }}>
                            {isSource ? '->' : '<-'}
                          </Typography>
                          <Typography variant="body2">{otherNode?.label || 'Unknown'}</Typography>
                          <Chip
                            label={edge.type}
                            size="small"
                            sx={{
                              ml: 'auto',
                              height: 18,
                              fontSize: '0.65rem',
                              backgroundColor: `${edgeTypeColors[edge.type]}20`,
                              color: edgeTypeColors[edge.type],
                            }}
                          />
                        </Box>
                      );
                    })}
                </Box>

                <Button fullWidth variant="outlined" size="small">
                  View Source Code
                </Button>
              </>
            ) : (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <GraphIcon sx={{ fontSize: 48, color: colors.navyLighter, mb: 2 }} />
                <Typography variant="body2" sx={{ color: colors.textMuted }}>
                  Click on a node to view details
                </Typography>
              </Box>
            )}

            <Divider sx={{ my: 3 }} />

            <Typography variant="subtitle2" sx={{ color: colors.textMuted, mb: 2 }}>
              Graph Stats
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <Box sx={{ p: 1.5, borderRadius: 1, backgroundColor: colors.navy, textAlign: 'center' }}>
                <Typography variant="h5" sx={{ fontWeight: 700, color: colors.orange }}>
                  {stats?.fileCount ?? positionedNodes.length}
                </Typography>
                <Typography variant="caption" sx={{ color: colors.textMuted }}>
                  Files
                </Typography>
              </Box>
              <Box sx={{ p: 1.5, borderRadius: 1, backgroundColor: colors.navy, textAlign: 'center' }}>
                <Typography variant="h5" sx={{ fontWeight: 700, color: colors.blue }}>
                  {stats?.symbolCount ?? 0}
                </Typography>
                <Typography variant="caption" sx={{ color: colors.textMuted }}>
                  Symbols
                </Typography>
              </Box>
              <Box sx={{ p: 1.5, borderRadius: 1, backgroundColor: colors.navy, textAlign: 'center' }}>
                <Typography variant="h5" sx={{ fontWeight: 700, color: colors.purple }}>
                  {stats?.relationshipCount ?? graphEdges.length}
                </Typography>
                <Typography variant="caption" sx={{ color: colors.textMuted }}>
                  Relationships
                </Typography>
              </Box>
              <Box sx={{ p: 1.5, borderRadius: 1, backgroundColor: colors.navy, textAlign: 'center' }}>
                <Typography variant="h5" sx={{ fontWeight: 700, color: colors.green }}>
                  {stats?.syncStatus === 'synced' ? 'OK' : stats?.syncStatus || '-'}
                </Typography>
                <Typography variant="caption" sx={{ color: colors.textMuted }}>
                  Status
                </Typography>
              </Box>
            </Box>

            <Box sx={{ mt: 3 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={showLabels}
                    onChange={(e) => setShowLabels(e.target.checked)}
                    size="small"
                  />
                }
                label={<Typography variant="body2">Show Labels</Typography>}
              />
            </Box>
          </CardContent>
        </Card>
      </Box>

      {/* Filter Menu */}
      <Menu
        anchorEl={filterMenuAnchor}
        open={Boolean(filterMenuAnchor)}
        onClose={() => setFilterMenuAnchor(null)}
      >
        {Object.entries(nodeFilters).map(([type, enabled]) => (
          <MenuItem
            key={type}
            onClick={() => setNodeFilters((f) => ({ ...f, [type]: !enabled }))}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Circle sx={{ fontSize: 12, color: enabled ? nodeTypeColors[type] : colors.navyLighter }} />
              <Typography sx={{ textTransform: 'capitalize' }}>{type}</Typography>
            </Box>
          </MenuItem>
        ))}
      </Menu>

      {/* Repo Menu */}
      <Menu
        anchorEl={repoMenuAnchor}
        open={Boolean(repoMenuAnchor)}
        onClose={() => setRepoMenuAnchor(null)}
      >
        {reposLoading ? (
          <MenuItem disabled>
            <CircularProgress size={16} sx={{ mr: 1 }} /> Loading...
          </MenuItem>
        ) : reposData?.length === 0 ? (
          <MenuItem disabled>No repositories found</MenuItem>
        ) : (
          reposData?.map((repo) => {
            const owner = repo.organization?.slug || repo.owner?.username || 'unknown';
            const repoPath = `${owner}/${repo.slug}`;
            const isSelected = selectedRepo?.owner === owner && selectedRepo?.repo === repo.slug;
            return (
              <MenuItem
                key={repo.id}
                onClick={() => {
                  setSelectedRepo({ owner, repo: repo.slug });
                  setRepoMenuAnchor(null);
                }}
                selected={isSelected}
              >
                <Box>
                  <Typography variant="body2">{repoPath}</Typography>
                  <Typography variant="caption" sx={{ color: colors.textMuted }}>
                    {repo.graphSyncStatus}
                  </Typography>
                </Box>
              </MenuItem>
            );
          })
        )}
      </Menu>
    </Box>
  );
}
