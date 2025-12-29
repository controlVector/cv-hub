import { pgTable, uuid, varchar, text, boolean, timestamp, index, pgEnum, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

// Supported AI providers
export const aiProviderEnum = pgEnum('ai_provider', [
  'openai',
  'anthropic',
  'google',
  'mistral',
  'cohere',
  'groq',
  'together',
  'openrouter',
  'custom',
]);

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: aiProviderEnum('provider').notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  encryptedKey: text('encrypted_key').notNull(),
  keyHint: varchar('key_hint', { length: 10 }).notNull(), // Last 4 chars for display
  customEndpoint: text('custom_endpoint'), // For custom providers
  isActive: boolean('is_active').default(true).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  usageCount: integer('usage_count').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('api_keys_user_id_idx').on(table.userId),
  index('api_keys_provider_idx').on(table.provider),
]);

// Relations
export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));
