import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import * as schema from "../packages/database/schema";
import { demoId, seedDemo } from "../packages/database/seed";

const org = demoId(1);
const at = (value: string) => new Date(value);
const migrations = join(process.cwd(), "drizzle");

test("the 0016 backfill sets closed_at for won and lost deals from their change events, then the update time", async () => {
  const client = new PGlite();
  try {
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrations });
    await seedDemo(db);
    const deals = {
      latestWon: demoId(2100),
      latestLost: demoId(2101),
      noEvent: demoId(2102),
      noTimes: demoId(2103),
      alreadyClosed: demoId(2104),
      open: demoId(2105),
      otherOrgEvent: demoId(2106),
    };
    const rows: [string, string, Date | null, Date | null, Date | null][] = [
      [deals.latestWon, "won", null, at("2026-01-10T00:00:00Z"), null],
      [deals.latestLost, "lost", null, at("2026-01-11T00:00:00Z"), null],
      [deals.noEvent, "won", null, at("2026-02-01T00:00:00Z"), null],
      [deals.noTimes, "lost", null, null, at("2025-12-01T00:00:00Z")],
      [
        deals.alreadyClosed,
        "lost",
        at("2025-11-05T00:00:00Z"),
        at("2026-03-01T00:00:00Z"),
        null,
      ],
      [deals.open, "open", null, at("2026-03-02T00:00:00Z"), null],
      [deals.otherOrgEvent, "won", null, at("2026-03-03T00:00:00Z"), null],
    ];
    for (const [id, status, closedAt, updatedAt, createdAt] of rows)
      await client.query(
        `INSERT INTO opportunities (id, organization_id, product_id, relationship_id, stage_id, name, status, closed_at, updated_at, created_at)
         SELECT $1::uuid, organization_id, product_id, relationship_id, stage_id, $1::text, $2, $3, $4, $5 FROM opportunities WHERE id = $6`,
        [id, status, closedAt, updatedAt, createdAt, demoId(1100)],
      );
    const events: [string, string, string, string][] = [
      [org, deals.latestWon, "opportunity.lost", "2025-10-01T00:00:00Z"],
      [org, deals.latestWon, "opportunity.won", "2025-10-05T00:00:00Z"],
      [org, deals.latestWon, "opportunity.won", "2025-10-09T00:00:00Z"],
      [org, deals.latestLost, "opportunity.lost", "2025-09-03T00:00:00Z"],
      [org, deals.latestLost, "opportunity.won", "2025-09-08T00:00:00Z"],
      [org, deals.open, "opportunity.won", "2025-09-09T00:00:00Z"],
      [
        demoId(2),
        deals.otherOrgEvent,
        "opportunity.won",
        "2025-08-01T00:00:00Z",
      ],
    ];
    for (const [organizationId, entityId, type, createdAt] of events)
      await client.query(
        "INSERT INTO change_events (organization_id, actor_id, type, entity_id, created_at) VALUES ($1, 'demo-you', $2, $3, $4)",
        [organizationId, type, entityId, createdAt],
      );
    await client.exec(
      await readFile(
        join(migrations, "0016_backfill_deal_closed_at.sql"),
        "utf8",
      ),
    );
    const result = await client.query<{ id: string; closed_at: Date | null }>(
      "SELECT id, closed_at FROM opportunities WHERE id = ANY($1)",
      [Object.values(deals)],
    );
    const closed = Object.fromEntries(
      result.rows.map((row) => [row.id, row.closed_at?.toISOString() ?? null]),
    );
    expect(closed).toEqual({
      [deals.latestWon]: "2025-10-09T00:00:00.000Z",
      [deals.latestLost]: "2025-09-03T00:00:00.000Z",
      [deals.noEvent]: "2026-02-01T00:00:00.000Z",
      [deals.noTimes]: null,
      [deals.alreadyClosed]: "2025-11-05T00:00:00.000Z",
      [deals.open]: null,
      [deals.otherOrgEvent]: "2026-03-03T00:00:00.000Z",
    });
    const unclosed = await client.query<{ id: string }>(
      "SELECT id FROM opportunities WHERE status IN ('won', 'lost') AND closed_at IS NULL",
    );
    expect(unclosed.rows.map((row) => row.id)).toEqual([deals.noTimes]);
  } finally {
    await client.close();
  }
});
