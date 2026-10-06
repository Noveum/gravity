import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { emptyRelationshipDetails } from "../packages/core/relationship-context";
import { demoId } from "../packages/database/seed";

test("upgrading populated 0013 preserves legacy context and versions while adding structured defaults", async () => {
  const folder = await mkdtemp(join(tmpdir(), "gravity-context-"));
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
          (entry: { idx: number }) => entry.idx <= 13,
        ),
      }),
    );
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: folder });
    await client.exec(`
   INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('context-fixture', 'Fictional', 'context@example.test', true, now(), now());
   INSERT INTO organizations (id, name, slug) VALUES ('${demoId(1)}', 'Fictional', 'fictional');
   INSERT INTO memberships (organization_id, user_id, role) VALUES ('${demoId(1)}', 'context-fixture', 'admin');
   INSERT INTO products (id, organization_id, name) VALUES ('${demoId(10)}', '${demoId(1)}', 'Fictional product');
   INSERT INTO people (id, organization_id, name) VALUES ('${demoId(200)}', '${demoId(1)}', 'Fictional person');
  `);
    const source = JSON.stringify({
      relationship: "Fictional imported history",
      permission: false,
    });
    await client.query(
      "INSERT INTO relationships (id, organization_id, product_id, person_id, owner_id, context, version) VALUES ($1, $2, $3, $4, $5, $6, 7)",
      [
        demoId(300),
        demoId(1),
        demoId(10),
        demoId(200),
        "context-fixture",
        source,
      ],
    );
    await writeFile(path, JSON.stringify(journal));
    await migrate(db, { migrationsFolder: folder });
    const result = await client.query<{
      context: string;
      context_source: string | null;
      context_details: unknown;
      version: number;
    }>(
      "SELECT context, context_source, context_details, version FROM relationships",
    );
    expect(result.rows).toEqual([
      {
        context: source,
        context_source: null,
        context_details: emptyRelationshipDetails(),
        version: 7,
      },
    ]);
    await migrate(db, { migrationsFolder: folder });
    expect(
      (await client.query("SELECT version FROM relationships")).rows,
    ).toEqual([{ version: 7 }]);
  } finally {
    await client.close();
    await rm(folder, { recursive: true, force: true });
  }
});
