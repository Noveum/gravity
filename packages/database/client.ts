import { AsyncLocalStorage } from "node:async_hooks";
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
import * as schema from "./schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
// A Workers isolate serves many requests but may only use a socket inside the
// request that opened it, so there the connection belongs to one invocation.
export const isWorkersRuntime =
  globalThis.navigator?.userAgent === "Cloudflare-Workers";
export function isDemoMode() {
  return (
    // With Hyperdrive a Worker has no DATABASE_URL, which must not read as demo.
    !isWorkersRuntime &&
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
type Client = ReturnType<typeof postgres>;
// Through Hyperdrive, unprepared queries sent together never answer, so a page
// that loads several at once hangs. postgres.js names a statement only when
// both the client and the query ask for it, and Drizzle sends every query
// through unsafe(), whose default is unprepared. Transactions hand Drizzle a
// new client, so it is wrapped as well.
function prepared(client: Client): Client {
  return new Proxy(client, {
    get(target, property) {
      if (property === "unsafe")
        return (query: string, args: unknown[] = [], options: object = {}) =>
          target.unsafe(query, args as never[], { prepare: true, ...options });
      if (property === "begin" || property === "savepoint")
        return (...args: unknown[]) => {
          const run = args.pop() as (client: Client) => unknown;
          // savepoint exists only on a transaction's client.
          const open = Reflect.get(target, property) as (
            ...rest: unknown[]
          ) => unknown;
          return open(...args, (scoped: Client) => run(prepared(scoped)));
        };
      return Reflect.get(target, property);
    },
  });
}
function connect(connectionUrl: string, pooled = false): Database {
  const options = databaseOptions(connectionUrl);
  // Hyperdrive verifies the database certificate on its own connection; the
  // hop from the Worker to Hyperdrive stays inside Cloudflare without TLS.
  const client = pooled
    ? prepared(
        postgres(connectionUrl, { ...options, ssl: false, prepare: true }),
      )
    : postgres(connectionUrl, options);
  return postgresDrizzle(client, { schema });
}
const invocations = new AsyncLocalStorage<{
  hyperdriveUrl?: string;
  db?: Database;
}>();
export function runWithInvocationDatabase<T>(
  run: () => T,
  hyperdriveUrl?: string,
): T {
  return invocations.run({ hyperdriveUrl }, run);
}
// Long-lived holders such as the auth instance keep one stable handle; each
// use resolves to the connection of the invocation that is running.
const invocationDatabase = new Proxy({} as Database, {
  get(_, property) {
    // An async function resolving to this handle probes it for a thenable.
    if (property === "then") return undefined;
    const invocation = invocations.getStore();
    if (!invocation) throw new Error("DATABASE_INVOCATION_REQUIRED");
    if (!invocation.db) {
      const url = invocation.hyperdriveUrl ?? process.env.DATABASE_URL;
      if (!url) throw new Error("DATABASE_URL_REQUIRED");
      invocation.db = connect(url, Boolean(invocation.hyperdriveUrl));
    }
    const value = Reflect.get(invocation.db, property);
    // Methods run against the real instance; own values such as the driver
    // client keep their identity.
    return typeof value === "function" &&
      !Object.hasOwn(invocation.db, property)
      ? value.bind(invocation.db)
      : value;
  },
});
export async function getDatabase(): Promise<Database> {
  if (isWorkersRuntime) return invocationDatabase;
  if (!globalThis.crmDatabase) {
    globalThis.crmDatabase = (async () => {
      if (process.env.DATABASE_URL) return connect(process.env.DATABASE_URL);
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
