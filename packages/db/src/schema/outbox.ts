import { sql } from 'drizzle-orm';
import { bigint, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { organization } from './org.ts';

export const outbox = pgTable(
  'outbox',
  {
    syncId: bigint('sync_id', { mode: 'number' }).primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    index('outbox_org_sync_idx').on(table.organizationId, table.syncId),
    index('outbox_unpublished_idx').on(table.createdAt).where(sql`${table.publishedAt} is null`),
  ],
);
