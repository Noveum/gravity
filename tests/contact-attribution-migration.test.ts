import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { demoId } from "../packages/database/seed";

test("0023 preserves populated contacts, owners, versions and notes without inventing attribution", async () => {
  const folder = await mkdtemp(join(tmpdir(), "gravity-attribution-"));
  const client = new PGlite();
  try {
    await cp(join(process.cwd(), "drizzle"), folder, { recursive: true });
    const path = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(path, "utf8"));
    await writeFile(
      path,
      JSON.stringify({
        ...journal,
        entries: journal.entries.filter(
          (entry: { idx: number }) => entry.idx <= 22,
        ),
      }),
    );
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: folder });
    await client.exec(`
      INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('fixture-owner', 'Fictional owner', 'owner@example.test', true, now(), now());
      INSERT INTO organizations (id, name, slug) VALUES ('${demoId(1)}', 'Fictional', 'fictional');
      INSERT INTO memberships (organization_id, user_id, role) VALUES ('${demoId(1)}', 'fixture-owner', 'admin');
      INSERT INTO products (id, organization_id, name) VALUES ('${demoId(10)}', '${demoId(1)}', 'Fictional product');
      INSERT INTO people (id, organization_id, name, summary, version) VALUES ('${demoId(200)}', '${demoId(1)}', 'Legacy fixture', 'Original imported notes', 7);
      INSERT INTO relationships (id, organization_id, product_id, person_id, owner_id, context, version) VALUES ('${demoId(300)}', '${demoId(1)}', '${demoId(10)}', '${demoId(200)}', 'fixture-owner', 'Original context', 4);
    `);
    const beforePeople = (await client.query("SELECT * FROM people")).rows;
    const beforeRelationships = (
      await client.query("SELECT * FROM relationships")
    ).rows;
    await writeFile(path, JSON.stringify(journal));
    await migrate(db, { migrationsFolder: folder });
    await migrate(db, { migrationsFolder: folder });
    expect((await client.query("SELECT * FROM people")).rows).toEqual(
      beforePeople,
    );
    expect((await client.query("SELECT * FROM relationships")).rows).toEqual(
      beforeRelationships,
    );
    expect(
      (await client.query("SELECT * FROM contact_contributions")).rows,
    ).toEqual([]);
    expect(
      (await client.query("SELECT * FROM contact_import_batches")).rows,
    ).toEqual([]);
  } finally {
    await client.close();
    await rm(folder, { recursive: true, force: true });
  }
});
