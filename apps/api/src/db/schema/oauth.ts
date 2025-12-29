import { pgTable, uuid, varchar, text, boolean, timestamp, index, jsonb, unique } from 'drizzle-orm/pg-core';
import { users } from './users';

// OAuth 2.0 Clients (registered applications)
export const oauthClients = pgTable('oauth_clients', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Client credentials
  clientId: varchar('client_id', { length: 64 }).notNull().unique(),  // Public identifier
  clientSecretHash: varchar('client_secret_hash', { length: 64 }),     // Hashed secret (null for public clients)

  // Client metadata
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  logoUrl: text('logo_url'),

  // URLs
  redirectUris: jsonb('redirect_uris').notNull().$type<string[]>(),   // Allowed redirect URIs
  websiteUrl: text('website_url'),
  privacyPolicyUrl: text('privacy_policy_url'),
  termsOfServiceUrl: text('terms_of_service_url'),

  // Client type
  isConfidential: boolean('is_confidential').default(true).notNull(), // Confidential vs public client
  isFirstParty: boolean('is_first_party').default(false).notNull(),   // First-party apps skip consent

  // Allowed scopes and grants
  allowedScopes: jsonb('allowed_scopes').notNull().$type<string[]>().default(['openid', 'profile', 'email']),
  allowedGrantTypes: jsonb('allowed_grant_types').notNull().$type<string[]>().default(['authorization_code', 'refresh_token']),

  // PKCE requirement
  requirePkce: boolean('require_pkce').default(true).notNull(),

  // Owner (developer who registered the app)
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),

  // Status
  isActive: boolean('is_active').default(true).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('oauth_clients_client_id_idx').on(table.clientId),
  index('oauth_clients_owner_id_idx').on(table.ownerId),
]);

// Authorization codes (temporary, exchanged for tokens)
export const oauthAuthorizationCodes = pgTable('oauth_authorization_codes', {
  id: uuid('id').primaryKey().defaultRandom(),

  code: varchar('code', { length: 64 }).notNull().unique(),

  clientId: uuid('client_id').notNull().references(() => oauthClients.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  redirectUri: text('redirect_uri').notNull(),
  scopes: jsonb('scopes').notNull().$type<string[]>(),

  // PKCE
  codeChallenge: varchar('code_challenge', { length: 128 }),
  codeChallengeMethod: varchar('code_challenge_method', { length: 10 }),  // 'S256' or 'plain'

  // State for OIDC
  nonce: varchar('nonce', { length: 128 }),

  // Remember consent decision (default true - auto-approve future requests)
  rememberConsent: boolean('remember_consent').default(true).notNull(),

  // Expiration (typically 10 minutes)
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

  // Usage tracking
  usedAt: timestamp('used_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('oauth_authorization_codes_code_idx').on(table.code),
  index('oauth_authorization_codes_expires_idx').on(table.expiresAt),
]);

// Access tokens
export const oauthAccessTokens = pgTable('oauth_access_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),

  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),  // SHA-256 hash

  clientId: uuid('client_id').notNull().references(() => oauthClients.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  scopes: jsonb('scopes').notNull().$type<string[]>(),

  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('oauth_access_tokens_token_hash_idx').on(table.tokenHash),
  index('oauth_access_tokens_user_id_idx').on(table.userId),
  index('oauth_access_tokens_expires_idx').on(table.expiresAt),
]);

// Refresh tokens (for offline access)
export const oauthRefreshTokens = pgTable('oauth_refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),

  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),  // SHA-256 hash

  clientId: uuid('client_id').notNull().references(() => oauthClients.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accessTokenId: uuid('access_token_id').references(() => oauthAccessTokens.id, { onDelete: 'cascade' }),

  scopes: jsonb('scopes').notNull().$type<string[]>(),

  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),

  // Rotation tracking
  rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  replacedByTokenId: uuid('replaced_by_token_id'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('oauth_refresh_tokens_token_hash_idx').on(table.tokenHash),
  index('oauth_refresh_tokens_user_id_idx').on(table.userId),
]);

// User consents (remembers what apps user has authorized)
export const oauthConsents = pgTable('oauth_consents', {
  id: uuid('id').primaryKey().defaultRandom(),

  clientId: uuid('client_id').notNull().references(() => oauthClients.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  scopes: jsonb('scopes').notNull().$type<string[]>(),

  grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('oauth_consents_client_user_unique').on(table.clientId, table.userId),
  index('oauth_consents_user_id_idx').on(table.userId),
]);
