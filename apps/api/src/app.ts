import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { serveStatic } from '@hono/node-server/serve-static';

import { env } from './config/env';
import { authRoutes } from './routes/auth';
import mfaRoutes from './routes/mfa';
import { oauthRoutes } from './routes/oauth';
import { oauthClientRoutes } from './routes/oauth-clients';
import { apiKeysRoutes } from './routes/api-keys';
import { appStoreRoutes } from './routes/app-store';
import { storageRoutes } from './routes/storage';
import { organizationRoutes } from './routes/organizations';
import { repositoryRoutes } from './routes/repositories';
import { gitRoutes } from './routes/git';
import graphRoutes from './routes/graph';
import cvGitRoutes from './routes/cv-git';
import searchRoutes from './routes/search';
import assistantRoutes from './routes/assistant';
import prRoutes from './routes/pull-requests';
import issueRoutes from './routes/issues';
import { githubOAuthRoutes } from './routes/github-oauth';
import cicdRoutes from './routes/ci-cd';
import { sshKeysRoutes } from './routes/ssh-keys';
import { patRoutes } from './routes/pat';
import { deviceAuthRoutes } from './routes/device-auth';
import { pricingRoutes } from './routes/pricing';
import { stripeRoutes } from './routes/stripe';
import { webhookRoutes } from './routes/webhooks';
import { commitStatusRoutes } from './routes/commit-statuses';
import { forkRoutes } from './routes/forks';
import { notificationRoutes } from './routes/notifications';
import { releaseRoutes } from './routes/releases';
import { tagProtectionRoutes } from './routes/tag-protection';
import { deployKeyRoutes } from './routes/deploy-keys';
import { codeownersRoutes } from './routes/codeowners';
import { autoMergeRoutes } from './routes/auto-merge';
import adminRoutes from './routes/admin';
import { configRoutes } from './routes/config';
import featureFlagsRoutes from './routes/feature-flags';
import { cliApiRoutes } from './routes/cli-api';
import { errorHandler } from './utils/errors';

export type AppVariables = {
  userId?: string;
  sessionId?: string;
  // Feature flags API key context
  flagOrgId?: string;
  flagEnv?: string;
};

export type AppEnv = { Variables: AppVariables };

const app = new Hono<AppEnv>();

// Global middleware
app.use('*', logger());
app.use('*', secureHeaders());
const allowedOrigins = [
  env.APP_URL,
  env.API_URL,
  ...(env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean) ?? []),
];
app.use('*', cors({
  origin: allowedOrigins,
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  exposeHeaders: ['X-CSRF-Token', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
}));

// Serve static files (test OAuth client)
app.use('/test-client.html', serveStatic({ path: './public/test-client.html' }));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// API routes
app.route('/api/auth', authRoutes);
app.route('/api/mfa', mfaRoutes);
app.route('/api/keys', apiKeysRoutes);
app.route('/oauth', oauthRoutes);
app.route('/api/oauth', oauthRoutes); // Also mount at /api/oauth for frontend convenience
app.route('/api/oauth/clients', oauthClientRoutes);

// App Store API (v1)
app.route('/api/v1', appStoreRoutes);

// Organization API (v1)
app.route('/api/v1/orgs', organizationRoutes);

// Repository API (v1)
app.route('/api/v1', repositoryRoutes);

// Git Smart HTTP Protocol (for clone/push)
app.route('/git', gitRoutes);

// Graph API (cv-git compatible)
app.route('/api/v1/repos', graphRoutes);

// CV-Git Integration API (auth, code browsing, discovery)
app.route('/api/v1', cvGitRoutes);

// Federated Search API
app.route('/api/v1', searchRoutes);

// AI Assistant API
app.route('/api/v1', assistantRoutes);

// Pull Request API
app.route('/api/v1', prRoutes);

// Issues API
app.route('/api/v1', issueRoutes);

// Storage API (file uploads/downloads)
app.route('/api/storage', storageRoutes);

// GitHub OAuth (for connecting GitHub accounts)
app.route('/api/github', githubOAuthRoutes);

// CI/CD API (pipelines, runs, MCP tools)
app.route('/api/v1', cicdRoutes);

// SSH Keys API (user key management)
app.route('/api/user/ssh-keys', sshKeysRoutes);

// Personal Access Tokens API (for git/API auth)
app.route('/api/user/tokens', patRoutes);

// Device Authorization API (RFC 8628 - OAuth 2.0 Device Authorization Grant)
app.route('/oauth/device', deviceAuthRoutes);

// Pricing API (tiers, calculator, quotes)
app.route('/api/pricing', pricingRoutes);

// Stripe API (payments, subscriptions)
app.route('/api/stripe', stripeRoutes);

// Webhooks API (outbound event notifications)
app.route('/api/v1', webhookRoutes);

// Commit Status Checks API (CI/CD status reporting)
app.route('/api/v1', commitStatusRoutes);

// Fork API (repository forking)
app.route('/api/v1', forkRoutes);

// Notifications API (in-app notifications)
app.route('/api', notificationRoutes);

// Releases API (repository releases and assets)
app.route('/api/v1', releaseRoutes);

// Tag Protection API
app.route('/api/v1', tagProtectionRoutes);

// Deploy Keys API (per-repository SSH keys)
app.route('/api/v1', deployKeyRoutes);

// CODEOWNERS API
app.route('/api/v1', codeownersRoutes);

// Auto-Merge API (PR auto-merge)
app.route('/api/v1', autoMergeRoutes);

// Admin API (admin-only endpoints, docs, user management)
app.route('/api/admin', adminRoutes);

// Config Management API (environment variables, secrets, configuration)
app.route('/api/v1/config', configRoutes);

// Feature Flags API (feature toggles, segments, targeting)
app.route('/api/v1/flags', featureFlagsRoutes);

// CLI API (CV-Git CLI integration - snake_case responses)
app.route('/v1', cliApiRoutes);

// OpenID Connect discovery (well-known needs to be at root)
app.get('/.well-known/openid-configuration', (c) => {
  const issuer = env.API_URL;

  return c.json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    device_authorization_endpoint: `${issuer}/oauth/device/authorize`,
    userinfo_endpoint: `${issuer}/oauth/userinfo`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    introspection_endpoint: `${issuer}/oauth/introspect`,
    scopes_supported: ['openid', 'profile', 'email', 'offline_access', 'repo:read', 'repo:write', 'repo:admin'],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: [
      'authorization_code',
      'refresh_token',
      'urn:ietf:params:oauth:grant-type:device_code',
    ],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['HS256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    introspection_endpoint_auth_methods_supported: ['client_secret_basic'],
    claims_supported: [
      'sub', 'iss', 'aud', 'exp', 'iat', 'auth_time', 'nonce',
      'name', 'preferred_username', 'picture', 'email', 'email_verified', 'updated_at',
    ],
    code_challenge_methods_supported: ['S256'],
  });
});

// Error handler
app.onError(errorHandler);

// 404 handler
app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Not Found' } }, 404));

export { app };
