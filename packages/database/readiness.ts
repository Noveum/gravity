import { getTableColumns, getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import type { Database } from "./client";
import * as schema from "./schema";

interface DatabaseColumn {
  tableName: string;
  columnName: string;
}

const requiredColumns = Object.values(schema).flatMap((table) =>
  is(table, PgTable)
    ? Object.values(getTableColumns(table)).map((column) => ({
        tableName: getTableName(table),
        columnName: column.name,
      }))
    : [],
);

export function databaseSchemaComplete(columns: DatabaseColumn[]) {
  const available = new Set(
    columns.map((column) => `${column.tableName}.${column.columnName}`),
  );
  return requiredColumns.every((column) =>
    available.has(`${column.tableName}.${column.columnName}`),
  );
}

export async function assertDatabaseSchema(db: Database) {
  const columns = await db
    .select({
      tableName: sql<string>`table_name`,
      columnName: sql<string>`column_name`,
    })
    .from(sql`information_schema.columns`)
    .where(sql`table_schema = 'public' AND pg_catalog.has_column_privilege(
      pg_catalog.quote_ident(table_schema) || '.' || pg_catalog.quote_ident(table_name),
      column_name,
      'SELECT'
    )`);
  if (!databaseSchemaComplete(columns))
    throw new Error("DATABASE_SCHEMA_INCOMPLETE");
}
