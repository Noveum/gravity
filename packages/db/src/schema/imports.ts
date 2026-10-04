import { foreignKey, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { createdAtColumn, organizationIdColumn, updatedAtColumn } from './columns.ts';
import { person } from './records.ts';

export const importSource = pgTable(
  'import_source',
  {
    organizationId: organizationIdColumn(),
    source: text('source').notNull(),
    sourceId: text('source_id').notNull(),
    personId: text('person_id').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    primaryKey({
      name: 'import_source_pk',
      columns: [table.organizationId, table.source, table.sourceId],
    }),
    foreignKey({
      name: 'import_source_person_fk',
      columns: [table.personId, table.organizationId],
      foreignColumns: [person.id, person.organizationId],
    }).onDelete('cascade'),
    index('import_source_person_idx').on(table.personId),
  ],
);
