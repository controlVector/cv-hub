/**
 * CodeBrowser Component
 * File tree with expand/collapse functionality
 */

import { Box, Typography, Collapse, CircularProgress, Skeleton } from '@mui/material';
import {
  Folder,
  FolderOpen,
  InsertDriveFile,
  ChevronRight,
  ExpandMore,
} from '@mui/icons-material';
import { colors } from '../../theme';
import type { FileTreeNode } from '../../contexts/RepositoryContext';

// File icon color based on extension
function getFileIconColor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'ts':
    case 'tsx':
      return '#3178c6'; // TypeScript blue
    case 'js':
    case 'jsx':
      return '#f7df1e'; // JavaScript yellow
    case 'json':
      return colors.orange;
    case 'md':
    case 'mdx':
      return colors.blue;
    case 'css':
    case 'scss':
    case 'sass':
      return colors.purple;
    case 'html':
      return colors.coral;
    case 'py':
      return '#3776ab'; // Python blue
    case 'go':
      return '#00add8'; // Go cyan
    case 'rs':
      return '#dea584'; // Rust orange
    case 'yaml':
    case 'yml':
      return colors.green;
    default:
      return colors.textMuted;
  }
}

interface FileTreeItemProps {
  node: FileTreeNode;
  level: number;
  selectedPath: string | null;
  expandedPaths: Set<string>;
  onSelect: (path: string, type: 'blob' | 'tree') => void;
  onToggle: (path: string) => void;
}

function FileTreeItem({
  node,
  level,
  selectedPath,
  expandedPaths,
  onSelect,
  onToggle,
}: FileTreeItemProps) {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;
  const isDirectory = node.type === 'tree';
  const isLoading = node.isLoading;

  const handleClick = () => {
    if (isDirectory) {
      onToggle(node.path);
    } else {
      onSelect(node.path, node.type);
    }
  };

  return (
    <>
      <Box
        onClick={handleClick}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          py: 0.5,
          px: 1,
          pl: level * 2 + 1,
          cursor: 'pointer',
          borderRadius: 1,
          backgroundColor: isSelected ? `${colors.orange}15` : 'transparent',
          '&:hover': {
            backgroundColor: isSelected ? `${colors.orange}20` : `${colors.orange}08`,
          },
        }}
      >
        {/* Expand/collapse icon for directories */}
        {isDirectory ? (
          isLoading ? (
            <CircularProgress size={14} sx={{ color: colors.textMuted, mr: 0.5 }} />
          ) : isExpanded ? (
            <ExpandMore sx={{ fontSize: 18, color: colors.textMuted }} />
          ) : (
            <ChevronRight sx={{ fontSize: 18, color: colors.textMuted }} />
          )
        ) : (
          <Box sx={{ width: 18 }} />
        )}

        {/* File/folder icon */}
        {isDirectory ? (
          isExpanded ? (
            <FolderOpen sx={{ fontSize: 16, color: colors.orange }} />
          ) : (
            <Folder sx={{ fontSize: 16, color: colors.orange }} />
          )
        ) : (
          <InsertDriveFile sx={{ fontSize: 16, color: getFileIconColor(node.name) }} />
        )}

        {/* File name */}
        <Typography
          variant="body2"
          sx={{
            color: isSelected ? colors.orange : colors.textLight,
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {node.name}
        </Typography>

        {/* File size for files */}
        {!isDirectory && node.size && (
          <Typography
            variant="caption"
            sx={{
              color: colors.textMuted,
              fontSize: '0.7rem',
              ml: 'auto',
            }}
          >
            {formatFileSize(node.size)}
          </Typography>
        )}
      </Box>

      {/* Children (expanded directories) */}
      {isDirectory && (
        <Collapse in={isExpanded}>
          {isLoading && !node.children?.length ? (
            <Box sx={{ pl: (level + 1) * 2 + 1, py: 0.5 }}>
              <Skeleton variant="text" width={100} height={20} />
              <Skeleton variant="text" width={120} height={20} />
              <Skeleton variant="text" width={80} height={20} />
            </Box>
          ) : (
            node.children?.map((child) => (
              <FileTreeItem
                key={child.path}
                node={child}
                level={level + 1}
                selectedPath={selectedPath}
                expandedPaths={expandedPaths}
                onSelect={onSelect}
                onToggle={onToggle}
              />
            ))
          )}
        </Collapse>
      )}
    </>
  );
}

// Format file size in human-readable format
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface CodeBrowserProps {
  fileTree: FileTreeNode[];
  selectedPath: string | null;
  expandedPaths: Set<string>;
  isLoading?: boolean;
  onSelect: (path: string, type: 'blob' | 'tree') => void;
  onToggle: (path: string) => void;
}

export function CodeBrowser({
  fileTree,
  selectedPath,
  expandedPaths,
  isLoading,
  onSelect,
  onToggle,
}: CodeBrowserProps) {
  if (isLoading) {
    return (
      <Box sx={{ py: 2, px: 1 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
            <Skeleton variant="circular" width={16} height={16} />
            <Skeleton variant="text" width={100 + Math.random() * 60} height={20} />
          </Box>
        ))}
      </Box>
    );
  }

  if (fileTree.length === 0) {
    return (
      <Box sx={{ py: 4, textAlign: 'center' }}>
        <Typography variant="body2" sx={{ color: colors.textMuted }}>
          No files in this repository
        </Typography>
      </Box>
    );
  }

  // Sort: directories first, then files, alphabetically
  const sortedTree = [...fileTree].sort((a, b) => {
    if (a.type === 'tree' && b.type !== 'tree') return -1;
    if (a.type !== 'tree' && b.type === 'tree') return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <Box sx={{ py: 1 }}>
      {sortedTree.map((node) => (
        <FileTreeItem
          key={node.path}
          node={node}
          level={0}
          selectedPath={selectedPath}
          expandedPaths={expandedPaths}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      ))}
    </Box>
  );
}

export default CodeBrowser;
