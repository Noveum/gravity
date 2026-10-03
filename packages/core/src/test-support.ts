import { db, schema, sql } from '@gravity/db';
import type { OrgRole } from '@gravity/shared/constants';
import { DomainError } from '@gravity/shared/errors';
import type { Principal } from '@gravity/shared/policy';
import { newId } from './internal.ts';
import { acceptInvite, createInvite } from './org/invite-service.ts';
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

export async function createMemberPrincipal(
  workspace: TestWorkspace,
  role: 'guest' | 'contributor' | 'member',
): Promise<Principal> {
  const user = await createUser(`${role} user`);
  const { token } = await createInvite(workspace.admin, { email: user.email, role });
  await acceptInvite(token, user.id);
  return await resolvePrincipal(user.id, workspace.organizationId);
}

export async function addMember(
  workspace: TestWorkspace,
  name: string,
  role: OrgRole,
): Promise<Principal> {
  const user = await createUser(name);
  const { token } = await createInvite(workspace.admin, { email: user.email, role });
  await acceptInvite(token, user.id);
  return await resolvePrincipal(user.id, workspace.organizationId);
}

export async function configurationFootprint(): Promise<Record<string, number>> {
  const counts = async (table: 'brand' | 'pipeline' | 'stage' | 'field_definition' | 'outbox') => {
    const [row] = await db.execute<{ total: string }>(
      sql.raw(`select count(*)::text as total from "${table}"`),
    );
    return Number(row?.['total'] ?? 0);
  };
  return {
    brand: await counts('brand'),
    pipeline: await counts('pipeline'),
    stage: await counts('stage'),
    field_definition: await counts('field_definition'),
    outbox: await counts('outbox'),
  };
}

export interface TestLeadInput {
  readonly organizationId: string;
  readonly pipelineId: string;
  readonly stageId: string;
  readonly stageCategory?: 'open' | 'hold' | 'won' | 'lost';
  readonly archivedAt?: Date | null;
}

export async function insertTestLead(input: TestLeadInput): Promise<string> {
  const personId = newId();
  await db
    .insert(schema.person)
    .values({ id: personId, organizationId: input.organizationId, name: 'Test Person' });
  const [numbered] = await db.execute<{ next: string }>(
    sql`select (coalesce(max(number), 0) + 1)::text as next from lead where pipeline_id = ${input.pipelineId}`,
  );
  const id = newId();
  await db.insert(schema.lead).values({
    id,
    organizationId: input.organizationId,
    personId,
    pipelineId: input.pipelineId,
    number: Number(numbered?.['next'] ?? 1),
    stageId: input.stageId,
    stageCategory: input.stageCategory ?? 'open',
    archivedAt: input.archivedAt ?? null,
  });
  return id;
}

export async function refusal(attempt: Promise<unknown>): Promise<DomainError> {
  try {
    await attempt;
  } catch (error: unknown) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('Expected the call to be refused, but it succeeded.');
}
