/**
 * NodeDetailPanel Component
 * Side panel showing details for a selected graph node
 */

import { useState } from 'react';
import {
  Box,
  Typography,
  Chip,
  IconButton,
  Tooltip,
  Collapse,
  CircularProgress,
} from '@mui/material';
import {
  Close,
  Code,
  CallMade,
  CallReceived,
  AutoAwesome as AIIcon,
  ExpandMore,
  ExpandLess,
  TrendingUp,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { colors } from '../../theme';
import type { VizNode, TimelineEntry } from '../../services/repository';
import { getSymbolUsage, getFileTimeline, getSymbolTimeline, getImpactAnalysis } from '../../services/repository';
import TimelineView from './TimelineView';
import ImpactAnalysis from './ImpactAnalysis';

interface NodeDetailPanelProps {
  node: VizNode | null;
  owner: string;
  repo: string;
  onClose: () => void;
  onNavigateToFile?: (path: string) => void;
}

export function NodeDetailPanel({
  node,
  owner,
  repo,
  onClose,
  onNavigateToFile,
}: NodeDetailPanelProps) {
  const [showTimeline, setShowTimeline] = useState(false);
  const [showImpact, setShowImpact] = useState(false);

  // Fetch symbol usage data if it's a symbol node
  const { data: usageData } = useQuery({
    queryKey: ['symbolUsage', owner, repo, node?.id],
    queryFn: () => getSymbolUsage(owner, repo, node!.id),
    enabled: !!node && node.type === 'symbol',
  });

  // Fetch timeline data
  const { data: timelineData, isLoading: isLoadingTimeline } = useQuery<{ timeline: TimelineEntry[]; count: number } | null>({
    queryKey: ['nodeTimeline', owner, repo, node?.id, node?.type],
    queryFn: async () => {
      if (!node) return null;
      if (node.type === 'file' && node.path) {
        const result = await getFileTimeline(owner, repo, node.path);
        return { timeline: result.timeline, count: result.count };
      }
      if (node.type === 'symbol') {
        const result = await getSymbolTimeline(owner, repo, node.id);
        return { timeline: result.timeline, count: result.count };
      }
      return null;
    },
    enabled: !!node && showTimeline,
  });

  // Fetch impact data
  const { data: impactData, isLoading: isLoadingImpact } = useQuery({
    queryKey: ['nodeImpact', owner, repo, node?.id],
    queryFn: () => getImpactAnalysis(owner, repo, node!.id),
    enabled: !!node && node.type === 'symbol' && showImpact,
  });

  if (!node) return null;

  const usage = usageData?.data;

  return (
    <Box
      sx={{
        width: 320,
        flexShrink: 0,
        backgroundColor: colors.navyLight,
        borderRadius: 2,
        border: `1px solid ${colors.navyLighter}`,
        overflow: 'auto',
        maxHeight: '100%',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          p: 2,
          borderBottom: `1px solid ${colors.navyLighter}`,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ flex: 1, mr: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: 'break-word' }}>
            {node.label}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
            <Chip
              label={node.type}
              size="small"
              sx={{ height: 18, fontSize: '0.65rem', backgroundColor: colors.navyLighter }}
            />
            {node.kind && (
              <Chip
                label={node.kind}
                size="small"
                sx={{ height: 18, fontSize: '0.65rem', backgroundColor: colors.navyLighter }}
              />
            )}
            {node.language && (
              <Chip
                label={node.language}
                size="small"
                sx={{ height: 18, fontSize: '0.65rem', backgroundColor: colors.navyLighter }}
              />
            )}
          </Box>
        </Box>
        <IconButton size="small" onClick={onClose}>
          <Close sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>

      {/* Details */}
      <Box sx={{ p: 2 }}>
        {/* File path */}
        {node.path && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" sx={{ color: colors.textMuted }}>
              Path
            </Typography>
            <Typography
              variant="body2"
              sx={{
                mt: 0.5,
                fontSize: '0.8rem',
                wordBreak: 'break-all',
                color: colors.orange,
                cursor: onNavigateToFile ? 'pointer' : 'default',
                '&:hover': onNavigateToFile ? { textDecoration: 'underline' } : {},
              }}
              onClick={() => node.path && onNavigateToFile?.(node.path)}
            >
              {node.path}
            </Typography>
          </Box>
        )}

        {/* Metrics */}
        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
          {node.complexity != null && node.complexity > 0 && (
            <Chip
              label={`Complexity: ${node.complexity}`}
              size="small"
              sx={{ fontSize: '0.7rem' }}
              color={node.complexity > 10 ? 'error' : node.complexity > 5 ? 'warning' : 'default'}
            />
          )}
          {node.linesOfCode != null && node.linesOfCode > 0 && (
            <Chip
              label={`${node.linesOfCode} LOC`}
              size="small"
              sx={{ fontSize: '0.7rem' }}
            />
          )}
          {node.modificationCount != null && node.modificationCount > 0 && (
            <Chip
              label={`${node.modificationCount} changes`}
              size="small"
              sx={{ fontSize: '0.7rem' }}
            />
          )}
        </Box>

        {/* Session Knowledge Details */}
        {node.type === 'session_knowledge' && (
          <Box sx={{ mb: 2 }}>
            {node.sessionId && (
              <Box sx={{ mb: 1 }}>
                <Typography variant="caption" sx={{ color: colors.textMuted }}>Session ID</Typography>
                <Typography variant="body2" sx={{ fontSize: '0.75rem', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {node.sessionId}
                </Typography>
              </Box>
            )}
            {node.turnNumber != null && (
              <Box sx={{ mb: 1 }}>
                <Typography variant="caption" sx={{ color: colors.textMuted }}>Turn Number</Typography>
                <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>{node.turnNumber}</Typography>
              </Box>
            )}
            {node.concern && (
              <Box sx={{ mb: 1 }}>
                <Typography variant="caption" sx={{ color: colors.textMuted }}>Concern</Typography>
                <Chip label={node.concern} size="small" sx={{ ml: 1, fontSize: '0.65rem', height: 18 }} />
              </Box>
            )}
          </Box>
        )}

        {/* AI Summary */}
        {node.summary && (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
              <AIIcon sx={{ fontSize: 14, color: colors.orange }} />
              <Typography variant="caption" sx={{ color: colors.textMuted, fontWeight: 600 }}>
                {node.type === 'session_knowledge' ? 'Knowledge Summary' : 'AI Summary'}
              </Typography>
            </Box>
            <Typography variant="body2" sx={{ fontSize: '0.8rem', lineHeight: 1.5 }}>
              {node.summary}
            </Typography>
          </Box>
        )}

        {/* Connections (for symbol nodes) */}
        {usage && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" sx={{ color: colors.textMuted, fontWeight: 600 }}>
              Connections
            </Typography>

            {usage.callerCount > 0 && (
              <Box sx={{ mt: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                  <CallReceived sx={{ fontSize: 14, color: '#3b82f6' }} />
                  <Typography variant="caption" sx={{ color: colors.textMuted }}>
                    Callers ({usage.callerCount})
                  </Typography>
                </Box>
                {usage.callers.slice(0, 5).map((caller: any) => (
                  <Typography
                    key={caller.qualifiedName}
                    variant="body2"
                    sx={{ fontSize: '0.75rem', pl: 2, color: 'rgba(248,250,252,0.8)' }}
                  >
                    {caller.name}
                  </Typography>
                ))}
                {usage.callerCount > 5 && (
                  <Typography variant="caption" sx={{ pl: 2, color: colors.textMuted }}>
                    +{usage.callerCount - 5} more
                  </Typography>
                )}
              </Box>
            )}

            {usage.calleeCount > 0 && (
              <Box sx={{ mt: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                  <CallMade sx={{ fontSize: 14, color: '#10b981' }} />
                  <Typography variant="caption" sx={{ color: colors.textMuted }}>
                    Callees ({usage.calleeCount})
                  </Typography>
                </Box>
                {usage.callees.slice(0, 5).map((callee: any) => (
                  <Typography
                    key={callee.qualifiedName}
                    variant="body2"
                    sx={{ fontSize: '0.75rem', pl: 2, color: 'rgba(248,250,252,0.8)' }}
                  >
                    {callee.name}
                  </Typography>
                ))}
                {usage.calleeCount > 5 && (
                  <Typography variant="caption" sx={{ pl: 2, color: colors.textMuted }}>
                    +{usage.calleeCount - 5} more
                  </Typography>
                )}
              </Box>
            )}
          </Box>
        )}

        {/* Timeline Section */}
        <Box sx={{ mb: 1 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              py: 0.5,
            }}
            onClick={() => setShowTimeline(!showTimeline)}
          >
            <Typography variant="caption" sx={{ color: colors.textMuted, fontWeight: 600 }}>
              Timeline
            </Typography>
            {showTimeline ? <ExpandLess sx={{ fontSize: 16 }} /> : <ExpandMore sx={{ fontSize: 16 }} />}
          </Box>
          <Collapse in={showTimeline}>
            {isLoadingTimeline ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={20} />
              </Box>
            ) : (
              <TimelineView
                entries={timelineData?.timeline || []}
              />
            )}
          </Collapse>
        </Box>

        {/* Impact Analysis (symbol nodes only) */}
        {node.type === 'symbol' && (
          <Box sx={{ mb: 1 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                py: 0.5,
              }}
              onClick={() => setShowImpact(!showImpact)}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <TrendingUp sx={{ fontSize: 14, color: colors.amber }} />
                <Typography variant="caption" sx={{ color: colors.textMuted, fontWeight: 600 }}>
                  Impact Analysis
                </Typography>
              </Box>
              {showImpact ? <ExpandLess sx={{ fontSize: 16 }} /> : <ExpandMore sx={{ fontSize: 16 }} />}
            </Box>
            <Collapse in={showImpact}>
              {isLoadingImpact ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                  <CircularProgress size={20} />
                </Box>
              ) : (
                <ImpactAnalysis data={impactData || null} />
              )}
            </Collapse>
          </Box>
        )}

        {/* Navigate to source */}
        {node.path && onNavigateToFile && (
          <Box sx={{ mt: 2 }}>
            <Tooltip title="View source code">
              <Chip
                icon={<Code sx={{ fontSize: 14 }} />}
                label="View Source"
                size="small"
                onClick={() => onNavigateToFile(node.path!)}
                sx={{
                  cursor: 'pointer',
                  '&:hover': { backgroundColor: colors.navyLighter },
                }}
              />
            </Tooltip>
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default NodeDetailPanel;
