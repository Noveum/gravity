import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as localDrizzle } from "drizzle-orm/pglite";
import { migrate as localMigrate } from "drizzle-orm/pglite/migrator";
import { drizzle as postgresDrizzle } from "drizzle-orm/postgres-js";
import { migrate as postgresMigrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { databaseOptions } from "./config";
import { allowIdleDatabaseRelease } from "./lifecycle";
import * as schema from "./schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
export function isDemoMode() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.CRM_DEMO_MODE !== "false" &&
    !process.env.DATABASE_URL
  );
}
export async function createLocalDatabase(path?: string) {
  const client = new PGlite(path);
  const db = localDrizzle(client, { schema });
  try {
    await localMigrate(db, {
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    });
  } catch (error) {
    await client.close();
    throw error;
  }
  return { db, client };
}
export async function migrateDatabase() {
  const migrationUrl =
    process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
  if (migrationUrl) {
    const client = postgres(migrationUrl, databaseOptions(migrationUrl));
    try {
      await postgresMigrate(postgresDrizzle(client, { schema }), {
        migrationsFolder: "drizzle",
      });
    } finally {
      await client.end();
    }
  } else {
    if (!isDemoMode()) throw new Error("DATABASE_URL_REQUIRED");
    await mkdir(".data", { recursive: true });
    const local = await createLocalDatabase(".data/postgres");
    await local.client.close();
  }
}
declare global {
  var crmDatabase: Promise<Database> | undefined;
}
export async function getDatabase(): Promise<Database> {
  allowIdleDatabaseRelease();
  if (!globalThis.crmDatabase) {
    globalThis.crmDatabase = (async () => {
      if (process.env.DATABASE_URL)
        return postgresDrizzle(
          postgres(
            process.env.DATABASE_URL,
            databaseOptions(process.env.DATABASE_URL),
          ),
          { schema },
        );
      if (!isDemoMode()) throw new Error("DATABASE_URL_REQUIRED");
      await mkdir(".data", { recursive: true });
      const local = await createLocalDatabase(".data/postgres");
      const { seedDemo } = await import("./seed");
      await seedDemo(local.db);
      return local.db;
    })().catch((error) => {
      globalThis.crmDatabase = undefined;
      throw error;
    });
  }
  return globalThis.crmDatabase;
}
