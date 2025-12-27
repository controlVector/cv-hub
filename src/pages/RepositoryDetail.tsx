import { useState } from 'react';
import {
  Box,
  Typography,
  Tabs,
  Tab,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Button,
  Breadcrumbs,
  Link,
  Tooltip,
  Collapse,
} from '@mui/material';
import {
  Star,
  StarBorder,
  ForkRight,
  Code,
  CallMerge as PRIcon,
  BugReport as IssueIcon,
  PlayArrow,
  Settings,
  Lock,
  MoreVert,
  Folder,
  InsertDriveFile,
  ChevronRight,
  ExpandMore,
  AutoAwesome as AIIcon,
  ContentCopy,
  Download,
  History,
} from '@mui/icons-material';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { colors } from '../theme';
import type { FileNode } from '../types';

// Mock file tree
const mockFileTree: FileNode[] = [
  {
    name: 'src',
    path: 'src',
    type: 'directory',
    children: [
      {
        name: 'components',
        path: 'src/components',
        type: 'directory',
        children: [
          { name: 'Layout.tsx', path: 'src/components/Layout.tsx', type: 'file', language: 'typescript' },
          { name: 'Header.tsx', path: 'src/components/Header.tsx', type: 'file', language: 'typescript' },
        ],
      },
      {
        name: 'pages',
        path: 'src/pages',
        type: 'directory',
        children: [
          { name: 'Dashboard.tsx', path: 'src/pages/Dashboard.tsx', type: 'file', language: 'typescript' },
          { name: 'Repository.tsx', path: 'src/pages/Repository.tsx', type: 'file', language: 'typescript' },
        ],
      },
      { name: 'App.tsx', path: 'src/App.tsx', type: 'file', language: 'typescript' },
      { name: 'main.tsx', path: 'src/main.tsx', type: 'file', language: 'typescript' },
    ],
  },
  { name: 'package.json', path: 'package.json', type: 'file', language: 'json' },
  { name: 'tsconfig.json', path: 'tsconfig.json', type: 'file', language: 'json' },
  { name: 'README.md', path: 'README.md', type: 'file', language: 'markdown' },
];

const mockFileContent = `import { useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';

interface DashboardProps {
  userId: string;
  onRefresh?: () => void;
}

export function Dashboard({ userId, onRefresh }: DashboardProps) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch(\`/api/dashboard/\${userId}\`);
        const result = await response.json();
        setData(result);
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [userId]);

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4">Welcome back!</Typography>
      <StatsGrid data={data} />
      <RecentActivity userId={userId} />
    </Box>
  );
}`;

interface FileTreeItemProps {
  node: FileNode;
  level: number;
  selectedPath: string;
  expandedPaths: Set<string>;
  onSelect: (path: string) => void;
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
  const isDirectory = node.type === 'directory';

  return (
    <>
      <Box
        onClick={() => {
          if (isDirectory) {
            onToggle(node.path);
          } else {
            onSelect(node.path);
          }
        }}
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
        {isDirectory ? (
          isExpanded ? (
            <ExpandMore sx={{ fontSize: 18, color: colors.textMuted }} />
          ) : (
            <ChevronRight sx={{ fontSize: 18, color: colors.textMuted }} />
          )
        ) : (
          <Box sx={{ width: 18 }} />
        )}
        {isDirectory ? (
          <Folder sx={{ fontSize: 16, color: colors.orange }} />
        ) : (
          <InsertDriveFile sx={{ fontSize: 16, color: colors.textMuted }} />
        )}
        <Typography
          variant="body2"
          sx={{
            color: isSelected ? colors.orange : colors.textLight,
            fontFamily: 'monospace',
            fontSize: '0.85rem',
          }}
        >
          {node.name}
        </Typography>
      </Box>
      {isDirectory && (
        <Collapse in={isExpanded}>
          {node.children?.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              level={level + 1}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </Collapse>
      )}
    </>
  );
}

export default function RepositoryDetail() {
  const [tabValue, setTabValue] = useState(0);
  const [starred, setStarred] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedFile, setSelectedFile] = useState('src/pages/Dashboard.tsx');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['src', 'src/pages']));

  const handleToggle = (path: string) => {
    const newExpanded = new Set(expandedPaths);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedPaths(newExpanded);
  };

  return (
    <Box>
      {/* Repository Header */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Lock sx={{ fontSize: 20, color: colors.textMuted }} />
          <Typography
            variant="body2"
            sx={{ color: colors.orange, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
          >
            team
          </Typography>
          <Typography variant="body2" sx={{ color: colors.textMuted }}>
            /
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            cv-git
          </Typography>
          <Chip
            label="Private"
            size="small"
            sx={{ ml: 1, fontSize: '0.7rem', height: 20, backgroundColor: colors.navyLighter }}
          />
        </Box>
        <Typography variant="body2" sx={{ color: colors.textMuted, mb: 2 }}>
          AI-native version control platform with knowledge graph and semantic search
        </Typography>

        {/* Action buttons */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={starred ? <Star sx={{ color: '#f7df1e' }} /> : <StarBorder />}
              onClick={() => setStarred(!starred)}
            >
              {starred ? 'Starred' : 'Star'} · 128
            </Button>
            <Button variant="outlined" size="small" startIcon={<ForkRight />}>
              Fork · 24
            </Button>
            <Button
              variant="contained"
              size="small"
              startIcon={<AIIcon />}
              sx={{ ml: 2 }}
            >
              AI Explain
            </Button>
          </Box>

          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="outlined" size="small" startIcon={<Download />}>
              Clone
            </Button>
            <IconButton
              size="small"
              onClick={(e) => setAnchorEl(e.currentTarget)}
              sx={{ border: `1px solid ${colors.navyLighter}` }}
            >
              <MoreVert />
            </IconButton>
          </Box>
        </Box>
      </Box>

      {/* Tabs */}
      <Box sx={{ borderBottom: `1px solid ${colors.navyLighter}`, mb: 3 }}>
        <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)}>
          <Tab icon={<Code sx={{ fontSize: 18 }} />} iconPosition="start" label="Code" />
          <Tab
            icon={<PRIcon sx={{ fontSize: 18 }} />}
            iconPosition="start"
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                Pull Requests
                <Chip label="3" size="small" sx={{ height: 18, fontSize: '0.7rem' }} />
              </Box>
            }
          />
          <Tab
            icon={<IssueIcon sx={{ fontSize: 18 }} />}
            iconPosition="start"
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                Issues
                <Chip label="12" size="small" sx={{ height: 18, fontSize: '0.7rem' }} />
              </Box>
            }
          />
          <Tab icon={<PlayArrow sx={{ fontSize: 18 }} />} iconPosition="start" label="Actions" />
          <Tab icon={<Settings sx={{ fontSize: 18 }} />} iconPosition="start" label="Settings" />
        </Tabs>
      </Box>

      {/* Code Browser */}
      {tabValue === 0 && (
        <Box sx={{ display: 'flex', gap: 3, minHeight: 600 }}>
          {/* File Tree */}
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
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Files
              </Typography>
              <Chip
                label="main"
                size="small"
                sx={{ fontSize: '0.7rem', height: 22, backgroundColor: colors.navyLighter }}
              />
            </Box>
            <Box sx={{ py: 1 }}>
              {mockFileTree.map((node) => (
                <FileTreeItem
                  key={node.path}
                  node={node}
                  level={0}
                  selectedPath={selectedFile}
                  expandedPaths={expandedPaths}
                  onSelect={setSelectedFile}
                  onToggle={handleToggle}
                />
              ))}
            </Box>
          </Box>

          {/* Code Viewer */}
          <Box
            sx={{
              flex: 1,
              backgroundColor: colors.navyLight,
              borderRadius: 2,
              border: `1px solid ${colors.navyLighter}`,
              overflow: 'hidden',
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
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Breadcrumbs separator="/" sx={{ '& .MuiBreadcrumbs-separator': { color: colors.textMuted } }}>
                  {selectedFile.split('/').map((part, i, arr) => (
                    <Link
                      key={i}
                      underline="hover"
                      sx={{
                        color: i === arr.length - 1 ? colors.textLight : colors.textMuted,
                        fontFamily: 'monospace',
                        fontSize: '0.9rem',
                        cursor: 'pointer',
                      }}
                    >
                      {part}
                    </Link>
                  ))}
                </Breadcrumbs>
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Tooltip title="Copy file path">
                  <IconButton size="small">
                    <ContentCopy sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="View history">
                  <IconButton size="small">
                    <History sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="AI Explain this file">
                  <IconButton size="small" sx={{ color: colors.orange }}>
                    <AIIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>

            {/* Code Content */}
            <Box
              sx={{
                maxHeight: 500,
                overflow: 'auto',
                '& pre': {
                  margin: '0 !important',
                  fontSize: '0.85rem !important',
                  lineHeight: '1.6 !important',
                },
              }}
            >
              <SyntaxHighlighter
                language="typescript"
                style={oneDark}
                showLineNumbers
                customStyle={{
                  background: colors.navy,
                  padding: '16px',
                }}
                lineNumberStyle={{
                  color: colors.textMuted,
                  minWidth: '3em',
                  paddingRight: '1em',
                }}
              >
                {mockFileContent}
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
                  42 lines
                </Typography>
                <Typography variant="caption" sx={{ color: colors.textMuted }}>
                  1.2 KB
                </Typography>
                <Typography variant="caption" sx={{ color: colors.textMuted }}>
                  TypeScript
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Tooltip title="Cyclomatic Complexity">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="caption" sx={{ color: colors.textMuted }}>
                      Complexity:
                    </Typography>
                    <Chip label="8" size="small" sx={{ height: 18, fontSize: '0.7rem', bgcolor: colors.green }} />
                  </Box>
                </Tooltip>
                <Tooltip title="Functions in this file">
                  <Typography variant="caption" sx={{ color: colors.textMuted }}>
                    2 functions
                  </Typography>
                </Tooltip>
              </Box>
            </Box>
          </Box>
        </Box>
      )}

      {/* Menu */}
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        <MenuItem onClick={() => setAnchorEl(null)}>View Knowledge Graph</MenuItem>
        <MenuItem onClick={() => setAnchorEl(null)}>Sync Graph</MenuItem>
        <MenuItem onClick={() => setAnchorEl(null)}>Run AI Analysis</MenuItem>
        <MenuItem onClick={() => setAnchorEl(null)}>Repository Settings</MenuItem>
      </Menu>
    </Box>
  );
}
