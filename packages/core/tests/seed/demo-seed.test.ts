import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { and, db, eq, isNull, schema, sql } from '@gravity/db';
import { newId } from '../../src/internal.ts';
import { acceptInvite, createInvite } from '../../src/org/invite-service.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import {
  DEMO_BRANDS,
  DEMO_SEED_MARKER,
  publishSeededOutbox,
  seedDemoWorkspace,
} from '../../src/seed/demo-seed.ts';
import {
  createWorkspace,
  refusal,
  resetDatabase,
  type TestWorkspace,
} from '../../src/test-support.ts';

const SEED = { slug: 'demo-test', domain: 'gravity.test' } as const;
const EXPECTED_LEADS = DEMO_BRANDS.reduce((total, brand) => total + brand.rows.length, 0);

beforeEach(async () => {
  delete process.env['ALLOWED_EMAIL_DOMAINS'];
  await resetDatabase();
});

afterEach(() => {
  delete process.env['ALLOWED_EMAIL_DOMAINS'];
});

afterAll(async () => {
  await closeRealtime();
});

async function footprint(organizationId: string) {
  return {
    users: await db.$count(schema.user),
    organizations: await db.$count(schema.organization),
    invitations: await db.$count(schema.invitation),
    people: await db.$count(schema.person, eq(schema.person.organizationId, organizationId)),
    companies: await db.$count(schema.company, eq(schema.company.organizationId, organizationId)),
    leads: await db.$count(schema.lead, eq(schema.lead.organizationId, organizationId)),
    brands: await db.$count(schema.brand, eq(schema.brand.organizationId, organizationId)),
    members: await db.$count(schema.member, eq(schema.member.organizationId, organizationId)),
    outbox: await db.$count(schema.outbox, eq(schema.outbox.organizationId, organizationId)),
    links: await db.$count(
      schema.importSource,
      eq(schema.importSource.organizationId, organizationId),
    ),
  };
}

describe('seedDemoWorkspace', () => {
  test('builds four brands with leads across stages and owners, then refuses a second run', async () => {
    const result = await seedDemoWorkspace(SEED);
    expect(result).toMatchObject({
      slug: 'demo-test',
      brands: 4,
      leads: EXPECTED_LEADS,
      ownerEmail: 'alex@gravity.test',
      teammateEmail: 'sam@gravity.test',
      reused: false,
    });
    expect(result.people).toBe(EXPECTED_LEADS - 2);
    const pipelines = await db
      .select()
      .from(schema.pipeline)
      .where(eq(schema.pipeline.organizationId, result.organizationId));
    expect(pipelines.map((pipeline) => pipeline.key).sort()).toEqual(['ATL', 'HAR', 'LUM', 'SED']);
    const leads = await db
      .select()
      .from(schema.lead)
      .where(eq(schema.lead.organizationId, result.organizationId));
    expect(new Set(leads.map((lead) => lead.stageId)).size).toBeGreaterThan(5);
    expect(new Set(leads.map((lead) => lead.ownerId)).size).toBe(2);
    expect(new Set(leads.map((lead) => lead.priority)).size).toBeGreaterThan(2);
    const before = await footprint(result.organizationId);
    const second = await refusal(seedDemoWorkspace(SEED));
    expect(second.code).toBe('conflict');
    expect(await footprint(result.organizationId)).toEqual(before);
  });

  test('two people carry a lead in two pipelines and nobody has two leads in one', async () => {
    const result = await seedDemoWorkspace(SEED);
    const leads = await db
      .select({ personId: schema.lead.personId, pipelineId: schema.lead.pipelineId })
      .from(schema.lead)
      .where(eq(schema.lead.organizationId, result.organizationId));
    const perPerson = new Map<string, Set<string>>();
    for (const lead of leads) {
      perPerson.set(
        lead.personId,
        (perPerson.get(lead.personId) ?? new Set()).add(lead.pipelineId),
      );
    }
    const shared = [...perPerson.values()].filter((pipelineIds) => pipelineIds.size === 2);
    expect(shared).toHaveLength(2);
    expect(new Set(leads.map((lead) => `${lead.personId}:${lead.pipelineId}`)).size).toBe(
      leads.length,
    );
  });

  test('uses fictional companies, emails and phones on reserved names only', async () => {
    const result = await seedDemoWorkspace({ slug: 'demo-domains', domain: 'gravity.test' });
    const companies = await db
      .select()
      .from(schema.company)
      .where(eq(schema.company.organizationId, result.organizationId));
    expect(companies.length).toBeGreaterThan(10);
    expect(
      companies.every((company) => company.domains.every((domain) => domain.endsWith('.example'))),
    ).toBe(true);
    const brands = await db
      .select()
      .from(schema.brand)
      .where(eq(schema.brand.organizationId, result.organizationId));
    expect(brands.every((brand) => brand.domain?.endsWith('.example') ?? false)).toBe(true);
    const people = await db
      .select()
      .from(schema.person)
      .where(eq(schema.person.organizationId, result.organizationId));
    expect(
      people.every(
        (person) =>
          person.emails.length > 0 &&
          person.emails.every((email) => email.endsWith('.example')) &&
          person.phones.length > 0 &&
          person.phones.every((phone) => phone.startsWith('+1 555 01')),
      ),
    ).toBe(true);
    const names = [
      ...companies.map((company) => company.name),
      ...brands.map((brand) => brand.name),
    ];
    for (const echo of ['Juniper', 'Cobalt', 'Tidewater', 'Lumen ']) {
      expect(names.some((name) => name.includes(echo))).toBe(false);
    }
  });

  test('adds the teammate through an accepted invite, with sync ids and outbox rows', async () => {
    const result = await seedDemoWorkspace(SEED);
    const [teammate] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, result.teammateEmail));
    expect(teammate).toBeDefined();
    const [member] = await db
      .select()
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, result.organizationId),
          eq(schema.member.userId, teammate?.id ?? ''),
        ),
      );
    expect(member?.role).toBe('member');
    expect(member?.syncId).toBeGreaterThan(0);
    const [invitation] = await db
      .select()
      .from(schema.invitation)
      .where(eq(schema.invitation.organizationId, result.organizationId));
    expect(invitation).toMatchObject({ email: 'sam@gravity.test', status: 'accepted' });
    const rows = await db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.organizationId, result.organizationId));
    expect(rows.some((row) => row.syncId === member?.syncId)).toBe(true);
  });

  test('imports as the integration actor with a source id for every person', async () => {
    const result = await seedDemoWorkspace(SEED);
    const links = await db
      .select()
      .from(schema.importSource)
      .where(eq(schema.importSource.organizationId, result.organizationId));
    expect(links).toHaveLength(result.people);
    expect(new Set(links.map((link) => link.source))).toEqual(new Set(['demo-seed']));
  });

  test('a run with reuse completes the same workspace and creates nothing new', async () => {
    const first = await seedDemoWorkspace(SEED);
    const before = await footprint(first.organizationId);
    const again = await seedDemoWorkspace({ ...SEED, reuse: true });
    expect(again).toMatchObject({
      organizationId: first.organizationId,
      reused: true,
      people: first.people,
      leads: first.leads,
    });
    expect(await footprint(first.organizationId)).toEqual(before);
  });

  test('reuse refills what was removed and leaves what is there alone', async () => {
    const first = await seedDemoWorkspace(SEED);
    const [removed] = await db
      .select()
      .from(schema.lead)
      .where(eq(schema.lead.organizationId, first.organizationId))
      .limit(1);
    expect(removed).toBeDefined();
    await db.delete(schema.lead).where(eq(schema.lead.id, removed?.id ?? ''));
    const again = await seedDemoWorkspace({ ...SEED, reuse: true });
    expect(again.leads).toBe(first.leads);
    expect(again.people).toBe(first.people);
  });

  test('never touches a workspace it did not create, even with reuse', async () => {
    const other = await createWorkspace('Acme');
    const slug = await slugOf(other.organizationId);
    await lookalikeMember(other, 'member');
    const before = await footprint(other.organizationId);
    const attempt = await refusal(seedDemoWorkspace({ slug, domain: 'gravity.test', reuse: true }));
    expect(attempt.code).toBe('conflict');
    expect(await footprint(other.organizationId)).toEqual(before);
  });

  test('a workspace carrying the marker whose alex is not its admin is refused', async () => {
    const other = await createWorkspace('Acme');
    const slug = await slugOf(other.organizationId);
    await mark(other.organizationId);
    await lookalikeMember(other, 'member');
    const before = await footprint(other.organizationId);
    const attempt = await refusal(seedDemoWorkspace({ slug, domain: 'gravity.test', reuse: true }));
    expect(attempt.code).toBe('conflict');
    expect(await footprint(other.organizationId)).toEqual(before);
  });

  test('an admin alex alone does not prove the workspace is a demo one', async () => {
    const first = await seedDemoWorkspace(SEED);
    await db
      .update(schema.organization)
      .set({ metadata: null })
      .where(eq(schema.organization.id, first.organizationId));
    const before = await footprint(first.organizationId);
    const attempt = await refusal(seedDemoWorkspace({ ...SEED, reuse: true }));
    expect(attempt.code).toBe('conflict');
    expect(attempt.message).toContain('not created by this seed');
    expect(await footprint(first.organizationId)).toEqual(before);
  });

  test('the workspace is marked as created by the seed when it is made', async () => {
    const result = await seedDemoWorkspace(SEED);
    const [row] = await db
      .select({ metadata: schema.organization.metadata })
      .from(schema.organization)
      .where(eq(schema.organization.id, result.organizationId));
    expect(JSON.parse(row?.metadata ?? 'null')).toEqual({ createdBy: DEMO_SEED_MARKER });
  });

  test('a refusal writes nothing, not even the seed users', async () => {
    const other = await createWorkspace('Acme');
    const taken = await slugOf(other.organizationId);
    const refusals: [string, Parameters<typeof seedDemoWorkspace>[0]][] = [
      ['slug collision', { slug: taken, domain: 'gravity.test' }],
      ['bad slug', { slug: 'Not A Slug!', domain: 'gravity.test' }],
      ['reserved slug', { slug: 'admin', domain: 'gravity.test' }],
      ['bad domain', { slug: 'demo-x', domain: 'not a domain' }],
      ['real domain', { slug: 'demo-x', domain: 'acme.com' }],
      ['reuse without a workspace proof', { slug: taken, domain: 'gravity.test', reuse: true }],
    ];
    const before = await footprint(other.organizationId);
    for (const [label, options] of refusals) {
      const outcome = await refusal(seedDemoWorkspace(options));
      expect([label, outcome.code]).not.toEqual([label, 'internal']);
      expect([label, await footprint(other.organizationId)]).toEqual([label, before]);
    }
    process.env['ALLOWED_EMAIL_DOMAINS'] = 'acme.test';
    const allowlist = await refusal(seedDemoWorkspace(SEED));
    expect(allowlist.code).toBe('forbidden');
    expect(await footprint(other.organizationId)).toEqual(before);
  });

  test('a real domain is seeded only when it is allowed explicitly', async () => {
    const result = await seedDemoWorkspace({
      slug: 'demo-real',
      domain: 'Acme.com',
      allowRealDomain: true,
    });
    expect(result.ownerEmail).toBe('alex@acme.com');
  });

  test('a seed handle owned by another account is a clear conflict that writes nothing', async () => {
    await db.insert(schema.user).values({
      id: newId(),
      name: 'Someone Else',
      email: 'someone@elsewhere.test',
      handle: 'demo-test-sam',
      emailVerified: true,
    });
    const before = await db.$count(schema.user);
    const attempt = await refusal(seedDemoWorkspace(SEED));
    expect(attempt.code).toBe('conflict');
    expect(attempt.message).toContain('demo-test-sam');
    expect(await db.$count(schema.user)).toBe(before);
    expect(await db.$count(schema.organization)).toBe(0);
  });

  test('a failing create leaves no seed users behind', async () => {
    await db.execute(sql`create function seed_boom() returns trigger language plpgsql as $$ begin
      raise exception 'seed boom'; end $$`);
    await db.execute(
      sql`create trigger seed_boom before insert on organization for each row execute function seed_boom()`,
    );
    try {
      await expect(seedDemoWorkspace(SEED)).rejects.toThrow();
    } finally {
      await db.execute(sql`drop trigger seed_boom on organization`);
      await db.execute(sql`drop function seed_boom()`);
    }
    expect(await db.$count(schema.user)).toBe(0);
    expect(await db.$count(schema.organization)).toBe(0);
  });

  test('a reuse run refuses an archived seed pipeline before writing anything', async () => {
    const first = await seedDemoWorkspace(SEED);
    await db
      .update(schema.pipeline)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(schema.pipeline.organizationId, first.organizationId),
          eq(schema.pipeline.key, 'HAR'),
        ),
      );
    const before = await footprint(first.organizationId);
    const attempt = await refusal(seedDemoWorkspace({ ...SEED, reuse: true }));
    expect(attempt.code).toBe('conflict');
    expect(attempt.message).toContain('HAR');
    expect(await footprint(first.organizationId)).toEqual(before);
  });

  test('a reuse run refuses an archived seniority field with a clear message', async () => {
    const first = await seedDemoWorkspace(SEED);
    await db
      .update(schema.fieldDefinition)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(schema.fieldDefinition.organizationId, first.organizationId),
          eq(schema.fieldDefinition.key, 'seniority'),
        ),
      );
    const before = await footprint(first.organizationId);
    const attempt = await refusal(seedDemoWorkspace({ ...SEED, reuse: true }));
    expect(attempt.code).toBe('conflict');
    expect(attempt.message).toContain('seniority');
    expect(await footprint(first.organizationId)).toEqual(before);
  });

  test('refuses a domain the instance does not admit before writing anything', async () => {
    process.env['ALLOWED_EMAIL_DOMAINS'] = 'acme.test';
    const attempt = await refusal(seedDemoWorkspace(SEED));
    expect(attempt.code).toBe('forbidden');
    expect(await db.$count(schema.organization)).toBe(0);
    expect(await db.$count(schema.user)).toBe(0);
    const admitted = await seedDemoWorkspace({ slug: 'demo-acme', domain: 'acme.test' });
    expect(admitted).toMatchObject({ ownerEmail: 'alex@acme.test', leads: EXPECTED_LEADS });
  });

  test('publishSeededOutbox stamps the workspace rows through the given publisher', async () => {
    const result = await seedDemoWorkspace(SEED);
    const published: number[] = [];
    const delivered = await publishSeededOutbox(result.organizationId, (actions) => {
      published.push(actions.length);
      return Promise.resolve(true);
    });
    expect(delivered).toBeGreaterThan(100);
    expect(published).toEqual([delivered]);
    expect(
      await db.$count(
        schema.outbox,
        and(
          eq(schema.outbox.organizationId, result.organizationId),
          isNull(schema.outbox.publishedAt),
        ),
      ),
    ).toBe(0);
  });
});

async function slugOf(organizationId: string): Promise<string> {
  const [row] = await db
    .select({ slug: schema.organization.slug })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId));
  return row?.slug ?? '';
}

async function mark(organizationId: string): Promise<void> {
  await db
    .update(schema.organization)
    .set({ metadata: JSON.stringify({ createdBy: DEMO_SEED_MARKER }) })
    .where(eq(schema.organization.id, organizationId));
}

async function lookalikeMember(workspace: TestWorkspace, role: 'member' | 'admin'): Promise<void> {
  const [user] = await db
    .insert(schema.user)
    .values({
      id: newId(),
      name: 'Alex Rivera',
      email: 'alex@gravity.test',
      handle: 'alex-lookalike',
      emailVerified: true,
    })
    .returning();
  const invite = await createInvite(workspace.admin, { email: 'alex@gravity.test', role });
  await acceptInvite(invite.token, user?.id ?? '');
}
