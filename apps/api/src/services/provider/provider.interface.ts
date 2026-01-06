/**
 * Git Provider Interface
 *
 * Abstracts git operations across different providers (local, GitHub, GitLab).
 * Local repos use git-backend.service.ts, while remote providers use their APIs.
 */

export interface ProviderRef {
  name: string;
  sha: string;
  type: 'branch' | 'tag';
  isDefault?: boolean;
}

export interface ProviderTreeEntry {
  name: string;
  path: string;
  type: 'blob' | 'tree' | 'commit';
  mode: string;
  sha: string;
  size?: number;
}

export interface ProviderBlob {
  sha: string;
  content: string;
  encoding: 'utf-8' | 'base64';
  size: number;
  isBinary: boolean;
}

export interface ProviderCommit {
  sha: string;
  message: string;
  author: {
    name: string;
    email: string;
    date: Date;
    username?: string; // Provider username
    avatarUrl?: string;
  };
  committer: {
    name: string;
    email: string;
    date: Date;
    username?: string;
    avatarUrl?: string;
  };
  parents: string[];
  tree: string;
  url?: string; // Link to commit on provider
}

export interface ProviderBranch {
  name: string;
  sha: string;
  isDefault: boolean;
  isProtected: boolean;
  protection?: {
    requireReviews: boolean;
    requiredReviewers: number;
    requireStatusChecks: boolean;
    allowForcePush: boolean;
  };
}

export interface ProviderTag {
  name: string;
  sha: string;
  message?: string;
  tagger?: {
    name: string;
    email: string;
    date: Date;
  };
  releaseUrl?: string;
}

export interface ProviderPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed' | 'merged';
  isDraft: boolean;
  sourceBranch: string;
  targetBranch: string;
  sourceSha: string;
  author: {
    username: string;
    avatarUrl?: string;
  };
  createdAt: Date;
  updatedAt: Date;
  mergedAt?: Date;
  closedAt?: Date;
  url: string;
}

export interface ProviderIssue {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  author: {
    username: string;
    avatarUrl?: string;
  };
  labels: string[];
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date;
  url: string;
}

export interface ProviderRelease {
  id: string;
  tagName: string;
  name: string;
  body: string | null;
  isPrerelease: boolean;
  isDraft: boolean;
  publishedAt: Date;
  author: {
    username: string;
    avatarUrl?: string;
  };
  assets: Array<{
    id: string;
    name: string;
    size: number;
    downloadUrl: string;
    downloadCount: number;
  }>;
  url: string;
}

export interface ProviderRepoInfo {
  name: string;
  fullName: string; // owner/repo
  description: string | null;
  visibility: 'public' | 'internal' | 'private';
  defaultBranch: string;
  language: string | null;
  topics: string[];
  starCount: number;
  forkCount: number;
  watcherCount: number;
  openIssuesCount: number;
  hasIssues: boolean;
  hasPullRequests: boolean;
  hasWiki: boolean;
  isArchived: boolean;
  isFork: boolean;
  createdAt: Date;
  updatedAt: Date;
  pushedAt: Date;
  cloneUrl: string;
  htmlUrl: string;
}

/**
 * Git Provider Interface
 */
export interface GitProvider {
  /**
   * Provider type identifier
   */
  readonly type: 'local' | 'github' | 'gitlab';

  /**
   * Get repository info
   */
  getRepoInfo(): Promise<ProviderRepoInfo>;

  /**
   * Get all refs (branches and tags)
   */
  getRefs(): Promise<ProviderRef[]>;

  /**
   * Get branches with protection info
   */
  getBranches(): Promise<ProviderBranch[]>;

  /**
   * Get tags with release info
   */
  getTags(): Promise<ProviderTag[]>;

  /**
   * Get tree contents at a path
   */
  getTree(ref: string, path?: string): Promise<ProviderTreeEntry[]>;

  /**
   * Get file content
   */
  getBlob(ref: string, path: string): Promise<ProviderBlob>;

  /**
   * Get commit details
   */
  getCommit(sha: string): Promise<ProviderCommit>;

  /**
   * Get commit history
   */
  getCommitHistory(ref: string, options?: {
    limit?: number;
    offset?: number;
    path?: string;
  }): Promise<ProviderCommit[]>;

  /**
   * Get pull requests
   */
  getPullRequests(options?: {
    state?: 'open' | 'closed' | 'all';
    limit?: number;
  }): Promise<ProviderPullRequest[]>;

  /**
   * Get single pull request
   */
  getPullRequest(number: number): Promise<ProviderPullRequest>;

  /**
   * Get issues
   */
  getIssues(options?: {
    state?: 'open' | 'closed' | 'all';
    limit?: number;
  }): Promise<ProviderIssue[]>;

  /**
   * Get single issue
   */
  getIssue(number: number): Promise<ProviderIssue>;

  /**
   * Get releases
   */
  getReleases(options?: {
    limit?: number;
    includePrerelease?: boolean;
  }): Promise<ProviderRelease[]>;

  /**
   * Get latest release
   */
  getLatestRelease(): Promise<ProviderRelease | null>;

  /**
   * Compare two refs
   */
  compare(base: string, head: string): Promise<{
    ahead: number;
    behind: number;
    commits: ProviderCommit[];
  }>;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  type: 'local' | 'github' | 'gitlab';

  // For local repos
  ownerSlug?: string;
  repoSlug?: string;

  // For remote repos
  owner?: string;
  repo?: string;
  accessToken?: string;
  baseUrl?: string; // For self-hosted instances
}
