import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, eq, schema } from '@gravity/db';
import { createBrand } from '../../src/crm/brand-service.ts';
import { upsertCompany } from '../../src/crm/company-service.ts';
import { addEmployment } from '../../src/crm/employment-service.ts';
import { createLead } from '../../src/crm/lead-service.ts';
import { upsertPerson } from '../../src/crm/person-service.ts';
import { getCompanyRecord, getPersonRecord } from '../../src/crm/record-service.ts';
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

describe('record reads', () => {
  test('a person record lists the current job first and every lead', async () => {
    const context = { principal: workspace.admin };
    const brand = await createBrand(context, { name: 'Yodu' });
    const ada = await upsertPerson(context, {
      name: 'Ada',
      company: { domain: 'acme.io', name: 'Acme' },
    });
    const globex = await upsertCompany(context, { name: 'Globex', domains: ['globex.com'] });
    await addEmployment(context, { personId: ada.person.id, companyId: globex.company.id });
    await createLead(context, { personId: ada.person.id, pipelineId: brand.pipeline.id });
    const record = await getPersonRecord(workspace.admin, ada.person.id);
    expect(record.employments.map((job) => [job.companyName, job.isCurrent])).toEqual([
      ['Globex', true],
      ['Acme', false],
    ]);
    expect(record.leads.map((lead) => lead.companyName)).toEqual(['Globex']);
  });

  test('a company record lists its current people and their leads', async () => {
    const context = { principal: workspace.admin };
    const brand = await createBrand(context, { name: 'Yodu' });
    const ada = await upsertPerson(context, {
      name: 'Ada',
      company: { domain: 'acme.io', name: 'Acme' },
    });
    await createLead(context, { personId: ada.person.id, pipelineId: brand.pipeline.id });
    const companyId = ada.company?.id ?? '';
    const record = await getCompanyRecord(workspace.admin, companyId);
    expect(record.people.map((entry) => entry.person.name)).toEqual(['Ada']);
    expect(record.people.map((entry) => entry.employment.companyName)).toEqual(['Acme']);
    expect(record.leads.map((lead) => lead.key)).toEqual(['YOD-1']);
    const other = await createWorkspace('Other');
    await expect(getCompanyRecord(other.admin, companyId)).rejects.toThrow(
      'That company does not exist.',
    );
  });

  test('a person record leaves out archived leads and refuses another workspace', async () => {
    const context = { principal: workspace.admin };
    const brand = await createBrand(context, { name: 'Yodu' });
    const ada = await upsertPerson(context, { name: 'Ada' });
    const { lead } = await createLead(context, {
      personId: ada.person.id,
      pipelineId: brand.pipeline.id,
    });
    await db.update(schema.lead).set({ archivedAt: new Date() }).where(eq(schema.lead.id, lead.id));
    expect((await getPersonRecord(workspace.admin, ada.person.id)).leads).toHaveLength(0);
    const other = await createWorkspace('Other');
    await expect(getPersonRecord(other.admin, ada.person.id)).rejects.toThrow(
      'That person does not exist.',
    );
  });

  test('a company record leaves out people who left and archived people', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, {
      name: 'Ada',
      company: { domain: 'acme.io', name: 'Acme' },
    });
    await upsertPerson(context, { name: 'Bob', company: { domain: 'acme.io' } });
    const globex = await upsertCompany(context, { name: 'Globex', domains: ['globex.com'] });
    await addEmployment(context, { personId: ada.person.id, companyId: globex.company.id });
    const acmeId = ada.company?.id ?? '';
    expect(
      (await getCompanyRecord(workspace.admin, acmeId)).people.map((entry) => entry.person.name),
    ).toEqual(['Bob']);
    await db
      .update(schema.person)
      .set({ archivedAt: new Date() })
      .where(eq(schema.person.name, 'Bob'));
    expect((await getCompanyRecord(workspace.admin, acmeId)).people).toHaveLength(0);
  });
});
