/**
 * Device Auth Routes Tests
 * Tests device auth routing (dual mount at /oauth/device and /api/oauth/device)
 * and /auth/me organization enrichment.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock env before anything else ───────────────────────────────────
vi.mock('../config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://test:test@localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'test-access-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
    CSRF_SECRET: 'test-csrf-secret',
    API_URL: 'https://api.test.io',
    APP_URL: 'https://test.io',
    NODE_ENV: 'test',
  },
}));

// ── Mock services ───────────────────────────────────────────────────
vi.mock('../services/device-auth.service', () => ({
  createDeviceAuthorization: vi.fn(),
  getDeviceAuthByUserCode: vi.fn(),
  verifyUserCode: vi.fn(),
  CV_HUB_SCOPES: {
    'repo:read': 'Clone and fetch repositories',
    'repo:write': 'Push to repositories',
    profile: 'Access your profile information',
    offline_access: 'Stay connected (refresh token)',
  },
  DEFAULT_CLI_SCOPES: ['repo:read', 'repo:write', 'profile', 'offline_access'],
}));

vi.mock('../services/audit.service', () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock('../services/user.service', () => ({
  getUserById: vi.fn(),
}));

vi.mock('../services/organization.service', () => ({
  getUserOrganizations: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireAuth: async (c: any, next: () => Promise<void>) => {
    c.set('userId', 'test-user-id');
    return next();
  },
}));

vi.mock('../middleware/rate-limit', () => ({
  strictRateLimiter: async (_c: any, next: () => Promise<void>) => next(),
}));

import { Hono } from 'hono';
import { deviceAuthRoutes } from './device-auth';
import { authRoutes } from './auth';
import {
  createDeviceAuthorization,
  getDeviceAuthByUserCode,
  verifyUserCode,
} from '../services/device-auth.service';
import { getUserById } from '../services/user.service';
import { getUserOrganizations } from '../services/organization.service';

// ── Test app with both mount points ─────────────────────────────────
const app = new Hono();
app.route('/oauth/device', deviceAuthRoutes);
app.route('/api/oauth/device', deviceAuthRoutes);
app.route('/api/auth', authRoutes);

describe('Device Auth Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Device code generation ──────────────────────────────────────
  describe('POST /oauth/device/authorize', () => {
    it('returns device code at /oauth/device/authorize', async () => {
      (createDeviceAuthorization as any).mockResolvedValue({
        device_code: 'dc-test',
        user_code: 'ABCD-1234',
        verification_uri: 'https://hub.controlvector.io/device',
        verification_uri_complete: 'https://hub.controlvector.io/device?code=ABCD-1234',
        expires_in: 900,
        interval: 5,
      });

      const res = await app.request('/oauth/device/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'client_id=cv-git-cli&scope=repo:read repo:write',
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.user_code).toBe('ABCD-1234');
      expect(data.device_code).toBe('dc-test');
    });

    it('returns device code at /api/oauth/device/authorize (frontend path)', async () => {
      (createDeviceAuthorization as any).mockResolvedValue({
        device_code: 'dc-test-2',
        user_code: 'WXYZ-5678',
        verification_uri: 'https://hub.controlvector.io/device',
        verification_uri_complete: 'https://hub.controlvector.io/device?code=WXYZ-5678',
        expires_in: 900,
        interval: 5,
      });

      const res = await app.request('/api/oauth/device/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'client_id=cv-git-cli&scope=repo:read',
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.user_code).toBe('WXYZ-5678');
    });

    it('returns 400 for error from service', async () => {
      (createDeviceAuthorization as any).mockResolvedValue({
        error: 'invalid_client',
        error_description: 'Unknown client',
      });

      const res = await app.request('/oauth/device/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'client_id=bad-client',
      });
      expect(res.status).toBe(400);
    });
  });

  // ── Device status lookup ────────────────────────────────────────
  describe('GET /oauth/device/status', () => {
    it('returns status at /oauth/device/status', async () => {
      (getDeviceAuthByUserCode as any).mockResolvedValue({
        found: true,
        expired: false,
        status: 'pending',
        clientName: 'cv-git CLI',
        clientId: 'cv-git-cli',
        scopes: ['repo:read', 'repo:write'],
      });

      const res = await app.request('/oauth/device/status?code=ABCD-1234');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.client_name).toBe('cv-git CLI');
      expect(data.scopes).toContain('repo:read');
    });

    it('returns status at /api/oauth/device/status (frontend path)', async () => {
      (getDeviceAuthByUserCode as any).mockResolvedValue({
        found: true,
        expired: false,
        status: 'pending',
        clientName: 'cv-git CLI',
        clientId: 'cv-git-cli',
        scopes: ['profile'],
      });

      const res = await app.request('/api/oauth/device/status?code=WXYZ-5678');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.client_name).toBe('cv-git CLI');
    });

    it('returns 404 for invalid code', async () => {
      (getDeviceAuthByUserCode as any).mockResolvedValue({ found: false });
      const res = await app.request('/oauth/device/status?code=XXXX-YYYY');
      expect(res.status).toBe(404);
    });

    it('returns 410 for expired code', async () => {
      (getDeviceAuthByUserCode as any).mockResolvedValue({ found: true, expired: true });
      const res = await app.request('/oauth/device/status?code=XXXX-YYYY');
      expect(res.status).toBe(410);
    });
  });

  // ── Device verification ─────────────────────────────────────────
  describe('POST /oauth/device/verify', () => {
    it('approves at /oauth/device/verify', async () => {
      (verifyUserCode as any).mockResolvedValue({
        success: true,
        clientName: 'cv-git CLI',
        scopes: ['repo:read'],
      });

      const res = await app.request('/oauth/device/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_code: 'ABCD-1234', action: 'approve' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('approves at /api/oauth/device/verify (frontend path)', async () => {
      (verifyUserCode as any).mockResolvedValue({
        success: true,
        clientName: 'cv-git CLI',
        scopes: ['repo:read'],
      });

      const res = await app.request('/api/oauth/device/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_code: 'ABCD-1234', action: 'approve' }),
      });
      expect(res.status).toBe(200);
    });

    it('returns error on failure', async () => {
      (verifyUserCode as any).mockResolvedValue({
        success: false,
        error: 'expired_code',
      });

      const res = await app.request('/oauth/device/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_code: 'ABCD-1234', action: 'approve' }),
      });
      expect(res.status).toBe(400);
    });
  });
});

// ── /auth/me with organizations ───────────────────────────────────
describe('GET /api/auth/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns user and organizations', async () => {
    (getUserById as any).mockResolvedValue({
      id: 'test-user-id',
      username: 'johndoe',
      email: 'john@example.com',
      displayName: 'John Doe',
      avatarUrl: '',
      emailVerified: true,
      mfaEnabled: false,
      isAdmin: false,
    });
    (getUserOrganizations as any).mockResolvedValue([
      { id: 'org-1', slug: 'acme-corp', name: 'Acme Corp' },
      { id: 'org-2', slug: 'personal', name: 'Personal' },
    ]);

    const res = await app.request('/api/auth/me', {
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.user.username).toBe('johndoe');
    expect(data.user.email).toBe('john@example.com');
    expect(data.organizations).toHaveLength(2);
    expect(data.organizations[0].slug).toBe('acme-corp');
    expect(data.organizations[1].id).toBe('org-2');
  });

  it('returns empty organizations if user has none', async () => {
    (getUserById as any).mockResolvedValue({
      id: 'test-user-id',
      username: 'newuser',
      email: 'new@example.com',
      displayName: 'New User',
      avatarUrl: '',
      emailVerified: true,
      mfaEnabled: false,
      isAdmin: false,
    });
    (getUserOrganizations as any).mockResolvedValue([]);

    const res = await app.request('/api/auth/me', {
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.organizations).toHaveLength(0);
  });
});
