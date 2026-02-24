/**
 * GraphCanvas Component
 * Reusable D3 force-directed graph renderer for architecture visualization
 */

import { useEffect, useRef, useMemo, useState } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import * as d3 from 'd3';
import { colors } from '../../theme';
import type { VizData, VizNode, VizEdge } from '../../services/repository';

// Color schemes
const NODE_COLORS: Record<string, string> = {
  file: '#3b82f6',
  symbol: '#10b981',
  module: '#f59e0b',
  commit: '#8b5cf6',
};

const EDGE_COLORS: Record<string, string> = {
  IMPORTS: '#64748b',
  CALLS: '#3b82f6',
  INHERITS: '#f59e0b',
  DEFINES: '#10b981',
  CONTAINS: '#6366f1',
  MODIFIES: '#f43f5e',
  TOUCHES: '#f97316',
};

// Heatmap color interpolation
function getHeatmapColor(t: number): string {
  // blue (cold/stable) → red (hot/active), t in [0,1]
  const r = Math.round(59 + t * (244 - 59));
  const g = Math.round(130 + t * (63 - 130));
  const b = Math.round(246 + t * (94 - 246));
  return `rgb(${r}, ${g}, ${b})`;
}

export type LayoutMode = 'force' | 'hierarchical' | 'treemap' | 'packed';
export type ColorMode = 'default' | 'recency' | 'frequency' | 'churn';

interface GraphCanvasProps {
  data: VizData | null;
  layout?: LayoutMode;
  colorMode?: ColorMode;
  isLoading?: boolean;
  onNodeSelect?: (node: VizNode | null) => void;
  selectedNodeId?: string | null;
  width?: number;
  height?: number;
}

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: VizNode['type'];
  data: VizNode;
  radius: number;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  edgeType: VizEdge['type'];
}

// Pre-compute node colors for all nodes (avoids O(N²) per-node min/max)
function computeNodeColors(
  nodes: VizNode[],
  colorMode: ColorMode,
): Map<string, string> {
  const colorMap = new Map<string, string>();

  if (colorMode === 'default') {
    for (const n of nodes) {
      colorMap.set(n.id, NODE_COLORS[n.type] || '#64748b');
    }
    return colorMap;
  }

  // Heatmap mode — pre-compute min/max once
  const valueKey = colorMode === 'recency' ? 'lastModifiedTimestamp' : 'modificationCount';
  const fileNodes = nodes.filter(n => n.type === 'file' && n[valueKey] != null);
  let min = Infinity;
  let max = -Infinity;
  for (const n of fileNodes) {
    const v = n[valueKey]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  for (const n of nodes) {
    if (n.type === 'file' && n[valueKey] != null && max > min) {
      const t = (n[valueKey]! - min) / (max - min);
      colorMap.set(n.id, getHeatmapColor(t));
    } else {
      colorMap.set(n.id, NODE_COLORS[n.type] || '#64748b');
    }
  }

  return colorMap;
}

export function GraphCanvas({
  data,
  layout: _layout = 'force',
  colorMode = 'default',
  isLoading = false,
  onNodeSelect,
  selectedNodeId,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const onNodeSelectRef = useRef(onNodeSelect);
  onNodeSelectRef.current = onNodeSelect;
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Pre-compute colors (avoids O(N²))
  const nodeColors = useMemo(
    () => computeNodeColors(data?.nodes || [], colorMode),
    [data, colorMode],
  );

  // Handle container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setDimensions({ width, height });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Main simulation setup — runs when data/dimensions/colorMode change (NOT on selection change)
  useEffect(() => {
    if (!data || !svgRef.current || data.nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width, height } = dimensions;

    // Build node/link data
    const nodeMap = new Map<string, SimNode>();
    const simNodes: SimNode[] = data.nodes.map((n) => {
      const radius = Math.max(5, Math.min(20,
        n.type === 'module' ? 12 :
        n.complexity ? 5 + Math.sqrt(n.complexity) * 2 :
        n.linesOfCode ? 5 + Math.sqrt(n.linesOfCode / 100) * 2 :
        8
      ));
      const simNode: SimNode = {
        id: n.id,
        label: n.label,
        type: n.type,
        data: n,
        radius,
        x: width / 2 + (Math.random() - 0.5) * width * 0.5,
        y: height / 2 + (Math.random() - 0.5) * height * 0.5,
      };
      nodeMap.set(n.id, simNode);
      return simNode;
    });

    const simLinks: SimLink[] = data.edges
      .filter(e => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map((e) => ({
        source: nodeMap.get(e.source)!,
        target: nodeMap.get(e.target)!,
        edgeType: e.type,
      }));

    // Create zoom behavior
    const g = svg.append('g');
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });
    svg.call(zoom);

    // Draw edges
    const linkGroup = g.append('g').attr('class', 'links');
    const links = linkGroup
      .selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', (d) => EDGE_COLORS[d.edgeType] || '#475569')
      .attr('stroke-opacity', 0.4)
      .attr('stroke-width', 1);

    // Draw nodes
    const nodeGroup = g.append('g').attr('class', 'nodes');
    const nodes = nodeGroup
      .selectAll<SVGGElement, SimNode>('g')
      .data(simNodes, (d) => d.id)
      .join('g')
      .attr('cursor', 'pointer')
      .on('click', (_event, d) => {
        onNodeSelectRef.current?.(d.data);
      });

    // Node shapes
    nodes.each(function (d) {
      const el = d3.select(this);
      const color = nodeColors.get(d.data.id) || NODE_COLORS[d.type] || '#64748b';

      if (d.data.type === 'module' || d.data.kind === 'class') {
        el.append('rect')
          .attr('class', 'node-shape')
          .attr('width', d.radius * 2)
          .attr('height', d.radius * 2)
          .attr('x', -d.radius)
          .attr('y', -d.radius)
          .attr('rx', 3)
          .attr('fill', color)
          .attr('stroke', 'none')
          .attr('stroke-width', 0)
          .attr('opacity', 0.85);
      } else {
        el.append('circle')
          .attr('class', 'node-shape')
          .attr('r', d.radius)
          .attr('fill', color)
          .attr('stroke', 'none')
          .attr('stroke-width', 0)
          .attr('opacity', 0.85);
      }

      // Label
      el.append('text')
        .text(d.label.length > 20 ? d.label.slice(0, 18) + '..' : d.label)
        .attr('text-anchor', 'middle')
        .attr('dy', d.radius + 14)
        .attr('fill', 'rgba(248, 250, 252, 0.8)')
        .attr('font-size', '10px')
        .attr('pointer-events', 'none');
    });

    // Drag behavior
    const simulation = d3.forceSimulation<SimNode>(simNodes)
      .force('link', d3.forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance(80))
      .force('charge', d3.forceManyBody().strength(-150))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<SimNode>().radius((d) => d.radius + 4))
      .on('tick', () => {
        links
          .attr('x1', (d: any) => d.source.x)
          .attr('y1', (d: any) => d.source.y)
          .attr('x2', (d: any) => d.target.x)
          .attr('y2', (d: any) => d.target.y);

        nodes.attr('transform', (d) => `translate(${d.x}, ${d.y})`);
      });

    const drag = d3.drag<SVGGElement, SimNode>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
    nodes.call(drag);

    simulationRef.current = simulation;

    // Auto-fit after settling
    const autoFitTimer = setTimeout(() => {
      const bounds = g.node()?.getBBox();
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        const padding = 40;
        const scale = Math.min(
          (width - padding * 2) / bounds.width,
          (height - padding * 2) / bounds.height,
          1.5
        );
        const tx = width / 2 - (bounds.x + bounds.width / 2) * scale;
        const ty = height / 2 - (bounds.y + bounds.height / 2) * scale;
        svg.transition().duration(500).call(
          zoom.transform,
          d3.zoomIdentity.translate(tx, ty).scale(scale)
        );
      }
    }, 2000);

    return () => {
      clearTimeout(autoFitTimer);
      simulation.stop();
    };
  }, [data, dimensions, nodeColors]);

  // Selection highlighting — updates SVG in place without rebuilding the simulation
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll<SVGGElement, SimNode>('g.nodes g').each(function (d) {
      const shape = d3.select(this).select('.node-shape');
      const isSelected = selectedNodeId === d.id;
      shape
        .attr('stroke', isSelected ? '#fff' : 'none')
        .attr('stroke-width', isSelected ? 2 : 0);
    });
  }, [selectedNodeId]);

  // Empty state
  if (!isLoading && (!data || data.nodes.length === 0)) {
    return (
      <Box
        ref={containerRef}
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.navy,
          borderRadius: 2,
          border: `1px solid ${colors.navyLighter}`,
          minHeight: 400,
        }}
      >
        <Typography variant="body1" sx={{ color: colors.textMuted }}>
          No graph data available. Trigger a graph sync to populate.
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      ref={containerRef}
      sx={{
        flex: 1,
        position: 'relative',
        backgroundColor: colors.navy,
        borderRadius: 2,
        border: `1px solid ${colors.navyLighter}`,
        overflow: 'hidden',
        minHeight: 400,
      }}
    >
      {isLoading && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            backgroundColor: 'rgba(0,0,0,0.3)',
          }}
        >
          <CircularProgress size={40} />
        </Box>
      )}
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        style={{ display: 'block' }}
      />
      {/* Legend */}
      {data && data.nodes.length > 0 && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            display: 'flex',
            gap: 1.5,
            p: 1,
            borderRadius: 1,
            backgroundColor: 'rgba(0,0,0,0.5)',
          }}
        >
          {Object.entries(NODE_COLORS)
            .filter(([type]) => data.nodes.some(n => n.type === type))
            .map(([type, color]) => (
            <Box key={type} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color }} />
              <Typography variant="caption" sx={{ color: colors.textMuted, fontSize: '0.65rem' }}>
                {type}
              </Typography>
            </Box>
          ))}
          {data.meta.truncated && (
            <Typography variant="caption" sx={{ color: colors.amber, fontSize: '0.65rem', ml: 1 }}>
              (truncated)
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

export default GraphCanvas;
