/**
 * GitHub OAuth Routes
 *
 * Handles GitHub OAuth flow for connecting GitHub accounts.
 *
 * Routes:
 * - GET /api/github/connect - Start OAuth flow (requires auth)
 * - GET /api/github/callback - OAuth callback
 * - GET /api/github/status - Check connection status
 * - DELETE /api/github/disconnect - Remove connection
 * - GET /api/github/repos - List user's GitHub repos
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import {
  isGitHubOAuthConfigured,
  createOAuthState,
  validateOAuthState,
  getGitHubAuthUrl,
  exchangeCodeForToken,
  getGitHubUser,
  saveGitHubConnection,
  getGitHubConnection,
  disconnectGitHub,
  getGitHubAccessToken,
  listUserRepos,
} from '../services/github-oauth.service';
import { logger } from '../utils/logger';

import type { AppEnv } from '../app';

const github = new Hono<AppEnv>();

// ============================================================================
// GET /github/connect - Start GitHub OAuth flow
// ============================================================================

github.get('/connect', requireAuth, async (c) => {
  const userId = c.get('userId')!;

  if (!isGitHubOAuthConfigured()) {
    return c.json({
      error: 'GitHub OAuth not configured',
      message: 'Contact administrator to configure GitHub integration',
    }, 501);
  }

  // Create state for CSRF protection
  const state = createOAuthState(userId);

  // Redirect to GitHub
  const authUrl = getGitHubAuthUrl(state);

  logger.info('general', 'Starting GitHub OAuth flow', { userId });

  return c.json({ authUrl });
});

// ============================================================================
// GET /github/callback - OAuth callback from GitHub
// ============================================================================

const callbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

github.get('/callback', zValidator('query', callbackSchema), async (c) => {
  const { code, state } = c.req.valid('query');

  // Validate state and get user ID
  const userId = validateOAuthState(state);
  if (!userId) {
    logger.warn('general', 'Invalid OAuth state', { state: state.substring(0, 8) + '...' });
    // Redirect to frontend with error
    return c.redirect(`${env.APP_URL}/dashboard/settings/connections?error=invalid_state`);
  }

  try {
    // Exchange code for token
    const tokenResponse = await exchangeCodeForToken(code);

    // Get GitHub user info
    const githubUser = await getGitHubUser(tokenResponse.access_token);

    // Save connection
    await saveGitHubConnection(userId, tokenResponse, githubUser);

    logger.info('general', 'GitHub OAuth successful', {
      userId,
      githubUser: githubUser.login,
    });

    // Redirect to frontend success page
    return c.redirect(`${env.APP_URL}/dashboard/settings/connections?success=github`);
  } catch (error) {
    logger.error('general', 'GitHub OAuth callback failed', error as Error);
    return c.redirect(`${env.APP_URL}/dashboard/settings/connections?error=oauth_failed`);
  }
});

// ============================================================================
// GET /github/status - Check GitHub connection status
// ============================================================================

github.get('/status', requireAuth, async (c) => {
  const userId = c.get('userId')!;

  if (!isGitHubOAuthConfigured()) {
    return c.json({
      configured: false,
      connected: false,
    });
  }

  const connection = await getGitHubConnection(userId);

  return c.json({
    configured: true,
    connected: !!connection,
    connection: connection || undefined,
  });
});

// ============================================================================
// DELETE /github/disconnect - Remove GitHub connection
// ============================================================================

github.delete('/disconnect', requireAuth, async (c) => {
  const userId = c.get('userId')!;

  await disconnectGitHub(userId);

  return c.json({ success: true, message: 'GitHub disconnected' });
});

// ============================================================================
// GET /github/repos - List user's GitHub repositories
// ============================================================================

const listReposSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(30),
  type: z.enum(['all', 'owner', 'public', 'private', 'member']).default('owner'),
  sort: z.enum(['created', 'updated', 'pushed', 'full_name']).default('updated'),
});

github.get('/repos', requireAuth, zValidator('query', listReposSchema), async (c) => {
  const userId = c.get('userId')!;
  const query = c.req.valid('query');

  const accessToken = await getGitHubAccessToken(userId);
  if (!accessToken) {
    return c.json({
      error: 'GitHub not connected',
      message: 'Connect your GitHub account first',
    }, 401);
  }

  try {
    const repos = await listUserRepos(accessToken, {
      page: query.page,
      perPage: query.per_page,
      type: query.type,
      sort: query.sort,
    });

    return c.json({
      repos: repos.map(repo => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description,
        private: repo.private,
        htmlUrl: repo.html_url,
        cloneUrl: repo.clone_url,
        defaultBranch: repo.default_branch,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        openIssues: repo.open_issues_count,
        language: repo.language,
        updatedAt: repo.updated_at,
        owner: {
          login: repo.owner.login,
          avatarUrl: repo.owner.avatar_url,
        },
      })),
      page: query.page,
      perPage: query.per_page,
    });
  } catch (error) {
    logger.error('general', 'Failed to list GitHub repos', error as Error);
    return c.json({
      error: 'Failed to list repositories',
      message: (error as Error).message,
    }, 500);
  }
});

export { github as githubOAuthRoutes };
