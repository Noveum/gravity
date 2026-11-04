import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import {
  createLocalDatabase,
  type Database,
} from "../../packages/database/client";
import { databaseOptions } from "../../packages/database/config";
import * as schema from "../../packages/database/schema";

export function localOAuthPostgresUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("OAUTH_TEST_DATABASE_MUST_BE_LOCAL");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.search ||
    url.hash
  )
    throw new Error("OAUTH_TEST_DATABASE_MUST_BE_LOCAL");
  return url;
}

export async function createOAuthDatabase(): Promise<{
  db: Database;
  close: () => Promise<void>;
}> {
  const serverUrl = process.env.GRAVITY_OAUTH_POSTGRES_TEST_URL;
  if (!serverUrl) {
    const local = await createLocalDatabase();
    return { db: local.db, close: () => local.client.close() };
  }
  const url = localOAuthPostgresUrl(serverUrl);
  const name = `gravity_oauth_${randomUUID().replaceAll("-", "")}`;
  const server = postgres(
    url.toString(),
    databaseOptions(url.toString(), { DATABASE_SSL_MODE: "disable" }),
  );
  let client: postgres.Sql | undefined;
  let created = false;
  const close = async () => {
    try {
      await client?.end();
    } finally {
      try {
        if (created) await server.unsafe(`DROP DATABASE IF EXISTS ${name}`);
      } finally {
        await server.end();
      }
    }
  };
  try {
    await server.unsafe(`CREATE DATABASE ${name}`);
    created = true;
    url.pathname = `/${name}`;
    client = postgres(
      url.toString(),
      databaseOptions(url.toString(), { DATABASE_SSL_MODE: "disable" }),
    );
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: resolve("drizzle") });
    return { db, close };
  } catch (error) {
    await close();
    throw error;
  }
}
