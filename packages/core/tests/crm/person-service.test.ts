import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, eq, schema } from '@gravity/db';
import { personInputSchema } from '@gravity/shared/validators';
import { upsertCompany } from '../../src/crm/company-service.ts';
import { addEmployment, endEmployment } from '../../src/crm/employment-service.ts';
import { createFieldDefinition } from '../../src/crm/field-service.ts';
import {
  findPersonMatch,
  mergedPersonValues,
  updatePerson,
  upsertPerson,
  upsertPersonIn,
  writePersonIn,
} from '../../src/crm/person-service.ts';
import { withBatch } from '../../src/crm/sync-batch.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import { createWorkspace, resetDatabase, type TestWorkspace } from '../../src/test-support.ts';
import { racingRival } from '../support/rival-connection.ts';
import { emitted, modelCounts, openLeadFor, required } from './record-fixtures.ts';

let workspace: TestWorkspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
});

afterAll(async () => {
  await closeRealtime();
});

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
    expect(modelCounts(result.actions)).toEqual({
      person: 1,
      company: 1,
      employment: 1,
      activity: 3,
    });
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
    const leadId = await openLeadFor(workspace, ada.person.id);
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

  test('a merge that fills a missing primary email re-emits the leads', async () => {
    const context = { principal: workspace.admin };
    const linkedinUrl = 'https://www.linkedin.com/in/ada';
    const ada = await upsertPerson(context, { name: 'Ada', linkedinUrl });
    const leadId = await openLeadFor(workspace, ada.person.id);
    const merged = await upsertPerson(context, {
      name: 'Ada',
      linkedinUrl,
      emails: ['ada@acme.io'],
    });
    expect(merged.matchedBy).toBe('linkedin_url');
    const leads = emitted(merged.actions, 'lead');
    expect(leads.map((action) => action.modelId)).toEqual([leadId]);
    expect(leads[0]?.data).toMatchObject({ personEmail: 'ada@acme.io' });
  });

  test('a merge that fills a missing LinkedIn URL re-emits the leads', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, { name: 'Ada', emails: ['ada@acme.io'] });
    const leadId = await openLeadFor(workspace, ada.person.id);
    const merged = await upsertPerson(context, {
      name: 'Ada',
      emails: ['ada@acme.io'],
      linkedinUrl: 'https://www.linkedin.com/in/ada',
    });
    const leads = emitted(merged.actions, 'lead');
    expect(leads.map((action) => action.modelId)).toEqual([leadId]);
    expect(leads[0]?.data).toMatchObject({
      personLinkedinUrl: 'https://www.linkedin.com/in/ada',
    });
  });
});

describe('employment', () => {
  test('adding a past job re-emits no person or lead', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, { name: 'Ada', company: { domain: 'acme.io' } });
    await openLeadFor(workspace, ada.person.id);
    const globex = await upsertCompany(context, { name: 'Globex', domains: ['globex.com'] });
    const past = await addEmployment(context, {
      personId: ada.person.id,
      companyId: globex.company.id,
      isCurrent: false,
    });
    expect(past.actions.map((action) => [action.model, action.action])).toEqual([
      ['employment', 'insert'],
      ['activity', 'insert'],
    ]);
  });

  test('adding a job waits for a rename in flight and records the new company name', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, { name: 'Ada' });
    const globex = await upsertCompany(context, { name: 'Globex', domains: ['globex.com'] });
    const companyId = globex.company.id;
    const joined = await racingRival(
      (tx) => tx`select id from company where id = ${companyId} for update`,
      () => addEmployment(context, { personId: ada.person.id, companyId }),
      (tx) => tx`update company set name = 'Globex Corp' where id = ${companyId}`,
    );
    expect(joined.employment.companyName).toBe('Globex Corp');
  });

  test('naming a company by id waits for a rename in flight', async () => {
    const context = { principal: workspace.admin };
    const globex = await upsertCompany(context, { name: 'Globex', domains: ['globex.com'] });
    const companyId = globex.company.id;
    const created = await racingRival(
      (tx) => tx`select id from company where id = ${companyId} for update`,
      () => upsertPerson(context, { name: 'Ada', company: { id: companyId } }),
      (tx) => tx`update company set name = 'Globex Corp' where id = ${companyId}`,
    );
    expect(created.company?.name).toBe('Globex Corp');
    expect(created.person.companyName).toBe('Globex Corp');
  });

  test('adding a job waits on the person, so two writes never leave two current jobs', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, { name: 'Ada' });
    const acme = await upsertCompany(context, { name: 'Acme', domains: ['acme.io'] });
    const globex = await upsertCompany(context, { name: 'Globex', domains: ['globex.com'] });
    const personId = ada.person.id;
    await racingRival(
      (tx) => tx`select id from person where id = ${personId} for update`,
      () => addEmployment(context, { personId, companyId: globex.company.id }),
      (tx) => tx`
        insert into employment (id, organization_id, person_id, company_id, is_current, sync_id)
        values (${`job-${personId}`}, ${workspace.organizationId}, ${personId}, ${acme.company.id},
          true, nextval('sync_id_seq'))`,
    );
    const rows = await db
      .select()
      .from(schema.employment)
      .where(eq(schema.employment.personId, personId));
    expect(rows.filter((row) => row.isCurrent).map((row) => row.companyId)).toEqual([
      globex.company.id,
    ]);
  });

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
    const leadId = await openLeadFor(workspace, ada.person.id);
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
    await openLeadFor(workspace, ada.person.id);
    const promoted = await addEmployment(context, {
      personId: ada.person.id,
      companyId: required(ada.company?.id, 'the company Ada works at'),
      title: 'CTO',
    });
    expect(emitted(promoted.actions, 'person')[0]?.data).toMatchObject({ title: 'CTO' });
    expect(emitted(promoted.actions, 'lead')).toHaveLength(0);
  });

  test('ending a job re-emits the person and their leads without a company', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, { name: 'Ada', company: { domain: 'acme.io' } });
    const leadId = await openLeadFor(workspace, ada.person.id);
    const [job] = await db
      .select()
      .from(schema.employment)
      .where(eq(schema.employment.personId, ada.person.id));
    const ended = await endEmployment(context, required(job, 'the current job').id);
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
    const leadId = await openLeadFor(workspace, ada.person.id);
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
    await openLeadFor(workspace, ada.person.id);
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

describe('findPersonMatch', () => {
  test('prefers a linked id, then email, with or without a lock, and never across workspaces', async () => {
    const context = { principal: workspace.admin };
    const linked = await upsertPerson(context, { name: 'Linked', emails: ['linked@vela.example'] });
    const byEmail = await upsertPerson(context, { name: 'Ada', emails: ['ada@vela.example'] });
    const input = personInputSchema.parse({ name: 'Ada', emails: ['ada@vela.example'] });
    expect(
      await findPersonMatch(db, workspace.organizationId, input, { lock: false }),
    ).toMatchObject({
      matchedBy: 'email',
      row: { id: byEmail.person.id },
    });
    expect(
      await findPersonMatch(db, workspace.organizationId, input, {
        lock: false,
        preferredId: linked.person.id,
      }),
    ).toMatchObject({ matchedBy: 'source_id', row: { id: linked.person.id } });
    const locked = await withBatch(context, async (batch) => ({
      match: await findPersonMatch(batch.tx, batch.organizationId, input, { lock: true }),
    }));
    expect(locked.match?.row.id).toBe(byEmail.person.id);
    const other = await createWorkspace('Other');
    expect(
      await findPersonMatch(db, other.organizationId, input, {
        lock: false,
        preferredId: linked.person.id,
      }),
    ).toBeNull();
  });

  test('probes the linked id, then the provider id, then the email, then the LinkedIn URL', async () => {
    const context = { principal: workspace.admin };
    const byUrl = await upsertPerson(context, {
      name: 'By Url',
      linkedinUrl: 'https://www.linkedin.com/in/by-url',
    });
    const byEmail = await upsertPerson(context, {
      name: 'By Email',
      emails: ['mail@vela.example'],
      linkedinUrl: 'https://www.linkedin.com/in/by-url-too',
    });
    const byProvider = await upsertPerson(context, {
      name: 'By Provider',
      linkedinProviderId: 'ACoAAA1',
    });
    const input = personInputSchema.parse({
      name: 'Anyone',
      emails: ['mail@vela.example'],
      linkedinUrl: 'https://www.linkedin.com/in/by-url',
      linkedinProviderId: 'ACoAAA1',
    });
    const matchedBy = async (next: typeof input, lock: boolean) => {
      const { match } = await withBatch(context, async (batch) => ({
        match: await findPersonMatch(batch.tx, batch.organizationId, next, { lock }),
      }));
      return match === null ? null : [match.matchedBy, match.row.id];
    };
    expect(await matchedBy(input, true)).toEqual(['linkedin_provider_id', byProvider.person.id]);
    expect(await matchedBy(input, false)).toEqual(['linkedin_provider_id', byProvider.person.id]);
    const withoutProvider = { ...input, linkedinProviderId: null };
    expect(await matchedBy(withoutProvider, true)).toEqual(['email', byEmail.person.id]);
    const urlOnly = { ...withoutProvider, emails: [] };
    expect(await matchedBy(urlOnly, true)).toEqual(['linkedin_url', byUrl.person.id]);
    expect(await matchedBy({ ...urlOnly, linkedinUrl: null }, true)).toBeNull();
  });

  test('runs unlocked inside a read-only transaction and skips archived people', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, { name: 'Ada', emails: ['ada@vela.example'] });
    const input = personInputSchema.parse({ name: 'Ada', emails: ['ada@vela.example'] });
    const preview = await db.transaction(
      (tx) => findPersonMatch(tx, workspace.organizationId, input, { lock: false }),
      { accessMode: 'read only' },
    );
    expect(preview?.row.id).toBe(ada.person.id);
    await db
      .update(schema.person)
      .set({ archivedAt: new Date() })
      .where(eq(schema.person.id, ada.person.id));
    expect(
      await findPersonMatch(db, workspace.organizationId, input, {
        lock: false,
        preferredId: ada.person.id,
      }),
    ).toBeNull();
  });

  test('upsertPersonIn merges into the preferred person even when the email is new', async () => {
    const context = { principal: workspace.admin };
    const linked = await upsertPerson(context, { name: 'No Email' });
    const merged = await withBatch(context, (batch) =>
      upsertPersonIn(
        batch,
        personInputSchema.parse({ name: 'No Email', emails: ['new@vela.example'] }),
        linked.person.id,
      ),
    );
    expect(merged).toMatchObject({ created: false, matchedBy: 'source_id' });
    expect(merged.person.emails).toEqual(['new@vela.example']);
  });

  test('mergedPersonValues fills blanks and never replaces a value', async () => {
    const existing = await upsertPerson(
      { principal: workspace.admin },
      { name: 'Ada', emails: ['ada@vela.example'], location: 'London' },
    );
    const [stored] = await db
      .select()
      .from(schema.person)
      .where(eq(schema.person.id, existing.person.id));
    const next = mergedPersonValues(
      required(stored, 'the stored person'),
      personInputSchema.parse({
        name: 'A. L.',
        emails: ['ada@home.example'],
        location: 'Paris',
        timezone: 'Europe/London',
      }),
      {},
    );
    expect(next).toMatchObject({
      name: 'Ada',
      location: 'London',
      timezone: 'Europe/London',
      emails: ['ada@vela.example', 'ada@home.example'],
    });
  });
});

describe('writePersonIn', () => {
  const companyOf = () => Promise.reject(new Error('no company expected'));

  test('inserts a person when there is no match and emits its insert', async () => {
    const input = personInputSchema.parse({ name: 'Nia North', emails: ['NIA@quill.example'] });
    const written = await withBatch({ principal: workspace.admin }, async (batch) => ({
      result: await writePersonIn(batch, input, null, companyOf),
    }));
    expect(written.result).toMatchObject({ created: true, matchedBy: null });
    expect(written.result.person.emails).toEqual(['nia@quill.example']);
    expect(emitted(written.actions, 'person').map((action) => action.action)).toEqual(['insert']);
  });

  test('merges into the matched person and reports how it matched', async () => {
    const first = await upsertPerson(
      { principal: workspace.admin },
      { name: 'Nia North', emails: ['nia@quill.example'] },
    );
    const match = await findPersonMatch(
      db,
      workspace.organizationId,
      personInputSchema.parse({ name: 'Nia', emails: ['nia@quill.example'] }),
      { lock: false },
    );
    const input = personInputSchema.parse({
      name: 'Nia North',
      emails: ['nia@quill.example', 'nia@north.example'],
    });
    const written = await withBatch({ principal: workspace.admin }, async (batch) => ({
      result: await writePersonIn(batch, input, match, companyOf),
    }));
    expect(written.result).toMatchObject({ created: false, matchedBy: 'email' });
    expect(written.result.person.id).toBe(first.person.id);
    expect(written.result.person.emails).toEqual(['nia@quill.example', 'nia@north.example']);
    expect(emitted(written.actions, 'person').map((action) => action.action)).toEqual(['update']);
  });
});
