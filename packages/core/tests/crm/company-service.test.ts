import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, eq, schema } from '@gravity/db';
import { scopes } from '@gravity/shared/events';
import { companyInputSchema } from '@gravity/shared/validators';
import { createBrand } from '../../src/crm/brand-service.ts';
import {
  companyRowById,
  selectCompanyRows,
  updateCompany,
  upsertCompany,
  upsertCompanyIn,
} from '../../src/crm/company-service.ts';
import { upsertPerson } from '../../src/crm/person-service.ts';
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

  test('a rename re-emits the people who work there and their leads', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, { name: 'Ada', company: { domain: 'acme.io' } });
    const companyId = ada.company?.id ?? '';
    const leadId = await openLeadFor(ada.person.id);
    const renamed = await updateCompany(context, companyId, { name: 'Acme Corp' });
    expect(renamed.actions.map((action) => [action.model, action.action])).toEqual([
      ['company', 'update'],
      ['activity', 'insert'],
      ['person', 'update'],
      ['lead', 'update'],
    ]);
    const person = renamed.actions.find((action) => action.model === 'person');
    expect(person?.data).toMatchObject({ id: ada.person.id, companyName: 'Acme Corp', companyId });
    const lead = renamed.actions.find((action) => action.model === 'lead');
    expect(lead?.data).toMatchObject({
      id: leadId,
      companyId,
      companyName: 'Acme Corp',
      personName: 'Ada',
    });
    expect(lead?.scopes).toContain(scopes.company(companyId));
    const [stored] = await db.select().from(schema.lead).where(eq(schema.lead.id, leadId));
    expect(stored?.syncId).toBe(lead?.syncId);
  });

  test('changing only the domains re-emits no person or lead', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, { name: 'Ada', company: { domain: 'acme.io' } });
    await openLeadFor(ada.person.id);
    const changed = await updateCompany(context, ada.company?.id ?? '', {
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
