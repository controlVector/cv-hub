import { pgTable, uuid, varchar, text, boolean, timestamp, index, uniqueIndex, bigint, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { repositories } from './repositories';
import { users } from './users';

// ============================================================================
// Repository Releases
// ============================================================================

export const repoReleases = pgTable('repo_releases', {
  id: uuid('id').primaryKey().defaultRandom(),
  repositoryId: uuid('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),

  tagName: varchar('tag_name', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  body: text('body'),

  draft: boolean('draft').default(false).notNull(),
  prerelease: boolean('prerelease').default(false).notNull(),

  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('repo_releases_repo_tag_idx').on(table.repositoryId, table.tagName),
  index('repo_releases_repo_id_idx').on(table.repositoryId),
  index('repo_releases_author_id_idx').on(table.authorId),
  index('repo_releases_published_at_idx').on(table.publishedAt),
]);

// ============================================================================
// Release Assets
// ============================================================================

export const repoReleaseAssets = pgTable('repo_release_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  releaseId: uuid('release_id').notNull().references(() => repoReleases.id, { onDelete: 'cascade' }),

  name: varchar('name', { length: 255 }).notNull(),
  contentType: varchar('content_type', { length: 255 }).default('application/octet-stream').notNull(),
  size: bigint('size', { mode: 'number' }).default(0).notNull(),
  downloadCount: integer('download_count').default(0).notNull(),

  storageKey: text('storage_key').notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('repo_release_assets_release_id_idx').on(table.releaseId),
  uniqueIndex('repo_release_assets_release_name_idx').on(table.releaseId, table.name),
]);

// ============================================================================
// Relations
// ============================================================================

export const repoReleasesRelations = relations(repoReleases, ({ one, many }) => ({
  repository: one(repositories, {
    fields: [repoReleases.repositoryId],
    references: [repositories.id],
  }),
  author: one(users, {
    fields: [repoReleases.authorId],
    references: [users.id],
  }),
  assets: many(repoReleaseAssets),
}));

export const repoReleaseAssetsRelations = relations(repoReleaseAssets, ({ one }) => ({
  release: one(repoReleases, {
    fields: [repoReleaseAssets.releaseId],
    references: [repoReleases.id],
  }),
}));

// ============================================================================
// Type Exports
// ============================================================================

export type RepoRelease = typeof repoReleases.$inferSelect;
export type NewRepoRelease = typeof repoReleases.$inferInsert;
export type RepoReleaseAsset = typeof repoReleaseAssets.$inferSelect;
export type NewRepoReleaseAsset = typeof repoReleaseAssets.$inferInsert;
