import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, eq, schema } from '@gravity/db';
import { createBrand } from '../../src/crm/brand-service.ts';
import { createLead } from '../../src/crm/lead-service.ts';
import { upsertPerson } from '../../src/crm/person-service.ts';
import { resolveRecordRef } from '../../src/crm/record-ref.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import { createWorkspace, resetDatabase, type TestWorkspace } from '../../src/test-support.ts';

let workspace: TestWorkspace;
let personId = '';
let companyId = '';
let leadId = '';

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
  const context = { principal: workspace.admin };
  const brand = await createBrand(context, { name: 'Lumen', pipelineKey: 'LUM' });
  const person = await upsertPerson(context, {
    name: 'Ada Lovelace',
    emails: ['ada@vela.example'],
    linkedinUrl: 'https://www.linkedin.com/in/ada-lovelace',
    company: { domain: 'vela.example', name: 'Vela Robotics' },
  });
  personId = person.person.id;
  companyId = person.company?.id ?? '';
  leadId = (await createLead(context, { personId, pipelineId: brand.pipeline.id })).lead.id;
});

afterAll(async () => {
  await closeRealtime();
});

describe('resolveRecordRef', () => {
  test('resolves a lead key, an email, a LinkedIn URL, a domain and ids', async () => {
    const principal = workspace.admin;
    expect(await resolveRecordRef(principal, 'LUM-1')).toEqual({ type: 'lead', id: leadId });
    expect(await resolveRecordRef(principal, ' lum-1 ')).toEqual({ type: 'lead', id: leadId });
    expect(await resolveRecordRef(principal, ' ADA@vela.example ')).toEqual({
      type: 'person',
      id: personId,
    });
    expect(await resolveRecordRef(principal, 'linkedin.com/in/Ada-Lovelace/')).toEqual({
      type: 'person',
      id: personId,
    });
    expect(await resolveRecordRef(principal, 'https://www.vela.example/about')).toEqual({
      type: 'company',
      id: companyId,
    });
    expect(await resolveRecordRef(principal, personId)).toEqual({ type: 'person', id: personId });
    expect(await resolveRecordRef(principal, companyId)).toEqual({
      type: 'company',
      id: companyId,
    });
    expect(await resolveRecordRef(principal, leadId)).toEqual({ type: 'lead', id: leadId });
  });

  test('never resolves a record of another workspace or an archived person', async () => {
    const other = await createWorkspace('Other');
    await expect(resolveRecordRef(other.admin, 'ada@vela.example')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(resolveRecordRef(other.admin, personId)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(resolveRecordRef(other.admin, companyId)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(resolveRecordRef(other.admin, leadId)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(resolveRecordRef(other.admin, 'LUM-1')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(resolveRecordRef(other.admin, 'vela.example')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      resolveRecordRef(other.admin, 'linkedin.com/in/ada-lovelace'),
    ).rejects.toMatchObject({ code: 'not_found' });
    await db
      .update(schema.person)
      .set({ archivedAt: new Date() })
      .where(eq(schema.person.id, personId));
    await expect(resolveRecordRef(workspace.admin, 'ada@vela.example')).rejects.toThrow(
      'Nothing in this workspace matches "ada@vela.example".',
    );
  });

  test('an archived company and an archived lead are not resolved', async () => {
    await db
      .update(schema.company)
      .set({ archivedAt: new Date() })
      .where(eq(schema.company.id, companyId));
    await expect(resolveRecordRef(workspace.admin, 'vela.example')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(resolveRecordRef(workspace.admin, companyId)).rejects.toMatchObject({
      code: 'not_found',
    });
    await db.update(schema.lead).set({ archivedAt: new Date() }).where(eq(schema.lead.id, leadId));
    await expect(resolveRecordRef(workspace.admin, 'LUM-1')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(resolveRecordRef(workspace.admin, leadId)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  test('a domain with no company and an unknown key are named in the refusal', async () => {
    await expect(resolveRecordRef(workspace.admin, 'nowhere.example')).rejects.toThrow(
      'Nothing in this workspace matches "nowhere.example".',
    );
    await expect(resolveRecordRef(workspace.admin, 'LUM-99')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  test('a LinkedIn company or school URL never matches the company whose domain is linkedin.com', async () => {
    const context = { principal: workspace.admin };
    const linkedin = await upsertPerson(context, {
      name: 'Reid Recruiter',
      emails: ['reid@linkedin.com'],
      company: { domain: 'linkedin.com', name: 'LinkedIn' },
    });
    const linkedinCompanyId = linkedin.company?.id ?? '';
    for (const ref of [
      'https://www.linkedin.com/company/vela-robotics',
      'linkedin.com/company/vela-robotics/',
      'https://www.linkedin.com/school/stanford-university',
      'https://uk.linkedin.com/company/vela-robotics?trk=x',
    ]) {
      await expect(resolveRecordRef(workspace.admin, ref)).rejects.toMatchObject({
        code: 'not_found',
      });
    }
    expect(await resolveRecordRef(workspace.admin, 'linkedin.com')).toEqual({
      type: 'company',
      id: linkedinCompanyId,
    });
  });

  test('asks for a reference when given nothing', async () => {
    await expect(resolveRecordRef(workspace.admin, '   ')).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });
});
