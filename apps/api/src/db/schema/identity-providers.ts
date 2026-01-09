import { pgTable, uuid, varchar, text, boolean, timestamp, index, pgEnum, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organizations } from './organizations';
import { users } from './users';

// Identity provider types
export const idpTypeEnum = pgEnum('idp_type', [
  'oidc',   // OpenID Connect (Azure AD, Google, Okta)
  'saml',   // SAML 2.0
]);

// Identity providers table - stores SSO configuration per organization
export const identityProviders = pgTable('identity_providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),

  // Provider identification
  name: varchar('name', { length: 100 }).notNull(), // "Maxnerva Azure AD"
  type: idpTypeEnum('type').notNull(),

  // OIDC Configuration
  issuer: text('issuer').notNull(), // https://login.microsoftonline.com/{tenant-id}/v2.0
  clientId: varchar('client_id', { length: 255 }).notNull(),
  clientSecretEncrypted: text('client_secret_encrypted'), // Encrypted with app secret

  // OIDC Endpoints (can be discovered from .well-known, but stored for performance)
  authorizationEndpoint: text('authorization_endpoint'),
  tokenEndpoint: text('token_endpoint'),
  userinfoEndpoint: text('userinfo_endpoint'),
  jwksUri: text('jwks_uri'),
  endSessionEndpoint: text('end_session_endpoint'), // For logout

  // Scopes and claims
  scopes: text('scopes').default('openid profile email').notNull(),

  // Attribute mapping (JSONB for flexibility)
  // Maps IdP claims to CV-Hub user fields
  attributeMapping: jsonb('attribute_mapping').$type<{
    email?: string;       // Claim name for email (default: 'email')
    displayName?: string; // Claim name for display name (default: 'name')
    username?: string;    // Claim name for username (default: 'preferred_username')
    groups?: string;      // Claim name for group membership
  }>(),

  // Behavior settings
  autoProvision: boolean('auto_provision').default(true).notNull(), // Create users automatically on first login
  defaultOrgRole: varchar('default_org_role', { length: 20 }).default('member').notNull(), // Default role for provisioned users
  allowedDomains: text('allowed_domains').array(), // Restrict to specific email domains ['@maxnerva.com']

  // Group-to-role mapping (optional)
  groupRoleMappings: jsonb('group_role_mappings').$type<Record<string, string>>(), // { "Admins": "admin", "Users": "member" }

  // Status
  isActive: boolean('is_active').default(true).notNull(),
  isDefault: boolean('is_default').default(false).notNull(), // Default IdP for the org

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by').references(() => users.id),
}, (table) => [
  index('identity_providers_org_id_idx').on(table.organizationId),
  index('identity_providers_issuer_idx').on(table.issuer),
]);

// External identity links - connects users to their IdP identities
export const externalIdentities = pgTable('external_identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  identityProviderId: uuid('identity_provider_id').notNull().references(() => identityProviders.id, { onDelete: 'cascade' }),

  // External identity
  externalSubject: varchar('external_subject', { length: 255 }).notNull(), // IdP's unique identifier (oid for Azure AD)
  externalEmail: varchar('external_email', { length: 255 }), // Email from IdP (may differ from user's primary email)
  externalUsername: varchar('external_username', { length: 255 }), // Username from IdP

  // Additional profile data from IdP
  profileData: jsonb('profile_data').$type<Record<string, unknown>>(),

  // Groups received from IdP (for audit/debugging)
  groups: text('groups').array(),

  // Timestamps
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('external_identities_user_id_idx').on(table.userId),
  index('external_identities_idp_id_idx').on(table.identityProviderId),
  index('external_identities_subject_idx').on(table.identityProviderId, table.externalSubject),
]);

// SSO state - temporary storage for OAuth state during login flow
export const ssoStates = pgTable('sso_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  state: varchar('state', { length: 64 }).notNull().unique(), // Random state parameter
  nonce: varchar('nonce', { length: 64 }).notNull(), // OIDC nonce for replay protection
  identityProviderId: uuid('identity_provider_id').notNull().references(() => identityProviders.id, { onDelete: 'cascade' }),

  // Where to redirect after successful login
  redirectUri: text('redirect_uri'),

  // Optional: link to existing user (for account linking flows)
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),

  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), // Short-lived (10 minutes)
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('sso_states_state_idx').on(table.state),
  index('sso_states_expires_idx').on(table.expiresAt),
]);

// Relations
export const identityProvidersRelations = relations(identityProviders, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [identityProviders.organizationId],
    references: [organizations.id],
  }),
  createdByUser: one(users, {
    fields: [identityProviders.createdBy],
    references: [users.id],
  }),
  externalIdentities: many(externalIdentities),
  ssoStates: many(ssoStates),
}));

export const externalIdentitiesRelations = relations(externalIdentities, ({ one }) => ({
  user: one(users, {
    fields: [externalIdentities.userId],
    references: [users.id],
  }),
  identityProvider: one(identityProviders, {
    fields: [externalIdentities.identityProviderId],
    references: [identityProviders.id],
  }),
}));

export const ssoStatesRelations = relations(ssoStates, ({ one }) => ({
  identityProvider: one(identityProviders, {
    fields: [ssoStates.identityProviderId],
    references: [identityProviders.id],
  }),
  user: one(users, {
    fields: [ssoStates.userId],
    references: [users.id],
  }),
}));

// Type exports
export type IdentityProvider = typeof identityProviders.$inferSelect;
export type NewIdentityProvider = typeof identityProviders.$inferInsert;
export type ExternalIdentity = typeof externalIdentities.$inferSelect;
export type NewExternalIdentity = typeof externalIdentities.$inferInsert;
export type SsoState = typeof ssoStates.$inferSelect;
export type NewSsoState = typeof ssoStates.$inferInsert;
export type IdpType = typeof idpTypeEnum.enumValues[number];
