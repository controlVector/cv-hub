import { pgTable, uuid, varchar, text, boolean, timestamp, index, jsonb, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

// ============================================================================
// Enums
// ============================================================================

export const patScopeEnum = pgEnum('pat_scope', [
  'repo:read',       // Clone and fetch public/private repos
  'repo:write',      // Push to repos
  'repo:admin',      // Manage repo settings, delete repos
  'user:read',       // Read user profile
  'user:write',      // Update user profile
  'org:read',        // Read organization info
  'org:write',       // Manage organization
  'ssh_keys:read',   // List SSH keys
  'ssh_keys:write',  // Manage SSH keys
]);

// ============================================================================
// Personal Access Tokens
// ============================================================================

export const personalAccessTokens = pgTable('personal_access_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Token identification
  name: varchar('name', { length: 255 }).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(), // SHA-256 hash
  tokenPrefix: varchar('token_prefix', { length: 12 }).notNull(), // First chars for identification (e.g., "cv_pat_abc...")

  // Scopes
  scopes: jsonb('scopes').notNull().$type<string[]>(),

  // Expiration
  expiresAt: timestamp('expires_at', { withTimezone: true }),

  // Revocation
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedReason: text('revoked_reason'),

  // Usage tracking
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  lastUsedIp: varchar('last_used_ip', { length: 45 }), // IPv6 max length
  usageCount: varchar('usage_count', { length: 20 }).default('0'), // Stored as string for large numbers

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('pat_user_id_idx').on(table.userId),
  index('pat_token_hash_idx').on(table.tokenHash),
  index('pat_expires_at_idx').on(table.expiresAt),
]);

// ============================================================================
// Relations
// ============================================================================

export const personalAccessTokensRelations = relations(personalAccessTokens, ({ one }) => ({
  user: one(users, {
    fields: [personalAccessTokens.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// Type Exports
// ============================================================================

export type PersonalAccessToken = typeof personalAccessTokens.$inferSelect;
export type NewPersonalAccessToken = typeof personalAccessTokens.$inferInsert;
export type PatScope = typeof patScopeEnum.enumValues[number];

// Scope descriptions for UI
export const PAT_SCOPE_INFO: Record<string, { name: string; description: string }> = {
  'repo:read': {
    name: 'Repository Read',
    description: 'Clone and fetch repositories (public and private you have access to)',
  },
  'repo:write': {
    name: 'Repository Write',
    description: 'Push changes to repositories',
  },
  'repo:admin': {
    name: 'Repository Admin',
    description: 'Manage repository settings, webhooks, and delete repositories',
  },
  'user:read': {
    name: 'User Read',
    description: 'Read your user profile information',
  },
  'user:write': {
    name: 'User Write',
    description: 'Update your user profile',
  },
  'org:read': {
    name: 'Organization Read',
    description: 'Read organization information and membership',
  },
  'org:write': {
    name: 'Organization Write',
    description: 'Manage organization settings and members',
  },
  'ssh_keys:read': {
    name: 'SSH Keys Read',
    description: 'List your SSH keys',
  },
  'ssh_keys:write': {
    name: 'SSH Keys Write',
    description: 'Add and remove SSH keys',
  },
};
