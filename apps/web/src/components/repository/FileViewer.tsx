/**
 * FileViewer Component
 * Syntax-highlighted code display with file info and graph sidebar
 */

import { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Tooltip,
  Skeleton,
  Chip,
  Alert,
} from '@mui/material';
import {
  History,
  ContentCopy,
  Download,
  AutoAwesome as AIIcon,
  BarChart,
} from '@mui/icons-material';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { colors } from '../../theme';
import BreadcrumbPath from './BreadcrumbPath';
import type { BlobResponse, GraphStats } from '../../services/repository';

// Map file extension to Prism language
function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();

  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    json: 'json',
    md: 'markdown',
    mdx: 'markdown',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    html: 'html',
    xml: 'xml',
    py: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    sql: 'sql',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    dockerfile: 'docker',
    makefile: 'makefile',
    graphql: 'graphql',
    vue: 'vue',
    svelte: 'svelte',
  };

  // Handle special filenames
  const lowerFilename = filename.toLowerCase();
  if (lowerFilename === 'dockerfile' || lowerFilename.startsWith('dockerfile.')) {
    return 'docker';
  }
  if (lowerFilename === 'makefile') {
    return 'makefile';
  }

  return languageMap[ext || ''] || 'text';
}

// Format file size
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FileViewerProps {
  repoName: string;
  file: BlobResponse | null;
  isLoading: boolean;
  graphStats?: GraphStats | null;
  onNavigate: (path: string) => void;
  onViewHistory?: () => void;
  onAIExplain?: () => void;
}

export function FileViewer({
  repoName,
  file,
  isLoading,
  graphStats,
  onNavigate,
  onViewHistory,
  onAIExplain,
}: FileViewerProps) {
  const [showGraphSidebar, setShowGraphSidebar] = useState(false);

  const handleCopyContent = () => {
    if (file?.content) {
      navigator.clipboard.writeText(file.content);
    }
  };

  const handleDownload = () => {
    if (file?.content) {
      const blob = new Blob([file.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.path.split('/').pop() || 'file';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const language = useMemo(() => {
    if (!file) return 'text';
    return getLanguage(file.path.split('/').pop() || '');
  }, [file?.path]);

  const lineCount = useMemo(() => {
    if (!file?.content) return 0;
    return file.content.split('\n').length;
  }, [file?.content]);

  // Loading state
  if (isLoading) {
    return (
      <Box
        sx={{
          flex: 1,
          backgroundColor: colors.navyLight,
          borderRadius: 2,
          border: `1px solid ${colors.navyLighter}`,
          overflow: 'hidden',
        }}
      >
        <Box sx={{ p: 2, borderBottom: `1px solid ${colors.navyLighter}` }}>
          <Skeleton variant="text" width={250} height={24} />
        </Box>
        <Box sx={{ p: 2 }}>
          {Array.from({ length: 15 }).map((_, i) => (
            <Skeleton
              key={i}
              variant="text"
              width={`${60 + Math.random() * 40}%`}
              height={20}
              sx={{ my: 0.5 }}
            />
          ))}
        </Box>
      </Box>
    );
  }

  // No file selected
  if (!file) {
    return (
      <Box
        sx={{
          flex: 1,
          backgroundColor: colors.navyLight,
          borderRadius: 2,
          border: `1px solid ${colors.navyLighter}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 400,
        }}
      >
        <Typography variant="body1" sx={{ color: colors.textMuted }}>
          Select a file to view its contents
        </Typography>
      </Box>
    );
  }

  // Binary file
  if (file.isBinary) {
    return (
      <Box
        sx={{
          flex: 1,
          backgroundColor: colors.navyLight,
          borderRadius: 2,
          border: `1px solid ${colors.navyLighter}`,
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            p: 2,
            borderBottom: `1px solid ${colors.navyLighter}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <BreadcrumbPath repoName={repoName} path={file.path} onNavigate={onNavigate} />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Tooltip title="Download">
              <IconButton size="small" onClick={handleDownload}>
                <Download sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        <Box
          sx={{
            p: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 300,
          }}
        >
          <Typography variant="body1" sx={{ color: colors.textMuted, mb: 1 }}>
            Binary file
          </Typography>
          <Typography variant="body2" sx={{ color: colors.textMuted }}>
            {formatFileSize(file.size)}
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flex: 1, gap: 2 }}>
      {/* Main file viewer */}
      <Box
        sx={{
          flex: 1,
          backgroundColor: colors.navyLight,
          borderRadius: 2,
          border: `1px solid ${colors.navyLighter}`,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* File Header */}
        <Box
          sx={{
            p: 2,
            borderBottom: `1px solid ${colors.navyLighter}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <BreadcrumbPath repoName={repoName} path={file.path} onNavigate={onNavigate} />

          <Box sx={{ display: 'flex', gap: 1 }}>
            <Tooltip title="Copy content">
              <IconButton size="small" onClick={handleCopyContent}>
                <ContentCopy sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Download">
              <IconButton size="small" onClick={handleDownload}>
                <Download sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            {onViewHistory && (
              <Tooltip title="View history">
                <IconButton size="small" onClick={onViewHistory}>
                  <History sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Show graph info">
              <IconButton
                size="small"
                onClick={() => setShowGraphSidebar(!showGraphSidebar)}
                sx={{ color: showGraphSidebar ? colors.orange : undefined }}
              >
                <BarChart sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            {onAIExplain && (
              <Tooltip title="AI Explain this file">
                <IconButton size="small" onClick={onAIExplain} sx={{ color: colors.orange }}>
                  <AIIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>

        {/* Code Content */}
        <Box
          sx={{
            flex: 1,
            overflow: 'auto',
            '& pre': {
              margin: '0 !important',
              fontSize: '0.85rem !important',
              lineHeight: '1.6 !important',
            },
          }}
        >
          <SyntaxHighlighter
            language={language}
            style={oneDark}
            showLineNumbers
            customStyle={{
              background: colors.navy,
              padding: '16px',
              minHeight: '100%',
            }}
            lineNumberStyle={{
              color: colors.textMuted,
              minWidth: '3em',
              paddingRight: '1em',
            }}
          >
            {file.content || ''}
          </SyntaxHighlighter>
        </Box>

        {/* File Stats */}
        <Box
          sx={{
            p: 2,
            borderTop: `1px solid ${colors.navyLighter}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Box sx={{ display: 'flex', gap: 3 }}>
            <Typography variant="caption" sx={{ color: colors.textMuted }}>
              {lineCount} lines
            </Typography>
            <Typography variant="caption" sx={{ color: colors.textMuted }}>
              {formatFileSize(file.size)}
            </Typography>
            <Typography variant="caption" sx={{ color: colors.textMuted }}>
              {language.charAt(0).toUpperCase() + language.slice(1)}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Graph Sidebar */}
      {showGraphSidebar && (
        <Box
          sx={{
            width: 280,
            flexShrink: 0,
            backgroundColor: colors.navyLight,
            borderRadius: 2,
            border: `1px solid ${colors.navyLighter}`,
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              p: 2,
              borderBottom: `1px solid ${colors.navyLighter}`,
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Graph Info
            </Typography>
          </Box>

          <Box sx={{ p: 2 }}>
            {graphStats ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box>
                  <Typography variant="caption" sx={{ color: colors.textMuted }}>
                    Repository Stats
                  </Typography>
                  <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    <Chip
                      label={`${graphStats.fileCount} files`}
                      size="small"
                      sx={{ fontSize: '0.75rem' }}
                    />
                    <Chip
                      label={`${graphStats.symbolCount} symbols`}
                      size="small"
                      sx={{ fontSize: '0.75rem' }}
                    />
                    <Chip
                      label={`${graphStats.functionCount} functions`}
                      size="small"
                      sx={{ fontSize: '0.75rem' }}
                    />
                    <Chip
                      label={`${graphStats.classCount} classes`}
                      size="small"
                      sx={{ fontSize: '0.75rem' }}
                    />
                  </Box>
                </Box>

                <Box>
                  <Typography variant="caption" sx={{ color: colors.textMuted }}>
                    Sync Status
                  </Typography>
                  <Box sx={{ mt: 1 }}>
                    <Chip
                      label={graphStats.syncStatus}
                      size="small"
                      color={graphStats.syncStatus === 'synced' ? 'success' : 'warning'}
                      sx={{ fontSize: '0.75rem' }}
                    />
                  </Box>
                </Box>

                {graphStats.lastSyncedAt && (
                  <Box>
                    <Typography variant="caption" sx={{ color: colors.textMuted }}>
                      Last Synced
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 0.5 }}>
                      {new Date(graphStats.lastSyncedAt).toLocaleDateString()}
                    </Typography>
                  </Box>
                )}

                {graphStats.syncError && (
                  <Alert severity="warning" sx={{ fontSize: '0.8rem', py: 0.5 }}>
                    {graphStats.syncError}
                  </Alert>
                )}
              </Box>
            ) : (
              <Typography variant="body2" sx={{ color: colors.textMuted }}>
                Graph data not available
              </Typography>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}

export default FileViewer;
