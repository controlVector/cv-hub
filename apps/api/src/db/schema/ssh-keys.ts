import { pgTable, uuid, varchar, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

// ============================================================================
// SSH Keys
// ============================================================================

export const sshKeys = pgTable('ssh_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Key metadata
  title: varchar('title', { length: 255 }).notNull(),
  publicKey: text('public_key').notNull(),
  fingerprint: varchar('fingerprint', { length: 64 }).notNull(), // SHA256 fingerprint

  // Key type (ed25519, rsa, ecdsa, etc.)
  keyType: varchar('key_type', { length: 32 }),

  // Usage tracking
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('ssh_keys_fingerprint_idx').on(table.fingerprint),
  index('ssh_keys_user_id_idx').on(table.userId),
]);

// ============================================================================
// Relations
// ============================================================================

export const sshKeysRelations = relations(sshKeys, ({ one }) => ({
  user: one(users, {
    fields: [sshKeys.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// Type Exports
// ============================================================================

export type SshKey = typeof sshKeys.$inferSelect;
export type NewSshKey = typeof sshKeys.$inferInsert;
