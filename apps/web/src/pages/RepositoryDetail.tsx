/**
 * Repository Detail Page
 * Code browser with file tree, file viewer, and repository information
 */

import { useState, useEffect } from 'react';
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
  Public,
  MoreVert,
  Download,
  AutoAwesome as AIIcon,
  Refresh,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { colors } from '../theme';
import { RepositoryProvider, useRepository } from '../contexts/RepositoryContext';
import {
  BranchSelector,
  CodeBrowser,
  FileViewer,
} from '../components/repository';

function RepositoryDetailContent() {
  const navigate = useNavigate();
  const {
    owner,
    repo,
    repository,
    isLoading,
    error,
    currentRef,
    branches,
    tags,
    fileTree,
    selectedPath,
    expandedPaths,
    currentFile,
    isLoadingFile,
    graphStats,
    toggleExpanded,
    loadFile,
    loadGraphStats,
    navigateToRef,
  } = useRepository();

  const [tabValue, setTabValue] = useState(0);
  const [starred, setStarred] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  // Load graph stats on mount
  useEffect(() => {
    loadGraphStats();
  }, [loadGraphStats]);

  const handleFileSelect = (path: string, type: 'blob' | 'tree') => {
    if (type === 'blob') {
      loadFile(path);
      navigate(`/repositories/${owner}/${repo}/blob/${currentRef}/${path}`);
    } else {
      navigate(`/repositories/${owner}/${repo}/tree/${currentRef}/${path}`);
    }
  };

  const handleNavigatePath = (path: string) => {
    if (path === '') {
      navigate(`/repositories/${owner}/${repo}`);
    } else {
      navigate(`/repositories/${owner}/${repo}/tree/${currentRef}/${path}`);
    }
  };

  const handleBranchChange = (ref: string) => {
    navigateToRef(ref);
  };

  const handleViewHistory = () => {
    navigate(`/repositories/${owner}/${repo}/commits/${currentRef}`);
  };

  const handleAIExplain = () => {
    // Navigate to AI assistant with file context
    navigate(`/ai-assistant?file=${selectedPath}&repo=${owner}/${repo}`);
  };

  const handleSyncGraph = async () => {
    // TODO: Implement graph sync trigger
    console.log('Triggering graph sync...');
  };

  if (error) {
    return (
      <Box sx={{ py: 8, textAlign: 'center' }}>
        <Typography variant="h6" sx={{ color: colors.coral, mb: 2 }}>
          Failed to load repository
        </Typography>
        <Typography variant="body2" sx={{ color: colors.textMuted, mb: 3 }}>
          {error}
        </Typography>
        <Button
          variant="outlined"
          onClick={() => window.location.reload()}
          startIcon={<Refresh />}
        >
          Retry
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      {/* Repository Header */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          {repository?.visibility === 'private' ? (
            <Lock sx={{ fontSize: 20, color: colors.textMuted }} />
          ) : (
            <Public sx={{ fontSize: 20, color: colors.textMuted }} />
          )}
          <Typography
            variant="body2"
            sx={{ color: colors.orange, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
            onClick={() => navigate(`/orgs/${owner}`)}
          >
            {owner}
          </Typography>
          <Typography variant="body2" sx={{ color: colors.textMuted }}>
            /
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            {repo}
          </Typography>
          <Chip
            label={repository?.visibility || 'private'}
            size="small"
            sx={{
              ml: 1,
              fontSize: '0.7rem',
              height: 20,
              backgroundColor: colors.navyLighter,
              textTransform: 'capitalize',
            }}
          />
        </Box>

        {repository?.description && (
          <Typography variant="body2" sx={{ color: colors.textMuted, mb: 2 }}>
            {repository.description}
          </Typography>
        )}

        {/* Action buttons */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={starred ? <Star sx={{ color: '#f7df1e' }} /> : <StarBorder />}
              onClick={() => setStarred(!starred)}
            >
              {starred ? 'Starred' : 'Star'}
            </Button>
            <Button variant="outlined" size="small" startIcon={<ForkRight />}>
              Fork
            </Button>
            <Button
              variant="contained"
              size="small"
              startIcon={<AIIcon />}
              sx={{ ml: 2 }}
              onClick={handleAIExplain}
            >
              AI Explain
            </Button>
          </Box>

          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <BranchSelector
              currentRef={currentRef}
              branches={branches}
              tags={tags}
              onSelect={handleBranchChange}
            />
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
                <Chip label="0" size="small" sx={{ height: 18, fontSize: '0.7rem' }} />
              </Box>
            }
          />
          <Tab
            icon={<IssueIcon sx={{ fontSize: 18 }} />}
            iconPosition="start"
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                Issues
                <Chip label="0" size="small" sx={{ height: 18, fontSize: '0.7rem' }} />
              </Box>
            }
          />
          <Tab icon={<PlayArrow sx={{ fontSize: 18 }} />} iconPosition="start" label="Actions" />
          <Tab icon={<Settings sx={{ fontSize: 18 }} />} iconPosition="start" label="Settings" />
        </Tabs>
      </Box>

      {/* Tab Content */}
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
                label={currentRef}
                size="small"
                sx={{ fontSize: '0.7rem', height: 22, backgroundColor: colors.navyLighter }}
              />
            </Box>
            <CodeBrowser
              fileTree={fileTree}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              isLoading={isLoading}
              onSelect={handleFileSelect}
              onToggle={toggleExpanded}
            />
          </Box>

          {/* File Viewer */}
          <FileViewer
            repoName={repo}
            file={currentFile}
            isLoading={isLoadingFile}
            graphStats={graphStats}
            onNavigate={handleNavigatePath}
            onViewHistory={handleViewHistory}
            onAIExplain={handleAIExplain}
          />
        </Box>
      )}

      {tabValue === 1 && (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <Typography variant="body1" sx={{ color: colors.textMuted }}>
            Pull Requests coming soon
          </Typography>
        </Box>
      )}

      {tabValue === 2 && (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <Typography variant="body1" sx={{ color: colors.textMuted }}>
            Issues coming soon
          </Typography>
        </Box>
      )}

      {tabValue === 3 && (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <Typography variant="body1" sx={{ color: colors.textMuted }}>
            Actions coming soon
          </Typography>
        </Box>
      )}

      {tabValue === 4 && (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <Typography variant="body1" sx={{ color: colors.textMuted }}>
            Settings coming soon
          </Typography>
        </Box>
      )}

      {/* More Menu */}
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        <MenuItem onClick={() => {
          setAnchorEl(null);
          navigate(`/repositories/${owner}/${repo}/graph`);
        }}>
          View Knowledge Graph
        </MenuItem>
        <MenuItem onClick={() => {
          setAnchorEl(null);
          handleSyncGraph();
        }}>
          Sync Graph
        </MenuItem>
        <MenuItem onClick={() => {
          setAnchorEl(null);
          handleAIExplain();
        }}>
          Run AI Analysis
        </MenuItem>
        <MenuItem onClick={() => {
          setAnchorEl(null);
          navigate(`/repositories/${owner}/${repo}/settings`);
        }}>
          Repository Settings
        </MenuItem>
      </Menu>
    </Box>
  );
}

export default function RepositoryDetail() {
  return (
    <RepositoryProvider>
      <RepositoryDetailContent />
    </RepositoryProvider>
  );
}
