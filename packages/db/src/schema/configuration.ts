import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import {
  archivedAtColumn,
  createdAtColumn,
  organizationIdColumn,
  syncIdColumn,
  updatedAtColumn,
} from './columns.ts';

export const brand = pgTable(
  'brand',
  {
    id: text('id').primaryKey(),
    organizationId: organizationIdColumn(),
    name: text('name').notNull(),
    domain: text('domain'),
    color: text('color').notNull().default('blue'),
    signature: text('signature').notNull().default(''),
    currentPlaybookVersion: integer('current_playbook_version').notNull().default(1),
    syncId: syncIdColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    archivedAt: archivedAtColumn(),
  },
  (table) => [
    index('brand_org_idx').on(table.organizationId),
    uniqueIndex('brand_org_name_unique')
      .on(table.organizationId, sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} is null`),
  ],
);

export const playbookVersion = pgTable(
  'playbook_version',
  {
    id: text('id').primaryKey(),
    organizationId: organizationIdColumn(),
    brandId: text('brand_id')
      .notNull()
      .references(() => brand.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    body: text('body').notNull().default(''),
    variables: jsonb('variables').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('playbook_version_brand_version_unique').on(table.brandId, table.version),
  ],
);

export const pipeline = pgTable(
  'pipeline',
  {
    id: text('id').primaryKey(),
    organizationId: organizationIdColumn(),
    brandId: text('brand_id')
      .notNull()
      .references(() => brand.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    key: text('key').notNull(),
    kind: text('kind').notNull().default('people'),
    leadCounter: integer('lead_counter').notNull().default(0),
    position: integer('position').notNull().default(0),
    syncId: syncIdColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    archivedAt: archivedAtColumn(),
  },
  (table) => [
    index('pipeline_brand_idx').on(table.brandId),
    uniqueIndex('pipeline_org_key_unique')
      .on(table.organizationId, table.key)
      .where(sql`${table.archivedAt} is null`),
    check('pipeline_key_format', sql`${table.key} ~ '^[A-Z]{2,5}$'`),
    check('pipeline_kind', sql`${table.kind} in ('people', 'deals')`),
  ],
);

export const stage = pgTable(
  'stage',
  {
    id: text('id').primaryKey(),
    organizationId: organizationIdColumn(),
    pipelineId: text('pipeline_id')
      .notNull()
      .references(() => pipeline.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category').notNull(),
    sortOrder: integer('sort_order').notNull(),
    syncId: syncIdColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    archivedAt: archivedAtColumn(),
  },
  (table) => [
    index('stage_pipeline_order_idx').on(table.pipelineId, table.sortOrder),
    check('stage_category', sql`${table.category} in ('open', 'won', 'lost', 'hold')`),
  ],
);

export const fieldDefinition = pgTable(
  'field_definition',
  {
    id: text('id').primaryKey(),
    organizationId: organizationIdColumn(),
    object: text('object').notNull(),
    pipelineId: text('pipeline_id').references(() => pipeline.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: text('type').notNull(),
    options: jsonb('options').$type<{ value: string; label: string }[]>().notNull().default([]),
    description: text('description').notNull().default(''),
    example: text('example').notNull().default(''),
    position: integer('position').notNull().default(0),
    syncId: syncIdColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    archivedAt: archivedAtColumn(),
  },
  (table) => [
    index('field_definition_org_idx').on(table.organizationId, table.object),
    uniqueIndex('field_definition_key_unique')
      .on(table.organizationId, table.object, sql`coalesce(${table.pipelineId}, '')`, table.key)
      .where(sql`${table.archivedAt} is null`),
    check('field_definition_object', sql`${table.object} in ('person', 'company', 'lead', 'deal')`),
  ],
);
