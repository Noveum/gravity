import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { demoId } from "../packages/database/seed";

const org = demoId(1);

test("a database at 0013 gains workspace email domains and a tenant keyed invitations table", async () => {
  const folder = await mkdtemp(join(tmpdir(), "gravity-invitations-"));
  const client = new PGlite();
  try {
    await cp(join(process.cwd(), "drizzle"), folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    expect(journal.entries.length).toBeGreaterThan(14);
    await writeFile(
      journalPath,
      JSON.stringify({
        ...journal,
        entries: journal.entries.filter((entry) => entry.idx <= 13),
      }),
    );
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: folder });
    await client.exec(`
      INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
        VALUES ('fixture-user', 'Fixture', 'fixture@example.test', true, now(), now());
      INSERT INTO organizations (id, name, slug) VALUES ('${org}', 'Fixture', 'fixture');
      INSERT INTO organizations (id, name, slug) VALUES ('${demoId(2)}', 'Other', 'other');
      INSERT INTO memberships (organization_id, user_id, role) VALUES ('${org}', 'fixture-user', 'admin');
    `);
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(db, { migrationsFolder: folder });
    const organization = await client.query<{
      allowed_email_domains: string[];
    }>(`SELECT allowed_email_domains FROM organizations WHERE id = '${org}'`);
    expect(organization.rows[0]?.allowed_email_domains).toEqual([]);
    const insert = (id: number, organizationId: string, hash: string) =>
      client.exec(`
        INSERT INTO invitations (id, organization_id, email, role, product_ids, token_hash, expires_at, invited_by)
          VALUES ('${demoId(id)}', '${organizationId}', 'person@example.test', 'member', '[]', '${hash}', now() + interval '7 days', 'fixture-user')
      `);
    await insert(700, org, "a".repeat(64));
    await expect(insert(701, org, "b".repeat(64))).rejects.toThrow();
    await expect(insert(702, demoId(2), "c".repeat(64))).rejects.toThrow();
    await client.exec(
      `UPDATE invitations SET revoked_at = now() WHERE id = '${demoId(700)}'`,
    );
    await insert(703, org, "d".repeat(64));
    await expect(insert(704, org, "d".repeat(64))).rejects.toThrow();
    await expect(
      client.exec(
        `UPDATE invitations SET email = 'Upper@Example.test' WHERE id = '${demoId(703)}'`,
      ),
    ).rejects.toThrow();
    const security = await client.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE relname = 'invitations'",
    );
    expect(security.rows[0]?.relrowsecurity).toBe(true);
  } finally {
    await client.close();
    await rm(folder, { recursive: true, force: true });
  }
});
