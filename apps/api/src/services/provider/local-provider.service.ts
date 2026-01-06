import type {
  GitProvider,
  ProviderRef,
  ProviderTreeEntry,
  ProviderBlob,
  ProviderCommit,
  ProviderBranch,
  ProviderTag,
  ProviderPullRequest,
  ProviderIssue,
  ProviderRelease,
  ProviderRepoInfo,
} from './provider.interface';
import * as gitBackend from '../git/git-backend.service';

interface LocalProviderOptions {
  ownerSlug: string;
  repoSlug: string;
}

/**
 * Local Provider
 *
 * Implements GitProvider interface for local bare repositories.
 * Wraps git-backend.service.ts functions.
 */
export class LocalProvider implements GitProvider {
  readonly type = 'local' as const;

  private ownerSlug: string;
  private repoSlug: string;

  constructor(options: LocalProviderOptions) {
    this.ownerSlug = options.ownerSlug;
    this.repoSlug = options.repoSlug;
  }

  async getRepoInfo(): Promise<ProviderRepoInfo> {
    const stats = await gitBackend.getRepoStats(this.ownerSlug, this.repoSlug);
    const refs = await this.getRefs();
    const defaultBranch = refs.find(r => r.isDefault)?.name || 'main';

    return {
      name: this.repoSlug,
      fullName: `${this.ownerSlug}/${this.repoSlug}`,
      description: null,
      visibility: 'private', // Local repos need DB check for actual visibility
      defaultBranch,
      language: null,
      topics: [],
      starCount: 0,
      forkCount: 0,
      watcherCount: 0,
      openIssuesCount: 0,
      hasIssues: true,
      hasPullRequests: true,
      hasWiki: false,
      isArchived: false,
      isFork: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      pushedAt: new Date(),
      cloneUrl: `${this.ownerSlug}/${this.repoSlug}.git`,
      htmlUrl: `/${this.ownerSlug}/${this.repoSlug}`,
    };
  }

  async getRefs(): Promise<ProviderRef[]> {
    return gitBackend.getRefs(this.ownerSlug, this.repoSlug);
  }

  async getBranches(): Promise<ProviderBranch[]> {
    const refs = await this.getRefs();

    return refs
      .filter(r => r.type === 'branch')
      .map(r => ({
        name: r.name,
        sha: r.sha,
        isDefault: r.isDefault || false,
        isProtected: false, // Local repos don't have branch protection yet
      }));
  }

  async getTags(): Promise<ProviderTag[]> {
    const refs = await this.getRefs();

    return refs
      .filter(r => r.type === 'tag')
      .map(r => ({
        name: r.name,
        sha: r.sha,
      }));
  }

  async getTree(ref: string, path = ''): Promise<ProviderTreeEntry[]> {
    const entries = await gitBackend.getTree(this.ownerSlug, this.repoSlug, ref, path);

    return entries.map(e => ({
      name: e.name,
      path: e.path,
      type: e.type,
      mode: e.mode,
      sha: e.sha,
      size: e.size,
    }));
  }

  async getBlob(ref: string, path: string): Promise<ProviderBlob> {
    return gitBackend.getBlob(this.ownerSlug, this.repoSlug, ref, path);
  }

  async getCommit(sha: string): Promise<ProviderCommit> {
    const commit = await gitBackend.getCommit(this.ownerSlug, this.repoSlug, sha);

    return {
      sha: commit.sha,
      message: commit.message,
      author: {
        name: commit.author.name,
        email: commit.author.email,
        date: commit.author.date,
      },
      committer: {
        name: commit.committer.name,
        email: commit.committer.email,
        date: commit.committer.date,
      },
      parents: commit.parents,
      tree: commit.tree,
    };
  }

  async getCommitHistory(ref: string, options: {
    limit?: number;
    offset?: number;
    path?: string;
  } = {}): Promise<ProviderCommit[]> {
    const commits = await gitBackend.getCommitHistory(
      this.ownerSlug,
      this.repoSlug,
      ref,
      options
    );

    return commits.map(c => ({
      sha: c.sha,
      message: c.message,
      author: {
        name: c.author.name,
        email: c.author.email,
        date: c.author.date,
      },
      committer: {
        name: c.committer.name,
        email: c.committer.email,
        date: c.committer.date,
      },
      parents: c.parents,
      tree: c.tree,
    }));
  }

  async getPullRequests(_options?: {
    state?: 'open' | 'closed' | 'all';
    limit?: number;
  }): Promise<ProviderPullRequest[]> {
    // Local repos store PRs in the database, not git
    // This would need to query the database
    return [];
  }

  async getPullRequest(_number: number): Promise<ProviderPullRequest> {
    throw new Error('Pull requests are stored in database for local repos');
  }

  async getIssues(_options?: {
    state?: 'open' | 'closed' | 'all';
    limit?: number;
  }): Promise<ProviderIssue[]> {
    // Local repos store issues in the database, not git
    return [];
  }

  async getIssue(_number: number): Promise<ProviderIssue> {
    throw new Error('Issues are stored in database for local repos');
  }

  async getReleases(_options?: {
    limit?: number;
    includePrerelease?: boolean;
  }): Promise<ProviderRelease[]> {
    // Local repos store releases in the database, linked to tags
    return [];
  }

  async getLatestRelease(): Promise<ProviderRelease | null> {
    // Would need to query database
    return null;
  }

  async compare(base: string, head: string): Promise<{
    ahead: number;
    behind: number;
    commits: ProviderCommit[];
  }> {
    const diff = await gitBackend.getDiff(this.ownerSlug, this.repoSlug, base, head);

    // Get commits between base and head
    const commits = await gitBackend.getCommitHistory(
      this.ownerSlug,
      this.repoSlug,
      head,
      { limit: 100 }
    );

    // Find where base and head diverge
    const baseCommit = await gitBackend.getCommit(this.ownerSlug, this.repoSlug, base);
    const aheadCommits: ProviderCommit[] = [];

    for (const c of commits) {
      if (c.sha === baseCommit.sha) break;
      aheadCommits.push({
        sha: c.sha,
        message: c.message,
        author: {
          name: c.author.name,
          email: c.author.email,
          date: c.author.date,
        },
        committer: {
          name: c.committer.name,
          email: c.committer.email,
          date: c.committer.date,
        },
        parents: c.parents,
        tree: c.tree,
      });
    }

    return {
      ahead: aheadCommits.length,
      behind: 0, // Would need more complex git rev-list calculation
      commits: aheadCommits,
    };
  }
}
