import { pgTable, uuid, varchar, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 30 }).notNull().unique(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  displayName: varchar('display_name', { length: 100 }),
  avatarUrl: text('avatar_url'),
  emailVerified: boolean('email_verified').default(false).notNull(),
  emailVerificationToken: varchar('email_verification_token', { length: 64 }),
  emailVerificationExpires: timestamp('email_verification_expires', { withTimezone: true }),
  passwordResetToken: varchar('password_reset_token', { length: 64 }),
  passwordResetExpires: timestamp('password_reset_expires', { withTimezone: true }),
  mfaEnabled: boolean('mfa_enabled').default(false).notNull(),
  isAdmin: boolean('is_admin').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('users_email_idx').on(table.email),
  index('users_username_idx').on(table.username),
]);

export const passwordCredentials = pgTable('password_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type PasswordCredential = typeof passwordCredentials.$inferSelect;
export type NewPasswordCredential = typeof passwordCredentials.$inferInsert;
