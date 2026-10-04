import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { and, db, eq, schema, sql } from '@gravity/db';
import type { SyncAction } from '@gravity/shared/events';
import { type ImportReport, suggestMapping } from '@gravity/shared/import';
import type { Principal } from '@gravity/shared/policy';
import postgres from 'postgres';
import { createBrand } from '../../src/crm/brand-service.ts';
import { createFieldDefinition } from '../../src/crm/field-service.ts';
import { changeLead, createLead, quickCreateLead } from '../../src/crm/lead-service.ts';
import { updatePerson, upsertPerson } from '../../src/crm/person-service.ts';
import { getPersonRecord } from '../../src/crm/record-service.ts';
import { companyScopes, leadScopes, personScopes } from '../../src/crm/scopes.ts';
import { archiveStage } from '../../src/crm/stage-service.ts';
import { commitImport, importActor, previewImport } from '../../src/import/import-service.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import {
  addMember,
  createMemberPrincipal,
  createWorkspace,
  resetDatabase,
  type TestWorkspace,
} from '../../src/test-support.ts';
import { racingRival, writerBackendPid } from '../support/rival-connection.ts';

const HEADER = 'Name,Email,Company,Domain,Title,Stage,Owner,Tier,Ref';
const MAPPING = {
  Name: 'person.name',
  Email: 'person.email',
  Company: 'company.name',
  Domain: 'company.domain',
  Title: 'person.title',
  Stage: 'lead.stage',
  Owner: 'lead.owner',
  Tier: 'person.field.tier',
  Ref: 'sourceId',
};

let workspace: TestWorkspace;
let teammate: Principal;
let teammateEmail = '';
let pipelineId = '';
let researchingId = '';
let qualifiedId = '';
let notFitId = '';

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
  const context = { principal: workspace.admin };
  const brand = await createBrand(context, { name: 'Lumen', pipelineKey: 'LUM' });
  pipelineId = brand.pipeline.id;
  researchingId = brand.stages.find((stage) => stage.name === 'Researching')?.id ?? '';
  qualifiedId = brand.stages.find((stage) => stage.name === 'Qualified')?.id ?? '';
  notFitId = brand.stages.find((stage) => stage.name === 'Closed: not a fit')?.id ?? '';
  await createFieldDefinition(context, {
    object: 'person',
    key: 'tier',
    label: 'Tier',
    type: 'select',
    options: [
      { value: 'gold', label: 'Gold' },
      { value: 'silver', label: 'Silver' },
    ],
  });
  teammate = await addMember(workspace, 'Tess Teammate', 'member');
  const [user] = await db.select().from(schema.user).where(eq(schema.user.id, teammate.userId));
  teammateEmail = user?.email ?? '';
});

afterAll(async () => {
  await closeRealtime();
});

function request(rows: readonly string[], overrides: Record<string, unknown> = {}) {
  return {
    format: 'csv',
    content: [HEADER, ...rows].join('\n'),
    target: 'leads',
    pipelineId,
    mapping: MAPPING,
    source: 'crm',
    ...overrides,
  };
}

function run(input: unknown, options: Partial<Parameters<typeof commitImport>[2]> = {}) {
  return commitImport({ principal: workspace.admin }, input, {
    actorName: 'Ada Admin',
    ...options,
  });
}

async function count(table: string): Promise<number> {
  const [row] = await db.execute<{ total: string }>(
    sql.raw(`select count(*)::text as total from "${table}"`),
  );
  return Number(row?.['total'] ?? 0);
}

async function counts(): Promise<Record<string, number>> {
  return {
    person: await count('person'),
    company: await count('company'),
    employment: await count('employment'),
    lead: await count('lead'),
    outbox: await count('outbox'),
    import_source: await count('import_source'),
  };
}

function shape(report: ImportReport) {
  return report.rows.map((row) => [row.status, row.matchedBy, row.company, row.lead]);
}

async function linksOf(organizationId: string, sourceId: string) {
  return await db
    .select()
    .from(schema.importSource)
    .where(
      and(
        eq(schema.importSource.organizationId, organizationId),
        eq(schema.importSource.source, 'crm'),
        eq(schema.importSource.sourceId, sourceId),
      ),
    );
}

function steppingClock(step: number): () => number {
  let current = 0;
  return () => {
    const value = current;
    current += step;
    return value;
  };
}

async function withFailingTrigger<T>(table: string, run: () => Promise<T>): Promise<T> {
  await db.execute(
    sql.raw(`
      create or replace function import_test_refuse() returns trigger as $$
      begin raise exception 'refused by test trigger'; end;
      $$ language plpgsql;
      create trigger import_test_refuse before insert on ${table}
        for each row execute function import_test_refuse();
    `),
  );
  try {
    return await run();
  } finally {
    await db.execute(
      sql.raw(`
        drop trigger if exists import_test_refuse on ${table};
        drop function if exists import_test_refuse();
      `),
    );
  }
}

describe('importActor', () => {
  test('names the import after the person who ran it', () => {
    expect(importActor(workspace.admin, 'Ada Admin')).toEqual({
      type: 'integration',
      id: `import:${workspace.admin.userId}`,
      name: 'Import by Ada Admin',
    });
  });
});

describe('previewImport', () => {
  test('writes nothing and reports what the commit would do', async () => {
    await upsertPerson(
      { principal: workspace.admin },
      { name: 'Grace Hopper', emails: ['grace@quarry.example'] },
    );
    const before = await counts();
    const preview = await previewImport(
      workspace.admin,
      request([
        `Ada Lovelace,ada@vela.example,Vela Robotics,vela.example,CTO,Ready,${teammateEmail},gold,r1`,
        'Grace Hopper,grace@quarry.example,,,,,,,r2',
        ',nobody@vela.example,,,,,,,r3',
      ]),
    );
    expect(await counts()).toEqual(before);
    expect(preview.mode).toBe('preview');
    expect(preview.rows.map((row) => [row.status, row.matchedBy, row.company, row.lead])).toEqual([
      ['create', null, 'create', 'create'],
      ['unchanged', 'email', 'none', 'create'],
      ['invalid', null, 'none', 'none'],
    ]);
    expect(preview.totals).toMatchObject({
      rows: 3,
      created: 1,
      unchanged: 1,
      invalid: 1,
      leadsCreated: 2,
      companiesCreated: 1,
    });
  });
});

describe('commitImport', () => {
  test('writes chunk by chunk, publishes after each, and acts as the import', async () => {
    await db.delete(schema.outbox);
    const published: number[] = [];
    const leadsSeenAtPublish: number[] = [];
    const report = await run(
      request([
        'Ada Lovelace,ada@vela.example,Vela Robotics,vela.example,CTO,Ready,,gold,r1',
        'Grace Hopper,grace@quarry.example,,,,,,,r2',
        `Linus Torvalds,linus@kernel.example,,,,,${teammateEmail},,r3`,
        'Mira Castell,mira@vela.example,Vela Robotics,vela.example,,,,,r4',
        'Nameless Ref,,,,,,,,r5',
      ]),
      {
        chunkRows: 2,
        publish: async (actions) => {
          published.push(actions.length);
          leadsSeenAtPublish.push(await count('lead'));
        },
      },
    );
    expect(report.status).toBe('completed');
    expect(report.rows.map((row) => row.leadKey)).toEqual([
      'LUM-1',
      'LUM-2',
      'LUM-3',
      'LUM-4',
      'LUM-5',
    ]);
    expect(published).toHaveLength(3);
    expect(published.every((total) => total > 0)).toBe(true);
    expect(leadsSeenAtPublish).toEqual([2, 4, 5]);
    const actors = (await db.select().from(schema.outbox)).map((row) => row.payload['actor']);
    expect(actors.length).toBeGreaterThan(0);
    expect(actors).toEqual(
      actors.map(() => ({
        type: 'integration',
        id: `import:${workspace.admin.userId}`,
        name: 'Import by Ada Admin',
      })),
    );
    expect(await count('company')).toBe(1);
    const [linus] = report.rows.filter((row) => row.label === 'Linus Torvalds');
    const [lead] = await db
      .select()
      .from(schema.lead)
      .where(eq(schema.lead.personId, linus?.recordId ?? ''));
    expect(lead?.ownerId).toBe(teammate.userId);
    expect(lead?.source).toBe('import');
  });

  test('running the same file twice creates nothing and writes no outbox rows', async () => {
    const input = request([
      'Ada Lovelace,ada@vela.example,Vela Robotics,vela.example,CTO,Ready,,gold,r1',
      'Nameless Ref,,,,,,,,r5',
    ]);
    await run(input);
    const before = await counts();
    const published: number[] = [];
    const second = await run(input, {
      publish: (actions) => {
        published.push(actions.length);
        return Promise.resolve();
      },
    });
    expect(await counts()).toEqual(before);
    expect(published).toEqual([]);
    expect(second.rows.map((row) => [row.status, row.matchedBy, row.lead])).toEqual([
      ['unchanged', 'source_id', 'exists'],
      ['unchanged', 'source_id', 'exists'],
    ]);
  });

  test('a lead imported straight into a closed stage is created once', async () => {
    const input = request(['Ada Lovelace,ada@vela.example,,,,Qualified,,,r1']);
    const first = await run(input);
    expect(first.rows[0]).toMatchObject({ status: 'create', lead: 'create', leadKey: 'LUM-1' });
    const preview = await previewImport(workspace.admin, input);
    const second = await run(input);
    for (const report of [preview, second]) {
      expect(report.rows[0]).toMatchObject({
        status: 'unchanged',
        lead: 'exists',
        leadKey: 'LUM-1',
      });
    }
    expect(await count('lead')).toBe(1);
  });

  test('a row that repeats an earlier identity is skipped', async () => {
    const report = await run(
      request(['Ada Lovelace,ada@vela.example,,,,,,,', 'Ada Again,ADA@vela.example,,,,,,,']),
    );
    expect(report.rows[1]).toMatchObject({
      status: 'skipped',
      issues: [{ row: 2, column: null, code: 'same_record', message: 'Same record as row 1.' }],
    });
    expect(await count('person')).toBe(1);
  });

  test('two rows that reach the same stored person are one record', async () => {
    const context = { principal: workspace.admin };
    const quinn = await upsertPerson(context, {
      name: 'Quinn Doe',
      emails: ['quinn@vela.example', 'q@home.example'],
    });
    const input = request(['Quinn Doe,quinn@vela.example,,,,,,,', 'Q Doe,q@home.example,,,,,,,']);
    const preview = await previewImport(workspace.admin, input);
    const commit = await run(input);
    expect(shape(commit)).toEqual(shape(preview));
    expect(commit.rows[1]).toMatchObject({
      status: 'skipped',
      recordId: quinn.person.id,
      issues: [{ row: 2, column: null, code: 'same_record', message: 'Same record as row 1.' }],
    });
    expect(commit.status).toBe('completed');
    expect(await count('lead')).toBe(1);
  });

  test('values a person edited survive and are reported as kept', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, {
      name: 'Ada Lovelace',
      emails: ['ada@vela.example'],
      company: { domain: 'acme.example', name: 'Acme' },
      title: 'CEO',
    });
    await updatePerson(context, ada.person.id, { fields: { tier: 'gold' } });
    const input = request([
      'Ada Lovelace,ada@vela.example,Vela Robotics,vela.example,CTO,,,silver,',
    ]);
    const preview = await previewImport(workspace.admin, input);
    expect(preview.rows[0]).toMatchObject({
      status: 'unchanged',
      kept: ['fields.tier', 'company'],
    });
    const commit = await run(input);
    expect(commit.rows[0]).toMatchObject({ status: 'unchanged', kept: ['fields.tier', 'company'] });
    const after = await getPersonRecord(workspace.admin, ada.person.id);
    expect(after.person.fields).toEqual({ tier: 'gold' });
    expect(after.person.companyName).toBe('Acme');
    expect(after.person.title).toBe('CEO');
    expect(await count('company')).toBe(1);
  });

  test('an import fills a value nobody set and reports it as a change', async () => {
    const context = { principal: workspace.admin };
    const ada = await upsertPerson(context, {
      name: 'Ada Lovelace',
      emails: ['ada@vela.example'],
    });
    const input = request(['Ada Lovelace,ada@vela.example,Vela Robotics,vela.example,CTO,,,gold,']);
    const preview = await previewImport(workspace.admin, input);
    expect(preview.rows[0]).toMatchObject({
      status: 'merge',
      changes: ['fields.tier', 'company'],
      company: 'create',
    });
    const commit = await run(input);
    expect(commit.rows[0]).toMatchObject({ status: 'merge', changes: ['fields.tier', 'company'] });
    const after = await getPersonRecord(workspace.admin, ada.person.id);
    expect(after.person).toMatchObject({
      fields: { tier: 'gold' },
      companyName: 'Vela Robotics',
      title: 'CTO',
    });
  });

  test('preview and commit agree across chunks', async () => {
    const context = { principal: workspace.admin };
    const mira = await upsertPerson(context, {
      name: 'Mira Castell',
      emails: ['mira@kestrel.example'],
    });
    await createLead(context, { personId: mira.person.id, pipelineId });
    const input = request([
      'Ada Lovelace,ada@vela.example,Vela Robotics,vela.example,,,,,',
      'Grace Hopper,grace@quarry.example,,,,,,,',
      'Linus Torvalds,linus@vela.example,Vela Robotics,vela.example,,,,,',
      'Mira Castell,mira@kestrel.example,,,,,,,',
    ]);
    const preview = await previewImport(workspace.admin, input, { chunkRows: 2 });
    const commit = await run(input, { chunkRows: 2 });
    expect(shape(commit)).toEqual(shape(preview));
    expect(commit.totals.companiesCreated).toBe(preview.totals.companiesCreated);
    expect(preview.totals.companiesCreated).toBe(1);
    expect([preview.rows[2]?.company, commit.rows[2]?.company]).toEqual(['match', 'match']);
    expect(commit.rows[3]).toMatchObject({ status: 'unchanged', lead: 'exists', leadKey: 'LUM-1' });
  });

  test('refuses another workspace pipeline and owners', async () => {
    const other = await createWorkspace('Other');
    const foreign = await createBrand(
      { principal: other.admin },
      { name: 'Elsewhere', pipelineKey: 'ELS' },
    );
    await expect(
      previewImport(
        workspace.admin,
        request(['Ada,ada@vela.example,,,,,,,'], { pipelineId: foreign.pipeline.id }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    const report = await run(request([`Ada,ada@vela.example,,,,,${other.adminUser.email},,`]));
    expect(report.rows[0]?.status).toBe('invalid');
    expect(report.rows[0]?.issues[0]?.message).toContain('No member matches');
    expect(await count('person')).toBe(0);
  });

  test('a source id from another workspace never links across', async () => {
    const other = await createWorkspace('Other');
    const otherBrand = await createBrand(
      { principal: other.admin },
      { name: 'Elsewhere', pipelineKey: 'ELS' },
    );
    await commitImport(
      { principal: other.admin },
      request(['Olga Other,olga@other.example,,,,,,,r1'], {
        pipelineId: otherBrand.pipeline.id,
        mapping: { ...MAPPING, Tier: 'ignore' },
      }),
      { actorName: 'Ada Admin' },
    );
    const report = await run(request(['Ada Lovelace,ada@vela.example,,,,,,,r1']));
    expect(report.rows[0]).toMatchObject({ status: 'create', matchedBy: null });
    const [mine] = await linksOf(workspace.organizationId, 'r1');
    const [theirs] = await linksOf(other.organizationId, 'r1');
    expect(mine?.personId).toBe(report.rows[0]?.recordId ?? 'missing');
    expect(theirs?.personId).not.toBe(mine?.personId);
    const [olga] = await db
      .select()
      .from(schema.person)
      .where(eq(schema.person.id, theirs?.personId ?? ''));
    expect(olga?.organizationId).toBe(other.organizationId);
  });

  test('a link to an archived person is re-pointed, never duplicated', async () => {
    const input = request(['Ada Lovelace,ada@vela.example,,,,,,,r1']);
    const first = await run(input);
    const archivedId = first.rows[0]?.recordId ?? '';
    await db
      .update(schema.person)
      .set({ archivedAt: new Date() })
      .where(eq(schema.person.id, archivedId));
    await db
      .update(schema.importSource)
      .set({ updatedAt: new Date('2020-01-01T00:00:00Z') })
      .where(eq(schema.importSource.personId, archivedId));
    const preview = await previewImport(workspace.admin, input);
    expect(preview.rows[0]).toMatchObject({ status: 'create', matchedBy: null });
    const second = await run(input);
    expect(second.rows[0]).toMatchObject({ status: 'create', matchedBy: null });
    const links = await linksOf(workspace.organizationId, 'r1');
    expect(links).toHaveLength(1);
    expect(links[0]?.personId).toBe(second.rows[0]?.recordId ?? 'missing');
    expect(links[0]?.personId).not.toBe(archivedId);
    expect(links[0]?.updatedAt.getTime()).toBeGreaterThan(Date.parse('2020-01-01T00:00:00Z'));
    const third = await run(input);
    expect(third.rows[0]).toMatchObject({ status: 'unchanged', matchedBy: 'source_id' });
  });

  test('a merge whose new primary email belongs to someone else is skipped, never a failed batch', async () => {
    const context = { principal: workspace.admin };
    const first = await run(request(['Nameless Ref,,,,,,,,r9']));
    const namelessId = first.rows[0]?.recordId ?? '';
    await upsertPerson(context, { name: 'Bea Bauer', emails: ['bea@vela.example'] });
    const input = request([
      'Nameless Ref,bea@vela.example,,,,,,,r9',
      'Cara Cole,cara@vela.example,,,,,,,',
    ]);
    const preview = await previewImport(workspace.admin, input);
    const before = await counts();
    const commit = await run(input);
    for (const report of [preview, commit]) {
      expect(report.rows[0]).toMatchObject({
        status: 'skipped',
        matchedBy: 'source_id',
        recordId: namelessId,
        changes: [],
        lead: 'none',
      });
      expect(report.rows[0]?.issues).toEqual([
        {
          row: 1,
          column: null,
          code: 'conflict',
          message:
            'Bea Bauer already uses bea@vela.example, so this row was not merged into Nameless Ref.',
        },
      ]);
      expect(report.rows[1]?.status).toBe('create');
    }
    expect(commit.status).toBe('completed');
    expect(await count('person')).toBe((before['person'] ?? 0) + 1);
    const nameless = await getPersonRecord(workspace.admin, namelessId);
    expect(nameless.person.emails).toEqual([]);
  });

  test('two files with a 1 to N ID column and the suggested mapping make four people', async () => {
    const fileOf = (rows: readonly string[]) => ['ID,Name,Email', ...rows].join('\n');
    const suggested = suggestMapping(['ID', 'Name', 'Email'], 'people', []);
    expect(suggested['ID']).toBe('ignore');
    const people = (content: string) => ({
      format: 'csv',
      content,
      target: 'people',
      mapping: suggested,
    });
    await run(people(fileOf(['1,Alice,alice@a.example', '2,Arun,arun@a.example'])));
    const second = await run(people(fileOf(['1,Bob,bob@b.example', '2,Bea,bea@b.example'])));
    expect(second.rows.map((row) => row.status)).toEqual(['create', 'create']);
    const stored = await db.select().from(schema.person).orderBy(schema.person.name);
    expect(stored.map((person) => [person.name, person.emails])).toEqual([
      ['Alice', ['alice@a.example']],
      ['Arun', ['arun@a.example']],
      ['Bea', ['bea@b.example']],
      ['Bob', ['bob@b.example']],
    ]);
  });

  test('a source id linked to someone with another email is a conflict, never a merge', async () => {
    const people = (rows: readonly string[]) => ({
      format: 'csv',
      content: ['ID,Name,Email,LinkedIn id', ...rows].join('\n'),
      target: 'people',
      mapping: {
        ID: 'sourceId',
        Name: 'person.name',
        Email: 'person.email',
        'LinkedIn id': 'person.linkedinProviderId',
      },
      source: 'crm',
    });
    const first = await run(people(['1,Alice,alice@a.example,', '2,Arun,,ACoAAArun']));
    const aliceId = first.rows[0]?.recordId ?? 'missing';
    const arunId = first.rows[1]?.recordId ?? 'missing';
    const second = people(['1,Bob,bob@b.example,', '2,Bea,,ACoAABea']);
    const preview = await previewImport(workspace.admin, second);
    const commit = await run(second);
    for (const report of [preview, commit]) {
      expect(report.rows.map((row) => [row.status, row.matchedBy, row.recordId])).toEqual([
        ['skipped', 'source_id', aliceId],
        ['skipped', 'source_id', arunId],
      ]);
      expect(report.rows[0]?.issues).toEqual([
        {
          row: 1,
          column: null,
          code: 'conflict',
          message:
            'Source id 1 belongs to Alice, whose email is alice@a.example, not bob@b.example, so this row was not merged.',
        },
      ]);
      expect(report.rows[1]?.issues[0]?.message).toBe(
        'Source id 2 belongs to Arun, whose LinkedIn account is ACoAAArun, not ACoAABea, so this row was not merged.',
      );
    }
    const same = await run(people(['1,Alice,ALICE@a.example,', '2,Arun,arun@a.example,ACoAAArun']));
    expect(same.rows.map((row) => [row.status, row.matchedBy, row.recordId])).toEqual([
      ['unchanged', 'source_id', aliceId],
      ['merge', 'source_id', arunId],
    ]);
    const stored = await db.select().from(schema.person).orderBy(schema.person.name);
    expect(stored.map((person) => [person.name, person.emails, person.linkedinProviderId])).toEqual(
      [
        ['Alice', ['alice@a.example'], null],
        ['Arun', ['arun@a.example'], 'ACoAAArun'],
      ],
    );
  });

  test('a role without import rights is refused', async () => {
    const contributor = await createMemberPrincipal(workspace, 'contributor');
    await expect(
      previewImport(contributor, request(['Ada,ada@vela.example,,,,,,,'])),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      commitImport({ principal: contributor }, request(['Ada,ada@vela.example,,,,,,,']), {
        actorName: 'C',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  test('stops at a failing chunk, reports the rows that landed, and a retry continues', async () => {
    const input = request([
      'A One,a1@vela.example,,,,New,,,',
      'A Two,a2@vela.example,,,,New,,,',
      'A Three,a3@vela.example,,,,Researching,,,',
      'A Four,a4@vela.example,,,,New,,,',
    ]);
    const report = await run(input, {
      chunkRows: 2,
      publish: async () => {
        await archiveStage({ principal: workspace.admin }, researchingId);
      },
    });
    expect(report.status).toBe('partial');
    expect(report.rows).toHaveLength(2);
    expect(report.totals).toMatchObject({ rows: 4, processed: 2, created: 2 });
    expect(report.resumeFromRow).toBe(3);
    expect(report.failure).toEqual({
      row: 3,
      message:
        'That stage is not in this pipeline. Nothing from row 3 on was imported; the rows before it were. Fix row 3, then continue from row 3.',
    });
    expect(await count('lead')).toBe(2);
    expect(await count('person')).toBe(2);
    const retry = await run(input, { chunkRows: 2 });
    expect(retry.status).toBe('completed');
    expect(retry.rows.map((row) => row.status)).toEqual([
      'unchanged',
      'unchanged',
      'invalid',
      'create',
    ]);
    expect(await count('lead')).toBe(3);
    expect(await count('person')).toBe(3);
  });

  test('names the failing row inside a chunk and rolls the whole chunk back', async () => {
    await db.execute(
      sql.raw(`
        create or replace function import_test_refuse_person() returns trigger as $$
        begin
          if new.name = 'A Three' then raise exception 'refused by test trigger'; end if;
          return new;
        end;
        $$ language plpgsql;
        create trigger import_test_refuse_person before insert on person
          for each row execute function import_test_refuse_person();
      `),
    );
    const quiet = spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const report = await run(
        request([
          'A One,a1@vela.example,,,,,,,',
          'A Two,a2@vela.example,,,,,,,',
          'A Three,a3@vela.example,,,,,,,',
        ]),
        { chunkRows: 3 },
      );
      expect(report.status).toBe('partial');
      expect(report.rows).toHaveLength(0);
      expect(report.failure).toEqual({
        row: 3,
        message:
          'Something went wrong on our side. Nothing from row 1 on was imported; the rows before it were. Fix row 3, then continue from row 1.',
      });
      expect(quiet).toHaveBeenCalledTimes(1);
      expect(await count('person')).toBe(0);
      expect(await count('lead')).toBe(0);
    } finally {
      quiet.mockRestore();
      await db.execute(
        sql.raw(`
          drop trigger if exists import_test_refuse_person on person;
          drop function if exists import_test_refuse_person();
        `),
      );
    }
  });

  test('a publish that fails leaves the chunk committed and the import going', async () => {
    const quiet = spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const report = await run(
        request(['A One,a1@vela.example,,,,,,,', 'A Two,a2@vela.example,,,,,,,']),
        {
          chunkRows: 1,
          publish: () => Promise.reject(new Error('redis is down')),
        },
      );
      expect(report.status).toBe('completed');
      expect(await count('lead')).toBe(2);
      expect(quiet).toHaveBeenCalledTimes(2);
    } finally {
      quiet.mockRestore();
    }
  });

  test('imports companies by domain and then by name, idempotently', async () => {
    const input = {
      format: 'csv',
      content: [
        'Company,Domain,Size',
        'Vela Robotics,vela.example,11-50',
        'Quarry Labs,,',
        'Vela Again,VELA.example,',
      ].join('\n'),
      target: 'companies',
      mapping: { Company: 'company.name', Domain: 'company.domain', Size: 'company.size' },
    };
    const preview = await previewImport(workspace.admin, input);
    const first = await commitImport({ principal: workspace.admin }, input, { actorName: 'Ada' });
    expect(shape(first)).toEqual(shape(preview));
    expect(shape(first)).toEqual([
      ['create', null, 'create', 'none'],
      ['create', null, 'create', 'none'],
      ['skipped', null, 'none', 'none'],
    ]);
    expect(await count('company')).toBe(2);
    const before = await counts();
    const second = await commitImport({ principal: workspace.admin }, input, { actorName: 'Ada' });
    expect(shape(second)).toEqual([
      ['unchanged', 'domain', 'match', 'none'],
      ['unchanged', 'name', 'match', 'none'],
      ['skipped', null, 'none', 'none'],
    ]);
    expect(second.rows[0]?.recordId).toBe(first.rows[0]?.recordId ?? 'missing');
    expect(await counts()).toEqual(before);
  });

  test('imports people without a pipeline and never creates a lead', async () => {
    const report = await run(
      request(['Ada Lovelace,ada@vela.example,,,,,,,r1'], {
        target: 'people',
        pipelineId: null,
        mapping: { ...MAPPING, Stage: 'ignore', Owner: 'ignore' },
      }),
    );
    expect(shape(report)).toEqual([['create', null, 'none', 'none']]);
    expect(await count('lead')).toBe(0);
    expect(await count('person')).toBe(1);
  });

  test('a chunk closes after ten seconds of work and the next one carries on', async () => {
    const published: number[] = [];
    const input = request([
      'A One,a1@vela.example,,,,,,,',
      'A Two,a2@vela.example,,,,,,,',
      'A Three,a3@vela.example,,,,,,,',
      'A Four,a4@vela.example,,,,,,,',
      'A Five,a5@vela.example,,,,,,,',
    ]);
    const preview = await previewImport(workspace.admin, input, { now: steppingClock(4000) });
    expect(preview.status).toBe('completed');
    expect(preview.rows.map((row) => row.row)).toEqual([1, 2, 3, 4, 5]);
    const report = await run(input, {
      now: steppingClock(4000),
      publish: (actions) => {
        published.push(
          new Set(actions.filter((a) => a.model === 'lead').map((a) => a.modelId)).size,
        );
        return Promise.resolve();
      },
    });
    expect(report.status).toBe('completed');
    expect(report.rows.map((row) => row.row)).toEqual([1, 2, 3, 4, 5]);
    expect(published).toEqual([3, 2]);
    expect(await count('lead')).toBe(5);
  });

  test('preview and commit stop at the deadline with a partial report', async () => {
    const input = request([
      'A One,a1@vela.example,,,,,,,',
      'A Two,a2@vela.example,,,,,,,',
      'A Three,a3@vela.example,,,,,,,',
    ]);
    const options = { chunkRows: 1, deadline: 10_000 };
    const preview = await previewImport(workspace.admin, input, {
      ...options,
      now: steppingClock(4000),
    });
    expect(preview.status).toBe('partial');
    expect(preview.rows.map((row) => row.row)).toEqual([1, 2]);
    expect(preview.failure).toEqual({
      row: null,
      message:
        'Stopped after row 2 to stay within the time limit. The rows after it were not checked.',
    });
    const commit = await run(input, { ...options, now: steppingClock(4000) });
    expect(commit.status).toBe('partial');
    expect(commit.rows.map((row) => row.row)).toEqual([1, 2]);
    expect([preview.resumeFromRow, commit.resumeFromRow]).toEqual([3, 3]);
    expect(commit.failure).toEqual({
      row: null,
      message: 'Stopped after row 2 to stay within the time limit. Continue from row 3.',
    });
    expect(await count('lead')).toBe(2);
    const rest = await run(input);
    expect(rest.rows.map((row) => row.status)).toEqual(['unchanged', 'unchanged', 'create']);
    expect(await count('lead')).toBe(3);
  });

  test('resuming from the stopped row never duplicates rows without an identity', async () => {
    const input = request(Array.from({ length: 6 }, (_, index) => `Nameless ${index + 1},,,,,,,,`));
    const cut = await run(input, { chunkRows: 3, deadline: 10_000, now: steppingClock(4000) });
    expect(cut.status).toBe('partial');
    expect(cut.rows.map((row) => row.row)).toEqual([1, 2, 3]);
    expect(cut.resumeFromRow).toBe(4);
    expect(cut.failure?.message).toBe(
      'Stopped after row 3 to stay within the time limit. Continue from row 4.',
    );
    const resume = { ...input, startRow: cut.resumeFromRow };
    const preview = await previewImport(workspace.admin, resume);
    expect(preview.rows.map((row) => [row.row, row.status])).toEqual([
      [4, 'create'],
      [5, 'create'],
      [6, 'create'],
    ]);
    expect(preview.totals).toMatchObject({ rows: 3, processed: 3 });
    const rest = await run(resume);
    expect(rest.status).toBe('completed');
    expect(rest.resumeFromRow).toBeNull();
    expect(rest.rows.map((row) => row.row)).toEqual([4, 5, 6]);
    expect(await count('person')).toBe(6);
    expect(await count('lead')).toBe(6);
  });

  test('a row without an email, LinkedIn or source id carries a warning and is still created', async () => {
    const report = await previewImport(
      workspace.admin,
      request([
        'Nameless One,,,,,,,,',
        'Ada Lovelace,ada@vela.example,,,,,,,',
        'Nameless Ref,,,,,,,,r7',
      ]),
    );
    expect(report.rows.map((row) => [row.status, row.issues.map((issue) => issue.code)])).toEqual([
      ['create', ['no_identity']],
      ['create', []],
      ['create', []],
    ]);
    expect(report.rows[0]?.issues[0]).toEqual({
      row: 1,
      column: null,
      code: 'no_identity',
      message:
        'This row has no email, LinkedIn or source id, so importing the whole file again would add it twice.',
    });
    expect(report.totals).toMatchObject({ created: 3, invalid: 0, skipped: 0 });
  });

  test('a row limit commits only the rows the preview checked and says where to continue', async () => {
    const input = request(
      Array.from({ length: 5 }, (_, index) => `A ${index + 1},a${index + 1}@vela.example,,,,,,,`),
    );
    const preview = await previewImport(workspace.admin, input, {
      chunkRows: 2,
      deadline: 10_000,
      now: steppingClock(6000),
    });
    expect(preview.status).toBe('partial');
    expect(preview.totals.processed).toBe(2);
    const commit = await run({ ...input, rowLimit: preview.totals.processed });
    expect(commit.status).toBe('partial');
    expect(commit.rows.map((row) => row.row)).toEqual([1, 2]);
    expect(commit.totals).toMatchObject({ rows: 5, processed: 2, created: 2 });
    expect(commit.resumeFromRow).toBe(3);
    expect(commit.failure).toEqual({
      row: null,
      message: 'Imported the 2 rows the preview checked. Continue from row 3.',
    });
    expect(await count('person')).toBe(2);
    const whole = await run({ ...input, rowLimit: 5 });
    expect(whole.status).toBe('completed');
    expect(whole.resumeFromRow).toBeNull();
  });

  test('refuses a start row past the end of the file', async () => {
    await expect(
      previewImport(workspace.admin, { ...request(['Ada,ada@vela.example,,,,,,,']), startRow: 2 }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      message: 'This file has 1 row, so it cannot start at row 2.',
    });
  });

  test('a person with a closed lead in the pipeline never gets a second one', async () => {
    const won = await run(request(['Ada Lovelace,ada@vela.example,,,,Qualified,,,']));
    const [adaLead] = await db
      .select()
      .from(schema.lead)
      .where(eq(schema.lead.personId, won.rows[0]?.recordId ?? ''));
    await changeLead({ principal: workspace.admin }, adaLead?.id ?? '', {
      type: 'close',
      stageId: notFitId,
    });
    const openRow = await run(request(['Grace Hopper,grace@vela.example,,,,New,,,']));
    const [graceLead] = await db
      .select()
      .from(schema.lead)
      .where(eq(schema.lead.personId, openRow.rows[0]?.recordId ?? ''));
    await changeLead({ principal: workspace.admin }, graceLead?.id ?? '', {
      type: 'close',
      stageId: qualifiedId,
    });
    const input = request([
      'Ada Lovelace,ada@vela.example,,,,Qualified,,,',
      'Grace Hopper,grace@vela.example,,,,New,,,',
    ]);
    const preview = await previewImport(workspace.admin, input);
    const again = await run(input);
    for (const report of [preview, again]) {
      expect(report.rows.map((row) => [row.lead, row.leadKey])).toEqual([
        ['exists', 'LUM-1'],
        ['exists', 'LUM-2'],
      ]);
    }
    expect(await count('lead')).toBe(2);
  });

  test('a teammate can create a lead in the pipeline while a chunk is being written', async () => {
    const rows = Array.from(
      { length: 60 },
      (_, index) => `P${index},p${index}@vela.example,,,,,,,`,
    );
    const writer = await writerBackendPid();
    const rival = postgres(String(process.env['DATABASE_URL']), {
      max: 1,
      onnotice: () => undefined,
    });
    try {
      const probe = (async () => {
        for (let attempt = 0; attempt < 500; attempt += 1) {
          const [state] = await rival<{ open: boolean }[]>`
            select xact_start is not null as open from pg_stat_activity where pid = ${writer}`;
          if (state?.open === true) break;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
        return await rival.begin(async (tx) => {
          await tx`set local lock_timeout = '200ms'`;
          const [bumped] = await tx<{ counter: number }[]>`
            update pipeline set lead_counter = lead_counter where id = ${pipelineId}
            returning lead_counter as counter`;
          return bumped?.counter ?? null;
        });
      })();
      const [report, probed] = await Promise.all([run(request(rows)), probe]);
      expect(report.status).toBe('completed');
      expect(probed).toBe(0);
    } finally {
      await rival.end();
    }
    const quick = await quickCreateLead(
      { principal: workspace.admin },
      { pipelineId, person: { name: 'Quick One', emails: ['quick@vela.example'] } },
    );
    expect(quick.lead.key).toBe('LUM-61');
  });

  test('a chunk waiting on the pipeline holds no stage lock, so a stage edit never deadlocks it', async () => {
    let stagesLocked = false;
    const report = await racingRival(
      (tx) => tx`select id from pipeline where id = ${pipelineId} for update`,
      () =>
        run(
          request(['Ada Lovelace,ada@vela.example,,,,,,,', 'Grace Hopper,grace@q.example,,,,,,,']),
        ),
      async (tx) => {
        await tx`set local lock_timeout = '500ms'`;
        await tx`select id from stage where pipeline_id = ${pipelineId} for update`;
        stagesLocked = true;
      },
    );
    expect(stagesLocked).toBe(true);
    expect(report.status).toBe('completed');
    expect(report.rows.map((row) => row.leadKey)).toEqual(['LUM-1', 'LUM-2']);
  });

  test('a failure after the rows were written blames no row', async () => {
    const quiet = spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const report = await withFailingTrigger('outbox', () =>
        run(request(['A One,a1@vela.example,,,,,,,', 'A Two,a2@vela.example,,,,,,,'])),
      );
      expect(report.status).toBe('partial');
      expect(report.failure).toEqual({
        row: null,
        message:
          'Something went wrong on our side. Rows 1 to 2 were not imported; the rows before them were. Continue from row 1.',
      });
      expect(await count('person')).toBe(0);
    } finally {
      quiet.mockRestore();
    }
  });

  test('every standard property the import declines to overwrite is reported as kept', async () => {
    const context = { principal: workspace.admin };
    await upsertPerson(context, {
      name: 'Ada Lovelace',
      emails: ['ada@vela.example'],
      location: 'London',
      timezone: 'Europe/London',
      linkedinUrl: 'https://www.linkedin.com/in/ada',
    });
    const input = {
      format: 'csv',
      content: [
        'Name,Email,Location,Timezone,LinkedIn',
        'Ada King,ada@vela.example,Paris,Europe/Paris,https://www.linkedin.com/in/ada-king',
      ].join('\n'),
      target: 'people',
      mapping: {
        Name: 'person.name',
        Email: 'person.email',
        Location: 'person.location',
        Timezone: 'person.timezone',
        LinkedIn: 'person.linkedinUrl',
      },
    };
    const preview = await previewImport(workspace.admin, input);
    const commit = await run(input);
    for (const report of [preview, commit]) {
      expect(report.rows[0]).toMatchObject({
        status: 'unchanged',
        changes: [],
        kept: ['name', 'linkedinUrl', 'location', 'timezone'],
      });
    }
  });

  test('published actions carry the scopes their emitters give', async () => {
    const published: SyncAction[] = [];
    await run(request(['Ada Lovelace,ada@vela.example,Vela Robotics,vela.example,CTO,,,gold,r1']), {
      publish: (actions) => {
        published.push(...actions);
        return Promise.resolve();
      },
    });
    const org = workspace.organizationId;
    const models = new Set(published.map((action) => action.model));
    expect([...models].sort()).toEqual(['activity', 'company', 'employment', 'lead', 'person']);
    for (const action of published) {
      const data = action.data;
      if (action.model === 'person')
        expect(action.scopes).toEqual(personScopes(org, action.modelId));
      if (action.model === 'company')
        expect(action.scopes).toEqual(companyScopes(org, action.modelId));
      if (action.model === 'lead') {
        expect(action.scopes).toEqual(
          leadScopes(org, {
            brandId: String(data['brandId']),
            pipelineId: String(data['pipelineId']),
            personId: String(data['personId']),
            companyId: typeof data['companyId'] === 'string' ? data['companyId'] : null,
          }),
        );
        expect(data['companyId']).toBeTruthy();
      }
      if (action.model === 'activity') {
        expect(action.scopes[0]).toBe(`workspace:${org}`);
        expect(action.scopes.length).toBeGreaterThan(1);
      }
    }
  });

  test('refuses a file over the row limit before planning', async () => {
    await expect(
      run(
        request(['A,a@vela.example,,,,,,,', 'B,b@vela.example,,,,,,,', 'C,c@vela.example,,,,,,,']),
        {
          limits: { maxBytes: 1_000_000, maxRows: 2 },
        },
      ),
    ).rejects.toMatchObject({ code: 'payload_too_large' });
  });
});
