import { db, schema, sql } from '@gravity/db';
import type { Principal } from '@gravity/shared/policy';
import { newId } from './internal.ts';
import { resolvePrincipal } from './org/member-service.ts';
import { createOrganization } from './org/organization-service.ts';

const TEST_DATABASE_NAME = /^gravity_test(?:_[a-z0-9]+)*$/;

export async function resetDatabase(): Promise<void> {
  const [current] = await db.execute<{ name: string }>(sql`select current_database() as name`);
  const name = String(current?.['name'] ?? 'unknown');
  if (!TEST_DATABASE_NAME.test(name)) {
    throw new Error(`resetDatabase refuses to truncate "${name}".`);
  }
  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  const tables = rows.map((row) => `"${row['tablename']}"`).join(', ');
  if (tables.length > 0) {
    await db.execute(sql.raw(`truncate table ${tables} restart identity cascade`));
  }
  await db.execute(sql`select setval('sync_id_seq', 1, false)`);
}

export async function createUser(name: string): Promise<typeof schema.user.$inferSelect> {
  const id = newId();
  const handle = `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}-${id.slice(-8)}`;
  const [row] = await db
    .insert(schema.user)
    .values({ id, name, email: `${handle}@gravity.test`, handle, emailVerified: true })
    .returning();
  if (row === undefined) throw new Error('Could not create the test user.');
  return row;
}

export interface TestWorkspace {
  readonly organizationId: string;
  readonly admin: Principal;
  readonly adminUser: typeof schema.user.$inferSelect;
}

export async function createWorkspace(name = 'Acme'): Promise<TestWorkspace> {
  const adminUser = await createUser('Ada Admin');
  const created = await createOrganization(adminUser.id, {
    name,
    slug: `${name.toLowerCase()}-${newId().slice(-8)}`,
  });
  const admin = await resolvePrincipal(adminUser.id, created.organization.id);
  return { organizationId: created.organization.id, admin, adminUser };
}
