import { index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import { createdAtColumn, organizationIdColumn, syncIdColumn, updatedAtColumn } from './columns.ts';
import { pipeline } from './configuration.ts';

export const savedView = pgTable(
  'saved_view',
  {
    id: text('id').primaryKey(),
    organizationId: organizationIdColumn(),
    object: text('object').notNull(),
    pipelineId: text('pipeline_id').references(() => pipeline.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    filter: jsonb('filter').$type<Record<string, unknown>>().notNull().default({}),
    display: jsonb('display').$type<Record<string, unknown>>().notNull().default({}),
    visibility: text('visibility').notNull().default('private'),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    syncId: syncIdColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('saved_view_org_idx').on(table.organizationId),
    index('saved_view_owner_idx').on(table.ownerId),
  ],
);

export const viewPreference = pgTable(
  'view_preference',
  {
    id: text('id').primaryKey(),
    organizationId: organizationIdColumn(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    page: text('page').notNull(),
    scope: text('scope').notNull().default(''),
    layout: text('layout').notNull().default('list'),
    display: jsonb('display').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('view_preference_unique').on(
      table.userId,
      table.organizationId,
      table.page,
      table.scope,
    ),
  ],
);
