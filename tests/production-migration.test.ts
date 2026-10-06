import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { demoId } from "../packages/database/seed";

const org = demoId(1);
const id = (n: number) => demoId(5000 + n);

test("a populated database at 0013 runs 0014 to the latest migration in one go and the runtime role can use every table", async () => {
  const folder = await mkdtemp(join(tmpdir(), "gravity-production-"));
  const client = new PGlite();
  try {
    await cp(join(process.cwd(), "drizzle"), folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    const latest = Math.max(...journal.entries.map((entry) => entry.idx));
    expect(latest).toBeGreaterThanOrEqual(21);
    await writeFile(
      journalPath,
      JSON.stringify({
        ...journal,
        entries: journal.entries.filter((entry) => entry.idx <= 13),
      }),
    );
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: folder });
    await client.exec(`
      INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
        VALUES ('fixture-owner', 'Owner', 'owner@example.test', true, now(), now());
      INSERT INTO organizations (id, name, slug, timezone) VALUES ('${org}', 'Fixture', 'fixture', 'Asia/Kolkata');
      INSERT INTO memberships (organization_id, user_id, role) VALUES ('${org}', 'fixture-owner', 'admin');
      INSERT INTO products (id, organization_id, name, color) VALUES
        ('${id(1)}', '${org}', 'Teal product', '#418CA0'),
        ('${id(2)}', '${org}', 'Short red', '#c55'),
        ('${id(3)}', '${org}', 'Unreadable', 'not-a-colour');
      INSERT INTO people (id, organization_id, name, linkedin_url, do_not_contact, created_at) VALUES
        ('${id(10)}', '${org}', 'Older', 'https://www.linkedin.com/in/shared/', false, '2025-01-01'),
        ('${id(11)}', '${org}', 'Newer opted out', 'https://www.linkedin.com/in/SHARED/', true, '2025-02-01'),
        ('${id(12)}', '${org}', 'Newest', 'https://www.linkedin.com/in/shared/', false, '2025-03-01');
      INSERT INTO pipelines (id, organization_id, product_id, name) VALUES ('${id(20)}', '${org}', '${id(1)}', 'Deals');
      INSERT INTO stages (id, organization_id, product_id, pipeline_id, pipeline, name, position, category)
        VALUES ('${id(21)}', '${org}', '${id(1)}', '${id(20)}', 'deal', 'Won', 1, 'won');
      INSERT INTO relationships (id, organization_id, product_id, person_id, owner_id)
        VALUES ('${id(30)}', '${org}', '${id(1)}', '${id(10)}', 'fixture-owner');
      INSERT INTO opportunities (id, organization_id, product_id, relationship_id, stage_id, name, status, updated_at)
        VALUES ('${id(40)}', '${org}', '${id(1)}', '${id(30)}', '${id(21)}', 'Won deal', 'won', '2025-06-01T00:00:00Z');
    `);
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(db, { migrationsFolder: folder });
    const products = await client.query<{ id: string; color_key: string }>(
      "SELECT id, color_key FROM products ORDER BY id",
    );
    expect(products.rows.map((row) => row.color_key)).toEqual([
      "teal",
      "red",
      "violet",
    ]);
    const people = await client.query<{ id: string; linkedin_url: string }>(
      "SELECT id, linkedin_url FROM people ORDER BY id",
    );
    expect(people.rows.map((row) => row.linkedin_url)).toEqual([
      "",
      "https://www.linkedin.com/in/SHARED/",
      "",
    ]);
    const cleared = await client.query<{ entity_id: string }>(
      "SELECT entity_id FROM change_events WHERE type = 'person.linkedin_cleared' ORDER BY entity_id",
    );
    expect(cleared.rows.map((row) => row.entity_id)).toEqual([id(10), id(12)]);
    const deal = await client.query<{ closed_at: Date | null }>(
      `SELECT closed_at FROM opportunities WHERE id = '${id(40)}'`,
    );
    expect(deal.rows[0]?.closed_at?.toISOString()).toBe(
      "2025-06-01T00:00:00.000Z",
    );
    const organization = await client.query<{
      allowed_email_domains: string[];
    }>(`SELECT allowed_email_domains FROM organizations WHERE id = '${org}'`);
    expect(organization.rows[0]?.allowed_email_domains).toEqual([]);
    const tables = await client.query<{ table_name: string; column: string }>(`
      SELECT c.relname AS table_name, a.attname AS column
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = 1
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname
    `);
    expect(tables.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        "invitations",
        "organizations",
        "products",
        "people",
        "relationships",
        "sequences",
      ]),
    );
    await client.exec(
      "CREATE ROLE gravity_runtime_probe NOLOGIN IN ROLE gravity_app",
    );
    await client.exec("SET ROLE gravity_runtime_probe");
    try {
      for (const { table_name: table, column } of tables.rows) {
        const name = `public."${table}"`;
        await client.query(`SELECT * FROM ${name} LIMIT 1`);
        await client.exec(
          `INSERT INTO ${name} SELECT * FROM ${name} WHERE false`,
        );
        await client.exec(
          `UPDATE ${name} SET "${column}" = "${column}" WHERE false`,
        );
        await client.exec(`DELETE FROM ${name} WHERE false`);
      }
      await client.exec(`
        INSERT INTO invitations (organization_id, email, role, product_ids, token_hash, inviter_id, expires_at)
          VALUES ('${org}', 'probe@example.test', 'member', '["${id(1)}"]', '${"c".repeat(64)}', 'fixture-owner', now() + interval '14 days');
        UPDATE invitations SET revoked_at = now() WHERE email = 'probe@example.test';
        DELETE FROM invitations WHERE email = 'probe@example.test';
        UPDATE products SET color_key = 'gray', archived_at = now() WHERE id = '${id(3)}';
        UPDATE organizations SET allowed_email_domains = '["example.test"]' WHERE id = '${org}';
      `);
    } finally {
      await client.exec("RESET ROLE");
    }
  } finally {
    await client.close();
    await rm(folder, { recursive: true, force: true });
  }
});
