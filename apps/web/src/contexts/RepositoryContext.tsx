/**
 * Repository Context
 * Provides repository state and data fetching for code browsing
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  getRepositoryInfo,
  getRefs,
  getTree,
  getBlob,
  getCommits,
  getGraphStats,
  type RepositoryInfo,
  type RefsResponse,
  type BlobResponse,
  type CommitInfo,
  type GraphStats,
} from '../services/repository';

// File tree node with children loaded
export interface FileTreeNode {
  name: string;
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  children?: FileTreeNode[];
  isLoading?: boolean;
  isLoaded?: boolean;
}

interface RepositoryContextValue {
  // Repository info
  owner: string;
  repo: string;
  repository: RepositoryInfo | null;
  isLoading: boolean;
  error: string | null;

  // Branch/ref state
  currentRef: string;
  branches: RefsResponse['branches'];
  tags: RefsResponse['tags'];
  setCurrentRef: (ref: string) => void;

  // File tree state
  fileTree: FileTreeNode[];
  selectedPath: string | null;
  expandedPaths: Set<string>;
  setSelectedPath: (path: string | null) => void;
  toggleExpanded: (path: string) => void;
  loadDirectory: (path: string) => Promise<void>;

  // File content
  currentFile: BlobResponse | null;
  isLoadingFile: boolean;
  loadFile: (path: string) => Promise<void>;

  // Commits
  commits: CommitInfo[];
  loadCommits: (ref?: string) => Promise<void>;

  // Graph stats
  graphStats: GraphStats | null;
  loadGraphStats: () => Promise<void>;

  // Navigation helpers
  navigateToPath: (path: string) => void;
  navigateToRef: (ref: string) => void;
}

const RepositoryContext = createContext<RepositoryContextValue | null>(null);

export function useRepository() {
  const context = useContext(RepositoryContext);
  if (!context) {
    throw new Error('useRepository must be used within a RepositoryProvider');
  }
  return context;
}

interface RepositoryProviderProps {
  children: React.ReactNode;
}

export function RepositoryProvider({ children }: RepositoryProviderProps) {
  const params = useParams<{ owner: string; repo: string; '*': string }>();
  const navigate = useNavigate();
  useLocation(); // Subscribe to location changes

  const owner = params.owner || '';
  const repo = params.repo || '';

  // Repository state
  const [repository, setRepository] = useState<RepositoryInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Refs state
  const [currentRef, setCurrentRef] = useState<string>('main');
  const [branches, setBranches] = useState<RefsResponse['branches']>([]);
  const [tags, setTags] = useState<RefsResponse['tags']>([]);

  // File tree state
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  // File content state
  const [currentFile, setCurrentFile] = useState<BlobResponse | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);

  // Commits state
  const [commits, setCommits] = useState<CommitInfo[]>([]);

  // Graph stats state
  const [graphStats, setGraphStats] = useState<GraphStats | null>(null);

  // Parse path from URL
  useEffect(() => {
    const wildcardPath = params['*'] || '';
    if (wildcardPath.startsWith('tree/')) {
      // /tree/:ref/*path
      const parts = wildcardPath.replace('tree/', '').split('/');
      const ref = parts[0];
      const path = parts.slice(1).join('/');
      if (ref && ref !== currentRef) {
        setCurrentRef(ref);
      }
      if (path && path !== selectedPath) {
        setSelectedPath(path);
      }
    } else if (wildcardPath.startsWith('blob/')) {
      // /blob/:ref/*path
      const parts = wildcardPath.replace('blob/', '').split('/');
      const ref = parts[0];
      const path = parts.slice(1).join('/');
      if (ref && ref !== currentRef) {
        setCurrentRef(ref);
      }
      if (path) {
        setSelectedPath(path);
        loadFile(path);
      }
    }
  }, [params['*']]);

  // Load repository info
  useEffect(() => {
    if (!owner || !repo) return;

    async function loadRepo() {
      setIsLoading(true);
      setError(null);

      try {
        const [repoInfo, refsData] = await Promise.all([
          getRepositoryInfo(owner, repo),
          getRefs(owner, repo),
        ]);

        setRepository(repoInfo);
        setBranches(refsData.branches);
        setTags(refsData.tags);
        setCurrentRef(refsData.defaultBranch || 'main');

        // Load root tree
        const treeData = await getTree(owner, repo, refsData.defaultBranch || 'main', '');
        setFileTree(treeData.entries.map(entry => ({
          ...entry,
          children: entry.type === 'tree' ? [] : undefined,
          isLoaded: false,
        })));
      } catch (err: any) {
        setError(err.message || 'Failed to load repository');
        console.error('Failed to load repository:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadRepo();
  }, [owner, repo]);

  // Load directory contents
  const loadDirectory = useCallback(async (path: string) => {
    if (!owner || !repo) return;

    try {
      const treeData = await getTree(owner, repo, currentRef, path);

      setFileTree(prev => {
        const updateTree = (nodes: FileTreeNode[]): FileTreeNode[] => {
          return nodes.map(node => {
            if (node.path === path) {
              return {
                ...node,
                children: treeData.entries.map(entry => ({
                  ...entry,
                  children: entry.type === 'tree' ? [] : undefined,
                  isLoaded: false,
                })),
                isLoaded: true,
                isLoading: false,
              };
            }
            if (node.children) {
              return { ...node, children: updateTree(node.children) };
            }
            return node;
          });
        };
        return updateTree(prev);
      });
    } catch (err) {
      console.error('Failed to load directory:', err);
    }
  }, [owner, repo, currentRef]);

  // Toggle expanded state
  const toggleExpanded = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        // Load directory if not loaded
        const findNode = (nodes: FileTreeNode[]): FileTreeNode | null => {
          for (const node of nodes) {
            if (node.path === path) return node;
            if (node.children) {
              const found = findNode(node.children);
              if (found) return found;
            }
          }
          return null;
        };
        const node = findNode(fileTree);
        if (node && node.type === 'tree' && !node.isLoaded) {
          loadDirectory(path);
        }
      }
      return next;
    });
  }, [fileTree, loadDirectory]);

  // Load file content
  const loadFile = useCallback(async (path: string) => {
    if (!owner || !repo) return;

    setIsLoadingFile(true);
    try {
      const blobData = await getBlob(owner, repo, currentRef, path);
      setCurrentFile(blobData);
      setSelectedPath(path);
    } catch (err) {
      console.error('Failed to load file:', err);
      setCurrentFile(null);
    } finally {
      setIsLoadingFile(false);
    }
  }, [owner, repo, currentRef]);

  // Load commits
  const loadCommits = useCallback(async (ref?: string) => {
    if (!owner || !repo) return;

    try {
      const commitsData = await getCommits(owner, repo, { ref: ref || currentRef, limit: 30 });
      setCommits(commitsData.commits);
    } catch (err) {
      console.error('Failed to load commits:', err);
    }
  }, [owner, repo, currentRef]);

  // Load graph stats
  const loadGraphStats = useCallback(async () => {
    if (!owner || !repo) return;

    try {
      const statsData = await getGraphStats(owner, repo);
      setGraphStats(statsData.data);
    } catch (err) {
      console.error('Failed to load graph stats:', err);
    }
  }, [owner, repo]);

  // Navigation helpers
  const navigateToPath = useCallback((path: string) => {
    const isFile = !path.endsWith('/') && path.includes('.');
    if (isFile) {
      navigate(`/repositories/${owner}/${repo}/blob/${currentRef}/${path}`);
    } else {
      navigate(`/repositories/${owner}/${repo}/tree/${currentRef}/${path}`);
    }
  }, [navigate, owner, repo, currentRef]);

  const navigateToRef = useCallback((ref: string) => {
    setCurrentRef(ref);
    navigate(`/repositories/${owner}/${repo}/tree/${ref}`);
  }, [navigate, owner, repo]);

  const value = useMemo<RepositoryContextValue>(() => ({
    owner,
    repo,
    repository,
    isLoading,
    error,
    currentRef,
    branches,
    tags,
    setCurrentRef,
    fileTree,
    selectedPath,
    expandedPaths,
    setSelectedPath,
    toggleExpanded,
    loadDirectory,
    currentFile,
    isLoadingFile,
    loadFile,
    commits,
    loadCommits,
    graphStats,
    loadGraphStats,
    navigateToPath,
    navigateToRef,
  }), [
    owner, repo, repository, isLoading, error,
    currentRef, branches, tags,
    fileTree, selectedPath, expandedPaths,
    currentFile, isLoadingFile, commits, graphStats,
    loadDirectory, toggleExpanded, loadFile, loadCommits, loadGraphStats,
    navigateToPath, navigateToRef,
  ]);

  return (
    <RepositoryContext.Provider value={value}>
      {children}
    </RepositoryContext.Provider>
  );
}

export default RepositoryContext;
