import type { GitProvider, ProviderConfig } from './provider.interface';
import { GitHubProvider } from './github-provider.service';
import { LocalProvider } from './local-provider.service';

/**
 * Create a GitProvider instance based on configuration
 */
export function createProvider(config: ProviderConfig): GitProvider {
  switch (config.type) {
    case 'local':
      if (!config.ownerSlug || !config.repoSlug) {
        throw new Error('Local provider requires ownerSlug and repoSlug');
      }
      return new LocalProvider({
        ownerSlug: config.ownerSlug,
        repoSlug: config.repoSlug,
      });

    case 'github':
      if (!config.owner || !config.repo) {
        throw new Error('GitHub provider requires owner and repo');
      }
      return new GitHubProvider({
        owner: config.owner,
        repo: config.repo,
        accessToken: config.accessToken,
        baseUrl: config.baseUrl,
      });

    case 'gitlab':
      throw new Error('GitLab provider not yet implemented');

    default:
      throw new Error(`Unknown provider type: ${config.type}`);
  }
}

/**
 * Create a provider from a repository record
 */
export function createProviderFromRepo(repo: {
  provider: 'local' | 'github' | 'gitlab';
  externalOwner: string | null;
  externalRepo: string | null;
  externalToken: string | null;
  externalBaseUrl: string | null;
  slug: string;
  // Need owner info for local repos
  organization?: { slug: string } | null;
  user?: { username: string } | null;
}): GitProvider {
  if (repo.provider === 'local') {
    const ownerSlug = repo.organization?.slug || repo.user?.username;
    if (!ownerSlug) {
      throw new Error('Local repo must have an organization or user owner');
    }
    return createProvider({
      type: 'local',
      ownerSlug,
      repoSlug: repo.slug,
    });
  }

  if (repo.provider === 'github') {
    if (!repo.externalOwner || !repo.externalRepo) {
      throw new Error('GitHub repo must have external owner and repo');
    }
    return createProvider({
      type: 'github',
      owner: repo.externalOwner,
      repo: repo.externalRepo,
      accessToken: repo.externalToken || undefined,
      baseUrl: repo.externalBaseUrl || undefined,
    });
  }

  throw new Error(`Unsupported provider: ${repo.provider}`);
}
