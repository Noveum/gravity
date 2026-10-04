import { index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { createdAtColumn, organizationIdColumn, updatedAtColumn } from './columns.ts';
import { person } from './records.ts';

export const importSource = pgTable(
  'import_source',
  {
    organizationId: organizationIdColumn(),
    source: text('source').notNull(),
    sourceId: text('source_id').notNull(),
    personId: text('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    primaryKey({
      name: 'import_source_pk',
      columns: [table.organizationId, table.source, table.sourceId],
    }),
    index('import_source_person_idx').on(table.personId),
  ],
);
