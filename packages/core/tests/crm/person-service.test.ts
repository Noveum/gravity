import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, eq, schema } from '@gravity/db';
import type { SyncAction } from '@gravity/shared/events';
import { personInputSchema } from '@gravity/shared/validators';
import { createBrand } from '../../src/crm/brand-service.ts';
import { upsertCompany } from '../../src/crm/company-service.ts';
import { addEmployment, endEmployment } from '../../src/crm/employment-service.ts';
import { createFieldDefinition } from '../../src/crm/field-service.ts';
import { updatePerson, upsertPerson, upsertPersonIn } from '../../src/crm/person-service.ts';
import { withBatch } from '../../src/crm/sync-batch.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import { createWorkspace, resetDatabase, type TestWorkspace } from '../../src/test-support.ts';

let workspace: TestWorkspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
});

afterAll(async () => {
  await closeRealtime();
});

async function openLeadFor(personId: string): Promise<string> {
  const created = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
  const stage = created.stages[0];
  if (stage === undefined) throw new Error('The brand has no stages.');
  const id = `lead-${personId}`;
  await db.insert(schema.lead).values({
    id,
    organizationId: workspace.organizationId,
    personId,
    pipelineId: created.pipeline.id,
    number: 1,
    stageId: stage.id,
    stageCategory: stage.category,
  });
  return id;
}

function emitted(actions: readonly SyncAction[], model: string): SyncAction[] {
  return actions.filter((action) => action.model === model);
}

describe('upsertPerson', () => {
  test('creates the person, the company from a domain reference and a current employment', async () => {
    const result = await upsertPerson(
      { principal: workspace.admin },
      {
        name: 'Ada Lovelace',
        emails: ['Ada@Acme.io'],
        company: { domain: 'acme.io', name: 'Acme' },
        title: 'CTO',
      },
    );
    expect(result.created).toBe(true);
    expect(result.person).toMatchObject({
      primaryEmail: 'ada@acme.io',
      companyName: 'Acme',
      title: 'CTO',
    });
    expect(result.company?.primaryDomain).toBe('acme.io');
    expect(new Set(result.actions.map((action) => action.model))).toEqual(
      new Set(['person', 'company', 'employment', 'activity']),
    );
  });

  test('matches by email case-insensitively, merges emails and keeps the name', async () => {
    const context = { principal: workspace.admin };
    const first = await upsertPerson(context, { name: 'Ada', emails: ['ada@acme.io'] });
    const second = await upsertPerson(context, {
      name: 'A. Lovelace',
      emails: ['ADA@acme.io', 'ada@personal.dev'],
    });
    expect(second).toMatchObject({ created: false, matchedBy: 'email' });
    expect(second.person).toMatchObject({
      id: first.person.id,
      name: 'Ada',
      emails: ['ada@acme.io', 'ada@personal.dev'],
    });
  });

  test('matches on the provider id first and the LinkedIn URL last', async () => {
    const context = { principal: workspace.admin };
    const byId = await upsertPerson(context, { name: 'Grace', linkedinProviderId: 'ACoAA1' });
    expect(
      (await upsertPerson(context, { name: 'Grace H', linkedinProviderId: 'ACoAA1' })).matchedBy,
    ).toBe('linkedin_provider_id');
    await upsertPerson(context, { name: 'Lin', linkedinUrl: 'https://linkedin.com/in/lin-k/' });
    const byUrl = await upsertPerson(context, {
      name: 'Lin K',
      linkedinUrl: 'https://www.linkedin.com/in/Lin-K',
    });
    expect(byUrl.matchedBy).toBe('linkedin_url');
    expect(byId.person.id).not.toBe(byUrl.person.id);
  });

  test('a human value survives an agent write and the agent fills empty fields', async () => {
    await createFieldDefinition(
      { principal: workspace.admin },
      { object: 'person', key: 'tier', label: 'Tier', type: 'text' },
    );
    await createFieldDefinition(
      { principal: workspace.admin },
      { object: 'person', key: 'city', label: 'City', type: 'text' },
    );
    await upsertPerson(
      { principal: workspace.admin },
      { name: 'Ada', emails: ['ada@acme.io'], fields: { tier: 'gold' } },
    );
    const agent = { principal: workspace.admin, actor: { type: 'agent' as const, id: 'claude' } };
    const result = await upsertPerson(agent, {
      name: 'Ada',
      emails: ['ada@acme.io'],
      fields: { tier: 'silver', city: 'London' },
    });
    expect(result.person.fields).toEqual({ tier: 'gold', city: 'London' });
  });

  test('lowercases emails before matching and writing, even past the schema', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, { name: 'Ada', emails: ['ada@acme.com'] });
    const raw = { ...personInputSchema.parse({ name: 'Ada' }), emails: ['Ada@Acme.COM'] };
    const matched = await withBatch(context, (batch) => upsertPersonIn(batch, raw));
    expect(matched).toMatchObject({ created: false, matchedBy: 'email' });
    expect(matched.person.emails).toEqual(['ada@acme.com']);
    const fresh = await withBatch(context, (batch) =>
      upsertPersonIn(batch, { ...raw, name: 'Grace', emails: ['Grace@Navy.MIL'] }),
    );
    expect(fresh.person).toMatchObject({
      emails: ['grace@navy.mil'],
      primaryEmail: 'grace@navy.mil',
    });
    expect(fresh.person.id).not.toBe(ada.person.id);
  });

  test('an email shared by two people matches the oldest one every time', async () => {
    const context = { principal: workspace.admin };
    const older = await upsertPerson(context, { name: 'Zoe', emails: ['zoe@acme.io'] });
    await upsertPerson(context, { name: 'Ada', emails: ['ada@acme.io'] });
    await updatePerson(context, older.person.id, { name: 'Zoe Zimmer' });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const matched = await upsertPerson(context, {
        name: 'Either',
        emails: ['ada@acme.io', 'zoe@acme.io'],
      });
      expect(matched.person.id).toBe(older.person.id);
    }
  });

  test('a new company on an existing person re-emits the person once and their leads', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, { name: 'Ada', emails: ['ada@acme.io'] });
    const leadId = await openLeadFor(ada.person.id);
    const moved = await upsertPerson(context, {
      name: 'Ada',
      emails: ['ada@acme.io'],
      company: { domain: 'globex.com', name: 'Globex' },
    });
    const people = emitted(moved.actions, 'person');
    expect(people).toHaveLength(1);
    expect(people[0]?.data).toMatchObject({ id: ada.person.id, companyName: 'Globex' });
    const leads = emitted(moved.actions, 'lead');
    expect(leads.map((action) => [action.modelId, action.action])).toEqual([[leadId, 'update']]);
    expect(leads[0]?.data).toMatchObject({ companyName: 'Globex', companyId: moved.company?.id });
  });
});

describe('employment', () => {
  test('a new current job ends the previous one', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, { name: 'Ada', company: { domain: 'acme.io' } });
    const globex = await upsertCompany(context, { name: 'Globex', domains: ['globex.com'] });
    const moved = await addEmployment(context, {
      personId: ada.person.id,
      companyId: globex.company.id,
      title: 'VP',
    });
    expect(moved.employment).toMatchObject({ companyName: 'Globex', isCurrent: true });
    const rows = await db
      .select()
      .from(schema.employment)
      .where(eq(schema.employment.personId, ada.person.id));
    expect(rows.filter((row) => row.isCurrent).map((row) => row.companyId)).toEqual([
      globex.company.id,
    ]);
    const ended = rows.find((row) => !row.isCurrent);
    expect(ended).toBeDefined();
    expect(ended?.endedAt).not.toBeNull();
  });

  test('adding a job re-emits the person and their leads with the new company', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, { name: 'Ada', company: { domain: 'acme.io' } });
    const leadId = await openLeadFor(ada.person.id);
    const globex = await upsertCompany(context, { name: 'Globex', domains: ['globex.com'] });
    const moved = await addEmployment(context, {
      personId: ada.person.id,
      companyId: globex.company.id,
      title: 'VP',
    });
    const person = emitted(moved.actions, 'person');
    expect(person.map((action) => action.action)).toEqual(['update']);
    expect(person[0]?.data).toMatchObject({
      companyId: globex.company.id,
      companyName: 'Globex',
      title: 'VP',
    });
    const lead = emitted(moved.actions, 'lead');
    expect(lead.map((action) => [action.modelId, action.action])).toEqual([[leadId, 'update']]);
    expect(lead[0]?.data).toMatchObject({ companyId: globex.company.id, companyName: 'Globex' });
    const [stored] = await db
      .select()
      .from(schema.person)
      .where(eq(schema.person.id, ada.person.id));
    expect(stored?.syncId).toBe(person[0]?.syncId);
  });

  test('a title change re-emits the person but not their leads', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, { name: 'Ada', company: { domain: 'acme.io' } });
    await openLeadFor(ada.person.id);
    const promoted = await addEmployment(context, {
      personId: ada.person.id,
      companyId: ada.company?.id ?? '',
      title: 'CTO',
    });
    expect(emitted(promoted.actions, 'person')[0]?.data).toMatchObject({ title: 'CTO' });
    expect(emitted(promoted.actions, 'lead')).toHaveLength(0);
  });

  test('ending a job re-emits the person and their leads without a company', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, { name: 'Ada', company: { domain: 'acme.io' } });
    const leadId = await openLeadFor(ada.person.id);
    const [job] = await db
      .select()
      .from(schema.employment)
      .where(eq(schema.employment.personId, ada.person.id));
    const ended = await endEmployment(context, job?.id ?? '');
    expect(ended.employment).toMatchObject({ isCurrent: false });
    expect(ended.employment.endedAt).not.toBeNull();
    expect(emitted(ended.actions, 'person')[0]?.data).toMatchObject({
      companyId: null,
      companyName: null,
      title: null,
    });
    const lead = emitted(ended.actions, 'lead');
    expect(lead.map((action) => action.modelId)).toEqual([leadId]);
    expect(lead[0]?.data).toMatchObject({ companyId: null, companyName: null });
  });
});

describe('updatePerson', () => {
  test('refuses an email another person already holds', async () => {
    const context = { principal: workspace.admin };
    await upsertPerson(context, { name: 'Ada', emails: ['ada@acme.io'] });
    const grace = await upsertPerson(context, { name: 'Grace', emails: ['grace@acme.io'] });
    await expect(
      updatePerson(context, grace.person.id, { emails: ['ada@acme.io'] }),
    ).rejects.toThrow('Another person already uses that email.');
  });

  test('a rename emits the person, records the change and re-emits their leads', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, { name: 'Ada', company: { domain: 'acme.io' } });
    const leadId = await openLeadFor(ada.person.id);
    const renamed = await updatePerson(context, ada.person.id, { name: 'Ada Lovelace' });
    expect(renamed.actions.map((action) => [action.model, action.action])).toEqual([
      ['person', 'update'],
      ['activity', 'insert'],
      ['lead', 'update'],
    ]);
    expect(renamed.person).toMatchObject({ name: 'Ada Lovelace', companyName: 'acme.io' });
    expect(emitted(renamed.actions, 'activity')[0]?.data).toMatchObject({
      kind: 'person.updated',
      payload: { changes: { name: { from: 'Ada', to: 'Ada Lovelace' } } },
    });
    expect(emitted(renamed.actions, 'lead')[0]?.data).toMatchObject({
      id: leadId,
      personName: 'Ada Lovelace',
    });
  });

  test('a change to a field leads do not show re-emits no lead', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, { name: 'Ada' });
    await openLeadFor(ada.person.id);
    const changed = await updatePerson(context, ada.person.id, { location: 'London' });
    expect(changed.actions.map((action) => action.model)).toEqual(['person', 'activity']);
  });

  test('lowercases emails it writes', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, { name: 'Ada' });
    const changed = await updatePerson(context, ada.person.id, { emails: ['Ada@Acme.COM'] });
    expect(changed.person).toMatchObject({
      emails: ['ada@acme.com'],
      primaryEmail: 'ada@acme.com',
    });
  });
});
