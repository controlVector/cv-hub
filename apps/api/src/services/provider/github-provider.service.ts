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

interface GitHubApiOptions {
  owner: string;
  repo: string;
  accessToken?: string;
  baseUrl?: string;
}

/**
 * GitHub Provider
 *
 * Implements GitProvider interface for GitHub repositories.
 * Uses GitHub REST API for all operations.
 */
export class GitHubProvider implements GitProvider {
  readonly type = 'github' as const;

  private owner: string;
  private repo: string;
  private accessToken: string | undefined;
  private baseUrl: string;

  constructor(options: GitHubApiOptions) {
    this.owner = options.owner;
    this.repo = options.repo;
    this.accessToken = options.accessToken;
    this.baseUrl = options.baseUrl || 'https://api.github.com';
  }

  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'CV-Hub/1.0',
      ...options.headers as Record<string, string>,
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error: ${response.status} ${error}`);
    }

    return response.json() as Promise<T>;
  }

  async getRepoInfo(): Promise<ProviderRepoInfo> {
    const data = await this.fetch<any>(`/repos/${this.owner}/${this.repo}`);

    return {
      name: data.name,
      fullName: data.full_name,
      description: data.description,
      visibility: data.visibility || (data.private ? 'private' : 'public'),
      defaultBranch: data.default_branch,
      language: data.language,
      topics: data.topics || [],
      starCount: data.stargazers_count,
      forkCount: data.forks_count,
      watcherCount: data.subscribers_count,
      openIssuesCount: data.open_issues_count,
      hasIssues: data.has_issues,
      hasPullRequests: true, // GitHub always has PRs
      hasWiki: data.has_wiki,
      isArchived: data.archived,
      isFork: data.fork,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
      pushedAt: new Date(data.pushed_at),
      cloneUrl: data.clone_url,
      htmlUrl: data.html_url,
    };
  }

  async getRefs(): Promise<ProviderRef[]> {
    const refs: ProviderRef[] = [];

    // Get branches
    const branches = await this.getBranches();
    for (const branch of branches) {
      refs.push({
        name: branch.name,
        sha: branch.sha,
        type: 'branch',
        isDefault: branch.isDefault,
      });
    }

    // Get tags
    const tags = await this.getTags();
    for (const tag of tags) {
      refs.push({
        name: tag.name,
        sha: tag.sha,
        type: 'tag',
      });
    }

    return refs;
  }

  async getBranches(): Promise<ProviderBranch[]> {
    const [repoData, branchesData] = await Promise.all([
      this.fetch<any>(`/repos/${this.owner}/${this.repo}`),
      this.fetch<any[]>(`/repos/${this.owner}/${this.repo}/branches?per_page=100`),
    ]);

    return branchesData.map((b) => ({
      name: b.name,
      sha: b.commit.sha,
      isDefault: b.name === repoData.default_branch,
      isProtected: b.protected,
      protection: b.protection ? {
        requireReviews: b.protection.required_pull_request_reviews?.required_approving_review_count > 0,
        requiredReviewers: b.protection.required_pull_request_reviews?.required_approving_review_count || 0,
        requireStatusChecks: !!b.protection.required_status_checks,
        allowForcePush: b.protection.allow_force_pushes?.enabled || false,
      } : undefined,
    }));
  }

  async getTags(): Promise<ProviderTag[]> {
    const tagsData = await this.fetch<any[]>(
      `/repos/${this.owner}/${this.repo}/tags?per_page=100`
    );

    const tags: ProviderTag[] = [];

    for (const tag of tagsData) {
      const tagInfo: ProviderTag = {
        name: tag.name,
        sha: tag.commit.sha,
      };

      // Try to get annotated tag info
      try {
        const tagObj = await this.fetch<any>(
          `/repos/${this.owner}/${this.repo}/git/tags/${tag.commit.sha}`
        ).catch(() => null);

        if (tagObj && tagObj.object?.type === 'tag') {
          tagInfo.message = tagObj.message;
          if (tagObj.tagger) {
            tagInfo.tagger = {
              name: tagObj.tagger.name,
              email: tagObj.tagger.email,
              date: new Date(tagObj.tagger.date),
            };
          }
        }
      } catch {
        // Not an annotated tag
      }

      tags.push(tagInfo);
    }

    return tags;
  }

  async getTree(ref: string, path = ''): Promise<ProviderTreeEntry[]> {
    const endpoint = path
      ? `/repos/${this.owner}/${this.repo}/contents/${path}?ref=${ref}`
      : `/repos/${this.owner}/${this.repo}/contents?ref=${ref}`;

    const data = await this.fetch<any[]>(endpoint);

    return data.map((item): ProviderTreeEntry => ({
      name: item.name,
      path: item.path,
      type: item.type === 'dir' ? 'tree' : item.type === 'submodule' ? 'commit' : 'blob',
      mode: item.type === 'dir' ? '040000' : '100644',
      sha: item.sha,
      size: item.size,
    })).sort((a, b) => {
      if (a.type === 'tree' && b.type !== 'tree') return -1;
      if (a.type !== 'tree' && b.type === 'tree') return 1;
      return a.name.localeCompare(b.name);
    });
  }

  async getBlob(ref: string, path: string): Promise<ProviderBlob> {
    const data = await this.fetch<any>(
      `/repos/${this.owner}/${this.repo}/contents/${path}?ref=${ref}`
    );

    if (data.type !== 'file') {
      throw new Error(`Path is not a file: ${path}`);
    }

    const isBinary = data.encoding !== 'base64' ||
      /\.(png|jpg|jpeg|gif|ico|pdf|zip|tar|gz|exe|dll|so|dylib)$/i.test(path);

    if (isBinary) {
      return {
        sha: data.sha,
        content: data.content,
        encoding: 'base64',
        size: data.size,
        isBinary: true,
      };
    }

    // Decode base64 content
    const content = Buffer.from(data.content, 'base64').toString('utf-8');

    return {
      sha: data.sha,
      content,
      encoding: 'utf-8',
      size: data.size,
      isBinary: false,
    };
  }

  async getCommit(sha: string): Promise<ProviderCommit> {
    const data = await this.fetch<any>(
      `/repos/${this.owner}/${this.repo}/commits/${sha}`
    );

    return {
      sha: data.sha,
      message: data.commit.message,
      author: {
        name: data.commit.author.name,
        email: data.commit.author.email,
        date: new Date(data.commit.author.date),
        username: data.author?.login,
        avatarUrl: data.author?.avatar_url,
      },
      committer: {
        name: data.commit.committer.name,
        email: data.commit.committer.email,
        date: new Date(data.commit.committer.date),
        username: data.committer?.login,
        avatarUrl: data.committer?.avatar_url,
      },
      parents: data.parents.map((p: any) => p.sha),
      tree: data.commit.tree.sha,
      url: data.html_url,
    };
  }

  async getCommitHistory(ref: string, options: {
    limit?: number;
    offset?: number;
    path?: string;
  } = {}): Promise<ProviderCommit[]> {
    const { limit = 30, offset = 0, path } = options;
    const page = Math.floor(offset / limit) + 1;

    let endpoint = `/repos/${this.owner}/${this.repo}/commits?sha=${ref}&per_page=${limit}&page=${page}`;
    if (path) {
      endpoint += `&path=${encodeURIComponent(path)}`;
    }

    const data = await this.fetch<any[]>(endpoint);

    return data.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      author: {
        name: c.commit.author.name,
        email: c.commit.author.email,
        date: new Date(c.commit.author.date),
        username: c.author?.login,
        avatarUrl: c.author?.avatar_url,
      },
      committer: {
        name: c.commit.committer.name,
        email: c.commit.committer.email,
        date: new Date(c.commit.committer.date),
        username: c.committer?.login,
        avatarUrl: c.committer?.avatar_url,
      },
      parents: c.parents.map((p: any) => p.sha),
      tree: c.commit.tree.sha,
      url: c.html_url,
    }));
  }

  async getPullRequests(options: {
    state?: 'open' | 'closed' | 'all';
    limit?: number;
  } = {}): Promise<ProviderPullRequest[]> {
    const { state = 'open', limit = 30 } = options;

    const data = await this.fetch<any[]>(
      `/repos/${this.owner}/${this.repo}/pulls?state=${state}&per_page=${limit}`
    );

    return data.map((pr) => ({
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.merged_at ? 'merged' : pr.state as 'open' | 'closed',
      isDraft: pr.draft,
      sourceBranch: pr.head.ref,
      targetBranch: pr.base.ref,
      sourceSha: pr.head.sha,
      author: {
        username: pr.user.login,
        avatarUrl: pr.user.avatar_url,
      },
      createdAt: new Date(pr.created_at),
      updatedAt: new Date(pr.updated_at),
      mergedAt: pr.merged_at ? new Date(pr.merged_at) : undefined,
      closedAt: pr.closed_at ? new Date(pr.closed_at) : undefined,
      url: pr.html_url,
    }));
  }

  async getPullRequest(number: number): Promise<ProviderPullRequest> {
    const pr = await this.fetch<any>(
      `/repos/${this.owner}/${this.repo}/pulls/${number}`
    );

    return {
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.merged_at ? 'merged' : pr.state as 'open' | 'closed',
      isDraft: pr.draft,
      sourceBranch: pr.head.ref,
      targetBranch: pr.base.ref,
      sourceSha: pr.head.sha,
      author: {
        username: pr.user.login,
        avatarUrl: pr.user.avatar_url,
      },
      createdAt: new Date(pr.created_at),
      updatedAt: new Date(pr.updated_at),
      mergedAt: pr.merged_at ? new Date(pr.merged_at) : undefined,
      closedAt: pr.closed_at ? new Date(pr.closed_at) : undefined,
      url: pr.html_url,
    };
  }

  async getIssues(options: {
    state?: 'open' | 'closed' | 'all';
    limit?: number;
  } = {}): Promise<ProviderIssue[]> {
    const { state = 'open', limit = 30 } = options;

    const data = await this.fetch<any[]>(
      `/repos/${this.owner}/${this.repo}/issues?state=${state}&per_page=${limit}`
    );

    // Filter out pull requests (GitHub returns PRs as issues)
    return data
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state as 'open' | 'closed',
        author: {
          username: issue.user.login,
          avatarUrl: issue.user.avatar_url,
        },
        labels: issue.labels.map((l: any) => l.name),
        createdAt: new Date(issue.created_at),
        updatedAt: new Date(issue.updated_at),
        closedAt: issue.closed_at ? new Date(issue.closed_at) : undefined,
        url: issue.html_url,
      }));
  }

  async getIssue(number: number): Promise<ProviderIssue> {
    const issue = await this.fetch<any>(
      `/repos/${this.owner}/${this.repo}/issues/${number}`
    );

    return {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state as 'open' | 'closed',
      author: {
        username: issue.user.login,
        avatarUrl: issue.user.avatar_url,
      },
      labels: issue.labels.map((l: any) => l.name),
      createdAt: new Date(issue.created_at),
      updatedAt: new Date(issue.updated_at),
      closedAt: issue.closed_at ? new Date(issue.closed_at) : undefined,
      url: issue.html_url,
    };
  }

  async getReleases(options: {
    limit?: number;
    includePrerelease?: boolean;
  } = {}): Promise<ProviderRelease[]> {
    const { limit = 30, includePrerelease = true } = options;

    const data = await this.fetch<any[]>(
      `/repos/${this.owner}/${this.repo}/releases?per_page=${limit}`
    );

    return data
      .filter((r) => includePrerelease || !r.prerelease)
      .filter((r) => !r.draft)
      .map((r) => ({
        id: String(r.id),
        tagName: r.tag_name,
        name: r.name || r.tag_name,
        body: r.body,
        isPrerelease: r.prerelease,
        isDraft: r.draft,
        publishedAt: new Date(r.published_at),
        author: {
          username: r.author.login,
          avatarUrl: r.author.avatar_url,
        },
        assets: r.assets.map((a: any) => ({
          id: String(a.id),
          name: a.name,
          size: a.size,
          downloadUrl: a.browser_download_url,
          downloadCount: a.download_count,
        })),
        url: r.html_url,
      }));
  }

  async getLatestRelease(): Promise<ProviderRelease | null> {
    try {
      const r = await this.fetch<any>(
        `/repos/${this.owner}/${this.repo}/releases/latest`
      );

      return {
        id: String(r.id),
        tagName: r.tag_name,
        name: r.name || r.tag_name,
        body: r.body,
        isPrerelease: r.prerelease,
        isDraft: r.draft,
        publishedAt: new Date(r.published_at),
        author: {
          username: r.author.login,
          avatarUrl: r.author.avatar_url,
        },
        assets: r.assets.map((a: any) => ({
          id: String(a.id),
          name: a.name,
          size: a.size,
          downloadUrl: a.browser_download_url,
          downloadCount: a.download_count,
        })),
        url: r.html_url,
      };
    } catch {
      return null;
    }
  }

  async compare(base: string, head: string): Promise<{
    ahead: number;
    behind: number;
    commits: ProviderCommit[];
  }> {
    const data = await this.fetch<any>(
      `/repos/${this.owner}/${this.repo}/compare/${base}...${head}`
    );

    return {
      ahead: data.ahead_by,
      behind: data.behind_by,
      commits: data.commits.map((c: any) => ({
        sha: c.sha,
        message: c.commit.message,
        author: {
          name: c.commit.author.name,
          email: c.commit.author.email,
          date: new Date(c.commit.author.date),
          username: c.author?.login,
          avatarUrl: c.author?.avatar_url,
        },
        committer: {
          name: c.commit.committer.name,
          email: c.commit.committer.email,
          date: new Date(c.commit.committer.date),
          username: c.committer?.login,
          avatarUrl: c.committer?.avatar_url,
        },
        parents: c.parents.map((p: any) => p.sha),
        tree: c.commit.tree.sha,
        url: c.html_url,
      })),
    };
  }
}
