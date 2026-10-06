import type { FileGrant } from '@gravity/shared/validators';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import { createdAtColumn, organizationIdColumn, syncIdColumn, updatedAtColumn } from './columns.ts';

export const fileEntry = pgTable(
  'file_entry',
  {
    id: text('id').primaryKey(),
    organizationId: organizationIdColumn(),
    parentId: text('parent_id'),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    visibility: text('visibility').notNull().default('private'),
    grants: jsonb('grants').$type<FileGrant[]>().notNull().default([]),
    publicToken: text('public_token').notNull(),
    body: text('body'),
    storageKey: text('storage_key'),
    mimeType: text('mime_type'),
    size: bigint('size', { mode: 'number' }).notNull().default(0),
    syncId: syncIdColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('file_entry_parent_idx').on(table.organizationId, table.parentId),
    unique('file_entry_id_org_unique').on(table.id, table.organizationId),
    foreignKey({
      columns: [table.parentId, table.organizationId],
      foreignColumns: [table.id, table.organizationId],
      name: 'file_entry_parent_fk',
    }).onDelete('cascade'),
    uniqueIndex('file_entry_name_unique').on(
      table.organizationId,
      sql`coalesce(${table.parentId}, '')`,
      table.ownerId,
      sql`lower(${table.name})`,
    ),
    uniqueIndex('file_entry_public_token_unique').on(table.publicToken),
    check('file_entry_kind', sql`${table.kind} in ('folder', 'markdown', 'file')`),
    check(
      'file_entry_visibility',
      sql`${table.visibility} in ('private', 'workspace', 'public', 'shared', 'inherit')`,
    ),
    check(
      'file_entry_inherit_parent',
      sql`${table.visibility} <> 'inherit' or ${table.parentId} is not null`,
    ),
  ],
);

export const fileUpload = pgTable('file_upload', {
  id: text('id').primaryKey(),
  organizationId: organizationIdColumn(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  storageKey: text('storage_key').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAtColumn(),
});
