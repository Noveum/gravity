import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, test } from "vitest";
import { demoId } from "../packages/database/seed";

test("upgrading existing deals preserves stage IDs and values without inventing historical dates", async () => {
  const db = new PGlite();
  try {
    // Supabase can grant new tables to API roles through default privileges.
    await db.exec(
      "CREATE ROLE anon; ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO anon;",
    );
    const journal = JSON.parse(
      await readFile("drizzle/meta/_journal.json", "utf8"),
    );
    for (const entry of journal.entries.filter(
      (e: { idx: number }) => e.idx < 9,
    ))
      await db.exec(await readFile(`drizzle/${entry.tag}.sql`, "utf8"));
    await db.query('INSERT INTO "user" (id,name,email) VALUES ($1,$2,$3)', [
      "legacy-owner",
      "Fictional Owner",
      "legacy@example.test",
    ]);
    await db.query(
      "INSERT INTO organizations (id,name,slug) VALUES ($1,$2,$3)",
      [demoId(1), "Fictional Company", "legacy-fixture"],
    );
    await db.query(
      "INSERT INTO memberships (organization_id,user_id,role) VALUES ($1,$2,'admin')",
      [demoId(1), "legacy-owner"],
    );
    await db.query(
      "INSERT INTO products (id,organization_id,name) VALUES ($1,$2,$3)",
      [demoId(10), demoId(1), "Fictional Product"],
    );
    await db.query(
      "INSERT INTO people (id,organization_id,name) VALUES ($1,$2,$3)",
      [demoId(200), demoId(1), "Fictional Buyer"],
    );
    await db.query(
      "INSERT INTO relationships (id,organization_id,product_id,person_id,owner_id) VALUES ($1,$2,$3,$4,$5)",
      [demoId(300), demoId(1), demoId(10), demoId(200), "legacy-owner"],
    );
    await db.query(
      "INSERT INTO stages (id,organization_id,product_id,name,position) VALUES ($1,$2,$3,'Won',3)",
      [demoId(803), demoId(1), demoId(10)],
    );
    await db.query(
      "INSERT INTO opportunities (id,organization_id,product_id,relationship_id,stage_id,name,amount_minor,currency,version) VALUES ($1,$2,$3,$4,$5,$6,500000,'USD',7)",
      [
        demoId(1100),
        demoId(1),
        demoId(10),
        demoId(300),
        demoId(803),
        "Legacy fixture",
      ],
    );
    await db.exec(await readFile("drizzle/0009_eminent_photon.sql", "utf8"));
    const deals = await db.query(
      "SELECT stage_id,amount_minor,currency,version,status,owner_id,created_at,closed_at FROM opportunities",
    );
    expect(deals.rows).toEqual([
      {
        stage_id: demoId(803),
        amount_minor: 500000,
        currency: "USD",
        version: 7,
        status: "won",
        owner_id: "legacy-owner",
        created_at: null,
        closed_at: null,
      },
    ]);
    const stages = await db.query(
      "SELECT id,kind,pipeline_id FROM stages ORDER BY position",
    );
    expect(stages.rows).toHaveLength(2);
    expect(stages.rows[0]).toMatchObject({ id: demoId(803), kind: "won" });
    expect(stages.rows[1]).toMatchObject({
      kind: "lost",
      pipeline_id: (stages.rows[0] as { pipeline_id: string }).pipeline_id,
    });
    const grants = await db.query(
      "SELECT has_table_privilege('gravity_app','pipelines','SELECT') AS allowed,has_table_privilege('anon','pipelines','SELECT') AS public_allowed",
    );
    expect(grants.rows).toEqual([{ allowed: true, public_allowed: false }]);
  } finally {
    await db.close();
  }
});
