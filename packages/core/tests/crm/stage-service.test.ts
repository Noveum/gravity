import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, eq, schema } from '@gravity/db';
import { createBrand } from '../../src/crm/brand-service.ts';
import {
  archiveStage,
  createStage,
  listStages,
  reorderStages,
  updateStage,
} from '../../src/crm/stage-service.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import { createWorkspace, resetDatabase, type TestWorkspace } from '../../src/test-support.ts';

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
    await expect(
      updateStage({ principal: workspace.admin }, first, { category: 'won' }),
    ).rejects.toThrow();
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
});
