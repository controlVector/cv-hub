/**
 * GitHub OAuth Service
 *
 * Handles OAuth flow for connecting GitHub accounts to CV-Hub users.
 * Allows users to import and sync their GitHub repositories.
 */

import { env } from '../config/env';
import { db } from '../db';
import { userConnections } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '../utils/logger';
import crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  html_url: string;
}

interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  clone_url: string;
  default_branch: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  updated_at: string;
  owner: {
    login: string;
    avatar_url: string;
  };
}

export interface ConnectionInfo {
  id: string;
  provider: 'github';
  providerUsername: string | null;
  email: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
  scopes: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

// ============================================================================
// OAuth State Management (using Redis for production, in-memory for dev)
// ============================================================================

const oauthStates = new Map<string, { userId: string; expiresAt: number }>();

function generateState(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function createOAuthState(userId: string): string {
  const state = generateState();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  oauthStates.set(state, { userId, expiresAt });

  // Clean up expired states
  for (const [key, value] of oauthStates.entries()) {
    if (value.expiresAt < Date.now()) {
      oauthStates.delete(key);
    }
  }

  return state;
}

export function validateOAuthState(state: string): string | null {
  const stored = oauthStates.get(state);
  if (!stored) return null;

  oauthStates.delete(state);

  if (stored.expiresAt < Date.now()) return null;

  return stored.userId;
}

// ============================================================================
// GitHub OAuth URLs
// ============================================================================

const GITHUB_OAUTH_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_URL = 'https://api.github.com';

// Scopes we request
const GITHUB_SCOPES = [
  'read:user',      // Read user profile
  'user:email',     // Read user email
  'repo',           // Full repo access (needed for private repos)
].join(' ');

// ============================================================================
// OAuth Flow
// ============================================================================

export function getGitHubAuthUrl(state: string): string {
  if (!env.GITHUB_CLIENT_ID) {
    throw new Error('GitHub OAuth not configured: GITHUB_CLIENT_ID missing');
  }

  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: `${env.API_URL}/api/github/callback`,
    scope: GITHUB_SCOPES,
    state,
    allow_signup: 'false', // User must already have GitHub account
  });

  return `${GITHUB_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string): Promise<GitHubTokenResponse> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    throw new Error('GitHub OAuth not configured');
  }

  const response = await fetch(GITHUB_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: ${response.status}`);
  }

  const data = await response.json() as any;

  if (data.error) {
    throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
  }

  return data as GitHubTokenResponse;
}

export async function getGitHubUser(accessToken: string): Promise<GitHubUser> {
  const response = await fetch(`${GITHUB_API_URL}/user`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'cv-hub',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  return response.json() as Promise<GitHubUser>;
}

// ============================================================================
// Connection Management
// ============================================================================

export async function saveGitHubConnection(
  userId: string,
  tokenResponse: GitHubTokenResponse,
  githubUser: GitHubUser
): Promise<void> {
  const tokenExpiry = tokenResponse.expires_in
    ? new Date(Date.now() + tokenResponse.expires_in * 1000)
    : null;

  // Upsert connection
  const existing = await db.query.userConnections.findFirst({
    where: and(
      eq(userConnections.userId, userId),
      eq(userConnections.provider, 'github')
    ),
  });

  if (existing) {
    await db.update(userConnections)
      .set({
        providerUserId: String(githubUser.id),
        providerUsername: githubUser.login,
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token || null,
        tokenExpiry,
        scopes: tokenResponse.scope,
        email: githubUser.email,
        avatarUrl: githubUser.avatar_url,
        profileUrl: githubUser.html_url,
        isActive: 'true',
        lastUsedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userConnections.id, existing.id));

    logger.info('general', 'Updated GitHub connection', { userId, githubUser: githubUser.login });
  } else {
    await db.insert(userConnections).values({
      userId,
      provider: 'github',
      providerUserId: String(githubUser.id),
      providerUsername: githubUser.login,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      tokenExpiry,
      scopes: tokenResponse.scope,
      email: githubUser.email,
      avatarUrl: githubUser.avatar_url,
      profileUrl: githubUser.html_url,
      isActive: 'true',
      lastUsedAt: new Date(),
    });

    logger.info('general', 'Created GitHub connection', { userId, githubUser: githubUser.login });
  }
}

export async function getGitHubConnection(userId: string): Promise<ConnectionInfo | null> {
  const connection = await db.query.userConnections.findFirst({
    where: and(
      eq(userConnections.userId, userId),
      eq(userConnections.provider, 'github')
    ),
  });

  if (!connection) return null;

  return {
    id: connection.id,
    provider: 'github',
    providerUsername: connection.providerUsername,
    email: connection.email,
    avatarUrl: connection.avatarUrl,
    profileUrl: connection.profileUrl,
    scopes: connection.scopes,
    lastUsedAt: connection.lastUsedAt,
    createdAt: connection.createdAt,
  };
}

export async function disconnectGitHub(userId: string): Promise<boolean> {
  const result = await db.delete(userConnections)
    .where(and(
      eq(userConnections.userId, userId),
      eq(userConnections.provider, 'github')
    ));

  logger.info('general', 'Disconnected GitHub', { userId });
  return true;
}

export async function getGitHubAccessToken(userId: string): Promise<string | null> {
  const connection = await db.query.userConnections.findFirst({
    where: and(
      eq(userConnections.userId, userId),
      eq(userConnections.provider, 'github'),
      eq(userConnections.isActive, 'true')
    ),
  });

  if (!connection) return null;

  // Update last used timestamp
  await db.update(userConnections)
    .set({ lastUsedAt: new Date() })
    .where(eq(userConnections.id, connection.id));

  return connection.accessToken;
}

// ============================================================================
// GitHub API Operations
// ============================================================================

export async function listUserRepos(
  accessToken: string,
  options: {
    page?: number;
    perPage?: number;
    sort?: 'created' | 'updated' | 'pushed' | 'full_name';
    direction?: 'asc' | 'desc';
    type?: 'all' | 'owner' | 'public' | 'private' | 'member';
  } = {}
): Promise<GitHubRepo[]> {
  const params = new URLSearchParams({
    page: String(options.page || 1),
    per_page: String(options.perPage || 30),
    sort: options.sort || 'updated',
    direction: options.direction || 'desc',
    type: options.type || 'owner',
  });

  const response = await fetch(`${GITHUB_API_URL}/user/repos?${params}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'cv-hub',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  return response.json() as Promise<GitHubRepo[]>;
}

export async function getRepo(
  accessToken: string,
  owner: string,
  repo: string
): Promise<GitHubRepo> {
  const response = await fetch(`${GITHUB_API_URL}/repos/${owner}/${repo}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'cv-hub',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  return response.json() as Promise<GitHubRepo>;
}

// ============================================================================
// Check if GitHub OAuth is configured
// ============================================================================

export function isGitHubOAuthConfigured(): boolean {
  return !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
}
