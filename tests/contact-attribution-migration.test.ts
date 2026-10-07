import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { demoId } from "../packages/database/seed";

test("0023/0024 preserve populated records and enforce import isolation without inventing attribution", async () => {
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
    await client.exec(`
      INSERT INTO organizations (id, name, slug) VALUES ('${demoId(2)}', 'Other fictional tenant', 'other-fictional');
      INSERT INTO memberships (organization_id, user_id, role) VALUES ('${demoId(2)}', 'fixture-owner', 'admin');
      INSERT INTO products (id, organization_id, name) VALUES ('${demoId(11)}', '${demoId(2)}', 'Other tenant product'), ('${demoId(13)}', '${demoId(1)}', 'Second product');
      INSERT INTO people (id, organization_id, name) VALUES ('${demoId(201)}', '${demoId(2)}', 'Other tenant contact');
      INSERT INTO connections (id, organization_id, owner_id, product_id, provider, external_account_id) VALUES ('${demoId(900)}', '${demoId(2)}', 'fixture-owner', '${demoId(11)}', 'gmail', 'fictional-private-account');
      INSERT INTO contact_import_batches (id, organization_id, product_id, submitted_by, source_kind, label, submission_key, transport) VALUES ('${demoId(700)}', '${demoId(1)}', '${demoId(10)}', 'fixture-owner', 'file', 'Fictional batch', 'fixture-key', 'session');
    `);
    const contribution = (values: string, columns = "") =>
      client.exec(`
      INSERT INTO contact_contributions (organization_id, person_id, product_id, kind, transport${columns})
      VALUES (${values})
    `);
    await expect(
      contribution(
        `'${demoId(1)}', '${demoId(201)}', '${demoId(10)}', 'submitted', 'session'`,
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      contribution(
        `'${demoId(1)}', '${demoId(200)}', '${demoId(11)}', 'submitted', 'session'`,
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      contribution(
        `'${demoId(1)}', '${demoId(200)}', '${demoId(13)}', 'submitted', 'session', '${demoId(700)}', 'row-1', 'fixture-hash'`,
        ", batch_id, source_record_id, request_hash",
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      contribution(
        `'${demoId(1)}', '${demoId(200)}', '${demoId(10)}', 'submitted', 'session', '${demoId(700)}', 'row-1'`,
        ", batch_id, source_record_id",
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      contribution(
        `'${demoId(1)}', '${demoId(200)}', '${demoId(10)}', 'provider_import', 'system', '${demoId(900)}', 'provider-row'`,
        ", connection_id, source_record_id",
      ),
    ).rejects.toMatchObject({ code: "23503" });
    const valid = `'${demoId(1)}', '${demoId(200)}', '${demoId(10)}', 'submitted', 'session', '${demoId(700)}', 'row-1', 'fixture-hash'`;
    const sourceColumns = ", batch_id, source_record_id, request_hash";
    await contribution(valid, sourceColumns);
    await expect(contribution(valid, sourceColumns)).rejects.toMatchObject({
      code: "23505",
    });
    expect(
      (
        await client.query("SELECT * FROM people WHERE organization_id = $1", [
          demoId(1),
        ])
      ).rows,
    ).toEqual(beforePeople);
    expect((await client.query("SELECT * FROM relationships")).rows).toEqual(
      beforeRelationships,
    );
  } finally {
    await client.close();
    await rm(folder, { recursive: true, force: true });
  }
});
