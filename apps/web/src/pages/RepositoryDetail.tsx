/**
 * Repository Detail Page
 * Code browser with file tree, file viewer, and repository information
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  Tooltip,
  Popover,
  TextField,
  InputAdornment,
} from '@mui/material';
import {
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
  ContentCopy,
  Check as CheckIcon,
  AutoAwesome as AIIcon,
  Refresh,
  AccountTree,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { colors } from '../theme';
import { RepositoryProvider, useRepository } from '../contexts/RepositoryContext';
import { useAuth } from '../contexts/AuthContext';
import {
  BranchSelector,
  CodeBrowser,
  FileViewer,
  ArchitectureTab,
} from '../components/repository';
import { PipelinesList } from '../components/ci-cd';
import RepositoryIssues from './RepositoryIssues';
import RepositorySettings from './RepositorySettings';
import { triggerGraphSync } from '../services/repository';
import { getRepositoryPullRequests, type PullRequest } from '../services/pullRequests';

/**
 * Inline PR list for the repository Pull Requests tab
 */
function RepoPullRequests({ owner, repo }: { owner: string; repo: string }) {
  const [tabValue, setTabValue] = useState(0);
  const stateFilter = tabValue === 0 ? 'open' : tabValue === 1 ? 'merged' : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['repoPRs', owner, repo, stateFilter],
    queryFn: () => getRepositoryPullRequests(owner, repo, { state: stateFilter, limit: 50 }),
  });

  const prs: PullRequest[] = data?.pullRequests || [];

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <Tabs
          value={tabValue}
          onChange={(_, v) => setTabValue(v)}
          sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0 } }}
        >
          <Tab label="Open" />
          <Tab label="Merged" />
          <Tab label="All" />
        </Tabs>
      </Box>
      {isLoading ? (
        <Box>
          {[1, 2].map((i) => (
            <Box key={i} sx={{ p: 2, mb: 1, borderRadius: 2, backgroundColor: colors.navyLight }}>
              <Typography variant="body2" sx={{ color: colors.textMuted }}>Loading...</Typography>
            </Box>
          ))}
        </Box>
      ) : prs.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <PRIcon sx={{ fontSize: 40, color: colors.textMuted, mb: 1 }} />
          <Typography variant="body1" sx={{ color: colors.textMuted }}>
            No pull requests
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {prs.map((pr) => (
            <Box
              key={pr.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                p: 2,
                borderRadius: 2,
                backgroundColor: colors.navyLight,
                border: `1px solid ${colors.navyLighter}`,
              }}
            >
              <PRIcon sx={{ color: pr.state === 'merged' ? colors.purple : colors.green, fontSize: 20 }} />
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontWeight: 600, fontSize: '0.9rem' }}>{pr.title}</Typography>
                <Typography variant="caption" sx={{ color: colors.textMuted }}>
                  #{pr.number} by {pr.author?.displayName || pr.author?.username} — {pr.sourceBranch} → {pr.targetBranch}
                </Typography>
              </Box>
              {pr.labels?.map((l) => (
                <Chip key={l} label={l} size="small" sx={{ height: 20, fontSize: '0.65rem' }} />
              ))}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

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

  const { user } = useAuth();
  const isPersonalRepo = user?.username === owner;

  const [tabValue, setTabValue] = useState(0);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [cloneAnchor, setCloneAnchor] = useState<null | HTMLElement>(null);
  const [copied, setCopied] = useState(false);

  const cloneUrl = `${window.location.origin.replace('://hub.', '://git.hub.')}/${owner}/${repo}.git`;

  // Load graph stats on mount
  useEffect(() => {
    loadGraphStats();
  }, [loadGraphStats]);

  const handleFileSelect = (path: string, type: 'blob' | 'tree') => {
    if (type === 'blob') {
      loadFile(path);
      navigate(`/dashboard/repositories/${owner}/${repo}/blob/${currentRef}/${path}`);
    } else {
      navigate(`/dashboard/repositories/${owner}/${repo}/tree/${currentRef}/${path}`);
    }
  };

  const handleNavigatePath = (path: string) => {
    if (path === '') {
      navigate(`/dashboard/repositories/${owner}/${repo}`);
    } else {
      navigate(`/dashboard/repositories/${owner}/${repo}/tree/${currentRef}/${path}`);
    }
  };

  const handleBranchChange = (ref: string) => {
    navigateToRef(ref);
  };

  const handleViewHistory = () => {
    navigate(`/dashboard/repositories/${owner}/${repo}/commits/${currentRef}`);
  };

  const handleAIExplain = () => {
    // Navigate to AI assistant with file context
    navigate(`/dashboard/ai-assistant?file=${selectedPath}&repo=${owner}/${repo}`);
  };

  const handleSyncGraph = async () => {
    try {
      await triggerGraphSync(owner, repo);
      loadGraphStats();
    } catch (err) {
      console.error('Failed to trigger graph sync:', err);
    }
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
            onClick={() => navigate(isPersonalRepo ? '/dashboard' : `/dashboard/orgs/${owner}/settings`)}
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
            <Tooltip title="Coming soon">
              <span>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<StarBorder />}
                  disabled
                >
                  Star
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="Coming soon">
              <span>
                <Button variant="outlined" size="small" startIcon={<ForkRight />} disabled>
                  Fork
                </Button>
              </span>
            </Tooltip>
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
            <Button
              variant="outlined"
              size="small"
              startIcon={<Download />}
              onClick={(e) => setCloneAnchor(e.currentTarget)}
            >
              Clone
            </Button>
            <Popover
              open={!!cloneAnchor}
              anchorEl={cloneAnchor}
              onClose={() => { setCloneAnchor(null); setCopied(false); }}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              slotProps={{ paper: { sx: { p: 2, width: 380, backgroundColor: colors.navyLight, border: `1px solid ${colors.navyLighter}` } } }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                Clone with HTTPS
              </Typography>
              <TextField
                value={cloneUrl}
                fullWidth
                size="small"
                InputProps={{
                  readOnly: true,
                  sx: { fontFamily: 'monospace', fontSize: '0.8rem' },
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={() => {
                          navigator.clipboard.writeText(cloneUrl);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                      >
                        {copied ? <CheckIcon sx={{ fontSize: 16, color: colors.green }} /> : <ContentCopy sx={{ fontSize: 16 }} />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
              <Typography variant="caption" sx={{ color: colors.textMuted, mt: 1, display: 'block' }}>
                Use a personal access token as password when prompted.
              </Typography>
            </Popover>
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
          <Tab icon={<PRIcon sx={{ fontSize: 18 }} />} iconPosition="start" label="Pull Requests" />
          <Tab icon={<IssueIcon sx={{ fontSize: 18 }} />} iconPosition="start" label="Issues" />
          <Tab icon={<PlayArrow sx={{ fontSize: 18 }} />} iconPosition="start" label="Actions" />
          <Tab icon={<AccountTree sx={{ fontSize: 18 }} />} iconPosition="start" label="Architecture" />
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
            owner={owner}
            repo={repo}
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
        <RepoPullRequests owner={owner} repo={repo} />
      )}

      {tabValue === 2 && (
        <RepositoryIssues owner={owner} repo={repo} />
      )}

      {tabValue === 3 && (
        <PipelinesList owner={owner} repo={repo} />
      )}

      {tabValue === 4 && (
        <ArchitectureTab owner={owner} repo={repo} />
      )}

      {tabValue === 5 && (
        <RepositorySettings
          owner={owner}
          repo={repo}
          repository={repository ? {
            id: repository.id,
            name: repository.name,
            slug: repository.slug,
            description: repository.description,
            visibility: repository.visibility,
            defaultBranch: repository.defaultBranch,
          } : null}
        />
      )}

      {/* More Menu */}
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        <MenuItem onClick={() => {
          setAnchorEl(null);
          navigate(`/dashboard/graph?repo=${owner}/${repo}`);
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
          navigate(`/dashboard/repositories/${owner}/${repo}/settings`);
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
