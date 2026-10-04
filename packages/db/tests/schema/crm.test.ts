import { beforeEach, describe, expect, test } from 'bun:test';
import { db, eq, schema, sql } from '../../src/index.ts';

function failureOf(error: unknown): { code: string | null; constraint: string | null } {
  let cursor: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof cursor !== 'object' || cursor === null) break;
    const code = (cursor as { code?: unknown }).code;
    if (typeof code === 'string' && /^\d{5}$/.test(code)) {
      const constraint = (cursor as { constraint_name?: unknown }).constraint_name;
      return { code, constraint: typeof constraint === 'string' ? constraint : null };
    }
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return { code: null, constraint: null };
}

async function violation(
  run: () => Promise<unknown>,
): Promise<{ code: string | null; constraint: string | null }> {
  try {
    await run();
  } catch (error: unknown) {
    return failureOf(error);
  }
  return { code: null, constraint: null };
}

function insertLead(id: string, number: number, stageCategory: 'open' | 'lost') {
  return db.insert(schema.lead).values({
    id,
    organizationId: 'o1',
    personId: 'per1',
    pipelineId: 'p1',
    number,
    stageId: stageCategory === 'open' ? 's-open' : 's-lost',
    stageCategory,
  });
}

beforeEach(async () => {
  await db.execute(sql`truncate table organization, "user" restart identity cascade`);
  await db.insert(schema.organization).values({ id: 'o1', name: 'Acme', slug: 'acme' });
  await db.insert(schema.brand).values({ id: 'b1', organizationId: 'o1', name: 'Yodu' });
  await db.insert(schema.pipeline).values({
    id: 'p1',
    organizationId: 'o1',
    brandId: 'b1',
    name: 'Prospecting',
    key: 'YOD',
    kind: 'people',
  });
  await db.insert(schema.stage).values([
    {
      id: 's-open',
      organizationId: 'o1',
      pipelineId: 'p1',
      name: 'New',
      category: 'open',
      sortOrder: 0,
    },
    {
      id: 's-lost',
      organizationId: 'o1',
      pipelineId: 'p1',
      name: 'Closed',
      category: 'lost',
      sortOrder: 1,
    },
  ]);
  await db.insert(schema.person).values({ id: 'per1', organizationId: 'o1', name: 'Ada Lovelace' });
});

describe('lead constraints', () => {
  test('one open lead per person per pipeline', async () => {
    await insertLead('l1', 1, 'open');
    expect((await violation(() => insertLead('l2', 2, 'open'))).constraint).toBe(
      'lead_open_person_pipeline_unique',
    );
  });

  test('a closed lead does not block a new open one', async () => {
    await insertLead('l1', 1, 'lost');
    await insertLead('l2', 2, 'open');
    expect(await db.select().from(schema.lead)).toHaveLength(2);
  });

  test('lead numbers are unique per pipeline', async () => {
    await insertLead('l1', 1, 'lost');
    expect((await violation(() => insertLead('l2', 1, 'lost'))).constraint).toBe(
      'lead_pipeline_number_unique',
    );
  });
});

describe('pipeline keys', () => {
  test('must be two to five uppercase letters', async () => {
    const result = await violation(() =>
      db.insert(schema.pipeline).values({
        id: 'p2',
        organizationId: 'o1',
        brandId: 'b1',
        name: 'X',
        key: 'yod',
        kind: 'people',
      }),
    );
    expect(result.code).toBe('23514');
  });

  test('are unique per workspace even after the pipeline is archived', async () => {
    const duplicate = () =>
      db.insert(schema.pipeline).values({
        id: 'p2',
        organizationId: 'o1',
        brandId: 'b1',
        name: 'X',
        key: 'YOD',
        kind: 'people',
      });
    expect((await violation(duplicate)).constraint).toBe('pipeline_org_key_unique');
    await db
      .update(schema.pipeline)
      .set({ archivedAt: new Date() })
      .where(eq(schema.pipeline.id, 'p1'));
    expect((await violation(duplicate)).constraint).toBe('pipeline_org_key_unique');
    expect(await db.select().from(schema.pipeline)).toHaveLength(1);
  });
});

describe('field definitions', () => {
  test('a workspace-wide key is unique per object even with a null pipeline', async () => {
    const insert = (id: string) =>
      db.insert(schema.fieldDefinition).values({
        id,
        organizationId: 'o1',
        object: 'lead',
        key: 'industry',
        label: 'Industry',
        type: 'text',
      });
    await insert('f1');
    expect((await violation(() => insert('f2'))).constraint).toBe('field_definition_key_unique');
  });
});

describe('record identity', () => {
  const people = (id: string, extra: Partial<typeof schema.person.$inferInsert>) =>
    db.insert(schema.person).values({ id, organizationId: 'o1', name: id, ...extra });
  const companies = (id: string, extra: Partial<typeof schema.company.$inferInsert>) =>
    db.insert(schema.company).values({ id, organizationId: 'o1', name: id, ...extra });

  test('a primary email is unique per workspace among live people', async () => {
    await people('a', { primaryEmail: 'a@x.com' });
    expect((await violation(() => people('b', { primaryEmail: 'a@x.com' }))).constraint).toBe(
      'person_org_primary_email_unique',
    );
  });

  test('an archived person frees their email and LinkedIn id', async () => {
    await people('a', { primaryEmail: 'a@x.com', linkedinProviderId: 'li-1' });
    await db.update(schema.person).set({ archivedAt: new Date() }).where(eq(schema.person.id, 'a'));
    await people('b', { primaryEmail: 'a@x.com', linkedinProviderId: 'li-1' });
    expect(await db.select().from(schema.person)).toHaveLength(3);
  });

  test('a LinkedIn provider id is unique among live people', async () => {
    await people('a', { linkedinProviderId: 'li-1' });
    expect((await violation(() => people('b', { linkedinProviderId: 'li-1' }))).constraint).toBe(
      'person_org_linkedin_provider_unique',
    );
  });

  test('a primary domain is unique among live companies and free once archived', async () => {
    await companies('c1', { primaryDomain: 'acme.com' });
    expect((await violation(() => companies('c2', { primaryDomain: 'acme.com' }))).constraint).toBe(
      'company_org_primary_domain_unique',
    );
    await db
      .update(schema.company)
      .set({ archivedAt: new Date() })
      .where(eq(schema.company.id, 'c1'));
    await companies('c2', { primaryDomain: 'acme.com' });
    expect(await db.select().from(schema.company)).toHaveLength(2);
  });

  test('a person has one current employment per company', async () => {
    await companies('c1', {});
    const employ = (id: string, isCurrent: boolean) =>
      db
        .insert(schema.employment)
        .values({ id, organizationId: 'o1', personId: 'per1', companyId: 'c1', isCurrent });
    await employ('e1', true);
    expect((await violation(() => employ('e2', true))).constraint).toBe(
      'employment_current_unique',
    );
    await employ('e3', false);
    expect(await db.select().from(schema.employment)).toHaveLength(2);
  });
});

describe('views', () => {
  test('one preference per user, workspace, page and scope', async () => {
    await db.insert(schema.user).values({ id: 'u1', name: 'U', email: 'u@x.com', handle: 'u1' });
    const prefer = (id: string) =>
      db
        .insert(schema.viewPreference)
        .values({ id, organizationId: 'o1', userId: 'u1', page: 'leads', scope: 'p1' });
    await prefer('v1');
    expect((await violation(() => prefer('v2'))).constraint).toBe('view_preference_unique');
  });
});

describe('tenancy', () => {
  test('deleting a workspace removes its records', async () => {
    await insertLead('l1', 1, 'open');
    await db.delete(schema.organization).where(eq(schema.organization.id, 'o1'));
    expect(await db.select().from(schema.person)).toHaveLength(0);
    expect(await db.select().from(schema.lead)).toHaveLength(0);
  });
});
