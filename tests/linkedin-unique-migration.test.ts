import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { demoId } from "../packages/database/seed";

const org = demoId(1);
const otherOrg = demoId(2);
const person = (index: number) => demoId(3000 + index);

test("a production database at 0013 with duplicate LinkedIn URLs migrates through 0018 without failing", async () => {
  const folder = await mkdtemp(join(tmpdir(), "gravity-linkedin-"));
  const client = new PGlite();
  try {
    await cp(join(process.cwd(), "drizzle"), folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    expect(journal.entries.map((entry) => entry.idx)).toContain(18);
    await writeFile(
      journalPath,
      JSON.stringify({
        ...journal,
        entries: journal.entries.filter((entry) => entry.idx <= 13),
      }),
    );
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: folder });
    await client.exec(
      `INSERT INTO organizations (id, name, slug) VALUES ('${org}', 'Fixture', 'fixture'), ('${otherOrg}', 'Other', 'other');`,
    );
    const rows: [number, string, string, boolean, string][] = [
      [1, org, "https://www.linkedin.com/in/dup-a/", false, "2025-01-01"],
      [2, org, "https://www.linkedin.com/in/DUP-A/", false, "2025-02-01"],
      [3, org, "https://www.linkedin.com/in/dup-a/", false, "2025-03-01"],
      [4, org, "https://www.linkedin.com/in/dup-b", false, "2025-01-01"],
      [5, org, "https://www.linkedin.com/in/dup-b", true, "2025-04-01"],
      [6, otherOrg, "https://www.linkedin.com/in/dup-a/", false, "2025-05-01"],
      [7, org, "", false, "2025-01-01"],
      [8, org, "", false, "2025-01-02"],
      [9, org, "https://www.linkedin.com/in/unique", false, "2025-01-03"],
    ];
    for (const [index, organizationId, url, optedOut, createdAt] of rows)
      await client.query(
        "INSERT INTO people (id, organization_id, name, linkedin_url, do_not_contact, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          person(index),
          organizationId,
          `Person ${index}`,
          url,
          optedOut,
          createdAt,
        ],
      );
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(db, { migrationsFolder: folder });
    const after = await client.query<{
      id: string;
      linkedin_url: string;
      version: number;
    }>("SELECT id, linkedin_url, version FROM people ORDER BY id");
    const urls = Object.fromEntries(
      after.rows.map((row) => [row.id, row.linkedin_url]),
    );
    expect(urls).toEqual({
      [person(1)]: "https://www.linkedin.com/in/dup-a/",
      [person(2)]: "",
      [person(3)]: "",
      [person(4)]: "",
      [person(5)]: "https://www.linkedin.com/in/dup-b",
      [person(6)]: "https://www.linkedin.com/in/dup-a/",
      [person(7)]: "",
      [person(8)]: "",
      [person(9)]: "https://www.linkedin.com/in/unique",
    });
    const versions = Object.fromEntries(
      after.rows.map((row) => [row.id, row.version]),
    );
    for (const index of [2, 3, 4]) expect(versions[person(index)]).toBe(2);
    for (const index of [1, 5, 6, 7, 8, 9])
      expect(versions[person(index)]).toBe(1);
    const events = await client.query<{
      organization_id: string;
      entity_id: string;
      type: string;
    }>(
      "SELECT organization_id, entity_id, type FROM change_events ORDER BY entity_id",
    );
    expect(events.rows).toEqual(
      [2, 3, 4].map((index) => ({
        organization_id: org,
        entity_id: person(index),
        type: "person.linkedin_cleared",
      })),
    );
    await expect(
      client.query(
        "INSERT INTO people (organization_id, name, linkedin_url) VALUES ($1, 'Copy', 'https://www.linkedin.com/in/Unique')",
        [org],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await client.query(
      "INSERT INTO people (organization_id, name, linkedin_url) VALUES ($1, 'Elsewhere', 'https://www.linkedin.com/in/unique'), ($1, 'Blank', '')",
      [otherOrg],
    );
  } finally {
    await client.close();
    await rm(folder, { recursive: true, force: true });
  }
});
