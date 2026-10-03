import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { db } from '@gravity/db';
import { createBrand } from '../../src/crm/brand-service.ts';
import {
  archiveFieldDefinition,
  createFieldDefinition,
  loadFieldDefinitions,
  validateFieldInput,
} from '../../src/crm/field-service.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import { createWorkspace, resetDatabase, type TestWorkspace } from '../../src/test-support.ts';

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
