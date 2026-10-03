import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, db, eq, schema } from '@gravity/db';
import type { StageRow } from '@gravity/shared/records';
import { randomUUIDv7 } from '@gravity/shared/utils';
import postgres from 'postgres';
import { createBrand } from '../../src/crm/brand-service.ts';
import { createFieldDefinition } from '../../src/crm/field-service.ts';
import {
  changeLead,
  changeLeads,
  createLead,
  getLead,
  getLeadByKey,
  quickCreateLead,
} from '../../src/crm/lead-service.ts';
import { upsertPerson } from '../../src/crm/person-service.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import {
  createWorkspace,
  refusal,
  resetDatabase,
  type TestWorkspace,
} from '../../src/test-support.ts';

let workspace: TestWorkspace;
let pipelineId = '';
let stages: StageRow[] = [];
let personId = '';

function context() {
  return { principal: workspace.admin, originClientId: 'tab-1' };
}

function stageNamed(name: string): string {
  return stages.find((stage) => stage.name === name)?.id ?? '';
}

async function person(name: string, email: string): Promise<string> {
  return (await upsertPerson(context(), { name, emails: [email] })).person.id;
}

async function storedLead(leadId: string) {
  const [row] = await db.select().from(schema.lead).where(eq(schema.lead.id, leadId));
  return row;
}

async function waitForLockWaiter(observer: postgres.Sql): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await observer<{ waiting: number }[]>`
      select count(*)::int as waiting from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'`;
    if ((row?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('the write never waited on the rival lock');
}

async function racingRival<T>(
  hold: (tx: postgres.TransactionSql) => Promise<unknown>,
  write: () => Promise<T>,
): Promise<T> {
  const rival = postgres(String(process.env['DATABASE_URL']), {
    max: 2,
    onnotice: () => undefined,
  });
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = (): void => undefined;
  const taken = new Promise<void>((resolve) => {
    held = resolve;
  });
  const holder = rival.begin(async (tx) => {
    await hold(tx);
    held();
    await released;
  });
  let writing: Promise<{ ok: true; value: T } | { ok: false; error: unknown }> | undefined;
  try {
    await taken;
    writing = write().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await waitForLockWaiter(rival);
  } finally {
    release();
    await holder;
    await rival.end();
  }
  const outcome = await writing;
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
  const brand = await createBrand(context(), { name: 'Yodu' });
  pipelineId = brand.pipeline.id;
  stages = brand.stages;
  personId = await person('Ada Lovelace', 'ada@acme.io');
});

afterAll(async () => {
  await closeRealtime();
});

describe('createLead', () => {
  test('numbers per pipeline, starts in the first open stage and is owned by the caller', async () => {
    const first = await createLead(context(), { personId, pipelineId });
    expect(first.lead).toMatchObject({
      number: 1,
      key: 'YOD-1',
      stageId: stageNamed('New'),
      stageCategory: 'open',
      ownerId: workspace.admin.userId,
      personName: 'Ada Lovelace',
    });
    expect(first.actions.map((action) => action.model)).toEqual(['lead', 'activity']);
    expect(first.actions[0]?.scopes).toContain(`pipeline:${pipelineId}`);
    expect(first.actions[0]?.originClientId).toBe('tab-1');
    const second = await createLead(context(), {
      personId: await person('Grace', 'grace@navy.mil'),
      pipelineId,
    });
    expect(second.lead.key).toBe('YOD-2');
  });

  test('refuses a second open lead, names the first and burns no number', async () => {
    await createLead(context(), { personId, pipelineId });
    await expect(createLead(context(), { personId, pipelineId })).rejects.toThrow(
      'Ada Lovelace already has an open lead in this pipeline: YOD-1.',
    );
    const next = await createLead(context(), {
      personId: await person('Grace', 'grace@navy.mil'),
      pipelineId,
    });
    expect(next.lead.number).toBe(2);
    expect(
      await db.select().from(schema.lead).where(eq(schema.lead.personId, personId)),
    ).toHaveLength(1);
  });

  test('a closed lead allows a new one and reopening the closed one is refused', async () => {
    const first = await createLead(context(), { personId, pipelineId });
    await changeLead(context(), first.lead.id, { type: 'close' });
    const second = await createLead(context(), { personId, pipelineId });
    expect(second.lead.key).toBe('YOD-2');
    await expect(
      changeLead(context(), first.lead.id, {
        type: 'update',
        patch: { stageId: stageNamed('Ready') },
      }),
    ).rejects.toThrow('Ada Lovelace already has an open lead in this pipeline: YOD-2.');
  });

  test('a held lead blocks a new open lead with a 409', async () => {
    const first = await createLead(context(), { personId, pipelineId });
    await changeLead(context(), first.lead.id, { type: 'hold', reason: 'Back in Q1' });
    const refused = await refusal(createLead(context(), { personId, pipelineId }));
    expect(refused).toMatchObject({
      status: 409,
      message: 'Ada Lovelace already has an open lead in this pipeline: YOD-1.',
    });
    expect(
      await db.select().from(schema.lead).where(eq(schema.lead.personId, personId)),
    ).toHaveLength(1);
  });

  test('an archived open lead frees the slot', async () => {
    const first = await createLead(context(), { personId, pipelineId });
    await db
      .update(schema.lead)
      .set({ archivedAt: new Date() })
      .where(eq(schema.lead.id, first.lead.id));
    const second = await createLead(context(), { personId, pipelineId });
    expect(second.lead).toMatchObject({ key: 'YOD-2', stageCategory: 'open' });
  });

  test('a lead cannot start on hold and a start stage of another category is kept', async () => {
    await expect(
      createLead(context(), { personId, pipelineId, stageId: stageNamed('On hold') }),
    ).rejects.toThrow('Start a lead in an open stage, then put it on hold with a reason.');
    const won = await createLead(context(), {
      personId,
      pipelineId,
      stageId: stageNamed('Qualified'),
    });
    expect(won.lead.stageCategory).toBe('won');
    const open = await createLead(context(), { personId, pipelineId });
    expect(open.lead.key).toBe('YOD-2');
  });

  test('waits on a stage retype in flight and takes the category it commits', async () => {
    const newStage = stageNamed('New');
    const created = await racingRival(
      (tx) => tx`update stage set category = 'won' where id = ${newStage}`,
      () => createLead(context(), { personId, pipelineId, stageId: newStage }),
    );
    expect(created.lead.stageCategory).toBe('won');
    expect((await storedLead(created.lead.id))?.stageCategory).toBe('won');
  });
});

describe('foreign ids', () => {
  test('refuses a foreign stage, pipeline, person and owner and writes nothing', async () => {
    const other = await createWorkspace('Other');
    const otherBrand = await createBrand({ principal: other.admin }, { name: 'Zeta' });
    const otherPerson = (await upsertPerson({ principal: other.admin }, { name: 'Zed' })).person.id;
    await db.delete(schema.outbox);
    await expect(
      createLead(context(), { personId, pipelineId, stageId: otherBrand.stages[0]?.id }),
    ).rejects.toThrow('That stage is not in this pipeline.');
    await expect(
      createLead(context(), { personId, pipelineId: otherBrand.pipeline.id }),
    ).rejects.toThrow('That pipeline does not exist.');
    await expect(createLead(context(), { personId: otherPerson, pipelineId })).rejects.toThrow(
      'That person does not exist.',
    );
    await expect(
      createLead(context(), { personId, pipelineId, ownerId: other.admin.userId }),
    ).rejects.toThrow('That owner is not a member of this workspace.');
    expect(await db.select().from(schema.lead)).toHaveLength(0);
    expect(
      await db.select().from(schema.activity).where(eq(schema.activity.kind, 'lead.created')),
    ).toHaveLength(0);
    expect(await db.select().from(schema.outbox)).toHaveLength(0);
    const [counter] = await db
      .select({ leadCounter: schema.pipeline.leadCounter })
      .from(schema.pipeline)
      .where(eq(schema.pipeline.id, pipelineId));
    expect(counter?.leadCounter).toBe(0);
  });

  test('a bulk change that includes a foreign lead changes nothing', async () => {
    const other = await createWorkspace('Other');
    const otherBrand = await createBrand({ principal: other.admin }, { name: 'Zeta' });
    const otherPerson = (await upsertPerson({ principal: other.admin }, { name: 'Zed' })).person.id;
    const theirs = await createLead(
      { principal: other.admin },
      { personId: otherPerson, pipelineId: otherBrand.pipeline.id },
    );
    const mine = await createLead(context(), { personId, pipelineId });
    await db.delete(schema.outbox);
    await expect(
      changeLeads(context(), {
        leadIds: [mine.lead.id, theirs.lead.id],
        change: { type: 'update', patch: { priority: 1 } },
      }),
    ).rejects.toThrow('One or more of those leads do not exist.');
    expect((await getLead(workspace.admin, mine.lead.id)).priority).toBe(0);
    expect(await db.select().from(schema.outbox)).toHaveLength(0);
  });

  test('a foreign owner or a foreign stage in a change is refused and writes nothing', async () => {
    const other = await createWorkspace('Other');
    const otherBrand = await createBrand({ principal: other.admin }, { name: 'Zeta' });
    const { lead } = await createLead(context(), { personId, pipelineId });
    await db.delete(schema.outbox);
    await expect(
      changeLead(context(), lead.id, {
        type: 'update',
        patch: { ownerId: other.admin.userId },
      }),
    ).rejects.toThrow('That owner is not a member of this workspace.');
    await expect(
      changeLead(context(), lead.id, {
        type: 'update',
        patch: { stageId: otherBrand.stages[0]?.id ?? '' },
      }),
    ).rejects.toThrow('That stage is not in this pipeline.');
    expect(await getLead(workspace.admin, lead.id)).toMatchObject({
      ownerId: workspace.admin.userId,
      stageId: stageNamed('New'),
    });
    expect(await db.select().from(schema.outbox)).toHaveLength(0);
  });

  test('getLead refuses a lead of another workspace', async () => {
    const other = await createWorkspace('Other');
    const { lead } = await createLead(context(), { personId, pipelineId });
    await expect(getLead(other.admin, lead.id)).rejects.toThrow('That lead does not exist.');
  });
});

describe('changeLeads', () => {
  test('hold moves to On hold with the reason and logs lead.held', async () => {
    const { lead } = await createLead(context(), { personId, pipelineId });
    const held = await changeLead(context(), lead.id, {
      type: 'hold',
      reason: 'Back in Q1',
      until: null,
    });
    expect(held.lead).toMatchObject({
      stageId: stageNamed('On hold'),
      stageCategory: 'hold',
      holdReason: 'Back in Q1',
    });
    const activity = held.actions.find((action) => action.model === 'activity');
    expect(activity?.data['kind']).toBe('lead.held');
  });

  test('close lands in Closed: no reply and clears the next action', async () => {
    const { lead } = await createLead(context(), {
      personId,
      pipelineId,
      nextAction: 'Send intro',
      nextActionAt: '2026-10-05T09:00:00.000Z',
    });
    const closed = await changeLead(context(), lead.id, { type: 'close' });
    expect(closed.lead).toMatchObject({
      stageId: stageNamed('Closed: no reply'),
      stageCategory: 'lost',
      nextAction: null,
      nextActionAt: null,
    });
    const activity = closed.actions.find((action) => action.model === 'activity');
    expect(activity?.data['kind']).toBe('lead.closed');
  });

  test('a bulk stage change moves every lead and logs one stage change each', async () => {
    const a = await createLead(context(), { personId, pipelineId });
    const b = await createLead(context(), {
      personId: await person('Grace', 'grace@navy.mil'),
      pipelineId,
    });
    const moved = await changeLeads(context(), {
      leadIds: [a.lead.id, b.lead.id],
      change: { type: 'update', patch: { stageId: stageNamed('Ready') } },
    });
    expect(moved.leads.map((lead) => lead.stageId)).toEqual([
      stageNamed('Ready'),
      stageNamed('Ready'),
    ]);
    expect(
      moved.actions.filter((action) => action.data['kind'] === 'lead.stage_changed'),
    ).toHaveLength(2);
  });

  test('a stage change writes the category of the target stage', async () => {
    const { lead } = await createLead(context(), { personId, pipelineId });
    const won = await changeLead(context(), lead.id, {
      type: 'update',
      patch: { stageId: stageNamed('Qualified') },
    });
    expect(won.lead.stageCategory).toBe('won');
    expect((await storedLead(lead.id))?.stageCategory).toBe('won');
    const activity = won.actions.find((action) => action.model === 'activity');
    expect(activity?.data['payload']).toMatchObject({
      changes: {
        stageId: {
          from: { id: stageNamed('New'), name: 'New' },
          to: { id: stageNamed('Qualified'), name: 'Qualified' },
        },
      },
    });
  });

  test('a no-op change writes nothing and emits nothing', async () => {
    const { lead } = await createLead(context(), { personId, pipelineId });
    const same = await changeLead(context(), lead.id, { type: 'update', patch: { priority: 0 } });
    expect(same.actions).toHaveLength(0);
    expect(same.lead.syncId).toBe(lead.syncId);
  });

  test('a field patch is validated against the pipeline lead fields', async () => {
    await createFieldDefinition(context(), {
      object: 'lead',
      pipelineId,
      key: 'industry',
      label: 'Industry',
      type: 'select',
      options: [{ value: 'saas', label: 'SaaS' }],
    });
    const { lead } = await createLead(context(), { personId, pipelineId });
    const changed = await changeLead(context(), lead.id, {
      type: 'update',
      patch: { fields: { industry: 'saas' } },
    });
    expect(changed.lead.fields).toEqual({ industry: 'saas' });
    await expect(
      changeLead(context(), lead.id, { type: 'update', patch: { fields: { industry: 'retail' } } }),
    ).rejects.toThrow('Pick one of: saas.');
  });

  test('a closed lead whose stage was archived still reads, changes and reopens', async () => {
    const { lead } = await createLead(context(), { personId, pipelineId });
    await changeLead(context(), lead.id, { type: 'close' });
    const lost = stageNamed('Closed: no reply');
    await db.update(schema.stage).set({ archivedAt: new Date() }).where(eq(schema.stage.id, lost));
    expect((await getLead(workspace.admin, lead.id)).stageId).toBe(lost);
    expect((await getLeadByKey(workspace.admin, 'YOD-1')).stageId).toBe(lost);
    const reprioritised = await changeLead(context(), lead.id, {
      type: 'update',
      patch: { priority: 2 },
    });
    expect(reprioritised.lead).toMatchObject({ priority: 2, stageId: lost });
    const reopened = await changeLead(context(), lead.id, {
      type: 'update',
      patch: { stageId: stageNamed('New') },
    });
    expect(reopened.lead.stageCategory).toBe('open');
    const activity = reopened.actions.find((action) => action.model === 'activity');
    expect(activity?.data['payload']).toMatchObject({
      changes: { stageId: { from: { id: lost, name: 'Closed: no reply' } } },
    });
  });

  test('a move waits on a stage retype in flight and takes the category it commits', async () => {
    const { lead } = await createLead(context(), { personId, pipelineId });
    const ready = stageNamed('Ready');
    const moved = await racingRival(
      (tx) => tx`update stage set category = 'lost' where id = ${ready}`,
      () => changeLead(context(), lead.id, { type: 'update', patch: { stageId: ready } }),
    );
    expect(moved.lead).toMatchObject({ stageId: ready, stageCategory: 'lost' });
    expect((await storedLead(lead.id))?.stageCategory).toBe('lost');
  });

  test('a change that races a pipeline archive is refused once the archive commits', async () => {
    const { lead } = await createLead(context(), { personId, pipelineId });
    await changeLead(context(), lead.id, { type: 'close' });
    await expect(
      racingRival(
        (tx) => tx`update pipeline set archived_at = now() where id = ${pipelineId}`,
        () => changeLead(context(), lead.id, { type: 'update', patch: { priority: 3 } }),
      ),
    ).rejects.toThrow('One or more of those leads do not exist.');
    expect((await storedLead(lead.id))?.priority).toBe(0);
  });

  test('a reopen that loses the race to another open lead is a 409 and is not retried', async () => {
    const first = await createLead(context(), { personId, pipelineId });
    await changeLead(context(), first.lead.id, { type: 'close' });
    const second = await createLead(context(), { personId, pipelineId });
    await changeLead(context(), second.lead.id, { type: 'close' });
    const newStage = stageNamed('New');
    const refused = await refusal(
      racingRival(
        (tx) =>
          tx`update lead set stage_id = ${newStage}, stage_category = 'open' where id = ${first.lead.id}`,
        () =>
          changeLead(context(), second.lead.id, { type: 'update', patch: { stageId: newStage } }),
      ),
    );
    expect(refused).toMatchObject({
      status: 409,
      message: 'This person already has an open lead in this pipeline.',
    });
    const open = await db
      .select()
      .from(schema.lead)
      .where(and(eq(schema.lead.personId, personId), eq(schema.lead.stageCategory, 'open')));
    expect(open.map((row) => row.id)).toEqual([first.lead.id]);
  });
});

describe('quickCreateLead', () => {
  test('creates the person, company, employment and lead in one step', async () => {
    const leadId = randomUUIDv7();
    const created = await quickCreateLead(context(), {
      leadId,
      pipelineId,
      person: {
        name: 'Grace Hopper',
        emails: ['grace@navy.mil'],
        company: { domain: 'navy.mil', name: 'Navy' },
      },
    });
    expect(created.lead).toMatchObject({
      id: leadId,
      key: 'YOD-1',
      personName: 'Grace Hopper',
      companyName: 'Navy',
    });
    expect(created.personCreated).toBe(true);
  });

  test('refuses a matched person who already has an open lead and changes nothing about them', async () => {
    await quickCreateLead(context(), {
      pipelineId,
      person: { name: 'Grace', emails: ['grace@navy.mil'] },
    });
    await expect(
      quickCreateLead(context(), {
        pipelineId,
        person: { name: 'Grace H', emails: ['GRACE@navy.mil', 'g@other.dev'] },
      }),
    ).rejects.toThrow('Grace already has an open lead in this pipeline: YOD-1.');
    const [stored] = await db
      .select()
      .from(schema.person)
      .where(eq(schema.person.primaryEmail, 'grace@navy.mil'));
    expect(stored?.emails).toEqual(['grace@navy.mil']);
  });

  test('a foreign pipeline is refused before anyone is created', async () => {
    const other = await createWorkspace('Other');
    const otherBrand = await createBrand({ principal: other.admin }, { name: 'Zeta' });
    await expect(
      quickCreateLead(context(), {
        pipelineId: otherBrand.pipeline.id,
        person: { name: 'Grace', emails: ['grace@navy.mil'] },
      }),
    ).rejects.toThrow('That pipeline does not exist.');
    expect(
      await db.select().from(schema.person).where(eq(schema.person.primaryEmail, 'grace@navy.mil')),
    ).toHaveLength(0);
  });

  test('an open lead that commits under it is a 409 and is not retried', async () => {
    const graceId = await person('Grace', 'grace@navy.mil');
    const first = await createLead(context(), { personId: graceId, pipelineId });
    await changeLead(context(), first.lead.id, { type: 'close' });
    const newStage = stageNamed('New');
    const refused = await refusal(
      racingRival(
        (tx) =>
          tx`update lead set stage_id = ${newStage}, stage_category = 'open' where id = ${first.lead.id}`,
        () =>
          quickCreateLead(context(), {
            pipelineId,
            person: { name: 'Grace', emails: ['grace@navy.mil'] },
          }),
      ),
    );
    expect(refused).toMatchObject({
      status: 409,
      message: 'This person already has an open lead in this pipeline.',
    });
    expect(
      await db.select().from(schema.lead).where(eq(schema.lead.personId, graceId)),
    ).toHaveLength(1);
  });
});

describe('getLeadByKey', () => {
  test('finds a lead case-insensitively and refuses an unknown key', async () => {
    const { lead } = await createLead(context(), { personId, pipelineId });
    expect((await getLeadByKey(workspace.admin, 'yod-1')).id).toBe(lead.id);
    await expect(getLeadByKey(workspace.admin, 'YOD-99')).rejects.toThrow(
      'There is no lead YOD-99.',
    );
    await expect(getLeadByKey(workspace.admin, 'not a key')).rejects.toThrow(
      'There is no lead not a key.',
    );
  });
});
