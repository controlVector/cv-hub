/**
 * LogViewer Component
 * Displays pipeline job logs with ANSI color support and line numbers
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import {
  Box,
  Typography,
  IconButton,
  TextField,
  InputAdornment,
  Tooltip,
  CircularProgress,
  alpha,
} from '@mui/material';
import {
  Search,
  ArrowDownward,
  ContentCopy,
  Download,
  CheckCircle,
} from '@mui/icons-material';
import AnsiToHtml from 'ansi-to-html';
import { colors } from '../../theme';

interface LogViewerProps {
  logs: string | null;
  isLoading?: boolean;
  autoScroll?: boolean;
  maxHeight?: number | string;
  onLoadMore?: () => void;
}

// ANSI to HTML converter with dark theme colors
const ansiConverter = new AnsiToHtml({
  fg: '#f8fafc',
  bg: 'transparent',
  newline: true,
  escapeXML: true,
  colors: {
    0: '#1e293b',   // black -> slate
    1: '#f43f5e',   // red -> rose
    2: '#10b981',   // green
    3: '#f59e0b',   // yellow -> amber
    4: '#3b82f6',   // blue
    5: '#a855f7',   // magenta -> purple
    6: '#06b6d4',   // cyan
    7: '#f8fafc',   // white
    8: '#475569',   // bright black -> slate-500
    9: '#fb7185',   // bright red -> rose-400
    10: '#34d399',  // bright green -> emerald-400
    11: '#fbbf24',  // bright yellow -> amber-400
    12: '#60a5fa',  // bright blue -> blue-400
    13: '#c084fc',  // bright magenta -> purple-400
    14: '#22d3ee',  // bright cyan -> cyan-400
    15: '#ffffff',  // bright white
  },
});

export function LogViewer({
  logs,
  isLoading = false,
  autoScroll = true,
  maxHeight = 500,
  onLoadMore: _onLoadMore,
}: LogViewerProps) {
  void _onLoadMore; // Reserved for future infinite scroll
  const containerRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Parse logs into lines with HTML
  const logLines = useMemo(() => {
    if (!logs) return [];
    return logs.split('\n').map((line, index) => ({
      number: index + 1,
      html: ansiConverter.toHtml(line),
      text: line,
    }));
  }, [logs]);

  // Filter logs based on search
  const filteredLines = useMemo(() => {
    if (!searchQuery) return logLines;
    const query = searchQuery.toLowerCase();
    return logLines.filter((line) => line.text.toLowerCase().includes(query));
  }, [logLines, searchQuery]);

  // Handle scroll to bottom
  useEffect(() => {
    if (autoScroll && isAtBottom && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll, isAtBottom]);

  // Track scroll position
  const handleScroll = () => {
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      const atBottom = scrollHeight - scrollTop - clientHeight < 50;
      setIsAtBottom(atBottom);
    }
  };

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  };

  const handleCopy = async () => {
    if (logs) {
      await navigator.clipboard.writeText(logs);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (logs) {
      const blob = new Blob([logs], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pipeline-logs.txt';
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  // Empty state
  if (!logs && !isLoading) {
    return (
      <Box
        sx={{
          p: 4,
          textAlign: 'center',
          backgroundColor: '#0f172a',
          borderRadius: 1,
          border: `1px solid ${colors.slateLighter}`,
        }}
      >
        <Typography variant="body2" sx={{ color: colors.textMuted }}>
          No logs available
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        backgroundColor: '#0f172a',
        borderRadius: 1,
        border: `1px solid ${colors.slateLighter}`,
        overflow: 'hidden',
      }}
    >
      {/* Toolbar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          p: 1,
          borderBottom: `1px solid ${colors.slateLighter}`,
          backgroundColor: colors.slateLight,
        }}
      >
        <TextField
          size="small"
          placeholder="Search logs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search sx={{ fontSize: 18, color: colors.textMuted }} />
              </InputAdornment>
            ),
          }}
          sx={{
            width: 250,
            '& .MuiOutlinedInput-root': {
              height: 32,
              fontSize: '0.875rem',
            },
          }}
        />

        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {searchQuery && (
            <Typography variant="caption" sx={{ color: colors.textMuted, alignSelf: 'center', mr: 1 }}>
              {filteredLines.length} / {logLines.length} lines
            </Typography>
          )}
          <Tooltip title="Scroll to bottom">
            <IconButton size="small" onClick={scrollToBottom} disabled={isAtBottom}>
              <ArrowDownward sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={copied ? 'Copied!' : 'Copy logs'}>
            <IconButton size="small" onClick={handleCopy} disabled={!logs}>
              {copied ? (
                <CheckCircle sx={{ fontSize: 18, color: colors.green }} />
              ) : (
                <ContentCopy sx={{ fontSize: 18 }} />
              )}
            </IconButton>
          </Tooltip>
          <Tooltip title="Download logs">
            <IconButton size="small" onClick={handleDownload} disabled={!logs}>
              <Download sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Log Content */}
      <Box
        ref={containerRef}
        onScroll={handleScroll}
        sx={{
          maxHeight,
          overflow: 'auto',
          fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Consolas, monospace',
          fontSize: '0.8125rem',
          lineHeight: 1.6,
          '&::-webkit-scrollbar': {
            width: 8,
            height: 8,
          },
          '&::-webkit-scrollbar-track': {
            backgroundColor: '#0f172a',
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: colors.slateLighter,
            borderRadius: 4,
          },
        }}
      >
        {isLoading ? (
          <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
            <Box component="tbody">
              {filteredLines.map((line) => (
                <Box
                  key={line.number}
                  component="tr"
                  sx={{
                    '&:hover': {
                      backgroundColor: alpha(colors.violet, 0.05),
                    },
                  }}
                >
                  {/* Line Number */}
                  <Box
                    component="td"
                    sx={{
                      width: 50,
                      minWidth: 50,
                      px: 1.5,
                      py: 0.25,
                      textAlign: 'right',
                      color: colors.textMuted,
                      userSelect: 'none',
                      borderRight: `1px solid ${colors.slateLighter}`,
                      backgroundColor: alpha(colors.slate, 0.5),
                    }}
                  >
                    {line.number}
                  </Box>
                  {/* Log Content */}
                  <Box
                    component="td"
                    sx={{
                      px: 2,
                      py: 0.25,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      '& span': {
                        display: 'inline',
                      },
                    }}
                    dangerouslySetInnerHTML={{ __html: line.html }}
                  />
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {/* Loading indicator for streaming logs */}
        {isLoading && logs && (
          <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={14} />
            <Typography variant="caption" sx={{ color: colors.textMuted }}>
              Loading more logs...
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default LogViewer;
