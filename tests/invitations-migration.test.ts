import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { demoId } from "../packages/database/seed";

const org = demoId(1);

test("invitations from 0016 are deduplicated and lowercased before 0017 adds email domains and pending uniqueness", async () => {
  const folder = await mkdtemp(join(tmpdir(), "gravity-invitations-"));
  const client = new PGlite();
  try {
    await cp(join(process.cwd(), "drizzle"), folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    expect(journal.entries.find((entry) => entry.idx === 17)?.tag).toBe(
      "0017_invitation_constraints",
    );
    await writeFile(
      journalPath,
      JSON.stringify({
        ...journal,
        entries: journal.entries.filter((entry) => entry.idx <= 16),
      }),
    );
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: folder });
    const legacy = (
      id: number,
      email: string,
      hash: string,
      createdAt: string,
      settled = false,
    ) => `
      INSERT INTO invitations (id, organization_id, email, role, product_ids, token_hash, inviter_id, expires_at, created_at, accepted_at, revoked_at)
        VALUES ('${demoId(id)}', '${org}', '${email}', 'member', '[]', '${hash}', 'fixture-user', now() + interval '14 days', '${createdAt}', ${settled ? "now(), now()" : "NULL, NULL"});
    `;
    await client.exec(`
      INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
        VALUES ('fixture-user', 'Fixture', 'fixture@example.test', true, now(), now());
      INSERT INTO organizations (id, name, slug) VALUES ('${org}', 'Fixture', 'fixture');
      INSERT INTO organizations (id, name, slug) VALUES ('${demoId(2)}', 'Other', 'other');
      INSERT INTO memberships (organization_id, user_id, role) VALUES ('${org}', 'fixture-user', 'admin');
      ${legacy(700, "person@example.test", "a".repeat(64), "2026-10-01T00:00:00Z")}
      ${legacy(701, "Person@Example.test", "b".repeat(64), "2026-10-02T00:00:00Z")}
      ${legacy(702, "solo@example.test", "c".repeat(64), "2026-10-01T00:00:00Z")}
      ${legacy(703, "both@example.test", "e".repeat(64), "2026-10-01T00:00:00Z", true)}
    `);
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(db, { migrationsFolder: folder });
    const organization = await client.query<{
      allowed_email_domains: string[];
    }>(`SELECT allowed_email_domains FROM organizations WHERE id = '${org}'`);
    expect(organization.rows[0]?.allowed_email_domains).toEqual([]);
    const rows = await client.query<{
      id: string;
      email: string;
      revoked: boolean;
      accepted: boolean;
    }>(
      "SELECT id, email, revoked_at IS NOT NULL AS revoked, accepted_at IS NOT NULL AS accepted FROM invitations ORDER BY id",
    );
    expect(rows.rows).toEqual([
      {
        id: demoId(700),
        email: "person@example.test",
        revoked: true,
        accepted: false,
      },
      {
        id: demoId(701),
        email: "person@example.test",
        revoked: false,
        accepted: false,
      },
      {
        id: demoId(702),
        email: "solo@example.test",
        revoked: false,
        accepted: false,
      },
      {
        id: demoId(703),
        email: "both@example.test",
        revoked: false,
        accepted: true,
      },
    ]);
    const insert = (id: number, organizationId: string, hash: string) =>
      client.exec(`
        INSERT INTO invitations (id, organization_id, email, role, product_ids, token_hash, inviter_id, expires_at)
          VALUES ('${demoId(id)}', '${organizationId}', 'solo@example.test', 'member', '[]', '${hash}', 'fixture-user', now() + interval '14 days')
      `);
    await expect(insert(704, org, "f".repeat(64))).rejects.toThrow();
    await insert(705, demoId(2), "a1".repeat(32));
    await client.exec(
      `UPDATE invitations SET revoked_at = now() WHERE id = '${demoId(702)}'`,
    );
    await insert(706, org, "b1".repeat(32));
    await expect(insert(707, org, "b1".repeat(32))).rejects.toThrow();
    await expect(
      client.exec(
        `UPDATE invitations SET email = 'Upper@Example.test' WHERE id = '${demoId(706)}'`,
      ),
    ).rejects.toThrow();
    await expect(
      client.exec(
        `UPDATE invitations SET accepted_at = now() WHERE id = '${demoId(702)}'`,
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
