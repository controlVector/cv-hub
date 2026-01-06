import { pgTable, uuid, varchar, text, timestamp, index, uniqueIndex, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

// ============================================================================
// Enums
// ============================================================================

export const connectionProviderEnum = pgEnum('connection_provider', [
  'github',
  'gitlab',
  'bitbucket',
]);

// ============================================================================
// User Connections (OAuth tokens for external providers)
// ============================================================================

export const userConnections = pgTable('user_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Provider info
  provider: connectionProviderEnum('provider').notNull(),
  providerUserId: varchar('provider_user_id', { length: 255 }).notNull(), // GitHub user ID
  providerUsername: varchar('provider_username', { length: 255 }), // GitHub username

  // OAuth tokens (encrypted at rest)
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  tokenExpiry: timestamp('token_expiry', { withTimezone: true }),

  // Scopes granted
  scopes: text('scopes'), // Comma-separated scopes

  // Profile info from provider
  email: varchar('email', { length: 255 }),
  avatarUrl: text('avatar_url'),
  profileUrl: text('profile_url'),

  // Connection status
  isActive: varchar('is_active', { length: 10 }).default('true').notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // One connection per provider per user
  uniqueIndex('user_connections_user_provider_idx').on(table.userId, table.provider),
  // Find by provider user ID
  index('user_connections_provider_user_idx').on(table.provider, table.providerUserId),
  index('user_connections_user_idx').on(table.userId),
]);

// ============================================================================
// Relations
// ============================================================================

export const userConnectionsRelations = relations(userConnections, ({ one }) => ({
  user: one(users, {
    fields: [userConnections.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// Type Exports
// ============================================================================

export type UserConnection = typeof userConnections.$inferSelect;
export type NewUserConnection = typeof userConnections.$inferInsert;
export type ConnectionProvider = typeof connectionProviderEnum.enumValues[number];
