/**
 * PAT Service Tests
 * Tests for org-scoped PAT creation, validation, listing, and revocation
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  createToken,
  validateToken,
  listTokens,
  listOrgTokens,
  revokeToken,
  getToken,
} from './pat.service';
import {
  truncateAllTables,
  createTestUserWithPassword,
  createTestOrganization,
  getTestDb,
} from '../test/test-db';
import * as schema from '../db/schema';

describe('PAT Service', () => {
  beforeAll(async () => {
    const db = await getTestDb();
    await db.execute(/* sql */`SELECT 1`);
  });

  afterEach(async () => {
    await truncateAllTables();
  });

  async function createUserAndOrg() {
    const db = await getTestDb();
    const user = await createTestUserWithPassword({
      username: `pat_user_${Date.now()}`,
      email: `pat_${Date.now()}@example.com`,
    });
    const org = await createTestOrganization({
      slug: `pat-org-${Date.now()}`,
      name: 'PAT Test Org',
    });
    // Make user an owner of the org
    await db.insert(schema.organizationMembers).values({
      organizationId: org.id,
      userId: user.id,
      role: 'owner',
    });
    return { user, org };
  }

  describe('createToken', () => {
    it('creates a user-scoped token (no org)', async () => {
      const { user } = await createUserAndOrg();

      const result = await createToken({
        userId: user.id,
        name: 'My Token',
        scopes: ['repo:read'],
      });

      expect(result.token).toMatch(/^cv_pat_/);
      expect(result.tokenInfo.name).toBe('My Token');
      expect(result.tokenInfo.scopes).toEqual(['repo:read']);
      expect(result.tokenInfo.organizationId).toBeNull();
      expect(result.tokenInfo.isRevoked).toBe(false);
      expect(result.tokenInfo.isExpired).toBe(false);
    });

    it('creates an org-scoped token', async () => {
      const { user, org } = await createUserAndOrg();

      const result = await createToken({
        userId: user.id,
        name: 'Org Token',
        scopes: ['repo:read', 'repo:write'],
        organizationId: org.id,
      });

      expect(result.token).toMatch(/^cv_pat_/);
      expect(result.tokenInfo.organizationId).toBe(org.id);
      expect(result.tokenInfo.scopes).toEqual(['repo:read', 'repo:write']);
    });

    it('creates token with expiration', async () => {
      const { user } = await createUserAndOrg();
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      const result = await createToken({
        userId: user.id,
        name: 'Expiring Token',
        scopes: ['repo:read'],
        expiresAt: futureDate,
      });

      expect(result.tokenInfo.expiresAt).toBeTruthy();
      expect(result.tokenInfo.isExpired).toBe(false);
    });

    it('rejects invalid scopes', async () => {
      const { user } = await createUserAndOrg();

      await expect(
        createToken({
          userId: user.id,
          name: 'Bad Scopes',
          scopes: ['invalid:scope'],
        }),
      ).rejects.toThrow('Invalid scope');
    });

    it('rejects empty name', async () => {
      const { user } = await createUserAndOrg();

      await expect(
        createToken({
          userId: user.id,
          name: '',
          scopes: ['repo:read'],
        }),
      ).rejects.toThrow('Token name is required');
    });
  });

  describe('validateToken', () => {
    it('validates a valid token', async () => {
      const { user } = await createUserAndOrg();

      const { token } = await createToken({
        userId: user.id,
        name: 'Valid Token',
        scopes: ['repo:read'],
      });

      const result = await validateToken(token);

      expect(result.valid).toBe(true);
      expect(result.userId).toBe(user.id);
      expect(result.scopes).toEqual(['repo:read']);
      expect(result.organizationId).toBeNull();
    });

    it('validates an org-scoped token and returns organizationId', async () => {
      const { user, org } = await createUserAndOrg();

      const { token } = await createToken({
        userId: user.id,
        name: 'Org Token',
        scopes: ['repo:read'],
        organizationId: org.id,
      });

      const result = await validateToken(token);

      expect(result.valid).toBe(true);
      expect(result.userId).toBe(user.id);
      expect(result.organizationId).toBe(org.id);
    });

    it('rejects invalid token format', async () => {
      const result = await validateToken('not_a_valid_token');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid token format');
    });

    it('rejects unknown token', async () => {
      const result = await validateToken('cv_pat_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Token not found');
    });

    it('rejects revoked token', async () => {
      const { user } = await createUserAndOrg();

      const { token, tokenInfo } = await createToken({
        userId: user.id,
        name: 'Revoked Token',
        scopes: ['repo:read'],
      });

      await revokeToken(user.id, tokenInfo.id);

      const result = await validateToken(token);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('revoked');
    });

    it('rejects expired token', async () => {
      const { user } = await createUserAndOrg();
      const pastDate = new Date(Date.now() - 1000); // 1 second ago

      const { token } = await createToken({
        userId: user.id,
        name: 'Expired Token',
        scopes: ['repo:read'],
        expiresAt: pastDate,
      });

      const result = await validateToken(token);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });
  });

  describe('listTokens', () => {
    it('lists all tokens for a user', async () => {
      const { user, org } = await createUserAndOrg();

      await createToken({ userId: user.id, name: 'Token 1', scopes: ['repo:read'] });
      await createToken({ userId: user.id, name: 'Token 2', scopes: ['repo:write'], organizationId: org.id });

      const tokens = await listTokens(user.id);

      expect(tokens).toHaveLength(2);
      expect(tokens.map(t => t.name).sort()).toEqual(['Token 1', 'Token 2']);
    });
  });

  describe('listOrgTokens', () => {
    it('lists only org-scoped tokens', async () => {
      const { user, org } = await createUserAndOrg();

      await createToken({ userId: user.id, name: 'User Token', scopes: ['repo:read'] });
      await createToken({ userId: user.id, name: 'Org Token', scopes: ['repo:read'], organizationId: org.id });

      const tokens = await listOrgTokens(org.id);

      expect(tokens).toHaveLength(1);
      expect(tokens[0].name).toBe('Org Token');
      expect(tokens[0].organizationId).toBe(org.id);
    });

    it('returns empty for org with no tokens', async () => {
      const { org } = await createUserAndOrg();

      const tokens = await listOrgTokens(org.id);
      expect(tokens).toHaveLength(0);
    });
  });

  describe('revokeToken', () => {
    it('revokes a token', async () => {
      const { user } = await createUserAndOrg();

      const { tokenInfo } = await createToken({
        userId: user.id,
        name: 'To Revoke',
        scopes: ['repo:read'],
      });

      await revokeToken(user.id, tokenInfo.id);

      const updated = await getToken(user.id, tokenInfo.id);
      expect(updated?.isRevoked).toBe(true);
    });

    it('throws for non-existent token', async () => {
      const { user } = await createUserAndOrg();

      await expect(
        revokeToken(user.id, '00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow();
    });
  });
});
