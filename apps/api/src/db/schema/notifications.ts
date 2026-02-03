import { pgTable, uuid, varchar, text, boolean, timestamp, index, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

// ============================================================================
// Enums
// ============================================================================

export const notificationTypeEnum = pgEnum('notification_type', [
  'pr_review',
  'pr_merged',
  'pr_comment',
  'issue_assigned',
  'issue_comment',
  'mention',
  'repo_push',
  'release',
]);

// ============================================================================
// Notifications
// ============================================================================

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Notification content
  type: notificationTypeEnum('type').notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  body: text('body'),

  // Related entity (polymorphic link)
  relatedEntityType: varchar('related_entity_type', { length: 50 }), // e.g., 'pull_request', 'issue', 'repository'
  relatedEntityId: uuid('related_entity_id'),

  // Actor who triggered the notification
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),

  // Read state
  readAt: timestamp('read_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('notifications_user_id_idx').on(table.userId),
  index('notifications_user_read_idx').on(table.userId, table.readAt),
  index('notifications_user_type_idx').on(table.userId, table.type),
  index('notifications_created_at_idx').on(table.createdAt),
]);

// ============================================================================
// Notification Preferences
// ============================================================================

export const notificationPreferences = pgTable('notification_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  type: notificationTypeEnum('type').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  emailEnabled: boolean('email_enabled').default(false).notNull(),

  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('notification_prefs_user_idx').on(table.userId),
  index('notification_prefs_user_type_idx').on(table.userId, table.type),
]);

// ============================================================================
// Relations
// ============================================================================

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
  actor: one(users, {
    fields: [notifications.actorId],
    references: [users.id],
    relationName: 'notificationActor',
  }),
}));

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  user: one(users, {
    fields: [notificationPreferences.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// Type Exports
// ============================================================================

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;
export type NotificationType = typeof notificationTypeEnum.enumValues[number];
