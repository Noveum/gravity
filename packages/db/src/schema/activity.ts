import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createdAtColumn, organizationIdColumn, syncIdColumn } from './columns.ts';

export const activity = pgTable(
  'activity',
  {
    id: text('id').primaryKey(),
    organizationId: organizationIdColumn(),
    kind: text('kind').notNull(),
    actor: jsonb('actor').$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    externalId: text('external_id'),
    syncId: syncIdColumn(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('activity_org_external_unique')
      .on(table.organizationId, table.externalId)
      .where(sql`${table.externalId} is not null`),
    index('activity_org_occurred_idx').on(table.organizationId, table.occurredAt),
  ],
);

export const activityLink = pgTable(
  'activity_link',
  {
    activityId: text('activity_id')
      .notNull()
      .references(() => activity.id, { onDelete: 'cascade' }),
    organizationId: organizationIdColumn(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.activityId, table.entityType, table.entityId] }),
    index('activity_link_entity_idx').on(
      table.organizationId,
      table.entityType,
      table.entityId,
      table.occurredAt,
    ),
  ],
);
