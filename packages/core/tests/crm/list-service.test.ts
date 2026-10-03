import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, eq, schema } from '@gravity/db';
import { encodeFilter, inCondition } from '@gravity/shared/filters';
import type { Principal } from '@gravity/shared/policy';
import { createBrand } from '../../src/crm/brand-service.ts';
import { upsertCompany } from '../../src/crm/company-service.ts';
import { encodeCursor } from '../../src/crm/cursor.ts';
import { createLead } from '../../src/crm/lead-service.ts';
import { listCompanies, listLeads, listPeople } from '../../src/crm/list-service.ts';
import { upsertPerson } from '../../src/crm/person-service.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type TestWorkspace,
} from '../../src/test-support.ts';

let workspace: TestWorkspace;
let pipelineId = '';
let readyId = '';

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
  const brand = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
  pipelineId = brand.pipeline.id;
  readyId = brand.stages.find((stage) => stage.name === 'Ready')?.id ?? '';
  for (const name of ['Ada Lovelace', 'grace Hopper', 'Linus Torvalds']) {
    const person = await upsertPerson({ principal: workspace.admin }, { name });
    await createLead(
      { principal: workspace.admin },
      {
        personId: person.person.id,
        pipelineId,
        ...(name === 'Linus Torvalds' ? { stageId: readyId } : {}),
      },
    );
  }
});

afterAll(async () => {
  await closeRealtime();
});

describe('listLeads', () => {
  test('pages newest first with a cursor and skips archived leads', async () => {
    const first = await listLeads(workspace.admin, { pipelineId, limit: 2 });
    expect(first.leads.map((lead) => lead.key)).toEqual(['YOD-3', 'YOD-2']);
    const second = await listLeads(workspace.admin, {
      pipelineId,
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.leads.map((lead) => lead.key)).toEqual(['YOD-1']);
    expect(second.nextCursor).toBeNull();
    await db.update(schema.lead).set({ archivedAt: new Date() }).where(eq(schema.lead.number, 1));
    expect((await listLeads(workspace.admin, { pipelineId })).leads).toHaveLength(2);
  });

  test('applies the URL filter and the search term', async () => {
    const filter = encodeFilter({
      kind: 'group',
      combinator: 'and',
      children: [inCondition('stage', [readyId])],
    });
    expect(
      (await listLeads(workspace.admin, { pipelineId, filter })).leads.map(
        (lead) => lead.personName,
      ),
    ).toEqual(['Linus Torvalds']);
    expect(
      (await listLeads(workspace.admin, { pipelineId, q: 'hopper' })).leads.map((lead) => lead.key),
    ).toEqual(['YOD-2']);
  });

  test('owner me resolves to the principal asking', async () => {
    const teammate = await addMember(workspace, 'Tess', 'member');
    await db.update(schema.lead).set({ ownerId: teammate.userId }).where(eq(schema.lead.number, 2));
    const filter = encodeFilter({
      kind: 'group',
      combinator: 'and',
      children: [inCondition('owner', ['me'])],
    });
    const keysFor = async (principal: Principal) =>
      (await listLeads(principal, { pipelineId, filter })).leads.map((lead) => lead.key);
    expect(await keysFor(teammate)).toEqual(['YOD-2']);
    expect(await keysFor(workspace.admin)).toEqual(['YOD-3', 'YOD-1']);
  });

  test('refuses an unknown filter property and a foreign pipeline', async () => {
    const filter = encodeFilter({
      kind: 'group',
      combinator: 'and',
      children: [inCondition('ghost', ['x'])],
    });
    await expect(listLeads(workspace.admin, { pipelineId, filter })).rejects.toThrow(
      'There is no lead filter called ghost.',
    );
    const other = await createWorkspace('Other');
    await expect(listLeads(other.admin, { pipelineId })).rejects.toThrow(
      'That pipeline does not exist.',
    );
  });

  test('refuses a filter value the property cannot take', async () => {
    const filter = encodeFilter({
      kind: 'group',
      combinator: 'and',
      children: [inCondition('priority', ['high'])],
    });
    await expect(listLeads(workspace.admin, { pipelineId, filter })).rejects.toThrow(
      'Priority takes numbers.',
    );
  });

  test('refuses a cursor of the wrong shape with a validation error', async () => {
    for (const cursor of [
      encodeCursor(['YOD-3']),
      encodeCursor([1.5]),
      encodeCursor([3, 2]),
      '%%%',
    ]) {
      await expect(listLeads(workspace.admin, { pipelineId, cursor })).rejects.toMatchObject({
        code: 'validation_failed',
      });
    }
  });

  test('refuses an archived pipeline', async () => {
    await db
      .update(schema.pipeline)
      .set({ archivedAt: new Date() })
      .where(eq(schema.pipeline.id, pipelineId));
    await expect(listLeads(workspace.admin, { pipelineId })).rejects.toThrow(
      'That pipeline does not exist.',
    );
  });
});

describe('listPeople and listCompanies', () => {
  test('people sort by name case-insensitively across pages', async () => {
    const first = await listPeople(workspace.admin, { limit: 2 });
    const second = await listPeople(workspace.admin, {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect([...first.people, ...second.people].map((person) => person.name)).toEqual([
      'Ada Lovelace',
      'grace Hopper',
      'Linus Torvalds',
    ]);
    expect(second.nextCursor).toBeNull();
  });

  test('people with the same name page by id without repeats', async () => {
    for (let index = 0; index < 3; index += 1) {
      await upsertPerson({ principal: workspace.admin }, { name: 'ada lovelace' });
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await listPeople(workspace.admin, {
        limit: 2,
        ...(cursor === undefined ? {} : { cursor }),
      });
      seen.push(...result.people.map((person) => person.id));
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
  });

  test('people skip archived records and apply the search term', async () => {
    await db
      .update(schema.person)
      .set({ archivedAt: new Date() })
      .where(eq(schema.person.name, 'Linus Torvalds'));
    expect((await listPeople(workspace.admin, {})).people.map((person) => person.name)).toEqual([
      'Ada Lovelace',
      'grace Hopper',
    ]);
    expect(
      (await listPeople(workspace.admin, { q: 'HOP' })).people.map((person) => person.name),
    ).toEqual(['grace Hopper']);
  });

  test('people refuse a cursor of the wrong shape', async () => {
    await expect(
      listPeople(workspace.admin, { cursor: encodeCursor([3, 'id']) }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(
      listPeople(workspace.admin, { cursor: encodeCursor(['Ada']) }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  test('companies filter by domain', async () => {
    await upsertCompany({ principal: workspace.admin }, { name: 'Acme', domains: ['acme.io'] });
    await upsertCompany(
      { principal: workspace.admin },
      { name: 'Globex', domains: ['globex.com'] },
    );
    const filter = encodeFilter({
      kind: 'group',
      combinator: 'and',
      children: [
        {
          kind: 'condition',
          property: 'domain',
          operator: 'contains',
          value: 'acme',
          negate: false,
        },
      ],
    });
    expect(
      (await listCompanies(workspace.admin, { filter })).companies.map((company) => company.name),
    ).toEqual(['Acme']);
  });

  test('companies page by name and skip archived ones', async () => {
    for (const name of ['Globex', 'acme', 'Initech']) {
      await upsertCompany({ principal: workspace.admin }, { name });
    }
    const first = await listCompanies(workspace.admin, { limit: 2 });
    const second = await listCompanies(workspace.admin, {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect([...first.companies, ...second.companies].map((company) => company.name)).toEqual([
      'acme',
      'Globex',
      'Initech',
    ]);
    await db
      .update(schema.company)
      .set({ archivedAt: new Date() })
      .where(eq(schema.company.name, 'Globex'));
    expect((await listCompanies(workspace.admin, { q: 'glob' })).companies).toHaveLength(0);
  });

  test('another workspace sees none of these records', async () => {
    const other = await createWorkspace('Other');
    expect((await listPeople(other.admin, {})).people).toHaveLength(0);
    expect((await listCompanies(other.admin, {})).companies).toHaveLength(0);
  });
});
