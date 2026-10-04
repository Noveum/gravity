import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, eq, schema } from '@gravity/db';
import { createBrand } from '../../src/crm/brand-service.ts';
import {
  archiveFieldDefinition,
  createFieldDefinition,
  listFieldDefinitions,
  loadFieldDefinitions,
  unarchiveFieldDefinition,
  updateFieldDefinition,
  validateFieldInput,
} from '../../src/crm/field-service.ts';
import { archivePipeline } from '../../src/crm/pipeline-service.ts';
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

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
  pipelineId = (await createBrand({ principal: workspace.admin }, { name: 'Yodu' })).pipeline.id;
});

afterAll(async () => {
  await closeRealtime();
});

describe('field definitions', () => {
  test('pipeline fields apply only to that pipeline and workspace fields everywhere', async () => {
    const context = { principal: workspace.admin };
    await createFieldDefinition(context, {
      object: 'lead',
      key: 'seats',
      label: 'Seats',
      type: 'number',
    });
    await createFieldDefinition(context, {
      object: 'lead',
      pipelineId,
      key: 'industry',
      label: 'Industry',
      type: 'select',
      options: [{ value: 'saas', label: 'SaaS' }],
    });
    const inPipeline = await loadFieldDefinitions(db, workspace.organizationId, 'lead', pipelineId);
    const elsewhere = await loadFieldDefinitions(db, workspace.organizationId, 'lead', 'p-other');
    expect(inPipeline.map((field) => field.key).sort()).toEqual(['industry', 'seats']);
    expect(elsewhere.map((field) => field.key)).toEqual(['seats']);
  });

  test('a duplicate key is a conflict and an archived key is free again', async () => {
    const context = { principal: workspace.admin };
    const { field } = await createFieldDefinition(context, {
      object: 'person',
      key: 'tier',
      label: 'Tier',
      type: 'text',
    });
    await expect(
      createFieldDefinition(context, {
        object: 'person',
        key: 'tier',
        label: 'Again',
        type: 'text',
      }),
    ).rejects.toThrow('A custom field with that key already exists here.');
    await archiveFieldDefinition(context, field.id);
    await createFieldDefinition(context, {
      object: 'person',
      key: 'tier',
      label: 'Tier',
      type: 'text',
    });
  });

  test('a person field cannot belong to a pipeline', async () => {
    await expect(
      createFieldDefinition(
        { principal: workspace.admin },
        { object: 'person', pipelineId, key: 'x', label: 'X', type: 'text' },
      ),
    ).rejects.toThrow('Only lead and deal fields can belong to a pipeline.');
  });

  test('validateFieldInput accepts known values and names unknown keys', async () => {
    await createFieldDefinition(
      { principal: workspace.admin },
      { object: 'company', key: 'arr', label: 'ARR', type: 'number' },
    );
    expect(
      await validateFieldInput(db, workspace.organizationId, 'company', null, { arr: 1200 }),
    ).toEqual({ arr: 1200 });
    await expect(
      validateFieldInput(db, workspace.organizationId, 'company', null, { mrr: 1 }),
    ).rejects.toThrow('There is no custom field called mrr');
  });
});

describe('field key scope', () => {
  const lead = { object: 'lead', label: 'Seats', type: 'number' } as const;

  test('a pipeline field cannot reuse the key of a workspace-wide field', async () => {
    const context = { principal: workspace.admin };
    await createFieldDefinition(context, { ...lead, key: 'seats' });
    const before = await configurationFootprint();
    const refused = await refusal(
      createFieldDefinition(context, { ...lead, pipelineId, key: 'seats' }),
    );
    expect(refused).toMatchObject({
      status: 409,
      message: 'A workspace-wide custom field already uses that key. Use another key.',
    });
    expect(await configurationFootprint()).toEqual(before);
  });

  test('a workspace-wide field cannot reuse the key of any live pipeline field', async () => {
    const context = { principal: workspace.admin };
    const other = await createBrand(context, { name: 'Lumen' });
    await createFieldDefinition(context, { ...lead, pipelineId: other.pipeline.id, key: 'seats' });
    const before = await configurationFootprint();
    const refused = await refusal(createFieldDefinition(context, { ...lead, key: 'seats' }));
    expect(refused).toMatchObject({
      status: 409,
      message: 'A pipeline already has a custom field with that key. Use another key.',
    });
    expect(await configurationFootprint()).toEqual(before);
  });

  test('two pipelines may each have the key, and other objects are unaffected', async () => {
    const context = { principal: workspace.admin };
    const other = await createBrand(context, { name: 'Lumen' });
    await createFieldDefinition(context, { ...lead, pipelineId, key: 'seats' });
    await createFieldDefinition(context, { ...lead, pipelineId: other.pipeline.id, key: 'seats' });
    await createFieldDefinition(context, {
      object: 'company',
      label: 'Seats',
      type: 'number',
      key: 'seats',
    });
    expect(
      (await listFieldDefinitions(workspace.admin)).filter((f) => f.key === 'seats'),
    ).toHaveLength(3);
  });

  test('a workspace-wide and a pipeline field created at the same moment cannot both win', async () => {
    const context = { principal: workspace.admin };
    const results = await Promise.allSettled([
      createFieldDefinition(context, { ...lead, key: 'seats' }),
      createFieldDefinition(context, { ...lead, pipelineId, key: 'seats' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({ status: 409 });
    expect(
      (await listFieldDefinitions(workspace.admin)).filter((field) => field.key === 'seats'),
    ).toHaveLength(1);
  });

  test('an archived field or archived pipeline frees the key', async () => {
    const context = { principal: workspace.admin };
    const other = await createBrand(context, { name: 'Lumen' });
    await createFieldDefinition(context, { ...lead, pipelineId: other.pipeline.id, key: 'seats' });
    await archivePipeline(context, other.pipeline.id);
    await createFieldDefinition(context, { ...lead, key: 'seats' });
  });
});

describe('field permissions and foreign ids', () => {
  test('a contributor and a guest cannot create, update or archive fields', async () => {
    const { field } = await createFieldDefinition(
      { principal: workspace.admin },
      { object: 'person', key: 'tier', label: 'Tier', type: 'text' },
    );
    const principals = [
      await createMemberPrincipal(workspace, 'contributor'),
      await createMemberPrincipal(workspace, 'guest'),
    ];
    const before = await configurationFootprint();
    for (const principal of principals) {
      const attempts = [
        createFieldDefinition(
          { principal },
          { object: 'person', key: 'x', label: 'X', type: 'text' },
        ),
        updateFieldDefinition({ principal }, field.id, { label: 'Nope' }),
        archiveFieldDefinition({ principal }, field.id),
      ];
      for (const attempt of attempts) {
        expect(await refusal(attempt)).toMatchObject({
          status: 403,
          message: 'Your role cannot manage fields.',
        });
      }
    }
    expect(await configurationFootprint()).toEqual(before);
    expect((await listFieldDefinitions(workspace.admin))[0]?.label).toBe('Tier');
  });

  test('a pipeline of another workspace is a 404 and writes nothing', async () => {
    const other = await createWorkspace('Other');
    const foreign = await createBrand({ principal: other.admin }, { name: 'Foreign' });
    const before = await configurationFootprint();
    const refused = await refusal(
      createFieldDefinition(
        { principal: workspace.admin },
        { object: 'lead', pipelineId: foreign.pipeline.id, key: 'x', label: 'X', type: 'text' },
      ),
    );
    expect(refused).toMatchObject({ status: 404, message: 'That pipeline does not exist.' });
    expect(await configurationFootprint()).toEqual(before);
  });

  test('a field of another workspace is a 404 for update and archive', async () => {
    const other = await createWorkspace('Other');
    const { field } = await createFieldDefinition(
      { principal: other.admin },
      { object: 'person', key: 'tier', label: 'Tier', type: 'text' },
    );
    const before = await configurationFootprint();
    const updated = await refusal(
      updateFieldDefinition({ principal: workspace.admin }, field.id, { label: 'Mine' }),
    );
    expect(updated).toMatchObject({ status: 404, message: 'That custom field does not exist.' });
    const archived = await refusal(
      archiveFieldDefinition({ principal: workspace.admin }, field.id),
    );
    expect(archived).toMatchObject({ status: 404 });
    expect(await configurationFootprint()).toEqual(before);
    expect((await listFieldDefinitions(other.admin))[0]?.label).toBe('Tier');
  });
});

describe('updateFieldDefinition', () => {
  test('changes the label and options of a choice field and emits one update', async () => {
    const { field } = await createFieldDefinition(
      { principal: workspace.admin },
      {
        object: 'lead',
        key: 'industry',
        label: 'Industry',
        type: 'select',
        options: [{ value: 'saas', label: 'SaaS' }],
      },
    );
    const updated = await updateFieldDefinition({ principal: workspace.admin }, field.id, {
      label: 'Sector',
      description: 'Their market',
      options: [
        { value: 'saas', label: 'SaaS' },
        { value: 'fintech', label: 'Fintech' },
      ],
    });
    expect(updated.field).toMatchObject({
      key: 'industry',
      label: 'Sector',
      description: 'Their market',
    });
    expect(updated.field.options.map((option) => option.value)).toEqual(['saas', 'fintech']);
    expect(updated.field.syncId).toBeGreaterThan(field.syncId);
    expect(updated.actions.map((action) => `${action.model}:${action.action}`)).toEqual([
      'field_definition:update',
    ]);
  });

  test('options on a non-choice field are refused', async () => {
    const { field } = await createFieldDefinition(
      { principal: workspace.admin },
      { object: 'lead', key: 'seats', label: 'Seats', type: 'number' },
    );
    const refused = await refusal(
      updateFieldDefinition({ principal: workspace.admin }, field.id, {
        options: [{ value: 'a', label: 'A' }],
      }),
    );
    expect(refused).toMatchObject({ status: 422, message: 'Only choice fields have options.' });
  });

  test('an archived field is a 404', async () => {
    const context = { principal: workspace.admin };
    const { field } = await createFieldDefinition(context, {
      object: 'lead',
      key: 'seats',
      label: 'Seats',
      type: 'number',
    });
    await archiveFieldDefinition(context, field.id);
    const refused = await refusal(updateFieldDefinition(context, field.id, { label: 'Back' }));
    expect(refused).toMatchObject({ status: 404 });
  });
});

describe('unarchiveFieldDefinition', () => {
  const context = () => ({ principal: workspace.admin });
  const spec = { object: 'lead', key: 'seats', label: 'Seats', type: 'number' } as const;

  test('brings an archived field back and emits one unarchive action', async () => {
    const { field } = await createFieldDefinition(context(), spec);
    const archived = await archiveFieldDefinition(context(), field.id);
    const restored = await unarchiveFieldDefinition(context(), field.id);
    expect(restored.field).toMatchObject({ id: field.id, key: 'seats', archivedAt: null });
    expect(restored.field.syncId).toBeGreaterThan(archived.field.syncId);
    expect(restored.actions.map((action) => [action.model, action.action])).toEqual([
      ['field_definition', 'unarchive'],
    ]);
    expect((await listFieldDefinitions(workspace.admin)).map((entry) => entry.id)).toEqual([
      field.id,
    ]);
  });

  test('a key reused meanwhile is a 409 and the field stays archived', async () => {
    const { field } = await createFieldDefinition(context(), spec);
    await archiveFieldDefinition(context(), field.id);
    await createFieldDefinition(context(), { ...spec, label: 'Seats again' });
    const before = await configurationFootprint();
    const refused = await refusal(unarchiveFieldDefinition(context(), field.id));
    expect(refused).toMatchObject({
      status: 409,
      message: 'A custom field with that key already exists here.',
    });
    expect(await configurationFootprint()).toEqual(before);
    const [row] = await db
      .select()
      .from(schema.fieldDefinition)
      .where(eq(schema.fieldDefinition.id, field.id));
    expect(row?.archivedAt).not.toBeNull();
  });

  test('a field that is not archived is a 409', async () => {
    const { field } = await createFieldDefinition(context(), spec);
    expect(await refusal(unarchiveFieldDefinition(context(), field.id))).toMatchObject({
      status: 409,
      message: 'That custom field is not archived.',
    });
  });

  test('a pipeline field of an archived pipeline stays archived with a 404', async () => {
    const { field } = await createFieldDefinition(context(), { ...spec, pipelineId });
    await archiveFieldDefinition(context(), field.id);
    await archivePipeline(context(), pipelineId);
    expect(await refusal(unarchiveFieldDefinition(context(), field.id))).toMatchObject({
      status: 404,
      message: 'That pipeline does not exist.',
    });
  });

  test('a contributor or guest is refused and a foreign field is a 404', async () => {
    const { field } = await createFieldDefinition(context(), spec);
    await archiveFieldDefinition(context(), field.id);
    const guest = await createMemberPrincipal(workspace, 'guest');
    const contributor = await createMemberPrincipal(workspace, 'contributor');
    const foreign = await createWorkspace('Other');
    const before = await configurationFootprint();
    for (const principal of [guest, contributor]) {
      expect(await refusal(unarchiveFieldDefinition({ principal }, field.id))).toMatchObject({
        status: 403,
        message: 'Your role cannot manage fields.',
      });
    }
    expect(
      await refusal(unarchiveFieldDefinition({ principal: foreign.admin }, field.id)),
    ).toMatchObject({ status: 404, message: 'That custom field does not exist.' });
    expect(await configurationFootprint()).toEqual(before);
  });
});

describe('listFieldDefinitions', () => {
  test('excludes a live field whose pipeline is archived', async () => {
    const context = { principal: workspace.admin };
    const inPipeline = await createFieldDefinition(context, {
      object: 'lead',
      pipelineId,
      key: 'tier',
      label: 'Tier',
      type: 'text',
    });
    const everywhere = await createFieldDefinition(context, {
      object: 'lead',
      key: 'seats',
      label: 'Seats',
      type: 'number',
    });
    expect((await listFieldDefinitions(workspace.admin)).map((field) => field.id).sort()).toEqual(
      [inPipeline.field.id, everywhere.field.id].sort(),
    );
    await db
      .update(schema.pipeline)
      .set({ archivedAt: new Date() })
      .where(eq(schema.pipeline.id, pipelineId));
    const [stored] = await db
      .select()
      .from(schema.fieldDefinition)
      .where(eq(schema.fieldDefinition.id, inPipeline.field.id));
    expect(stored?.archivedAt).toBeNull();
    expect((await listFieldDefinitions(workspace.admin)).map((field) => field.id)).toEqual([
      everywhere.field.id,
    ]);
  });
});
