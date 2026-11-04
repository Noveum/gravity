import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { databaseOptions } from "../packages/database/config";
import * as s from "../packages/database/schema";

const serverUrl = process.env.GRAVITY_POSTGRES_TEST_URL ?? "";
const usable =
  serverUrl !== "" &&
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(serverUrl).hostname);

describe.skipIf(!usable)("database adapter on PostgreSQL", () => {
  const name = `gravity_driver_${randomUUID().replaceAll("-", "")}`;
  let server: postgres.Sql;
  let client: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof s>>;

  beforeAll(async () => {
    server = postgres(serverUrl, { max: 1, onnotice: () => {} });
    await server.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(serverUrl);
    url.pathname = `/${name}`;
    const options = databaseOptions(url.toString(), {
      DATABASE_SSL_MODE: "disable",
    });
    client = postgres(url.toString(), {
      ...options,
      // Exercise the application's serializers with a non-UTC session;
      // v4 changed raw Date inference and timestamp decoding outside UTC.
      connection: { ...options.connection, TimeZone: "Asia/Kolkata" },
    });
    db = drizzle(client, { schema: s });
    await migrate(db, { migrationsFolder: resolve("drizzle") });
  }, 120000);

  afterAll(async () => {
    await client?.end();
    await server?.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    await server?.end();
  });

  test("auth and CRM timestamps retain instants and expiry comparisons outside UTC", async () => {
    const instant = new Date("2026-10-31T23:45:12.345Z");
    const id = randomUUID();
    await db.insert(s.user).values({
      id,
      name: "Fictional driver fixture",
      email: `${id}@example.test`,
      createdAt: instant,
      updatedAt: instant,
    });
    await db.insert(s.session).values({
      id,
      userId: id,
      token: randomUUID(),
      expiresAt: instant,
    });
    const [session] = await db
      .select()
      .from(s.session)
      .where(eq(s.session.expiresAt, instant));
    expect(session.expiresAt.toISOString()).toBe(instant.toISOString());
    const [organization] = await db
      .insert(s.organizations)
      .values({
        name: "Fictional driver fixture",
        slug: id,
        createdAt: instant,
      })
      .returning();
    expect(organization.createdAt.toISOString()).toBe(instant.toISOString());
    const [stored] = await client`
      select expires_at::text as expiry from session where id = ${id}
    `;
    expect(stored.expiry).toBe("2026-10-31 23:45:12.345");
  });

  test("OAuth arrays, booleans and JSON round-trip through Drizzle's encoders", async () => {
    const id = randomUUID();
    const scopes = ["crm:read", "crm:write", 'scope,with"escape\\', "NULL", ""];
    const redirectUris = [
      "https://fictional.example.test/oauth/callback?next=a,b",
    ];
    const metadata = { fictional: true, labels: ["a", "b"], nested: { n: 3 } };
    const [created] = await db
      .insert(s.oauthClient)
      .values({
        id,
        clientId: id,
        scopes,
        redirectUris,
        metadata,
        disabled: false,
      })
      .returning();
    expect(created).toMatchObject({
      scopes,
      redirectUris,
      metadata,
      disabled: false,
      clientCredentialsScopes: [],
    });
    const [updated] = await db
      .update(s.oauthClient)
      .set({ scopes: [], disabled: true, metadata: null })
      .where(eq(s.oauthClient.clientId, id))
      .returning();
    expect(updated).toMatchObject({
      scopes: [],
      disabled: true,
      metadata: null,
    });
  });

  test("a swallowed constraint error rejects the transaction and commits no partial writes", async () => {
    const id = randomUUID();
    const insert = {
      id,
      name: "Fictional rollback fixture",
      email: `${id}@example.test`,
    };
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(s.user).values(insert);
        await expect(tx.insert(s.user).values(insert)).rejects.toMatchObject({
          cause: { code: "23505" },
        });
      }),
    ).rejects.toMatchObject({ code: "23505" });
    expect(await db.select().from(s.user).where(eq(s.user.id, id))).toEqual([]);
    // The same single-connection production pool is safe to use after rollback.
    const [saved] = await db.insert(s.user).values(insert).returning();
    expect(saved.id).toBe(id);
  });

  test("a failed nested transaction rolls back its savepoint while its parent commits", async () => {
    const outerId = randomUUID();
    const innerId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(s.user).values({
        id: outerId,
        name: "Fictional outer fixture",
        email: `${outerId}@example.test`,
      });
      await expect(
        tx.transaction(async (nested) => {
          await nested.insert(s.user).values({
            id: innerId,
            name: "Fictional inner fixture",
            email: `${innerId}@example.test`,
          });
          nested.rollback();
        }),
      ).rejects.toThrow();
    });
    expect(
      await db.select().from(s.user).where(eq(s.user.id, outerId)),
    ).toHaveLength(1);
    expect(
      await db.select().from(s.user).where(eq(s.user.id, innerId)),
    ).toEqual([]);
  });

  test("a completed transaction cannot later write through the released connection", async () => {
    const id = randomUUID();
    let lateWrite: () => Promise<unknown> = async () => {};
    await db.transaction(async (tx) => {
      lateWrite = async () =>
        tx.insert(s.user).values({
          id,
          name: "Fictional released fixture",
          email: `${id}@example.test`,
        });
      await tx.execute(sql`select 1`);
    });
    await expect(lateWrite()).rejects.toThrow();
    expect(await db.select().from(s.user).where(eq(s.user.id, id))).toEqual([]);
  });
});
