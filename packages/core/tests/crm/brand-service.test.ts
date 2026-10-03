import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, eq, schema } from '@gravity/db';
import { DomainError } from '@gravity/shared/errors';
import { archiveBrand, createBrand, listBrands, updateBrand } from '../../src/crm/brand-service.ts';
import { createFieldDefinition, listFieldDefinitions } from '../../src/crm/field-service.ts';
import { listPipelines } from '../../src/crm/pipeline-service.ts';
import { acceptInvite, createInvite } from '../../src/org/invite-service.ts';
import { resolvePrincipal } from '../../src/org/member-service.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import {
  configurationFootprint,
  createMemberPrincipal,
  createUser,
  createWorkspace,
  insertTestLead,
  refusal,
  resetDatabase,
  type TestWorkspace,
} from '../../src/test-support.ts';

let workspace: TestWorkspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
});

afterAll(async () => {
  await closeRealtime();
});

describe('createBrand', () => {
  test('creates the brand, playbook v1 and a prospecting pipeline with the default stages', async () => {
    const created = await createBrand(
      { principal: workspace.admin, originClientId: 'tab-1' },
      { name: 'Yodu', color: 'green' },
    );
    expect(created.brand).toMatchObject({
      name: 'Yodu',
      color: 'green',
      currentPlaybookVersion: 1,
    });
    expect(created.pipeline).toMatchObject({ key: 'YOD', name: 'Prospecting', kind: 'people' });
    expect(created.stages.map((stage) => stage.name)).toHaveLength(13);
    expect(created.stages.map((stage) => stage.sortOrder)).toEqual([...new Array(13).keys()]);
    const playbooks = await db
      .select()
      .from(schema.playbookVersion)
      .where(eq(schema.playbookVersion.brandId, created.brand.id));
    expect(playbooks.map((row) => row.version)).toEqual([1]);
    expect(created.actions.map((action) => action.model)).toEqual([
      'brand',
      'pipeline',
      ...new Array(13).fill('stage'),
    ]);
    expect(created.actions.every((action) => action.originClientId === 'tab-1')).toBe(true);
    expect(created.actions[1]?.scopes).toEqual([
      `workspace:${workspace.organizationId}`,
      `brand:${created.brand.id}`,
      `pipeline:${created.pipeline.id}`,
    ]);
  });

  test('walks past a taken key and refuses an explicit duplicate', async () => {
    await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
    const second = await createBrand({ principal: workspace.admin }, { name: 'Yolanda' });
    expect(second.pipeline.key).toBe('YOL');
    const third = await createBrand({ principal: workspace.admin }, { name: 'Yod' });
    expect(third.pipeline.key).toBe('YOA');
    await expect(
      createBrand({ principal: workspace.admin }, { name: 'Other', pipelineKey: 'yod' }),
    ).rejects.toThrow('Another pipeline already uses that key.');
  });

  test('a duplicate name is a 409, whatever its case, and writes nothing', async () => {
    await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
    const before = await configurationFootprint();
    const refused = await refusal(createBrand({ principal: workspace.admin }, { name: 'yodu' }));
    expect(refused).toMatchObject({
      status: 409,
      message: 'A brand with that name already exists.',
    });
    expect(await configurationFootprint()).toEqual(before);
  });

  test('a guest cannot create a brand', async () => {
    const guestUser = await createUser('Gus');
    const { token } = await createInvite(workspace.admin, {
      email: guestUser.email,
      role: 'guest',
    });
    await acceptInvite(token, guestUser.id);
    const guest = await resolvePrincipal(guestUser.id, workspace.organizationId);
    const attempt = createBrand({ principal: guest }, { name: 'Nope' });
    await expect(attempt).rejects.toBeInstanceOf(DomainError);
    expect(await listBrands(workspace.admin)).toHaveLength(0);
  });
});

describe('updateBrand', () => {
  test('changes only what was sent and emits one update', async () => {
    const created = await createBrand(
      { principal: workspace.admin },
      { name: 'Yodu', signature: 'Best, Ada' },
    );
    const updated = await updateBrand({ principal: workspace.admin }, created.brand.id, {
      name: 'Yodu Labs',
      color: 'violet',
    });
    expect(updated.brand).toMatchObject({
      name: 'Yodu Labs',
      color: 'violet',
      signature: 'Best, Ada',
    });
    expect(updated.brand.syncId).toBeGreaterThan(created.brand.syncId);
    expect(updated.actions.map((action) => [action.model, action.action])).toEqual([
      ['brand', 'update'],
    ]);
    expect(updated.actions[0]?.scopes).toEqual([
      `workspace:${workspace.organizationId}`,
      `brand:${created.brand.id}`,
    ]);
  });

  test('a name another brand holds is a 409', async () => {
    await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
    const second = await createBrand({ principal: workspace.admin }, { name: 'Lumen' });
    const refused = await refusal(
      updateBrand({ principal: workspace.admin }, second.brand.id, { name: 'YODU' }),
    );
    expect(refused).toMatchObject({
      status: 409,
      message: 'A brand with that name already exists.',
    });
  });

  test('an archived brand and a foreign brand are both a 404', async () => {
    const created = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
    const other = await createWorkspace('Other');
    const foreign = await refusal(
      updateBrand({ principal: other.admin }, created.brand.id, { name: 'Mine' }),
    );
    expect(foreign).toMatchObject({ status: 404, message: 'That brand does not exist.' });
    await archiveBrand({ principal: workspace.admin }, created.brand.id);
    const archived = await refusal(
      updateBrand({ principal: workspace.admin }, created.brand.id, { name: 'Back' }),
    );
    expect(archived).toMatchObject({ status: 404 });
  });

  test('a contributor cannot update a brand', async () => {
    const created = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
    const contributor = await createMemberPrincipal(workspace, 'contributor');
    const refused = await refusal(
      updateBrand({ principal: contributor }, created.brand.id, { name: 'Nope' }),
    );
    expect(refused).toMatchObject({ status: 403 });
    const [row] = await listBrands(workspace.admin);
    expect(row?.name).toBe('Yodu');
  });
});

describe('archiveBrand', () => {
  test('archives the brand and its pipelines and hides both from lists', async () => {
    const created = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
    const archived = await archiveBrand({ principal: workspace.admin }, created.brand.id);
    expect(archived.actions.map((action) => `${action.model}:${action.action}`)).toEqual([
      'brand:archive',
      'pipeline:archive',
      ...created.stages.map(() => 'stage:archive'),
    ]);
    expect(archived.actions.map((action) => action.modelId)).toEqual([
      created.brand.id,
      created.pipeline.id,
      ...created.stages.map((stage) => stage.id),
    ]);
    expect(await listBrands(workspace.admin)).toHaveLength(0);
    expect(await listPipelines(workspace.admin)).toHaveLength(0);
  });

  test('archives pipeline fields too and emits them', async () => {
    const created = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
    const pipelineField = await createFieldDefinition(
      { principal: workspace.admin },
      { object: 'lead', pipelineId: created.pipeline.id, key: 'tier', label: 'Tier', type: 'text' },
    );
    const workspaceField = await createFieldDefinition(
      { principal: workspace.admin },
      { object: 'lead', key: 'seats', label: 'Seats', type: 'number' },
    );
    const archived = await archiveBrand({ principal: workspace.admin }, created.brand.id);
    const fieldActions = archived.actions.filter((action) => action.model === 'field_definition');
    expect(fieldActions.map((action) => [action.modelId, action.action])).toEqual([
      [pipelineField.field.id, 'archive'],
    ]);
    const listed = await listFieldDefinitions(workspace.admin);
    expect(listed.map((field) => field.id)).toEqual([workspaceField.field.id]);
  });

  test('open and held leads block it with a 409 naming the count and nothing is written', async () => {
    const created = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
    const stageId = created.stages[0]?.id ?? '';
    const base = {
      organizationId: workspace.organizationId,
      pipelineId: created.pipeline.id,
      stageId,
    };
    await insertTestLead({ ...base, stageCategory: 'open' });
    await insertTestLead({ ...base, stageCategory: 'hold' });
    await insertTestLead({ ...base, stageCategory: 'lost' });
    const before = await configurationFootprint();
    const refused = await refusal(archiveBrand({ principal: workspace.admin }, created.brand.id));
    expect(refused).toMatchObject({
      status: 409,
      message: 'Close the 2 open or held leads in Yodu before archiving it.',
    });
    expect(await configurationFootprint()).toEqual(before);
    expect(await listBrands(workspace.admin)).toHaveLength(1);
  });

  test('a guest cannot archive a brand', async () => {
    const created = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
    const guest = await createMemberPrincipal(workspace, 'guest');
    const refused = await refusal(archiveBrand({ principal: guest }, created.brand.id));
    expect(refused).toMatchObject({ status: 403 });
    expect(await listBrands(workspace.admin)).toHaveLength(1);
  });

  test('another workspace cannot see or archive the brand', async () => {
    const created = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
    const other = await createWorkspace('Other');
    await expect(archiveBrand({ principal: other.admin }, created.brand.id)).rejects.toThrow(
      'That brand does not exist.',
    );
    expect(await listBrands(other.admin)).toHaveLength(0);
  });
});
