import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, eq, schema } from '@gravity/db';
import { createBrand } from '../../src/crm/brand-service.ts';
import { changeLead, createLead } from '../../src/crm/lead-service.ts';
import { upsertPerson } from '../../src/crm/person-service.ts';
import { archivePipeline } from '../../src/crm/pipeline-service.ts';
import { findDuplicates, searchRecords } from '../../src/crm/search-service.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import { createWorkspace, resetDatabase, type TestWorkspace } from '../../src/test-support.ts';

let workspace: TestWorkspace;
let adaId = '';
let pipelineId = '';
let wonStageId = '';
let leadId = '';

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
  const brand = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
  const ada = await upsertPerson(
    { principal: workspace.admin },
    {
      name: 'Ada Lovelace',
      emails: ['ada@acme.io'],
      linkedinUrl: 'https://linkedin.com/in/ada',
      company: { domain: 'acme.io', name: 'Acme' },
    },
  );
  adaId = ada.person.id;
  pipelineId = brand.pipeline.id;
  wonStageId = brand.stages.find((stage) => stage.category === 'won')?.id ?? '';
  leadId = (
    await createLead(
      { principal: workspace.admin },
      { personId: ada.person.id, pipelineId: brand.pipeline.id },
    )
  ).lead.id;
});

afterAll(async () => {
  await closeRealtime();
});

describe('searchRecords', () => {
  test('finds a person through a typo and a company by domain', async () => {
    const result = await searchRecords(workspace.admin, { q: 'Ada Lovelce' });
    expect(result.people.map((person) => person.name)).toEqual(['Ada Lovelace']);
    expect(
      (await searchRecords(workspace.admin, { q: 'acme.io' })).companies.map(
        (company) => company.name,
      ),
    ).toEqual(['Acme']);
  });

  test('a lead key returns that lead first', async () => {
    const result = await searchRecords(workspace.admin, { q: 'yod-1' });
    expect(result.leads[0]?.key).toBe('YOD-1');
    expect(result.leads).toHaveLength(1);
  });

  test('never returns another workspace record', async () => {
    const other = await createWorkspace('Other');
    const result = await searchRecords(other.admin, { q: 'Ada' });
    expect([...result.people, ...result.leads, ...result.companies]).toHaveLength(0);
    expect((await searchRecords(other.admin, { q: 'yod-1' })).leads).toHaveLength(0);
  });

  test('skips archived people and their leads', async () => {
    await db
      .update(schema.person)
      .set({ archivedAt: new Date() })
      .where(eq(schema.person.id, adaId));
    await db
      .update(schema.lead)
      .set({ archivedAt: new Date() })
      .where(eq(schema.lead.personId, adaId));
    const result = await searchRecords(workspace.admin, { q: 'Ada' });
    expect([...result.people, ...result.leads]).toHaveLength(0);
  });

  test('a lead key never returns an archived lead', async () => {
    await db.update(schema.lead).set({ archivedAt: new Date() }).where(eq(schema.lead.id, leadId));
    const result = await searchRecords(workspace.admin, { q: 'yod-1' });
    expect(result.leads).toHaveLength(0);
  });

  test('skips a won lead in an archived pipeline by term and by key', async () => {
    const context = { principal: workspace.admin };
    await changeLead(context, leadId, { type: 'close', stageId: wonStageId });
    expect((await searchRecords(workspace.admin, { q: 'yod-1' })).leads).toHaveLength(1);
    expect((await searchRecords(workspace.admin, { q: 'Ada' })).leads).toHaveLength(1);
    await archivePipeline(context, pipelineId);
    expect((await searchRecords(workspace.admin, { q: 'yod-1' })).leads).toHaveLength(0);
    expect((await searchRecords(workspace.admin, { q: 'Ada' })).leads).toHaveLength(0);
    expect((await searchRecords(workspace.admin, { q: 'Ada' })).people).toHaveLength(1);
  });

  test('treats wildcards in the term literally', async () => {
    expect((await searchRecords(workspace.admin, { q: 'a_a' })).people).toHaveLength(0);
    expect((await searchRecords(workspace.admin, { q: '%' })).leads).toHaveLength(0);
  });

  test('refuses an empty term', async () => {
    await expect(searchRecords(workspace.admin, { q: '  ' })).rejects.toThrow();
  });
});

describe('findDuplicates', () => {
  test('matches by email, by any LinkedIn URL form and the company by business domain', async () => {
    expect((await findDuplicates(workspace.admin, { email: 'ADA@acme.io' })).people).toHaveLength(
      1,
    );
    expect(
      (await findDuplicates(workspace.admin, { linkedinUrl: 'www.linkedin.com/in/Ada/' })).people,
    ).toHaveLength(1);
    expect(
      (await findDuplicates(workspace.admin, { email: 'someone@acme.io' })).companies.map(
        (company) => company.name,
      ),
    ).toEqual(['Acme']);
    expect(
      (await findDuplicates(workspace.admin, { email: 'someone@gmail.com' })).companies,
    ).toHaveLength(0);
  });

  test('matches a similar name and a domain, and nothing for an empty probe', async () => {
    expect((await findDuplicates(workspace.admin, { name: 'Ada Lovelace' })).people).toHaveLength(
      1,
    );
    expect(
      (await findDuplicates(workspace.admin, { domain: 'https://www.ACME.io/about' })).companies,
    ).toHaveLength(1);
    expect(await findDuplicates(workspace.admin, {})).toEqual({ people: [], companies: [] });
  });

  test('never matches another workspace or an archived person', async () => {
    const other = await createWorkspace('Other');
    expect((await findDuplicates(other.admin, { email: 'ada@acme.io' })).people).toHaveLength(0);
    await db
      .update(schema.person)
      .set({ archivedAt: new Date() })
      .where(eq(schema.person.id, adaId));
    expect((await findDuplicates(workspace.admin, { email: 'ada@acme.io' })).people).toHaveLength(
      0,
    );
  });
});
