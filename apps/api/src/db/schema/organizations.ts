import { pgTable, uuid, varchar, text, boolean, timestamp, index, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

// Organization member roles
export const orgRoleEnum = pgEnum('org_role', [
  'owner',    // Full control, can delete org
  'admin',    // Can manage apps, releases, members
  'member',   // Can view and download
]);

// Organizations table
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 64 }).notNull().unique(), // URL-friendly name, e.g., "controlvector"
  name: varchar('name', { length: 100 }).notNull(), // Display name, e.g., "Control Vector"
  description: text('description'),

  // Branding
  logoUrl: text('logo_url'),
  websiteUrl: text('website_url'),

  // Settings
  isPublic: boolean('is_public').default(true).notNull(), // Public orgs are visible to everyone
  isVerified: boolean('is_verified').default(false).notNull(), // Verified badge

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('organizations_slug_idx').on(table.slug),
  index('organizations_is_public_idx').on(table.isPublic),
]);

// Organization members table
export const organizationMembers = pgTable('organization_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: orgRoleEnum('role').default('member').notNull(),

  // Invitation tracking
  invitedBy: uuid('invited_by').references(() => users.id),
  invitedAt: timestamp('invited_at', { withTimezone: true }),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('org_members_org_id_idx').on(table.organizationId),
  index('org_members_user_id_idx').on(table.userId),
]);

// Relations
export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
}));

export const organizationMembersRelations = relations(organizationMembers, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationMembers.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [organizationMembers.userId],
    references: [users.id],
  }),
}));

// Type exports
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = typeof organizationMembers.$inferInsert;
export type OrgRole = typeof orgRoleEnum.enumValues[number];
