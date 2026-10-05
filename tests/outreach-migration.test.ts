import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, test } from "vitest";
import { demoId } from "../packages/database/seed";

const org = demoId(1);

describe("the outreach migration", () => {
  test("a database at 0009 gains outreach stages, reshaped enrollments, staged relationships and step templates", async () => {
    const folder = await mkdtemp(join(tmpdir(), "gravity-outreach-"));
    const client = new PGlite();
    try {
      await cp(join(process.cwd(), "drizzle"), folder, { recursive: true });
      const journalPath = join(folder, "meta", "_journal.json");
      const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
        entries: { tag: string }[];
      };
      await writeFile(
        journalPath,
        JSON.stringify({
          ...journal,
          entries: journal.entries.filter(
            (entry) => entry.tag !== "0010_outreach",
          ),
        }),
      );
      const db = drizzle(client);
      await migrate(db, { migrationsFolder: folder });
      const steps = JSON.stringify(
        [0, 3, 5, 5, 7].map((delayDays, index) => ({
          number: index + 1,
          name: `Step ${index + 1}`,
          delayDays,
          channel: "gmail",
        })),
      );
      await client.exec(`
        INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
          VALUES ('fixture-user', 'Fixture', 'fixture@example.test', true, now(), now());
        INSERT INTO organizations (id, name, slug) VALUES ('${org}', 'Fixture', 'fixture');
        INSERT INTO memberships (organization_id, user_id, role) VALUES ('${org}', 'fixture-user', 'admin');
        INSERT INTO products (id, organization_id, name) VALUES
          ('${demoId(10)}', '${org}', 'First'),
          ('${demoId(11)}', '${org}', 'Second');
        INSERT INTO stages (organization_id, product_id, name, position, category) VALUES
          ('${org}', '${demoId(10)}', 'Discovery', 0, 'open'),
          ('${org}', '${demoId(10)}', 'Won', 1, 'won');
        INSERT INTO people (id, organization_id, name) VALUES
          ('${demoId(200)}', '${org}', 'Fixture person'),
          ('${demoId(201)}', '${org}', 'Second person');
        INSERT INTO relationships (id, organization_id, product_id, person_id, owner_id) VALUES
          ('${demoId(300)}', '${org}', '${demoId(10)}', '${demoId(200)}', 'fixture-user'),
          ('${demoId(301)}', '${org}', '${demoId(11)}', '${demoId(201)}', 'fixture-user');
        INSERT INTO sequences (id, organization_id, product_id, name, steps) VALUES
          ('${demoId(400)}', '${org}', '${demoId(10)}', 'Fixture sequence', '${steps}'),
          ('${demoId(401)}', '${org}', '${demoId(11)}', 'Second sequence', '${steps}');
        INSERT INTO enrollments (id, organization_id, product_id, relationship_id, sequence_id, status) VALUES
          ('${demoId(500)}', '${org}', '${demoId(10)}', '${demoId(300)}', '${demoId(400)}', 'paused_reply'),
          ('${demoId(501)}', '${org}', '${demoId(11)}', '${demoId(301)}', '${demoId(401)}', 'paused_reply'),
          ('${demoId(502)}', '${org}', '${demoId(11)}', '${demoId(301)}', '${demoId(401)}', 'running'),
          ('${demoId(503)}', '${org}', '${demoId(10)}', '${demoId(300)}', '${demoId(400)}', 'completed'),
          ('${demoId(504)}', '${org}', '${demoId(10)}', '${demoId(300)}', '${demoId(400)}', 'paused_archived');
        INSERT INTO connections (id, organization_id, owner_id, provider, external_account_id, status) VALUES
          ('${demoId(700)}', '${org}', 'fixture-user', 'gmail', 'fixture-gmail', 'demo');
        INSERT INTO conversations (id, organization_id, product_id, relationship_id, connection_id, external_thread_id, owner_id, channel) VALUES
          ('${demoId(710)}', '${org}', '${demoId(10)}', '${demoId(300)}', '${demoId(700)}', 'fixture-thread', 'fixture-user', 'gmail');
        INSERT INTO messages (organization_id, product_id, conversation_id, connection_id, provider_message_id, direction, body, occurred_at) VALUES
          ('${org}', '${demoId(10)}', '${demoId(710)}', '${demoId(700)}', 'out-1', 'outbound', 'Fictional', '2026-09-01T10:00:00Z'),
          ('${org}', '${demoId(10)}', '${demoId(710)}', '${demoId(700)}', 'in-1', 'inbound', 'Fictional', '2026-09-02T10:00:00Z'),
          ('${org}', '${demoId(10)}', '${demoId(710)}', '${demoId(700)}', 'in-2', 'inbound', 'Fictional', '2026-09-03T10:00:00Z');
      `);
      await writeFile(journalPath, JSON.stringify(journal));
      await migrate(db, { migrationsFolder: folder });

      const stages = await client.query<{
        product_id: string;
        name: string;
        position: number;
        pipeline: string;
        category: string;
      }>(
        "SELECT product_id, name, position, pipeline, category FROM stages ORDER BY product_id, pipeline, position",
      );
      const outreach = [
        ["New", "open"],
        ["Researching", "open"],
        ["Contacted", "open"],
        ["Follow-up", "open"],
        ["Replied", "open"],
        ["Meeting", "open"],
        ["Won", "won"],
        ["Lost", "lost"],
        ["Not now", "hold"],
      ];
      for (const product of [demoId(10), demoId(11)])
        expect(
          stages.rows
            .filter(
              (row) =>
                row.product_id === product && row.pipeline === "outreach",
            )
            .map((row) => [row.name, row.category]),
        ).toEqual(outreach);
      expect(
        stages.rows
          .filter((row) => row.pipeline === "deal")
          .map((row) => [row.name, row.category]),
      ).toEqual([
        ["Discovery", "open"],
        ["Won", "won"],
      ]);

      const enrollments = await client.query<{
        id: string;
        status: string;
        pause_reason: string | null;
      }>("SELECT id, status, pause_reason FROM enrollments ORDER BY id");
      expect(enrollments.rows).toEqual([
        { id: demoId(500), status: "paused", pause_reason: "reply" },
        { id: demoId(501), status: "stopped", pause_reason: null },
        { id: demoId(502), status: "paused", pause_reason: "manual" },
        { id: demoId(503), status: "completed", pause_reason: null },
        { id: demoId(504), status: "stopped", pause_reason: null },
      ]);

      const relationships = await client.query<{
        id: string;
        stage: string;
        last_inbound_at: Date | null;
        last_outbound_at: Date | null;
        touch_count: number;
      }>(
        `SELECT r.id, s.name AS stage, r.last_inbound_at, r.last_outbound_at, r.touch_count
         FROM relationships r JOIN stages s ON s.id = r.stage_id AND s.product_id = r.product_id
         WHERE s.pipeline = 'outreach' ORDER BY r.id`,
      );
      expect(relationships.rows).toEqual([
        {
          id: demoId(300),
          stage: "New",
          last_inbound_at: new Date("2026-09-03T10:00:00Z"),
          last_outbound_at: new Date("2026-09-01T10:00:00Z"),
          touch_count: 0,
        },
        {
          id: demoId(301),
          stage: "New",
          last_inbound_at: null,
          last_outbound_at: null,
          touch_count: 0,
        },
      ]);

      const sequences = await client.query<{
        steps: { number: number; template: string; followUp: number }[];
      }>("SELECT steps FROM sequences ORDER BY id");
      for (const row of sequences.rows)
        expect(
          row.steps.map(({ number, template, followUp }) => ({
            number,
            template,
            followUp,
          })),
        ).toEqual([
          { number: 1, template: "", followUp: 0 },
          { number: 2, template: "", followUp: 1 },
          { number: 3, template: "", followUp: 2 },
          { number: 4, template: "", followUp: 3 },
          { number: 5, template: "", followUp: 3 },
        ]);
      await expect(
        client.exec(
          `UPDATE relationships SET stage_id = (SELECT id FROM stages WHERE pipeline = 'deal' LIMIT 1) WHERE id = '${demoId(300)}'`,
        ),
      ).rejects.toThrow();
    } finally {
      await client.close();
      await rm(folder, { recursive: true, force: true });
    }
  });
});
