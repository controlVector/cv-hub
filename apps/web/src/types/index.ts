// Repository types
export interface Repository {
  id: string;
  name: string;
  fullName: string;
  description: string;
  owner: User;
  visibility: 'public' | 'private';
  language: string;
  languages: Record<string, number>;
  stars: number;
  forks: number;
  openIssues: number;
  openPRs: number;
  defaultBranch: string;
  lastUpdated: string;
  createdAt: string;
  aiInsightsEnabled: boolean;
  knowledgeGraphSynced: boolean;
  complexity: number;
  healthScore: number;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  email?: string;
}

// File system types
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  language?: string;
  children?: FileNode[];
}

export interface FileContent {
  path: string;
  content: string;
  language: string;
  size: number;
  lastModified: string;
  complexity?: number;
  symbols?: Symbol[];
}

// Code intelligence types
export interface Symbol {
  name: string;
  type: 'function' | 'class' | 'method' | 'variable' | 'interface' | 'type';
  line: number;
  endLine: number;
  complexity?: number;
  callers?: string[];
  callees?: string[];
}

export interface GraphNode {
  id: string;
  label: string;
  type: 'file' | 'function' | 'class' | 'module';
  path?: string;
  complexity?: number;
  calls?: number;
  calledBy?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'calls' | 'imports' | 'inherits' | 'implements' | 'references';
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Pull Request types
export interface PullRequest {
  id: string;
  number: number;
  title: string;
  description: string;
  author: User;
  status: 'open' | 'closed' | 'merged';
  sourceBranch: string;
  targetBranch: string;
  createdAt: string;
  updatedAt: string;
  reviewers: User[];
  aiReview?: AIReview;
  changedFiles: number;
  additions: number;
  deletions: number;
  comments: number;
  labels: string[];
}

export interface AIReview {
  score: number;
  summary: string;
  issues: AIReviewIssue[];
  suggestions: AIReviewSuggestion[];
  generatedAt: string;
}

export interface AIReviewIssue {
  severity: 'critical' | 'warning' | 'info';
  category: 'security' | 'performance' | 'maintainability' | 'bug' | 'style';
  file: string;
  line: number;
  message: string;
  suggestion?: string;
}

export interface AIReviewSuggestion {
  type: 'refactor' | 'test' | 'documentation' | 'optimization';
  description: string;
  priority: 'high' | 'medium' | 'low';
}

// Commit types
export interface Commit {
  sha: string;
  message: string;
  author: User;
  date: string;
  changedFiles: number;
  additions: number;
  deletions: number;
}

// Branch types
export interface Branch {
  name: string;
  commit: string;
  isDefault: boolean;
  isProtected: boolean;
  aheadBehind?: {
    ahead: number;
    behind: number;
  };
}

// AI Assistant types
export interface AIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  context?: AIContext;
}

export interface AIContext {
  type: 'explain' | 'find' | 'review' | 'do';
  target?: string;
  files?: string[];
  graphData?: KnowledgeGraph;
}

export interface AICommand {
  type: 'explain' | 'find' | 'review' | 'do' | 'graph';
  query: string;
  options?: Record<string, unknown>;
}

// Search types
export interface SearchResult {
  type: 'code' | 'file' | 'symbol' | 'commit' | 'pr';
  score: number;
  path?: string;
  line?: number;
  content?: string;
  highlight?: string;
  repository?: string;
}

export interface SemanticSearchQuery {
  query: string;
  type?: 'code' | 'symbol' | 'all';
  repository?: string;
  language?: string;
  limit?: number;
}

// Dashboard types
export interface DashboardStats {
  totalRepositories: number;
  totalCommits: number;
  totalPRs: number;
  totalIssues: number;
  aiOperationsUsed: number;
  aiOperationsLimit: number;
}

export interface ActivityItem {
  id: string;
  type: 'commit' | 'pr' | 'issue' | 'review' | 'ai_operation';
  repository: string;
  title: string;
  description: string;
  timestamp: string;
  user: User;
}

export interface AIInsight {
  type: 'hotspot' | 'dead_code' | 'complexity' | 'cycle' | 'security';
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  file?: string;
  line?: number;
  recommendation: string;
}

// Settings types
export interface UserSettings {
  theme: 'dark' | 'light' | 'system';
  editorFontSize: number;
  tabSize: number;
  aiModel: string;
  defaultBranch: string;
  notifications: NotificationSettings;
}

export interface NotificationSettings {
  email: boolean;
  prReviews: boolean;
  mentions: boolean;
  aiInsights: boolean;
}
