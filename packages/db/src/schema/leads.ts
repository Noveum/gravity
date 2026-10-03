import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import {
  archivedAtColumn,
  createdAtColumn,
  organizationIdColumn,
  syncIdColumn,
  updatedAtColumn,
} from './columns.ts';
import { pipeline, stage } from './configuration.ts';
import { person } from './records.ts';

export const lead = pgTable(
  'lead',
  {
    id: text('id').primaryKey(),
    organizationId: organizationIdColumn(),
    personId: text('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    pipelineId: text('pipeline_id')
      .notNull()
      .references(() => pipeline.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'set null' }),
    stageId: text('stage_id')
      .notNull()
      .references(() => stage.id, { onDelete: 'restrict' }),
    stageCategory: text('stage_category').notNull(),
    source: text('source').notNull().default('manual'),
    priority: integer('priority').notNull().default(0),
    holdReason: text('hold_reason'),
    holdUntil: timestamp('hold_until', { withTimezone: true }),
    nextAction: text('next_action'),
    nextActionAt: timestamp('next_action_at', { withTimezone: true }),
    owedBy: text('owed_by').notNull().default('none'),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    lastOutboundAt: timestamp('last_outbound_at', { withTimezone: true }),
    unansweredStreak: integer('unanswered_streak').notNull().default(0),
    fields: jsonb('fields').$type<Record<string, unknown>>().notNull().default({}),
    fieldsMeta: jsonb('fields_meta').$type<Record<string, unknown>>().notNull().default({}),
    dealId: text('deal_id'),
    syncId: syncIdColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    archivedAt: archivedAtColumn(),
  },
  (table) => [
    uniqueIndex('lead_pipeline_number_unique').on(table.pipelineId, table.number),
    uniqueIndex('lead_open_person_pipeline_unique')
      .on(table.personId, table.pipelineId)
      .where(sql`${table.stageCategory} in ('open', 'hold') and ${table.archivedAt} is null`),
    index('lead_org_pipeline_stage_idx').on(table.organizationId, table.pipelineId, table.stageId),
    index('lead_person_idx').on(table.personId),
    index('lead_owner_idx').on(table.ownerId),
    check('lead_stage_category', sql`${table.stageCategory} in ('open', 'won', 'lost', 'hold')`),
    check('lead_priority_range', sql`${table.priority} between 0 and 4`),
    check('lead_owed_by', sql`${table.owedBy} in ('us', 'them', 'none')`),
  ],
);
