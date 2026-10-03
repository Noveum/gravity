import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, eq, schema } from '@gravity/db';
import postgres from 'postgres';
import { createBrand } from '../../src/crm/brand-service.ts';
import {
  archiveStage,
  createStage,
  listStages,
  reorderStages,
  updateStage,
} from '../../src/crm/stage-service.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import {
  configurationFootprint,
  createMemberPrincipal,
  createWorkspace,
  refusal,
  resetDatabase,
  type TestWorkspace,
} from '../../src/test-support.ts';

let workspace: TestWorkspace;
let pipelineId = '';
let stageIds: string[] = [];

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
  const created = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
  pipelineId = created.pipeline.id;
  stageIds = created.stages.map((stage) => stage.id);
});

afterAll(async () => {
  await closeRealtime();
});

async function waitForLockWaiter(observer: postgres.Sql): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await observer<{ waiting: number }[]>`
      select count(*)::int as waiting from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'`;
    if ((row?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('the stage edit never waited on the pipeline lock');
}

async function parkLeadIn(stageId: string, archivedAt: Date | null = null): Promise<void> {
  await db
    .insert(schema.person)
    .values({ id: 'per1', organizationId: workspace.organizationId, name: 'Ada' });
  await db.insert(schema.lead).values({
    id: 'l1',
    organizationId: workspace.organizationId,
    personId: 'per1',
    pipelineId,
    number: 1,
    stageId,
    stageCategory: 'open',
    archivedAt,
  });
}

describe('stages', () => {
  test('a new stage goes to the end', async () => {
    const { stage } = await createStage(
      { principal: workspace.admin },
      { pipelineId, name: 'Nurture' },
    );
    expect(stage.sortOrder).toBe(13);
  });

  test('reorder needs every stage once and emits only moved stages', async () => {
    const reversed = [...stageIds].reverse();
    const result = await reorderStages(
      { principal: workspace.admin },
      { pipelineId, stageIds: reversed },
    );
    expect(result.stages.map((stage) => stage.id)).toEqual(reversed);
    expect(result.actions).toHaveLength(12);
    await expect(
      reorderStages({ principal: workspace.admin }, { pipelineId, stageIds: reversed.slice(1) }),
    ).rejects.toThrow('Send every stage of the pipeline exactly once.');
  });

  test('a stage with leads keeps its type and cannot be archived', async () => {
    const first = stageIds[0] ?? '';
    await parkLeadIn(first);
    await expect(
      updateStage({ principal: workspace.admin }, first, { category: 'lost' }),
    ).rejects.toThrow('Move the 1 lead in New to another stage before changing its type.');
    await expect(archiveStage({ principal: workspace.admin }, first)).rejects.toThrow(
      'Move the 1 lead in New out before archiving it.',
    );
    const renamed = await updateStage({ principal: workspace.admin }, first, { name: 'Fresh' });
    expect(renamed.stage.name).toBe('Fresh');
  });

  test('retyping a stage rewrites the stage category of every lead left in it in the same transaction', async () => {
    const first = stageIds[0] ?? '';
    await parkLeadIn(first, new Date());
    const [before] = await db.select().from(schema.lead).where(eq(schema.lead.id, 'l1'));
    expect(before?.stageCategory).toBe('open');
    const retyped = await updateStage({ principal: workspace.admin }, first, { category: 'hold' });
    expect(retyped.stage.category).toBe('hold');
    const [after] = await db.select().from(schema.lead).where(eq(schema.lead.id, 'l1'));
    expect(after?.stageCategory).toBe('hold');
    await updateStage({ principal: workspace.admin }, first, { name: 'Fresh' });
    const [renamed] = await db.select().from(schema.lead).where(eq(schema.lead.id, 'l1'));
    expect(renamed?.stageCategory).toBe('hold');
  });

  test('a failed retype leaves lead categories alone', async () => {
    const first = stageIds[0] ?? '';
    await parkLeadIn(first);
    const refused = await refusal(
      updateStage({ principal: workspace.admin }, first, { category: 'won' }),
    );
    expect(refused).toMatchObject({
      status: 409,
      message: 'Move the 1 lead in New to another stage before changing its type.',
    });
    const [row] = await db.select().from(schema.lead).where(eq(schema.lead.id, 'l1'));
    expect(row?.stageCategory).toBe('open');
  });

  test('the last open stage cannot be archived or retyped', async () => {
    const stages = await listStages(workspace.admin);
    const open = stages.filter((stage) => stage.category === 'open');
    for (const stage of open.slice(1)) await archiveStage({ principal: workspace.admin }, stage.id);
    const last = open[0]?.id ?? '';
    await expect(archiveStage({ principal: workspace.admin }, last)).rejects.toThrow(
      'A pipeline needs at least one open stage.',
    );
    await expect(
      updateStage({ principal: workspace.admin }, last, { category: 'won' }),
    ).rejects.toThrow('A pipeline needs at least one open stage.');
  });

  test('a contributor or guest cannot create, update, reorder or archive stages', async () => {
    const contributor = await createMemberPrincipal(workspace, 'contributor');
    const guest = await createMemberPrincipal(workspace, 'guest');
    const before = await configurationFootprint();
    for (const principal of [contributor, guest]) {
      const attempts = [
        createStage({ principal }, { pipelineId, name: 'Nope' }),
        updateStage({ principal }, stageIds[0] ?? '', { name: 'Nope' }),
        reorderStages({ principal }, { pipelineId, stageIds: [...stageIds].reverse() }),
        archiveStage({ principal }, stageIds[1] ?? ''),
      ];
      for (const attempt of attempts) {
        expect(await refusal(attempt)).toMatchObject({
          status: 403,
          message: 'Your role cannot pipeline manage.',
        });
      }
    }
    expect(await configurationFootprint()).toEqual(before);
    const stages = await listStages(workspace.admin);
    expect(stages.map((stage) => stage.id)).toEqual(stageIds);
    expect(stages[0]?.name).toBe('New');
  });
});

describe('stages of another workspace', () => {
  let foreign: TestWorkspace;
  let foreignPipelineId = '';
  let foreignStageId = '';

  beforeEach(async () => {
    foreign = await createWorkspace('Other');
    const created = await createBrand({ principal: foreign.admin }, { name: 'Foreign' });
    foreignPipelineId = created.pipeline.id;
    foreignStageId = created.stages[0]?.id ?? '';
  });

  test('createStage with a foreign pipeline is a 404 and writes nothing', async () => {
    const before = await configurationFootprint();
    const refused = await refusal(
      createStage(
        { principal: workspace.admin },
        { pipelineId: foreignPipelineId, name: 'Sneaky' },
      ),
    );
    expect(refused).toMatchObject({ status: 404, message: 'That pipeline does not exist.' });
    expect(await configurationFootprint()).toEqual(before);
  });

  test('reorderStages with a foreign pipeline is a 404 and writes nothing', async () => {
    const before = await configurationFootprint();
    const refused = await refusal(
      reorderStages(
        { principal: workspace.admin },
        { pipelineId: foreignPipelineId, stageIds: [foreignStageId] },
      ),
    );
    expect(refused).toMatchObject({ status: 404, message: 'That pipeline does not exist.' });
    expect(await configurationFootprint()).toEqual(before);
  });

  test('reorderStages naming a foreign stage in our pipeline is refused and writes nothing', async () => {
    const before = await configurationFootprint();
    const refused = await refusal(
      reorderStages(
        { principal: workspace.admin },
        { pipelineId, stageIds: [...stageIds.slice(1), foreignStageId] },
      ),
    );
    expect(refused).toMatchObject({
      status: 422,
      message: 'Send every stage of the pipeline exactly once.',
    });
    expect(await configurationFootprint()).toEqual(before);
  });

  test('archiveStage and updateStage with a foreign stage are a 404 and write nothing', async () => {
    const before = await configurationFootprint();
    const archived = await refusal(archiveStage({ principal: workspace.admin }, foreignStageId));
    expect(archived).toMatchObject({ status: 404, message: 'That stage does not exist.' });
    const updated = await refusal(
      updateStage({ principal: workspace.admin }, foreignStageId, { name: 'Mine now' }),
    );
    expect(updated).toMatchObject({ status: 404, message: 'That stage does not exist.' });
    expect(await configurationFootprint()).toEqual(before);
    const [row] = await db.select().from(schema.stage).where(eq(schema.stage.id, foreignStageId));
    expect(row?.name).toBe('New');
    expect(row?.archivedAt).toBeNull();
  });

  test('a stage edit locks the pipeline before the stage, the order lead writes use', async () => {
    const first = stageIds[0] ?? '';
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
    let stageLocked = false;
    const holder = rival.begin(async (tx) => {
      await tx`select id from pipeline where id = ${pipelineId} for share`;
      held();
      await released;
      await tx`set local lock_timeout = '500ms'`;
      await tx`select id from stage where id = ${first} for share`;
      stageLocked = true;
    });
    let renaming: Promise<unknown> = Promise.resolve();
    try {
      await taken;
      renaming = updateStage({ principal: workspace.admin }, first, { name: 'Fresh' });
      await waitForLockWaiter(rival);
    } finally {
      release();
      await holder.catch(() => undefined);
      await rival.end();
    }
    await renaming;
    expect(stageLocked).toBe(true);
  });
});
