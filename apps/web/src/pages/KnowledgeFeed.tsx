/**
 * Knowledge Feed
 * Infinite-scroll feed of all SessionKnowledge nodes with filtering
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Box,
  Typography,
  Chip,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  CircularProgress,
  Alert,
  InputAdornment,
} from '@mui/material';
import { Psychology, FilterList, Search } from '@mui/icons-material';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { colors } from '../theme';
import { getKnowledgeFeed } from '../services/context-engine';

const PAGE_SIZE = 20;

function formatTimestamp(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function KnowledgeFeed() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const [concern, setConcern] = useState('');
  const [fileFilter, setFileFilter] = useState('');
  const sentinelRef = useRef<HTMLDivElement>(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useInfiniteQuery({
    queryKey: ['ceKnowledge', owner, repo, concern, fileFilter],
    queryFn: ({ pageParam = 0 }) =>
      getKnowledgeFeed(owner!, repo!, {
        concern: concern || undefined,
        file: fileFilter || undefined,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.pagination.hasMore) return undefined;
      return allPages.length * PAGE_SIZE;
    },
    enabled: !!owner && !!repo,
    staleTime: 30000,
  });

  // IntersectionObserver for infinite scroll
  const observerCallback = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage],
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(observerCallback, { threshold: 0.1 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [observerCallback]);

  const allItems = data?.pages.flatMap((p) => p.knowledge) ?? [];

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Psychology sx={{ fontSize: 24, color: colors.cyan }} />
        <Typography variant="h5" sx={{ fontWeight: 600 }}>Knowledge Feed</Typography>
      </Box>

      {/* Filter Bar */}
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <FilterList sx={{ fontSize: 18, color: colors.textMuted }} />
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel sx={{ fontSize: '0.75rem' }}>Concern</InputLabel>
          <Select
            value={concern}
            label="Concern"
            onChange={(e) => setConcern(e.target.value)}
            sx={{ fontSize: '0.8rem', height: 36 }}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="codebase">Codebase</MenuItem>
            <MenuItem value="deployment">Deployment</MenuItem>
            <MenuItem value="compilation">Compilation</MenuItem>
            <MenuItem value="business">Business</MenuItem>
          </Select>
        </FormControl>
        <TextField
          size="small"
          placeholder="Filter by file..."
          value={fileFilter}
          onChange={(e) => setFileFilter(e.target.value)}
          sx={{ width: 250, '& input': { fontSize: '0.8rem', py: 0.75 } }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search sx={{ fontSize: 16 }} />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      {/* Error */}
      {isError && (
        <Alert severity="error">Failed to load knowledge feed.</Alert>
      )}

      {/* Loading */}
      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={32} />
        </Box>
      )}

      {/* Empty */}
      {!isLoading && allItems.length === 0 && (
        <Alert severity="info">
          No knowledge nodes found. Knowledge is created when Claude Code sessions use the egress hook.
        </Alert>
      )}

      {/* Feed */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {allItems.map((node, idx) => (
          <Box
            key={`${node.sessionId}-${node.turnNumber}-${idx}`}
            sx={{
              p: 2,
              borderRadius: 1.5,
              backgroundColor: colors.navyLight,
              border: `1px solid ${colors.navyLighter}`,
            }}
          >
            {/* Card header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
              <Chip
                label={`Turn ${node.turnNumber}`}
                size="small"
                sx={{ fontSize: '0.7rem', height: 20, fontWeight: 600 }}
              />
              <Chip
                label={node.sessionId.length > 16 ? `${node.sessionId.slice(0, 16)}...` : node.sessionId}
                size="small"
                variant="outlined"
                sx={{ fontSize: '0.65rem', height: 18, fontFamily: 'monospace' }}
              />
              {node.concern && (
                <Chip
                  label={node.concern}
                  size="small"
                  sx={{
                    fontSize: '0.6rem', height: 18,
                    backgroundColor: 'rgba(6, 182, 212, 0.15)',
                    color: colors.cyan,
                  }}
                />
              )}
              <Typography variant="caption" sx={{ color: colors.textMuted, ml: 'auto' }}>
                {formatTimestamp(node.timestamp)}
              </Typography>
            </Box>

            {/* Summary */}
            {node.summary && (
              <Typography variant="body2" sx={{ fontSize: '0.85rem', lineHeight: 1.6, mb: 1 }}>
                {node.summary}
              </Typography>
            )}

            {/* Files */}
            {node.filesTouched.length > 0 && (
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.5 }}>
                {node.filesTouched.map((f) => (
                  <Chip
                    key={f}
                    label={f}
                    size="small"
                    sx={{
                      fontSize: '0.6rem', height: 18, fontFamily: 'monospace',
                      backgroundColor: 'rgba(59, 130, 246, 0.15)',
                      color: colors.blue,
                    }}
                  />
                ))}
              </Box>
            )}

            {/* Symbols */}
            {node.symbolsReferenced.length > 0 && (
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {node.symbolsReferenced.map((s) => (
                  <Chip
                    key={s}
                    label={s}
                    size="small"
                    sx={{
                      fontSize: '0.6rem', height: 18, fontFamily: 'monospace',
                      backgroundColor: 'rgba(16, 185, 129, 0.15)',
                      color: colors.green,
                    }}
                  />
                ))}
              </Box>
            )}
          </Box>
        ))}
      </Box>

      {/* Sentinel for infinite scroll */}
      <Box ref={sentinelRef} sx={{ height: 1 }} />
      {isFetchingNextPage && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      )}
    </Box>
  );
}
