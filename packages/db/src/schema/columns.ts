import { bigint, text, timestamp } from 'drizzle-orm/pg-core';
import { organization } from './org.ts';

export function organizationIdColumn() {
  return text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' });
}

export function syncIdColumn() {
  return bigint('sync_id', { mode: 'number' }).notNull().default(0);
}

export function createdAtColumn() {
  return timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
}

export function updatedAtColumn() {
  return timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
}

export function archivedAtColumn() {
  return timestamp('archived_at', { withTimezone: true });
}
