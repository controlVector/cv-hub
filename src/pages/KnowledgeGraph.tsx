import { useState, useEffect, useRef } from 'react';
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

interface GraphNode {
  id: string;
  label: string;
  type: 'file' | 'function' | 'class' | 'module';
  x: number;
  y: number;
  complexity?: number;
  calls?: number;
}

interface GraphEdge {
  source: string;
  target: string;
  type: 'calls' | 'imports' | 'inherits';
}

// Mock graph data
const mockNodes: GraphNode[] = [
  { id: '1', label: 'auth/service.ts', type: 'file', x: 400, y: 200, complexity: 12, calls: 45 },
  { id: '2', label: 'authenticateUser', type: 'function', x: 300, y: 350, complexity: 8, calls: 23 },
  { id: '3', label: 'validateToken', type: 'function', x: 500, y: 350, complexity: 5, calls: 67 },
  { id: '4', label: 'UserService', type: 'class', x: 200, y: 200, complexity: 18, calls: 34 },
  { id: '5', label: 'TokenManager', type: 'class', x: 600, y: 200, complexity: 15, calls: 89 },
  { id: '6', label: 'routes/auth.ts', type: 'file', x: 400, y: 50, complexity: 6, calls: 12 },
  { id: '7', label: 'loginHandler', type: 'function', x: 150, y: 350, complexity: 4, calls: 15 },
  { id: '8', label: 'refreshHandler', type: 'function', x: 650, y: 350, complexity: 3, calls: 28 },
  { id: '9', label: 'middleware/auth.ts', type: 'file', x: 400, y: 500, complexity: 7, calls: 156 },
  { id: '10', label: 'crypto/hash.ts', type: 'module', x: 100, y: 500, complexity: 4, calls: 45 },
];

const mockEdges: GraphEdge[] = [
  { source: '6', target: '1', type: 'imports' },
  { source: '1', target: '2', type: 'calls' },
  { source: '1', target: '3', type: 'calls' },
  { source: '2', target: '4', type: 'calls' },
  { source: '3', target: '5', type: 'calls' },
  { source: '6', target: '7', type: 'calls' },
  { source: '6', target: '8', type: 'calls' },
  { source: '7', target: '2', type: 'calls' },
  { source: '8', target: '3', type: 'calls' },
  { source: '9', target: '3', type: 'imports' },
  { source: '2', target: '10', type: 'calls' },
];

const nodeTypeColors: Record<string, string> = {
  file: colors.blue,
  function: colors.orange,
  class: colors.purple,
  module: colors.green,
};

const edgeTypeColors: Record<string, string> = {
  calls: colors.orange,
  imports: colors.blue,
  inherits: colors.purple,
};

export default function KnowledgeGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [zoom, setZoom] = useState(1);
  const [showLabels, setShowLabels] = useState(true);
  const [filterMenuAnchor, setFilterMenuAnchor] = useState<null | HTMLElement>(null);
  const [selectedRepo, setSelectedRepo] = useState('team/cv-git');
  const [repoMenuAnchor, setRepoMenuAnchor] = useState<null | HTMLElement>(null);
  const [nodeFilters, setNodeFilters] = useState({
    file: true,
    function: true,
    class: true,
    module: true,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = colors.navy;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Apply zoom
    ctx.save();
    ctx.scale(zoom, zoom);

    // Draw edges
    mockEdges.forEach((edge) => {
      const source = mockNodes.find((n) => n.id === edge.source);
      const target = mockNodes.find((n) => n.id === edge.target);
      if (!source || !target) return;

      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.strokeStyle = edgeTypeColors[edge.type] + '60';
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
      ctx.fillStyle = edgeTypeColors[edge.type];
      ctx.fill();
    });

    // Draw nodes
    mockNodes.forEach((node) => {
      if (!nodeFilters[node.type]) return;

      const radius = 20 + (node.calls || 0) / 10;
      const isSelected = selectedNode?.id === node.id;

      // Glow effect for selected node
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 10, 0, Math.PI * 2);
        ctx.fillStyle = nodeTypeColors[node.type] + '30';
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = nodeTypeColors[node.type];
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
  }, [zoom, showLabels, selectedNode, nodeFilters]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;

    const clickedNode = mockNodes.find((node) => {
      const radius = 20 + (node.calls || 0) / 10;
      const distance = Math.sqrt((x - node.x) ** 2 + (y - node.y) ** 2);
      return distance <= radius;
    });

    setSelectedNode(clickedNode || null);
  };

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
            <Typography variant="body2">{selectedRepo}</Typography>
            <KeyboardArrowDown sx={{ fontSize: 18, color: colors.textMuted }} />
          </Box>
          <Button variant="outlined" startIcon={<Refresh />}>
            Sync Graph
          </Button>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', gap: 3, flex: 1 }}>
        {/* Graph Canvas */}
        <Card sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
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

                <Typography variant="subtitle2" sx={{ color: colors.textMuted, mb: 1 }}>
                  Metrics
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 3 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">Complexity</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {selectedNode.complexity}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">Call Count</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {selectedNode.calls}
                    </Typography>
                  </Box>
                </Box>

                <Typography variant="subtitle2" sx={{ color: colors.textMuted, mb: 1 }}>
                  Connections
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 3 }}>
                  {mockEdges
                    .filter((e) => e.source === selectedNode.id || e.target === selectedNode.id)
                    .slice(0, 5)
                    .map((edge, i) => {
                      const isSource = edge.source === selectedNode.id;
                      const otherNode = mockNodes.find(
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
                            {isSource ? '→' : '←'}
                          </Typography>
                          <Typography variant="body2">{otherNode?.label}</Typography>
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
                  {mockNodes.length}
                </Typography>
                <Typography variant="caption" sx={{ color: colors.textMuted }}>
                  Nodes
                </Typography>
              </Box>
              <Box sx={{ p: 1.5, borderRadius: 1, backgroundColor: colors.navy, textAlign: 'center' }}>
                <Typography variant="h5" sx={{ fontWeight: 700, color: colors.blue }}>
                  {mockEdges.length}
                </Typography>
                <Typography variant="caption" sx={{ color: colors.textMuted }}>
                  Edges
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
        {['team/cv-git', 'team/api-service', 'team/web-frontend'].map((repo) => (
          <MenuItem
            key={repo}
            onClick={() => {
              setSelectedRepo(repo);
              setRepoMenuAnchor(null);
            }}
            selected={repo === selectedRepo}
          >
            {repo}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
