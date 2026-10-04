import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { and, db, eq, schema } from '@gravity/db';
import { newId } from '../../src/internal.ts';
import { acceptInvite, createInvite } from '../../src/org/invite-service.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import { DEMO_BRANDS, seedDemoWorkspace } from '../../src/seed/demo-seed.ts';
import { createWorkspace, refusal, resetDatabase } from '../../src/test-support.ts';

const SEED = { slug: 'demo-test', domain: 'gravity.test' } as const;
const EXPECTED_LEADS = DEMO_BRANDS.reduce((total, brand) => total + brand.rows.length, 0);

beforeEach(async () => {
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
    const slug = (
      await db
        .select({ slug: schema.organization.slug })
        .from(schema.organization)
        .where(eq(schema.organization.id, other.organizationId))
    )[0]?.slug;
    const [lookalike] = await db
      .insert(schema.user)
      .values({
        id: newId(),
        name: 'Alex Rivera',
        email: 'alex@gravity.test',
        handle: 'alex-lookalike',
        emailVerified: true,
      })
      .returning();
    const invite = await createInvite(other.admin, { email: 'alex@gravity.test', role: 'member' });
    await acceptInvite(invite.token, lookalike?.id ?? '');
    const before = await footprint(other.organizationId);
    const attempt = await refusal(
      seedDemoWorkspace({ slug: slug ?? '', domain: 'gravity.test', reuse: true }),
    );
    expect(attempt.code).toBe('conflict');
    expect(await footprint(other.organizationId)).toEqual(before);
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
});
