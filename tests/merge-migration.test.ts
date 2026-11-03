import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { RecordService } from "../packages/core/records";
import * as s from "../packages/database/schema";
import { demoId } from "../packages/database/seed";

test("populated pre-merge schema upgrades without losing creator or enrolled-touch history", async () => {
  const folder = await mkdtemp(join(tmpdir(), "gravity-merge-upgrade-"));
  const client = new PGlite();
  const org = demoId(1),
    product = demoId(10),
    target = demoId(20),
    source = demoId(21),
    tr = demoId(30),
    sr = demoId(31),
    sequence = demoId(40),
    enrollment = demoId(41),
    touch = demoId(42);
  try {
    await cp(join(process.cwd(), "drizzle"), folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    const merge = journal.entries.find((entry) =>
      entry.tag.endsWith("_merge_history"),
    );
    if (!merge) throw new Error("Missing merge migration");
    await writeFile(
      journalPath,
      JSON.stringify({
        ...journal,
        entries: journal.entries.filter((entry) => entry.idx < merge.idx),
      }),
    );
    const db = drizzle(client, { schema: s });
    await migrate(db, { migrationsFolder: folder });
    await client.exec(`
      INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES ('fixture-owner','Owner','owner@example.test',true,now(),now());
      INSERT INTO organizations (id,name,slug) VALUES ('${org}','Fixture','fixture');
      INSERT INTO memberships (organization_id,user_id,role) VALUES ('${org}','fixture-owner','admin');
      INSERT INTO products (id,organization_id,name) VALUES ('${product}','${org}','Fixture');
      INSERT INTO people (id,organization_id,name) VALUES ('${target}','${org}','Canonical'),('${source}','${org}','Duplicate');
      INSERT INTO relationships (id,organization_id,product_id,person_id,owner_id,context) VALUES ('${tr}','${org}','${product}','${target}','fixture-owner','Canonical context'),('${sr}','${org}','${product}','${source}','fixture-owner','Original context');
      INSERT INTO contact_contributions (organization_id,person_id,product_id,actor_id,kind,transport) VALUES ('${org}','${target}','${product}','fixture-owner','created','session'),('${org}','${source}','${product}','fixture-owner','created','session');
      INSERT INTO sequences (id,organization_id,product_id,name,steps) VALUES ('${sequence}','${org}','${product}','Fixture','[]');
      INSERT INTO enrollments (id,organization_id,product_id,relationship_id,sequence_id,status) VALUES ('${enrollment}','${org}','${product}','${sr}','${sequence}','running');
      INSERT INTO touches (id,organization_id,product_id,relationship_id,enrollment_id,step_number,follow_up,channel,sender_id,due_at) VALUES ('${touch}','${org}','${product}','${sr}','${enrollment}',1,0,'gmail','fixture-owner',now());
    `);
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(db, { migrationsFolder: folder });
    await new RecordService(db).mergeRecords(
      { userId: "fixture-owner", source: "session" },
      {
        organizationId: org,
        entity: "person",
        targetId: target,
        sourceId: source,
        targetVersion: 1,
        sourceVersion: 1,
      },
    );
    expect(
      await db
        .select()
        .from(s.contactContributions)
        .where(eq(s.contactContributions.kind, "created")),
    ).toHaveLength(2);
    expect(
      (await db.select().from(s.touches).where(eq(s.touches.id, touch)))[0],
    ).toMatchObject({ relationshipId: tr, enrollmentId: enrollment });
    expect(
      (
        await db
          .select()
          .from(s.relationships)
          .where(eq(s.relationships.id, tr))
      )[0].mergeHistory,
    ).toEqual([expect.objectContaining({ context: "Original context" })]);
  } finally {
    await client.close();
    await rm(folder, { recursive: true, force: true });
  }
});
