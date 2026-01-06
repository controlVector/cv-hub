/**
 * DiffViewer Component
 * Displays file diffs with syntax highlighting and line-by-line changes
 */

import { useState } from 'react';
import {
  Box,
  Typography,
  Collapse,
  IconButton,
  Chip,
  Tooltip,
} from '@mui/material';
import {
  ExpandMore,
  ChevronRight,
  Add,
  Remove,
  InsertDriveFile,
  DriveFileMove,
  Delete,
  NoteAdd,
} from '@mui/icons-material';
import { colors } from '../../theme';
import type { DiffFile } from '../../services/repository';

// Parse diff patch into lines
interface DiffLine {
  type: 'context' | 'addition' | 'deletion' | 'header';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

function parsePatch(patch: string): DiffLine[] {
  if (!patch) return [];

  const lines = patch.split('\n');
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      // Hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      result.push({ type: 'header', content: line });
    } else if (line.startsWith('+')) {
      result.push({
        type: 'addition',
        content: line.slice(1),
        newLineNumber: newLine++,
      });
    } else if (line.startsWith('-')) {
      result.push({
        type: 'deletion',
        content: line.slice(1),
        oldLineNumber: oldLine++,
      });
    } else if (line.startsWith(' ') || line === '') {
      result.push({
        type: 'context',
        content: line.slice(1) || '',
        oldLineNumber: oldLine++,
        newLineNumber: newLine++,
      });
    }
  }

  return result;
}

// Get status icon
function getStatusIcon(status: DiffFile['status']) {
  switch (status) {
    case 'added':
      return <NoteAdd sx={{ fontSize: 16, color: colors.green }} />;
    case 'deleted':
      return <Delete sx={{ fontSize: 16, color: colors.coral }} />;
    case 'renamed':
      return <DriveFileMove sx={{ fontSize: 16, color: colors.blue }} />;
    default:
      return <InsertDriveFile sx={{ fontSize: 16, color: colors.orange }} />;
  }
}

interface DiffFileViewProps {
  file: DiffFile;
  defaultExpanded?: boolean;
}

function DiffFileView({ file, defaultExpanded = true }: DiffFileViewProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const lines = parsePatch(file.patch || '');

  return (
    <Box
      sx={{
        backgroundColor: colors.navyLight,
        borderRadius: 2,
        border: `1px solid ${colors.navyLighter}`,
        overflow: 'hidden',
        mb: 2,
      }}
    >
      {/* File header */}
      <Box
        onClick={() => setExpanded(!expanded)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          p: 1.5,
          cursor: 'pointer',
          backgroundColor: colors.navy,
          borderBottom: expanded ? `1px solid ${colors.navyLighter}` : 'none',
          '&:hover': {
            backgroundColor: `${colors.orange}08`,
          },
        }}
      >
        {/* Expand icon */}
        {expanded ? (
          <ExpandMore sx={{ fontSize: 20, color: colors.textMuted }} />
        ) : (
          <ChevronRight sx={{ fontSize: 20, color: colors.textMuted }} />
        )}

        {/* Status icon */}
        {getStatusIcon(file.status)}

        {/* File path */}
        <Typography
          variant="body2"
          sx={{
            fontFamily: 'monospace',
            color: colors.textLight,
            flex: 1,
          }}
        >
          {file.oldPath && file.oldPath !== file.path ? (
            <>
              <span style={{ color: colors.textMuted }}>{file.oldPath}</span>
              <span style={{ color: colors.textMuted }}> → </span>
              {file.path}
            </>
          ) : (
            file.path
          )}
        </Typography>

        {/* Stats */}
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {file.additions > 0 && (
            <Chip
              icon={<Add sx={{ fontSize: 14 }} />}
              label={file.additions}
              size="small"
              sx={{
                height: 22,
                fontSize: '0.75rem',
                backgroundColor: `${colors.green}20`,
                color: colors.green,
                '& .MuiChip-icon': { color: colors.green },
              }}
            />
          )}
          {file.deletions > 0 && (
            <Chip
              icon={<Remove sx={{ fontSize: 14 }} />}
              label={file.deletions}
              size="small"
              sx={{
                height: 22,
                fontSize: '0.75rem',
                backgroundColor: `${colors.coral}20`,
                color: colors.coral,
                '& .MuiChip-icon': { color: colors.coral },
              }}
            />
          )}
        </Box>
      </Box>

      {/* Diff content */}
      <Collapse in={expanded}>
        {lines.length > 0 ? (
          <Box
            sx={{
              fontFamily: 'monospace',
              fontSize: '0.85rem',
              lineHeight: 1.6,
              overflow: 'auto',
            }}
          >
            {lines.map((line, index) => (
              <Box
                key={index}
                sx={{
                  display: 'flex',
                  backgroundColor:
                    line.type === 'addition'
                      ? `${colors.green}15`
                      : line.type === 'deletion'
                      ? `${colors.coral}15`
                      : line.type === 'header'
                      ? colors.navyLighter
                      : 'transparent',
                  borderLeft:
                    line.type === 'addition'
                      ? `3px solid ${colors.green}`
                      : line.type === 'deletion'
                      ? `3px solid ${colors.coral}`
                      : '3px solid transparent',
                  '&:hover': {
                    backgroundColor:
                      line.type === 'addition'
                        ? `${colors.green}25`
                        : line.type === 'deletion'
                        ? `${colors.coral}25`
                        : `${colors.orange}08`,
                  },
                }}
              >
                {/* Line numbers */}
                {line.type !== 'header' && (
                  <>
                    <Box
                      sx={{
                        width: 50,
                        px: 1,
                        textAlign: 'right',
                        color: colors.textMuted,
                        userSelect: 'none',
                        borderRight: `1px solid ${colors.navyLighter}`,
                        backgroundColor: `${colors.navy}50`,
                      }}
                    >
                      {line.oldLineNumber || ''}
                    </Box>
                    <Box
                      sx={{
                        width: 50,
                        px: 1,
                        textAlign: 'right',
                        color: colors.textMuted,
                        userSelect: 'none',
                        borderRight: `1px solid ${colors.navyLighter}`,
                        backgroundColor: `${colors.navy}50`,
                      }}
                    >
                      {line.newLineNumber || ''}
                    </Box>
                  </>
                )}

                {/* Sign */}
                <Box
                  sx={{
                    width: 20,
                    textAlign: 'center',
                    color:
                      line.type === 'addition'
                        ? colors.green
                        : line.type === 'deletion'
                        ? colors.coral
                        : 'transparent',
                    userSelect: 'none',
                  }}
                >
                  {line.type === 'addition' ? '+' : line.type === 'deletion' ? '-' : ' '}
                </Box>

                {/* Content */}
                <Box
                  sx={{
                    flex: 1,
                    px: 1,
                    whiteSpace: 'pre',
                    color:
                      line.type === 'header'
                        ? colors.blue
                        : line.type === 'addition'
                        ? colors.green
                        : line.type === 'deletion'
                        ? colors.coral
                        : colors.textLight,
                  }}
                >
                  {line.content || ' '}
                </Box>
              </Box>
            ))}
          </Box>
        ) : (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" sx={{ color: colors.textMuted }}>
              {file.status === 'added'
                ? 'New file'
                : file.status === 'deleted'
                ? 'File deleted'
                : 'Binary file or no changes to display'}
            </Typography>
          </Box>
        )}
      </Collapse>
    </Box>
  );
}

interface DiffViewerProps {
  files: DiffFile[];
  totalAdditions?: number;
  totalDeletions?: number;
}

export function DiffViewer({ files, totalAdditions = 0, totalDeletions = 0 }: DiffViewerProps) {
  const [expandAll, setExpandAll] = useState(true);

  if (files.length === 0) {
    return (
      <Box
        sx={{
          backgroundColor: colors.navyLight,
          borderRadius: 2,
          border: `1px solid ${colors.navyLighter}`,
          p: 4,
          textAlign: 'center',
        }}
      >
        <Typography variant="body1" sx={{ color: colors.textMuted }}>
          No file changes
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {/* Summary header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="body2" sx={{ color: colors.textMuted }}>
            {files.length} file{files.length !== 1 ? 's' : ''} changed
          </Typography>
          {totalAdditions > 0 && (
            <Typography variant="body2" sx={{ color: colors.green }}>
              +{totalAdditions} additions
            </Typography>
          )}
          {totalDeletions > 0 && (
            <Typography variant="body2" sx={{ color: colors.coral }}>
              -{totalDeletions} deletions
            </Typography>
          )}
        </Box>

        <Tooltip title={expandAll ? 'Collapse all' : 'Expand all'}>
          <IconButton size="small" onClick={() => setExpandAll(!expandAll)}>
            {expandAll ? (
              <ExpandMore sx={{ fontSize: 20 }} />
            ) : (
              <ChevronRight sx={{ fontSize: 20 }} />
            )}
          </IconButton>
        </Tooltip>
      </Box>

      {/* File diffs */}
      {files.map((file) => (
        <DiffFileView key={file.path} file={file} defaultExpanded={expandAll} />
      ))}
    </Box>
  );
}

export default DiffViewer;
