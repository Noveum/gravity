import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { createBrand } from '../../src/crm/brand-service.ts';
import {
  archivePipeline,
  createPipeline,
  listPipelines,
  listRetiredPipelineKeys,
  updatePipeline,
} from '../../src/crm/pipeline-service.ts';
import { listStages } from '../../src/crm/stage-service.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import {
  configurationFootprint,
  createMemberPrincipal,
  createWorkspace,
  insertTestLead,
  refusal,
  resetDatabase,
  type TestWorkspace,
} from '../../src/test-support.ts';

let workspace: TestWorkspace;
let brandId = '';
let firstPipelineId = '';
let firstStageId = '';

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
  const created = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
  brandId = created.brand.id;
  firstPipelineId = created.pipeline.id;
  firstStageId = created.stages[0]?.id ?? '';
});

afterAll(async () => {
  await closeRealtime();
});

describe('createPipeline', () => {
  test('adds a pipeline with the default stages, scoped to its brand', async () => {
    const created = await createPipeline(
      { principal: workspace.admin, originClientId: 'tab-2' },
      { brandId, name: 'Deals', key: 'dls', kind: 'deals' },
    );
    expect(created.pipeline).toMatchObject({ brandId, name: 'Deals', key: 'DLS', kind: 'deals' });
    expect(created.pipeline.position).toBe(1);
    expect(created.stages.length).toBeGreaterThan(0);
    expect(created.actions[0]).toMatchObject({ model: 'pipeline', action: 'insert' });
    expect(created.actions.slice(1).every((action) => action.model === 'stage')).toBe(true);
    expect(created.actions.every((action) => action.originClientId === 'tab-2')).toBe(true);
    expect(created.actions[0]?.scopes).toEqual([
      `workspace:${workspace.organizationId}`,
      `brand:${brandId}`,
      `pipeline:${created.pipeline.id}`,
    ]);
    expect(await listPipelines(workspace.admin)).toHaveLength(2);
  });

  test('refuses a taken key with a 409 and writes nothing', async () => {
    const before = await configurationFootprint();
    const refused = await refusal(
      createPipeline({ principal: workspace.admin }, { brandId, name: 'Again', key: 'YOD' }),
    );
    expect(refused).toMatchObject({
      status: 409,
      message: 'Another pipeline already uses that key.',
    });
    expect(await configurationFootprint()).toEqual(before);
  });

  test('refuses the key of an archived pipeline with a 409 and writes nothing', async () => {
    const deals = await createPipeline(
      { principal: workspace.admin },
      { brandId, name: 'Deals', key: 'DLS', kind: 'deals' },
    );
    await archivePipeline({ principal: workspace.admin }, deals.pipeline.id);
    const before = await configurationFootprint();
    const refused = await refusal(
      createPipeline({ principal: workspace.admin }, { brandId, name: 'Deals again', key: 'dls' }),
    );
    expect(refused).toMatchObject({
      status: 409,
      message: 'That key belonged to an archived pipeline.',
    });
    expect(await configurationFootprint()).toEqual(before);
  });

  test('lists the keys of archived pipelines, which stay taken', async () => {
    const deals = await createPipeline(
      { principal: workspace.admin },
      { brandId, name: 'Deals', key: 'DLS', kind: 'deals' },
    );
    expect(await listRetiredPipelineKeys(workspace.admin)).toEqual([]);
    await archivePipeline({ principal: workspace.admin }, deals.pipeline.id);
    expect(await listRetiredPipelineKeys(workspace.admin)).toEqual(['DLS']);
    const other = await createWorkspace('Other');
    expect(await listRetiredPipelineKeys(other.admin)).toEqual([]);
  });

  test('a brand of another workspace is a 404 and writes nothing', async () => {
    const other = await createWorkspace('Other');
    const foreign = await createBrand({ principal: other.admin }, { name: 'Foreign' });
    const before = await configurationFootprint();
    await expect(
      createPipeline(
        { principal: workspace.admin },
        { brandId: foreign.brand.id, name: 'Sneaky', key: 'SNK' },
      ),
    ).rejects.toThrow('That brand does not exist.');
    expect(await configurationFootprint()).toEqual(before);
  });

  test('a guest cannot create a pipeline', async () => {
    const guest = await createMemberPrincipal(workspace, 'guest');
    const before = await configurationFootprint();
    await expect(
      createPipeline({ principal: guest }, { brandId, name: 'Nope', key: 'NOP' }),
    ).rejects.toThrow('Your role cannot pipeline manage.');
    expect(await configurationFootprint()).toEqual(before);
  });
});

describe('updatePipeline', () => {
  test('renames, emitting one update, and leaves the key alone', async () => {
    const updated = await updatePipeline({ principal: workspace.admin }, firstPipelineId, {
      name: 'Outbound',
    });
    expect(updated.pipeline).toMatchObject({ name: 'Outbound', key: 'YOD' });
    expect(updated.actions.map((action) => [action.model, action.action])).toEqual([
      ['pipeline', 'update'],
    ]);
  });

  test('sending the key it already has is accepted', async () => {
    const updated = await updatePipeline({ principal: workspace.admin }, firstPipelineId, {
      name: 'Outbound',
      key: 'yod',
    });
    expect(updated.pipeline).toMatchObject({ name: 'Outbound', key: 'YOD' });
  });

  test('a different key is a 422 and writes nothing, because lead links use it', async () => {
    const before = await configurationFootprint();
    const refused = await refusal(
      updatePipeline({ principal: workspace.admin }, firstPipelineId, {
        name: 'Outbound',
        key: 'OUT',
      }),
    );
    expect(refused).toMatchObject({
      status: 422,
      message: 'Pipeline keys are fixed after creation: lead links use them.',
    });
    expect(await configurationFootprint()).toEqual(before);
    const [row] = await listPipelines(workspace.admin);
    expect(row).toMatchObject({ name: 'Prospecting', key: 'YOD' });
  });

  test('a foreign pipeline is a 404 and a guest is refused', async () => {
    const other = await createWorkspace('Other');
    await expect(
      updatePipeline({ principal: other.admin }, firstPipelineId, { name: 'Mine now' }),
    ).rejects.toThrow('That pipeline does not exist.');
    const guest = await createMemberPrincipal(workspace, 'guest');
    await expect(
      updatePipeline({ principal: guest }, firstPipelineId, { name: 'Nope' }),
    ).rejects.toThrow('Your role cannot pipeline manage.');
    const [row] = await listPipelines(workspace.admin);
    expect(row?.name).toBe('Prospecting');
  });
});

describe('archivePipeline', () => {
  test('archives the pipeline and every stage, emitting each archive', async () => {
    const stageTotal = (await listStages(workspace.admin)).length;
    const archived = await archivePipeline({ principal: workspace.admin }, firstPipelineId);
    const models = archived.actions.map((action) => action.model);
    expect(models.filter((model) => model === 'pipeline')).toHaveLength(1);
    expect(models.filter((model) => model === 'stage')).toHaveLength(stageTotal);
    expect(archived.actions.every((action) => action.action === 'archive')).toBe(true);
    expect(await listPipelines(workspace.admin)).toHaveLength(0);
    expect(await listStages(workspace.admin)).toHaveLength(0);
  });

  test('open and held leads block it with their count, closed and archived ones do not', async () => {
    const stages = await listStages(workspace.admin);
    const stageId = stages[0]?.id ?? '';
    const base = { organizationId: workspace.organizationId, pipelineId: firstPipelineId, stageId };
    await insertTestLead({ ...base, stageCategory: 'open' });
    await insertTestLead({ ...base, stageCategory: 'hold' });
    await insertTestLead({ ...base, stageCategory: 'won' });
    await insertTestLead({ ...base, stageCategory: 'open', archivedAt: new Date() });
    const before = await configurationFootprint();
    const refused = await refusal(archivePipeline({ principal: workspace.admin }, firstPipelineId));
    expect(refused).toMatchObject({
      status: 409,
      message: 'Close the 2 open or held leads in Prospecting before archiving it.',
    });
    expect(await configurationFootprint()).toEqual(before);
    expect(await listPipelines(workspace.admin)).toHaveLength(1);
  });

  test('a single blocking lead is named in the singular', async () => {
    await insertTestLead({
      organizationId: workspace.organizationId,
      pipelineId: firstPipelineId,
      stageId: firstStageId,
    });
    await expect(archivePipeline({ principal: workspace.admin }, firstPipelineId)).rejects.toThrow(
      'Close the 1 open or held lead in Prospecting before archiving it.',
    );
  });

  test('a guest cannot archive and a foreign workspace gets a 404', async () => {
    const guest = await createMemberPrincipal(workspace, 'guest');
    await expect(archivePipeline({ principal: guest }, firstPipelineId)).rejects.toThrow(
      'Your role cannot pipeline manage.',
    );
    const other = await createWorkspace('Other');
    await expect(archivePipeline({ principal: other.admin }, firstPipelineId)).rejects.toThrow(
      'That pipeline does not exist.',
    );
  });
});
