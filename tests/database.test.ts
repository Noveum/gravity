import { afterAll, beforeAll, expect, test } from "vitest";
import { createLocalDatabase } from "../packages/database/client";
import { databaseOptions } from "../packages/database/config";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
beforeAll(async () => {
  local = await createLocalDatabase();
  await local.client.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE gravity_test_runtime NOLOGIN IN ROLE gravity_app;
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    INSERT INTO public.organizations (name, slug) VALUES ('Permission fixture', 'permission-fixture');
  `);
});
afterAll(async () => local.client.close());

test("all CRM and authentication tables have RLS with only the trusted server policy", async () => {
  const tables = await local.client.query<{ relrowsecurity: boolean }>(`
    SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  `);
  expect(tables.rows).toHaveLength(42);
  expect(tables.rows.every((table) => table.relrowsecurity)).toBe(true);
  const policies = await local.client.query<{ roles: string[] }>(`
    SELECT roles FROM pg_policies WHERE schemaname = 'public'
  `);
  expect(policies.rows).toHaveLength(42);
  expect(
    policies.rows.every((policy) => policy.roles.join() === "gravity_app"),
  ).toBe(true);
});

test("browser roles cannot read CRM, sessions, or signing keys even if table grants are accidentally restored", async () => {
  for (const role of ["anon", "authenticated"]) {
    for (const table of [
      "organizations",
      "session",
      "jwks",
      "provider_configurations",
    ]) {
      await local.client.exec(
        `GRANT SELECT, INSERT ON public.${table} TO ${role}`,
      );
      await local.client.exec(`SET ROLE ${role}`);
      try {
        const result = await local.client.query(
          `SELECT * FROM public.${table}`,
        );
        expect(result.rows).toEqual([]);
        if (table === "organizations")
          await expect(
            local.client.exec(
              "INSERT INTO public.organizations (name, slug) VALUES ('Denied', 'denied')",
            ),
          ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await local.client.exec("RESET ROLE");
      }
    }
  }
});

test("runtime role can transact but cannot truncate tables or bypass RLS", async () => {
  await local.client.exec("SET ROLE gravity_test_runtime");
  try {
    const result = await local.client.query(
      "SELECT * FROM public.organizations",
    );
    expect(result.rows).toHaveLength(1);
    await local.client.exec(
      "BEGIN; INSERT INTO public.organizations (name, slug) VALUES ('Transaction fixture', 'transaction-fixture'); ROLLBACK;",
    );
    await expect(
      local.client.exec("TRUNCATE public.organizations CASCADE"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      local.client.exec(
        "ALTER TABLE public.organizations DISABLE ROW LEVEL SECURITY",
      ),
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await local.client.exec("RESET ROLE");
  }
});

test("managed database connections verify certificates and bound serverless connections", () => {
  const options = databaseOptions(
    "postgresql://app:secret@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=require",
    {},
  );
  expect(options.ssl).toEqual({ rejectUnauthorized: true });
  expect(options.max).toBe(1);
  expect(options.prepare).toBe(false);
  expect(
    databaseOptions("postgresql://app:secret@localhost/db", {
      DATABASE_SSL_MODE: "disable",
    }).ssl,
  ).toBe(false);
  expect(() =>
    databaseOptions("postgresql://app:secret@db.example/db", {
      DATABASE_SSL_MODE: "disable",
    }),
  ).toThrow("DATABASE_TLS_REQUIRED");
  expect(() =>
    databaseOptions("postgresql://app:secret@localhost/db", {
      DATABASE_SSL_MODE: "disable",
      NODE_ENV: "production",
    }),
  ).toThrow("DATABASE_TLS_REQUIRED");
  expect(() =>
    databaseOptions(
      "postgresql://app:secret@aws-0-region.pooler.supabase.com:6543/postgres",
      {},
    ),
  ).toThrow("DATABASE_SESSION_POOLER_REQUIRED");
  expect(() => databaseOptions("not-a-url-containing-secret", {})).toThrow(
    "DATABASE_URL_INVALID",
  );
});
