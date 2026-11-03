import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { demoId } from "../packages/database/seed";

test("0027 upgrades populated main0026 preserving materials and grants", async () => {
  const folder = await mkdtemp(join(tmpdir(), "gravity-material-migration-"));
  const client = new PGlite();
  try {
    await cp(join(process.cwd(), "drizzle"), folder, { recursive: true });
    const path = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(path, "utf8"));
    await writeFile(
      path,
      JSON.stringify({
        ...journal,
        entries: journal.entries.filter((e: { idx: number }) => e.idx <= 26),
      }),
    );
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: folder });
    await client.exec(`
      INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES ('fixture-owner','Fictional owner','owner@example.test',true,now(),now());
      INSERT INTO organizations(id,name,slug) VALUES ('${demoId(1)}','Fictional','fictional');
      INSERT INTO memberships(organization_id,user_id,role) VALUES ('${demoId(1)}','fixture-owner','admin');
      INSERT INTO products(id,organization_id,name) VALUES ('${demoId(10)}','${demoId(1)}','Fictional product');
      INSERT INTO folders(id,organization_id,product_id,name) VALUES ('${demoId(900)}','${demoId(1)}','${demoId(10)}','Fictional folder');
      INSERT INTO assets(id,organization_id,product_id,folder_id,name,storage_key,mime_type,size,sha256,uploaded_by) VALUES ('${demoId(901)}','${demoId(1)}','${demoId(10)}','${demoId(900)}','Legacy.md','${demoId(902)}','text/markdown',12,'${"a".repeat(64)}','fixture-owner');
    `);
    const before = (await client.query("SELECT * FROM assets")).rows;
    await writeFile(path, JSON.stringify(journal));
    await migrate(db, { migrationsFolder: folder });
    await migrate(db, { migrationsFolder: folder });
    expect((await client.query("SELECT * FROM assets")).rows).toEqual(before);
    expect((await client.query("SELECT * FROM asset_upload")).rows).toEqual([]);
    await client.exec("SET ROLE gravity_app");
    await client.exec(
      `INSERT INTO asset_upload(id,organization_id,product_id,folder_id,name,mime_type,size,storage_key,uploaded_by,expires_at,completed_asset_id) VALUES ('${demoId(903)}','${demoId(1)}','${demoId(10)}','${demoId(900)}','Fictional.md','text/markdown',104857600,'fixture','fixture-owner',now(),'${demoId(901)}')`,
    );
    await client.exec("RESET ROLE");
    const policies = await client.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE relname='asset_upload'",
    );
    expect(policies.rows[0]?.relrowsecurity).toBe(true);
  } finally {
    await client.close();
    await rm(folder, { recursive: true, force: true });
  }
});
