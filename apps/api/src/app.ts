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
import { errorHandler } from './utils/errors';

export type AppVariables = {
  userId?: string;
  sessionId?: string;
};

export type AppEnv = { Variables: AppVariables };

const app = new Hono<AppEnv>();

// Global middleware
app.use('*', logger());
app.use('*', secureHeaders());
app.use('*', cors({
  origin: [env.APP_URL, env.API_URL], // Allow both frontend and API origin (for test client)
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
app.route('/api/oauth/clients', oauthClientRoutes);

// OpenID Connect discovery (well-known needs to be at root)
app.get('/.well-known/openid-configuration', (c) => {
  const issuer = env.API_URL;

  return c.json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    userinfo_endpoint: `${issuer}/oauth/userinfo`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    introspection_endpoint: `${issuer}/oauth/introspect`,
    scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['HS256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
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
