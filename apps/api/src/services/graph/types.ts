/**
 * Graph Types
 * Compatible with @cv-git/core for seamless federation
 */

// Node Types
export interface FileNode {
  path: string;
  absolutePath: string;
  language: string;
  lastModified: number;
  size: number;
  gitHash: string;
  linesOfCode: number;
  complexity: number;
}

export interface SymbolNode {
  qualifiedName: string;
  name: string;
  kind: SymbolKind;
  file: string;
  startLine: number;
  endLine: number;
  signature?: string;
  docstring?: string;
  returnType?: string;
  visibility: 'public' | 'private' | 'protected' | 'internal';
  isAsync: boolean;
  isStatic: boolean;
  complexity: number;
  vectorId?: string;
}

export type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'interface'
  | 'type'
  | 'struct'
  | 'enum'
  | 'constant'
  | 'variable';

export interface CommitNode {
  sha: string;
  message: string;
  author: string;
  authorEmail: string;
  committer: string;
  timestamp: number;
  branch: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  vectorId?: string;
  createdAt: number;
}

export interface ModuleNode {
  path: string;
  name: string;
  type: 'package' | 'module' | 'namespace';
  language: string;
  description?: string;
  version?: string;
  fileCount: number;
  symbolCount: number;
}

// Edge Types
export interface ImportsEdge {
  line: number;
  importedSymbols: string[];
  alias?: string;
}

export interface DefinesEdge {
  line: number;
}

export interface CallsEdge {
  line: number;
  callCount: number;
  isConditional: boolean;
}

export interface InheritsEdge {
  type: 'extends' | 'implements';
}

export interface ModifiesEdge {
  changeType: 'added' | 'modified' | 'deleted';
  insertions: number;
  deletions: number;
}

export interface TouchesEdge {
  changeType: 'added' | 'modified' | 'deleted';
  lineDelta: number;
}

// Query Types (cv-git compatible)
export interface GraphQuery {
  type: 'calls' | 'calledBy' | 'imports' | 'importedBy' | 'defines' | 'inherits' | 'path' | 'custom';
  target?: string;
  from?: string;
  to?: string;
  maxDepth?: number;
  cypher?: string;
  params?: Record<string, any>;
}

export interface GraphQueryResult {
  [key: string]: any;
}

export interface GraphStats {
  fileCount: number;
  symbolCount: number;
  functionCount: number;
  classCount: number;
  commitCount: number;
  moduleCount: number;
  relationshipCount: number;
  nodesByLabel?: Record<string, number>;
  relationshipsByType?: Record<string, number>;
}

export interface CallPath {
  path: string[];
  depth: number;
}

export interface SymbolUsage {
  symbol: SymbolNode;
  callers: SymbolNode[];
  callees: SymbolNode[];
  callerCount: number;
  calleeCount: number;
}

// Error Types
export class GraphError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'GraphError';
  }
}
