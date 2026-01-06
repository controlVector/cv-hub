/**
 * Repository Service
 * API client for repository operations
 */

import { api } from '../lib/api';

// Types
export interface RepositoryInfo {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: 'public' | 'internal' | 'private';
  provider: 'local' | 'github' | 'gitlab';
  defaultBranch: string;
  gitUrl: string;
  graphSyncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
  permissions: {
    read: boolean;
    write: boolean;
  };
}

export interface Branch {
  name: string;
  sha: string;
  isDefault?: boolean;
  isProtected?: boolean;
}

export interface Tag {
  name: string;
  sha: string;
  message?: string;
}

export interface RefsResponse {
  branches: Branch[];
  tags: Tag[];
  defaultBranch: string;
}

export interface TreeEntry {
  name: string;
  path: string;
  type: 'blob' | 'tree';
  mode: string;
  sha: string;
  size?: number;
}

export interface TreeResponse {
  ref: string;
  path: string;
  entries: TreeEntry[];
}

export interface BlobResponse {
  ref: string;
  path: string;
  sha: string;
  size: number;
  isBinary: boolean;
  content: string | null;
  encoding: 'utf-8' | 'base64';
  contentBase64: string | null;
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: {
    name: string;
    email: string;
    date: string;
  };
  committer: {
    name: string;
    email: string;
    date: string;
  };
  parents?: string[];
}

export interface CommitsResponse {
  ref: string;
  commits: CommitInfo[];
}

export interface GraphStats {
  fileCount: number;
  symbolCount: number;
  functionCount: number;
  classCount: number;
  commitCount: number;
  moduleCount: number;
  relationshipCount: number;
  syncStatus: string;
  lastSyncedAt: string | null;
  syncError: string | null;
}

export interface SymbolInfo {
  qualifiedName: string;
  name: string;
  kind: string;
  file: string;
  startLine: number;
  endLine: number;
  signature?: string;
  docstring?: string;
  complexity: number;
}

export interface SymbolUsage {
  symbol: SymbolInfo;
  callers: SymbolInfo[];
  callees: SymbolInfo[];
  callerCount: number;
  calleeCount: number;
}

// API Functions

/**
 * Get repository clone info
 */
export async function getRepositoryInfo(owner: string, repo: string): Promise<RepositoryInfo> {
  const response = await api.get(`/v1/repos/${owner}/${repo}/clone-info`);
  return response.data;
}

/**
 * Get repository refs (branches and tags)
 */
export async function getRefs(owner: string, repo: string): Promise<RefsResponse> {
  const response = await api.get(`/v1/repos/${owner}/${repo}/refs`);
  return response.data;
}

/**
 * Get directory tree
 */
export async function getTree(owner: string, repo: string, ref: string, path: string = ''): Promise<TreeResponse> {
  const encodedPath = path ? `/${encodeURIComponent(path)}` : '';
  const response = await api.get(`/v1/repos/${owner}/${repo}/tree/${encodeURIComponent(ref)}${encodedPath}`);
  return response.data;
}

/**
 * Get file content
 */
export async function getBlob(owner: string, repo: string, ref: string, path: string): Promise<BlobResponse> {
  const response = await api.get(`/v1/repos/${owner}/${repo}/blob/${encodeURIComponent(ref)}/${encodeURIComponent(path)}`);
  return response.data;
}

/**
 * Get commit history
 */
export async function getCommits(
  owner: string,
  repo: string,
  options: { ref?: string; path?: string; limit?: number } = {}
): Promise<CommitsResponse> {
  const params = new URLSearchParams();
  if (options.ref) params.set('ref', options.ref);
  if (options.path) params.set('path', options.path);
  if (options.limit) params.set('limit', options.limit.toString());

  const response = await api.get(`/v1/repos/${owner}/${repo}/commits?${params.toString()}`);
  return response.data;
}

/**
 * Get a specific commit
 */
export async function getCommit(owner: string, repo: string, sha: string): Promise<{ commit: CommitInfo }> {
  const response = await api.get(`/v1/repos/${owner}/${repo}/commits/${sha}`);
  return response.data;
}

/**
 * Get blame information
 */
export async function getBlame(owner: string, repo: string, ref: string, path: string): Promise<any> {
  const response = await api.get(`/v1/repos/${owner}/${repo}/blame/${encodeURIComponent(ref)}/${encodeURIComponent(path)}`);
  return response.data;
}

/**
 * Get graph statistics
 */
export async function getGraphStats(owner: string, repo: string): Promise<{ data: GraphStats }> {
  const response = await api.get(`/v1/repos/${owner}/${repo}/graph/stats`);
  return response.data;
}

/**
 * Get symbol usage
 */
export async function getSymbolUsage(owner: string, repo: string, symbolName: string): Promise<{ data: SymbolUsage }> {
  const response = await api.get(`/v1/repos/${owner}/${repo}/graph/symbol/${encodeURIComponent(symbolName)}`);
  return response.data;
}

/**
 * Execute graph query
 */
export async function executeGraphQuery(
  owner: string,
  repo: string,
  query: {
    type: 'calls' | 'calledBy' | 'imports' | 'importedBy' | 'defines' | 'inherits' | 'path' | 'custom';
    target?: string;
    from?: string;
    to?: string;
    maxDepth?: number;
    cypher?: string;
  }
): Promise<{ data: { query: any; results: any[]; count: number } }> {
  const response = await api.post(`/v1/repos/${owner}/${repo}/graph/query`, query);
  return response.data;
}

/**
 * Trigger graph sync
 */
export async function triggerGraphSync(owner: string, repo: string, jobType: 'full' | 'delta' = 'full'): Promise<any> {
  const response = await api.post(`/v1/repos/${owner}/${repo}/graph/sync`, { jobType });
  return response.data;
}

/**
 * Get graph sync status
 */
export async function getGraphSyncStatus(owner: string, repo: string): Promise<any> {
  const response = await api.get(`/v1/repos/${owner}/${repo}/graph/sync/status`);
  return response.data;
}

// Diff types
export interface DiffFile {
  path: string;
  oldPath?: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  additions: number;
  deletions: number;
  patch?: string;
}

export interface CompareResponse {
  base: string;
  head: string;
  baseCommit: CommitInfo;
  headCommit: CommitInfo;
  aheadBy: number;
  behindBy: number;
  commits: CommitInfo[];
  files: DiffFile[];
  totalAdditions: number;
  totalDeletions: number;
}

/**
 * Compare two refs (branches, tags, or commits)
 */
export async function compareRefs(
  owner: string,
  repo: string,
  base: string,
  head: string
): Promise<CompareResponse> {
  const response = await api.get(`/v1/repos/${owner}/${repo}/compare/${base}...${head}`);
  return response.data;
}

// Graph visualization types
export interface GraphNode {
  id: string;
  label: string;
  type: 'file' | 'function' | 'class' | 'module' | 'commit';
  path?: string;
  complexity?: number;
  calls?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'calls' | 'imports' | 'inherits' | 'defines' | 'modifies';
}

export interface GraphVisualizationData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
}

/**
 * Get graph visualization data (nodes and edges)
 */
export async function getGraphVisualization(owner: string, repo: string): Promise<GraphVisualizationData> {
  // Get stats
  const statsResponse = await api.get(`/v1/repos/${owner}/${repo}/graph/stats`);
  const stats = statsResponse.data.data as GraphStats;

  // Get all file nodes
  const filesResponse = await api.post(`/v1/repos/${owner}/${repo}/graph/cypher`, {
    query: 'MATCH (f:File) RETURN f.path as path, f.language as language, f.complexity as complexity LIMIT 200'
  });

  // Get all symbol nodes
  const symbolsResponse = await api.post(`/v1/repos/${owner}/${repo}/graph/cypher`, {
    query: 'MATCH (s:Symbol) RETURN s.qualifiedName as name, s.kind as kind, s.file as file, s.complexity as complexity LIMIT 200'
  });

  // Get edges
  const edgesResponse = await api.post(`/v1/repos/${owner}/${repo}/graph/cypher`, {
    query: `
      MATCH (a)-[r]->(b)
      WHERE type(r) IN ['IMPORTS', 'CALLS', 'INHERITS', 'DEFINES']
      RETURN a.path as sourcePath, a.qualifiedName as sourceSymbol,
             b.path as targetPath, b.qualifiedName as targetSymbol,
             type(r) as relType
      LIMIT 500
    `
  });

  // Transform to visualization format
  const nodes: GraphNode[] = [];
  const nodeMap = new Map<string, string>(); // path/name -> id

  // Add file nodes
  const fileResults = filesResponse.data?.data?.results || [];
  fileResults.forEach((f: any, i: number) => {
    const id = `file-${i}`;
    nodes.push({
      id,
      label: f.path?.split('/').pop() || f.path || 'unknown',
      type: 'file',
      path: f.path,
      complexity: f.complexity || 0,
    });
    if (f.path) nodeMap.set(f.path, id);
  });

  // Add symbol nodes
  const symbolResults = symbolsResponse.data?.data?.results || [];
  symbolResults.forEach((s: any, i: number) => {
    const id = `symbol-${i}`;
    const kind = s.kind === 'class' ? 'class' : s.kind === 'function' || s.kind === 'method' ? 'function' : 'module';
    nodes.push({
      id,
      label: s.name?.split('.').pop() || s.name || 'unknown',
      type: kind,
      path: s.file,
      complexity: s.complexity || 0,
    });
    if (s.name) nodeMap.set(s.name, id);
  });

  // Add edges
  const edges: GraphEdge[] = [];
  const edgeResults = edgesResponse.data?.data?.results || [];
  edgeResults.forEach((e: any) => {
    const sourceId = nodeMap.get(e.sourcePath) || nodeMap.get(e.sourceSymbol);
    const targetId = nodeMap.get(e.targetPath) || nodeMap.get(e.targetSymbol);

    if (sourceId && targetId && sourceId !== targetId) {
      edges.push({
        source: sourceId,
        target: targetId,
        type: (e.relType?.toLowerCase() || 'calls') as GraphEdge['type'],
      });
    }
  });

  return { nodes, edges, stats };
}
