import { pgTable, uuid, varchar, text, boolean, timestamp, index, bigint, pgEnum } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { repositories, tags } from './repositories';

// Enums
export const appCategoryEnum = pgEnum('app_category', [
  'developer-tools',
  'productivity',
  'ai-ml',
  'utilities',
  'communication',
  'other',
]);

export const platformEnum = pgEnum('platform', [
  'windows-x64',
  'windows-arm64',
  'macos-x64',
  'macos-arm64',
  'linux-x64',
  'linux-arm64',
]);

// Apps table
export const apps = pgTable('apps', {
  id: varchar('id', { length: 64 }).primaryKey(), // e.g., "cv-prd", "cv-git"
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }), // Owner org (null = system/global)
  repositoryId: uuid('repository_id').references(() => repositories.id, { onDelete: 'set null' }), // Source repository (optional)
  name: varchar('name', { length: 100 }).notNull(), // e.g., "CV-PRD"
  description: text('description').notNull(), // Short description
  longDescription: text('long_description'), // Markdown content
  iconUrl: text('icon_url'),
  category: appCategoryEnum('category').default('developer-tools').notNull(),
  homepageUrl: text('homepage_url'),
  repositoryUrl: text('repository_url'), // GitHub repo URL (legacy, for external repos)

  // Status
  isActive: boolean('is_active').default(true).notNull(),
  isFeatured: boolean('is_featured').default(false).notNull(),

  // Stats
  totalDownloads: bigint('total_downloads', { mode: 'number' }).default(0).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('apps_category_idx').on(table.category),
  index('apps_is_active_idx').on(table.isActive),
  index('apps_is_featured_idx').on(table.isFeatured),
  index('apps_organization_id_idx').on(table.organizationId),
  index('apps_repository_id_idx').on(table.repositoryId),
]);

// Releases table
export const releases = pgTable('releases', {
  id: uuid('id').primaryKey().defaultRandom(),
  appId: varchar('app_id', { length: 64 }).notNull().references(() => apps.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').references(() => tags.id, { onDelete: 'set null' }), // Link to git tag (optional)
  version: varchar('version', { length: 32 }).notNull(), // e.g., "0.1.9"
  releaseNotes: text('release_notes'), // Markdown

  // Release type
  isPrerelease: boolean('is_prerelease').default(false).notNull(),
  isLatest: boolean('is_latest').default(false).notNull(),

  // Signing (for Tauri updater)
  signaturePublicKey: text('signature_public_key'),

  // Stats
  downloadCount: bigint('download_count', { mode: 'number' }).default(0).notNull(),

  // GitHub sync metadata
  githubReleaseId: bigint('github_release_id', { mode: 'number' }),
  githubReleaseUrl: text('github_release_url'),

  publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('releases_app_id_idx').on(table.appId),
  index('releases_tag_id_idx').on(table.tagId),
  index('releases_version_idx').on(table.version),
  index('releases_is_latest_idx').on(table.isLatest),
  index('releases_published_at_idx').on(table.publishedAt),
]);

// Release assets table
export const releaseAssets = pgTable('release_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  releaseId: uuid('release_id').notNull().references(() => releases.id, { onDelete: 'cascade' }),

  // Platform info
  platform: platformEnum('platform').notNull(),

  // File info
  fileName: varchar('file_name', { length: 255 }).notNull(), // e.g., "cv-prd_0.1.9_x64-setup.exe"
  fileSize: bigint('file_size', { mode: 'number' }).notNull(), // bytes
  fileHash: varchar('file_hash', { length: 64 }).notNull(), // SHA256

  // Tauri signature for updates
  signature: text('signature'),

  // Download URL (could be GitHub, S3, etc.)
  downloadUrl: text('download_url').notNull(),

  // Stats
  downloadCount: bigint('download_count', { mode: 'number' }).default(0).notNull(),

  // GitHub sync metadata
  githubAssetId: bigint('github_asset_id', { mode: 'number' }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('release_assets_release_id_idx').on(table.releaseId),
  index('release_assets_platform_idx').on(table.platform),
]);

// Download events table for analytics
export const downloadEvents = pgTable('download_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  appId: varchar('app_id', { length: 64 }).notNull().references(() => apps.id, { onDelete: 'cascade' }),
  releaseId: uuid('release_id').notNull().references(() => releases.id, { onDelete: 'cascade' }),
  assetId: uuid('asset_id').notNull().references(() => releaseAssets.id, { onDelete: 'cascade' }),

  // Request info
  platform: platformEnum('platform').notNull(),
  version: varchar('version', { length: 32 }).notNull(),
  userAgent: text('user_agent'),
  ipAddress: varchar('ip_address', { length: 45 }), // IPv6 max length
  country: varchar('country', { length: 2 }), // ISO country code

  // Event type
  eventType: varchar('event_type', { length: 32 }).default('download').notNull(), // 'download', 'update_check', 'update_download'

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('download_events_app_id_idx').on(table.appId),
  index('download_events_release_id_idx').on(table.releaseId),
  index('download_events_platform_idx').on(table.platform),
  index('download_events_created_at_idx').on(table.createdAt),
  index('download_events_event_type_idx').on(table.eventType),
]);

// Type exports
export type App = typeof apps.$inferSelect;
export type NewApp = typeof apps.$inferInsert;
export type Release = typeof releases.$inferSelect;
export type NewRelease = typeof releases.$inferInsert;
export type ReleaseAsset = typeof releaseAssets.$inferSelect;
export type NewReleaseAsset = typeof releaseAssets.$inferInsert;
export type DownloadEvent = typeof downloadEvents.$inferSelect;
export type NewDownloadEvent = typeof downloadEvents.$inferInsert;
export type AppCategory = typeof appCategoryEnum.enumValues[number];
export type Platform = typeof platformEnum.enumValues[number];
