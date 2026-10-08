import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import * as schema from "../packages/database/schema";

test("the generated upgrade preserves populated actions/provider history and is repeatable", async () => {
  const folder = await mkdtemp(join(tmpdir(), "gravity-remaining-features-"));
  const client = new PGlite();
  try {
    await cp(join(process.cwd(), "drizzle"), folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    await writeFile(
      journalPath,
      JSON.stringify({
        ...journal,
        entries: journal.entries.filter(
          (entry: { idx: number }) => entry.idx <= 24,
        ),
      }),
    );
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: folder });
    await client.exec(`
      INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES ('fictional-upgrade-owner','Fictional owner','upgrade@example.test',true,now(),now());
      INSERT INTO organizations (id,name,slug) VALUES ('10000000-0000-4000-8000-000000000001','Fictional organization','fictional-upgrade');
      INSERT INTO memberships (organization_id,user_id,role) VALUES ('10000000-0000-4000-8000-000000000001','fictional-upgrade-owner','admin');
      INSERT INTO products (id,organization_id,name) VALUES ('10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000001','Fictional product');
      INSERT INTO people (id,organization_id,name) VALUES ('10000000-0000-4000-8000-000000000200','10000000-0000-4000-8000-000000000001','Fictional person');
      INSERT INTO relationships (id,organization_id,product_id,person_id,owner_id) VALUES ('10000000-0000-4000-8000-000000000300','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000200','fictional-upgrade-owner');
      INSERT INTO actions (organization_id,product_id,relationship_id,owner_id,kind,title,reason,owed_by,channel,due_at,draft,version) VALUES ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000300','fictional-upgrade-owner','review','Fictional review','{"legacy":"Fictional unchanged source"}','us','research','2026-10-01T12:34:56.123Z','Fictional unchanged draft',7);
      INSERT INTO connections (id,organization_id,owner_id,provider,external_account_id,display_name) VALUES ('10000000-0000-4000-8000-000000000700','10000000-0000-4000-8000-000000000001','fictional-upgrade-owner','gmail','fictional-upgrade-account','Fictional account');
      INSERT INTO conversations (id,organization_id,product_id,relationship_id,connection_id,external_thread_id,owner_id,channel) VALUES ('10000000-0000-4000-8000-000000000710','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000300','10000000-0000-4000-8000-000000000700','fictional-upgrade-thread','fictional-upgrade-owner','gmail');
      INSERT INTO messages (organization_id,product_id,conversation_id,connection_id,provider_message_id,direction,body,occurred_at) VALUES ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000710','10000000-0000-4000-8000-000000000700','fictional-upgrade-message','outbound','Fictional unchanged body','2026-10-01T12:34:56.123Z');
    `);
    await client.exec(`
      INSERT INTO contact_import_batches (id,organization_id,product_id,submitted_by,source_kind,label,submission_key,transport) VALUES ('10000000-0000-4000-8000-000000000800','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000010','fictional-upgrade-owner','file','Fictional import','fictional-upgrade-import','demo');
      INSERT INTO contact_contributions (organization_id,person_id,product_id,actor_id,kind,transport,batch_id,source_record_id,request_hash) VALUES ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000200','10000000-0000-4000-8000-000000000010','fictional-upgrade-owner','created','demo','10000000-0000-4000-8000-000000000800','fictional-row-1','fictional-source-hash');
    `);
    const beforeAttribution = (
      await client.query("SELECT * FROM contact_contributions ORDER BY id")
    ).rows;
    const beforeBatches = (
      await client.query("SELECT * FROM contact_import_batches ORDER BY id")
    ).rows;
    const beforeActions = (
      await client.query(
        "SELECT id, reason, draft, version, status, due_at FROM actions ORDER BY id",
      )
    ).rows;
    const beforeMessages = (
      await client.query("SELECT * FROM messages ORDER BY id")
    ).rows;
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(db, { migrationsFolder: folder });
    await migrate(db, { migrationsFolder: folder });
    expect(
      (await client.query("SELECT * FROM contact_contributions ORDER BY id"))
        .rows,
    ).toEqual(beforeAttribution);
    expect(
      (await client.query("SELECT * FROM contact_import_batches ORDER BY id"))
        .rows,
    ).toEqual(beforeBatches);
    expect(
      (
        await client.query(
          "SELECT id, reason, draft, version, status, due_at FROM actions ORDER BY id",
        )
      ).rows,
    ).toEqual(beforeActions);
    expect(
      (await client.query("SELECT * FROM messages ORDER BY id")).rows,
    ).toEqual(beforeMessages);
    expect(
      (
        await client.query<{ reason_source: string | null }>(
          "SELECT reason_source FROM actions",
        )
      ).rows.every((row) => row.reason_source === null),
    ).toBe(true);
    expect(
      (
        await client.query<{ provenance: string }>(
          "SELECT provenance FROM conversations",
        )
      ).rows.every((row) => row.provenance === "provider"),
    ).toBe(true);
    for (const table of [
      "native_drafts",
      "internal_tasks",
      "yodu_sources",
      "yodu_bindings",
      "yodu_events",
    ])
      expect((await client.query(`SELECT * FROM ${table}`)).rows).toEqual([]);
  } finally {
    await client.close();
    await rm(folder, { recursive: true, force: true });
  }
});
