import { pgTable, uuid, varchar, text, boolean, timestamp, index, integer, pgEnum, unique } from 'drizzle-orm/pg-core';
import { users } from './users';

// MFA method types
export const mfaMethodType = pgEnum('mfa_method_type', ['totp', 'webauthn', 'backup_codes']);

// Tracks which MFA methods a user has enabled
export const mfaMethods = pgTable('mfa_methods', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: mfaMethodType('type').notNull(),
  enabled: boolean('enabled').default(false).notNull(),
  primary: boolean('primary').default(false).notNull(),  // Primary method for prompts
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
}, (table) => [
  index('mfa_methods_user_id_idx').on(table.userId),
  unique('mfa_methods_user_type_unique').on(table.userId, table.type),
]);

// TOTP credentials (Authenticator apps)
export const totpCredentials = pgTable('totp_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  encryptedSecret: text('encrypted_secret').notNull(),  // AES-256-GCM encrypted
  iv: varchar('iv', { length: 32 }).notNull(),  // Initialization vector for decryption
  deviceName: varchar('device_name', { length: 100 }),
  verified: boolean('verified').default(false).notNull(),  // Has user completed setup?
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
});

// WebAuthn/Passkey credentials
export const webauthnCredentials = pgTable('webauthn_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  credentialId: text('credential_id').notNull().unique(),  // Base64URL encoded credential ID
  publicKey: text('public_key').notNull(),  // Base64URL encoded COSE public key
  counter: integer('counter').default(0).notNull(),  // Signature counter for replay protection
  transports: text('transports'),  // JSON array: ['usb', 'ble', 'nfc', 'internal']
  deviceName: varchar('device_name', { length: 100 }),  // User-friendly name
  aaguid: varchar('aaguid', { length: 36 }),  // Authenticator AAGUID (identifies device type)
  backupEligible: boolean('backup_eligible').default(false).notNull(),
  backupState: boolean('backup_state').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
}, (table) => [
  index('webauthn_credentials_user_id_idx').on(table.userId),
  index('webauthn_credentials_credential_id_idx').on(table.credentialId),
]);

// Backup codes for account recovery
export const backupCodes = pgTable('backup_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  codeHash: varchar('code_hash', { length: 64 }).notNull(),  // SHA-256 hash
  used: boolean('used').default(false).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('backup_codes_user_id_idx').on(table.userId),
  index('backup_codes_user_used_idx').on(table.userId, table.used),
]);
