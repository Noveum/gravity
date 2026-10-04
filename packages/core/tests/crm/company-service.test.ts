import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, eq, schema } from '@gravity/db';
import { scopes } from '@gravity/shared/events';
import { companyInputSchema } from '@gravity/shared/validators';
import {
  companyRowById,
  selectCompanyRows,
  updateCompany,
  upsertCompany,
  upsertCompanyIn,
} from '../../src/crm/company-service.ts';
import { addEmployment } from '../../src/crm/employment-service.ts';
import { upsertPerson } from '../../src/crm/person-service.ts';
import { withBatch } from '../../src/crm/sync-batch.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import { createWorkspace, resetDatabase, type TestWorkspace } from '../../src/test-support.ts';
import { racingRival } from '../support/rival-connection.ts';
import { emitted, openLeadFor, required } from './record-fixtures.ts';

let workspace: TestWorkspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
});

afterAll(async () => {
  await closeRealtime();
});

describe('upsertCompany', () => {
  test('matches on any domain after normalisation, unions domains and fills gaps', async () => {
    const context = { principal: workspace.admin };
    const first = await upsertCompany(context, { name: 'Acme', domains: ['acme.com'] });
    expect(first.created).toBe(true);
    const second = await upsertCompany(context, {
      name: 'ACME Inc',
      domains: ['https://www.ACME.com/', 'acme.io'],
      segment: 'SaaS',
    });
    expect(second.created).toBe(false);
    expect(second.company).toMatchObject({
      id: first.company.id,
      name: 'Acme',
      domains: ['acme.com', 'acme.io'],
      primaryDomain: 'acme.com',
      segment: 'SaaS',
    });
    expect(second.actions.map((action) => action.model)).toEqual(['company', 'activity']);
  });

  test('an unchanged match emits nothing', async () => {
    const context = { principal: workspace.admin };
    await upsertCompany(context, { name: 'Acme', domains: ['acme.com'] });
    const again = await upsertCompany(context, { name: 'Acme', domains: ['acme.com'] });
    expect(again.actions).toHaveLength(0);
  });

  test('matches by name only when no domain is given', async () => {
    const context = { principal: workspace.admin };
    const named = await upsertCompany(context, { name: 'Initech' });
    expect((await upsertCompany(context, { name: 'initech' })).company.id).toBe(named.company.id);
  });

  test('another workspace never matches', async () => {
    await upsertCompany({ principal: workspace.admin }, { name: 'Acme', domains: ['acme.com'] });
    const other = await createWorkspace('Other');
    expect(
      (await upsertCompany({ principal: other.admin }, { name: 'Acme', domains: ['acme.com'] }))
        .created,
    ).toBe(true);
  });

  test('lowercases domains before matching and writing, even past the schema', async () => {
    const context = { principal: workspace.admin };
    const acme = await upsertCompany(context, { name: 'Acme', domains: ['acme.com'] });
    const raw = { ...companyInputSchema.parse({ name: 'Acme' }), domains: ['ACME.com', 'Acme.IO'] };
    const matched = await withBatch(context, (batch) => upsertCompanyIn(batch, raw));
    expect(matched.created).toBe(false);
    expect(matched.company).toMatchObject({
      id: acme.company.id,
      domains: ['acme.com', 'acme.io'],
    });
    const fresh = await withBatch(context, (batch) =>
      upsertCompanyIn(batch, { ...raw, name: 'Globex', domains: ['GLOBEX.com'] }),
    );
    expect(fresh.company).toMatchObject({ domains: ['globex.com'], primaryDomain: 'globex.com' });
  });

  test('a domain shared by two companies matches the oldest one every time', async () => {
    const context = { principal: workspace.admin };
    const older = await upsertCompany(context, { name: 'Zeta', domains: ['zeta.com'] });
    await upsertCompany(context, { name: 'Acme', domains: ['acme.com'] });
    await updateCompany(context, older.company.id, { name: 'Zeta Corp' });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const matched = await upsertCompany(context, {
        name: 'Either',
        domains: ['acme.com', 'zeta.com'],
      });
      expect(matched.company.id).toBe(older.company.id);
    }
  });
});

describe('updateCompany', () => {
  test('refuses a primary domain another company holds', async () => {
    const context = { principal: workspace.admin };
    await upsertCompany(context, { name: 'Acme', domains: ['acme.com'] });
    const other = await upsertCompany(context, { name: 'Globex', domains: ['globex.com'] });
    await expect(
      updateCompany(context, other.company.id, { domains: ['acme.com'] }),
    ).rejects.toThrow('Another company already uses that domain.');
  });

  test('a rename re-emits every job there and the people who work there now, with their leads', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, { name: 'Ada', company: { domain: 'acme.io' } });
    const companyId = required(ada.company?.id, 'the company Ada works at');
    const leadId = await openLeadFor(workspace, ada.person.id);
    const renamed = await updateCompany(context, companyId, { name: 'Acme Corp' });
    expect(renamed.actions.map((action) => [action.model, action.action])).toEqual([
      ['company', 'update'],
      ['activity', 'insert'],
      ['employment', 'update'],
      ['person', 'update'],
      ['lead', 'update'],
    ]);
    expect(emitted(renamed.actions, 'person')[0]?.data).toMatchObject({
      id: ada.person.id,
      companyName: 'Acme Corp',
      companyId,
    });
    const lead = required(emitted(renamed.actions, 'lead')[0], 'a lead action');
    expect(lead.data).toMatchObject({
      id: leadId,
      companyId,
      companyName: 'Acme Corp',
      personName: 'Ada',
    });
    expect(lead.scopes).toContain(scopes.company(companyId));
    const [stored] = await db.select().from(schema.lead).where(eq(schema.lead.id, leadId));
    expect(stored?.syncId).toBe(lead.syncId);
  });

  test('a rename refreshes past jobs too but leaves former employees alone', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, { name: 'Ada', company: { domain: 'acme.io' } });
    const acmeId = required(ada.company?.id, 'the company Ada works at');
    const grace = await upsertPerson(context, { name: 'Grace', company: { id: acmeId } });
    const globex = await upsertCompany(context, { name: 'Globex', domains: ['globex.com'] });
    await addEmployment(context, { personId: ada.person.id, companyId: globex.company.id });
    await openLeadFor(workspace, ada.person.id);
    const graceLead = await openLeadFor(workspace, grace.person.id);
    const renamed = await updateCompany(context, acmeId, { name: 'Acme Corp' });
    const jobs = emitted(renamed.actions, 'employment');
    expect(
      jobs
        .map((action) => [action.data['personId'], action.data['isCurrent']])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual(
      [
        [ada.person.id, false],
        [grace.person.id, true],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    for (const job of jobs) {
      expect(job.data['companyName']).toBe('Acme Corp');
      const [stored] = await db
        .select()
        .from(schema.employment)
        .where(eq(schema.employment.id, job.modelId));
      expect(stored?.syncId).toBe(job.syncId);
    }
    expect(emitted(renamed.actions, 'person').map((action) => action.modelId)).toEqual([
      grace.person.id,
    ]);
    expect(emitted(renamed.actions, 'lead').map((action) => action.modelId)).toEqual([graceLead]);
  });

  test('a re-emitted person outranks an update that committed while the rename waited', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, { name: 'Ada', company: { domain: 'acme.io' } });
    const companyId = required(ada.company?.id, 'the company Ada works at');
    let competing = 0;
    const renamed = await racingRival(
      (tx) => tx`select id from person where id = ${ada.person.id} for update`,
      () => updateCompany(context, companyId, { name: 'Acme Corp' }),
      async (tx) => {
        const [row] = await tx<{ next: string }[]>`select nextval('sync_id_seq')::text as next`;
        competing = Number(required(row, 'a sync id').next);
        await tx`update person set sync_id = ${competing} where id = ${ada.person.id}`;
      },
    );
    const person = required(emitted(renamed.actions, 'person')[0], 'a person action');
    expect(person.syncId).toBeGreaterThan(competing);
    const [stored] = await db
      .select()
      .from(schema.person)
      .where(eq(schema.person.id, ada.person.id));
    expect(stored?.syncId).toBe(person.syncId);
  });

  test('changing only the domains re-emits no person or lead', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, { name: 'Ada', company: { domain: 'acme.io' } });
    await openLeadFor(workspace, ada.person.id);
    const changed = await updateCompany(context, required(ada.company?.id, 'a company'), {
      domains: ['acme.io', 'acme.dev'],
    });
    expect(changed.actions.map((action) => action.model)).toEqual(['company', 'activity']);
  });
});

describe('company reads', () => {
  test('selectCompanyRows is scoped to the workspace and companyRowById skips archived rows', async () => {
    const context = { principal: workspace.admin };
    const acme = await upsertCompany(context, { name: 'Acme', domains: ['acme.com'] });
    const other = await createWorkspace('Other');
    await upsertCompany({ principal: other.admin }, { name: 'Elsewhere' });
    const rows = await selectCompanyRows(db, workspace.organizationId, undefined);
    expect(rows.map((row) => row.name)).toEqual(['Acme']);
    await db
      .update(schema.company)
      .set({ archivedAt: new Date() })
      .where(eq(schema.company.id, acme.company.id));
    await expect(companyRowById(db, workspace.organizationId, acme.company.id)).rejects.toThrow(
      'That company does not exist.',
    );
  });
});
