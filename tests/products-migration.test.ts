import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import {
  defaultProductColorKey,
  nearestProductColorKey,
  productColorKeys,
  productColorReferences,
} from "../packages/core/product-colors";
import { demoId } from "../packages/database/seed";

const org = demoId(1);
const samples = [
  ...productColorKeys.map((key) => productColorReferences[key]),
  "#7565cf",
  "#418ca0",
  "#ca9058",
  "#cf6f93",
  "#7565CF",
  "#000000",
  "#ffffff",
  "#ff0000",
  "#00ff00",
  "#0000ff",
  "#123456",
  "#abcdef",
  "#fff",
  "#f80",
  "#808080",
  "#f0f4f8",
  "#1a1d22",
  "red",
  "",
  "#12345g",
];

test("a database at 0017 gains product colour keys mapped like the application and an archive column", async () => {
  const folder = await mkdtemp(join(tmpdir(), "gravity-products-"));
  const client = new PGlite();
  try {
    await cp(join(process.cwd(), "drizzle"), folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    expect(journal.entries.find((entry) => entry.idx === 18)?.tag).toBe(
      "0018_product_settings",
    );
    await writeFile(
      journalPath,
      JSON.stringify({
        ...journal,
        entries: journal.entries.filter((entry) => entry.idx <= 17),
      }),
    );
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: folder });
    await client.exec(
      `INSERT INTO organizations (id, name, slug) VALUES ('${org}', 'Fixture', 'fixture');`,
    );
    for (const [index, color] of samples.entries())
      await client.query(
        "INSERT INTO products (id, organization_id, name, color) VALUES ($1, $2, $3, $4)",
        [demoId(2000 + index), org, `Product ${index}`, color],
      );
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(db, { migrationsFolder: folder });
    const rows = await client.query<{
      id: string;
      color: string;
      color_key: string;
      archived_at: Date | null;
    }>("SELECT id, color, color_key, archived_at FROM products ORDER BY id");
    expect(rows.rows).toHaveLength(samples.length);
    for (const row of rows.rows) {
      expect(row.archived_at).toBeNull();
      expect({ color: row.color, key: row.color_key }).toEqual({
        color: row.color,
        key: nearestProductColorKey(row.color),
      });
    }
    for (const neutral of ["#000000", "#ffffff", "#808080", "#fff"]) {
      expect(nearestProductColorKey(neutral), neutral).toBe("gray");
      expect(
        rows.rows.find((row) => row.color === neutral)?.color_key,
        neutral,
      ).toBe("gray");
    }
    expect(rows.rows.find((row) => row.color === "red")?.color_key).toBe(
      defaultProductColorKey,
    );
    await client.query(
      "INSERT INTO products (organization_id, name) VALUES ($1, 'Defaulted')",
      [org],
    );
    const defaulted = await client.query<{ color_key: string }>(
      "SELECT color_key FROM products WHERE name = 'Defaulted'",
    );
    expect(defaulted.rows[0]?.color_key).toBe(defaultProductColorKey);
    await expect(
      client.query(
        "UPDATE products SET color_key = '#ff0000' WHERE name = 'Defaulted'",
      ),
    ).rejects.toThrow();
  } finally {
    await client.close();
    await rm(folder, { recursive: true, force: true });
  }
});
