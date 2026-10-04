import { describe, expect, test } from 'bun:test';
import type { SyncAction, SyncModel } from '@gravity/shared/events';
import { emptyFilterGroup } from '@gravity/shared/filters';
import type {
  BrandRow,
  FieldDefinitionRow,
  PipelineRow,
  SavedViewRow,
  StageRow,
} from '@gravity/shared/records';
import type { QueryClient } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { queryKeys } from '@/lib/query/keys.ts';
import type { Bootstrap, PersonRecord } from '@/lib/query/schemas.ts';
import {
  useArchiveBrand,
  useArchiveField,
  useArchivePipeline,
  useArchiveStage,
  useCreateBrand,
  useCreateField,
  useCreatePipeline,
  useCreateStage,
  useReorderStages,
  useUnarchiveField,
  useUnarchiveStage,
  useUpdateBrand,
  useUpdateField,
  useUpdatePipeline,
  useUpdateStage,
} from '@/lib/query/use-config-mutations.ts';
import { registerCrmDeltaHandlers } from '@/lib/realtime/crm-deltas.tsx';
import { applyDelta, isSuperseded } from '@/lib/realtime/delta-bridge.tsx';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { installDeferredFetch } from '../../support/deferred-fetch.ts';
import { leadFixture } from '../../support/lead-fixture.ts';
import { mutationClient, wrapperFor } from '../../support/query-wrapper.tsx';
import { personFixture } from '../../support/record-fixtures.ts';

const server = installDeferredFetch();
const AT = '2026-10-03T10:00:00.000Z';

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`The fixture has no ${what}.`);
  return value;
}

const base = bootstrapFixture();
const brand: BrandRow = must(base.brands[0], 'brand');
const pipeline: PipelineRow = must(base.pipelines[0], 'pipeline');
const stageNew: StageRow = must(base.stages[0], 'stage');
const stageReady: StageRow = must(
  base.stages.find((stage) => stage.name === 'Ready'),
  'Ready stage',
);

const field: FieldDefinitionRow = {
  id: 'f1',
  object: 'lead',
  pipelineId: 'p1',
  key: 'industry',
  label: 'Industry',
  type: 'text',
  options: [],
  description: '',
  example: '',
  position: 0,
  syncId: 2,
  archivedAt: null,
};

const view: SavedViewRow = {
  id: 'v1',
  object: 'lead',
  pipelineId: 'p1',
  name: 'Hot leads',
  filter: emptyFilterGroup(),
  display: {},
  visibility: 'workspace',
  ownerId: 'u1',
  position: 0,
  syncId: 3,
  createdAt: AT,
  updatedAt: AT,
};

function setup(overrides: Partial<Bootstrap> = {}) {
  const client = mutationClient();
  client.setQueryData(
    queryKeys.bootstrap,
    bootstrapFixture({ fields: [field], savedViews: [view], ...overrides }),
  );
  const bootstrap = () => {
    const data = client.getQueryData<Bootstrap>(queryKeys.bootstrap);
    if (data === undefined) throw new Error('The bootstrap is gone.');
    return data;
  };
  return { client, bootstrap };
}

async function send<I>(
  client: QueryClient,
  use: () => { readonly mutate: (input: I) => void },
  input: I,
) {
  const hook = renderHook(use, { wrapper: wrapperFor(client) });
  act(() => {
    hook.result.current.mutate(input);
  });
  await waitFor(() => expect(server.waiting()).toBe(1));
}

function echoOf(model: SyncModel, modelId: string, syncId: number): SyncAction {
  return {
    syncId,
    organizationId: 'o1',
    scopes: ['org:o1'],
    action: 'update',
    model,
    modelId,
    data: {},
    actor: { type: 'user', id: 'u1' },
    at: AT,
  };
}

function expectServed(client: QueryClient, model: SyncModel, id: string, syncId: number): void {
  expect(isSuperseded(echoOf(model, id, syncId), client)).toBe(true);
  expect(isSuperseded(echoOf(model, id, syncId + 1), client)).toBe(false);
}

describe('configuration mutations', () => {
  test('creating a brand places the brand, its pipeline and its stages from one response', async () => {
    const { client, bootstrap } = setup();
    const created: BrandRow = { ...brand, id: 'b2', name: 'Nimbus', syncId: 11 };
    const createdPipeline: PipelineRow = {
      ...pipeline,
      id: 'p2',
      brandId: 'b2',
      key: 'NIM',
      syncId: 12,
    };
    const createdStage: StageRow = { ...stageNew, id: 's-nim', pipelineId: 'p2', syncId: 13 };
    await send(client, useCreateBrand, {
      name: 'Nimbus',
      domain: null,
      color: 'blue',
      pipelineKey: 'NIM',
    });
    expect(server.sent).toEqual([
      {
        path: '/api/brands',
        method: 'POST',
        body: { name: 'Nimbus', domain: null, color: 'blue', pipelineKey: 'NIM' },
      },
    ]);
    server.answer(200, { brand: created, pipeline: createdPipeline, stages: [createdStage] });
    await waitFor(() => expect(bootstrap().brands.map((entry) => entry.id)).toContain('b2'));
    expect(bootstrap().pipelines.map((entry) => entry.id)).toContain('p2');
    expect(bootstrap().stages.map((entry) => entry.id)).toContain('s-nim');
    expectServed(client, 'brand', 'b2', 11);
    expectServed(client, 'pipeline', 'p2', 12);
    expectServed(client, 'stage', 's-nim', 13);
  });

  test('updating a brand shows the patch at once and keeps the server row afterwards', async () => {
    const { client, bootstrap } = setup();
    await send(client, useUpdateBrand, { brand, patch: { name: 'Yodu Labs' } });
    expect(bootstrap().brands[0]?.name).toBe('Yodu Labs');
    expect(server.sent[0]).toMatchObject({
      path: '/api/brands/b1',
      method: 'PATCH',
      body: { name: 'Yodu Labs' },
    });
    server.answer(200, { brand: { ...brand, name: 'Yodu Studio', syncId: 9 } });
    await waitFor(() => expect(bootstrap().brands[0]?.name).toBe('Yodu Studio'));
    expectServed(client, 'brand', 'b1', 9);
  });

  test('archiving a brand takes its pipelines, stages, fields and views with it', async () => {
    const { client, bootstrap } = setup();
    await send(client, useArchiveBrand, brand);
    expect(bootstrap().brands).toEqual([]);
    expect(bootstrap().pipelines).toEqual([]);
    expect(bootstrap().stages).toEqual([]);
    expect(bootstrap().fields).toEqual([]);
    expect(bootstrap().savedViews).toEqual([]);
    server.answer(200, { brand: { ...brand, archivedAt: AT, syncId: 9 } });
    await waitFor(() => expect(isSuperseded(echoOf('brand', 'b1', 9), client)).toBe(true));
    expectServed(client, 'brand', 'b1', 9);
  });

  test('a brand archive the server refuses comes back with its pipelines and says why', async () => {
    const { client, bootstrap } = setup();
    await send(client, useArchiveBrand, brand);
    expect(bootstrap().pipelines).toEqual([]);
    server.answer(409, {
      error: { code: 'conflict', message: 'Close the 4 leads in Yodu first.' },
    });
    await waitFor(() => expect(bootstrap().pipelines).toHaveLength(1));
    expect(bootstrap().stages.length).toBeGreaterThan(0);
    expect(bootstrap().fields).toHaveLength(1);
    expect(bootstrap().savedViews).toHaveLength(1);
    expect(await screen.findByText('Could not archive Yodu')).toBeInTheDocument();
    expect(screen.getByText('Close the 4 leads in Yodu first.')).toBeInTheDocument();
  });

  test('creating a pipeline places it and its stages', async () => {
    const { client, bootstrap } = setup();
    await send(client, useCreatePipeline, {
      brandId: 'b1',
      name: 'Renewals',
      key: 'REN',
      kind: 'deals',
    });
    server.answer(200, {
      pipeline: { ...pipeline, id: 'p3', name: 'Renewals', key: 'REN', kind: 'deals', syncId: 14 },
      stages: [{ ...stageNew, id: 's-ren', pipelineId: 'p3', syncId: 15 }],
    });
    await waitFor(() => expect(bootstrap().pipelines.map((entry) => entry.id)).toContain('p3'));
    expect(bootstrap().stages.map((entry) => entry.id)).toContain('s-ren');
    expectServed(client, 'pipeline', 'p3', 14);
    expectServed(client, 'stage', 's-ren', 15);
  });

  test('updating a pipeline patches at once and records the server row', async () => {
    const { client, bootstrap } = setup();
    await send(client, useUpdatePipeline, { pipeline, patch: { name: 'Outbound' } });
    expect(bootstrap().pipelines[0]?.name).toBe('Outbound');
    server.answer(200, { pipeline: { ...pipeline, name: 'Outbound', syncId: 10 } });
    await waitFor(() => expect(isSuperseded(echoOf('pipeline', 'p1', 10), client)).toBe(true));
    expectServed(client, 'pipeline', 'p1', 10);
  });

  test('archiving a pipeline takes its stages, fields and views with it', async () => {
    const { client, bootstrap } = setup();
    await send(client, useArchivePipeline, pipeline);
    expect(bootstrap().pipelines).toEqual([]);
    expect(bootstrap().stages).toEqual([]);
    expect(bootstrap().fields).toEqual([]);
    expect(bootstrap().savedViews).toEqual([]);
    expect(bootstrap().brands).toHaveLength(1);
    server.answer(200, { pipeline: { ...pipeline, archivedAt: AT, syncId: 10 } });
    await waitFor(() => expect(isSuperseded(echoOf('pipeline', 'p1', 10), client)).toBe(true));
    expectServed(client, 'pipeline', 'p1', 10);
  });

  test('the tab that archived a pipeline drops its closed leads from records, though its echo is skipped', async () => {
    const unregister = registerCrmDeltaHandlers();
    try {
      const { client } = setup();
      const won = leadFixture({ id: 'lw', key: 'YOD-7', stageId: 'won', stageCategory: 'won' });
      const elsewhere = leadFixture({ id: 'lx', key: 'PRT-1', pipelineId: 'p2' });
      client.setQueryData<PersonRecord>(queryKeys.person('per1'), {
        person: personFixture(),
        employments: [],
        leads: [won, elsewhere],
      });
      await send(client, useArchivePipeline, pipeline);
      const archived = { ...pipeline, archivedAt: AT, syncId: 10 };
      server.answer(200, { pipeline: archived });
      await waitFor(() => expect(isSuperseded(echoOf('pipeline', 'p1', 10), client)).toBe(true));
      applyDelta({ ...echoOf('pipeline', 'p1', 10), action: 'archive', data: archived }, client);
      const record = client.getQueryData<PersonRecord>(queryKeys.person('per1'));
      expect(record?.leads.map((lead) => lead.id)).toEqual(['lx']);
    } finally {
      unregister();
    }
  });

  test('a workspace wide field outlives an archived pipeline', async () => {
    const wide: FieldDefinitionRow = { ...field, id: 'f2', pipelineId: null };
    const { client, bootstrap } = setup({ fields: [field, wide] });
    await send(client, useArchivePipeline, pipeline);
    expect(bootstrap().fields.map((entry) => entry.id)).toEqual(['f2']);
    server.answer(200, { pipeline: { ...pipeline, archivedAt: AT, syncId: 10 } });
    await waitFor(() => expect(isSuperseded(echoOf('pipeline', 'p1', 10), client)).toBe(true));
  });

  test('creating a stage places the server row and records it', async () => {
    const { client, bootstrap } = setup();
    await send(client, useCreateStage, { pipelineId: 'p1', name: 'Nurture', category: 'open' });
    server.answer(200, {
      stage: { ...stageNew, id: 's-nur', name: 'Nurture', sortOrder: 13, syncId: 16 },
    });
    await waitFor(() => expect(bootstrap().stages.map((entry) => entry.id)).toContain('s-nur'));
    expectServed(client, 'stage', 's-nur', 16);
  });

  test('updating a stage patches at once, records the server row, and rolls back when refused', async () => {
    const { client, bootstrap } = setup();
    const nameOf = () => bootstrap().stages.find((entry) => entry.id === stageReady.id)?.name;
    await send(client, useUpdateStage, { stage: stageReady, patch: { name: 'Prepared' } });
    expect(nameOf()).toBe('Prepared');
    server.answer(200, { stage: { ...stageReady, name: 'Prepared', syncId: 17 } });
    await waitFor(() =>
      expect(isSuperseded(echoOf('stage', stageReady.id, 17), client)).toBe(true),
    );
    expectServed(client, 'stage', stageReady.id, 17);

    await send(client, useUpdateStage, { stage: stageReady, patch: { category: 'lost' } });
    server.answer(422, { error: { code: 'invalid', message: 'Not that.' } });
    await waitFor(() => expect(nameOf()).toBe('Prepared'));
    expect(bootstrap().stages.find((entry) => entry.id === stageReady.id)?.category).toBe('open');
  });

  test('reordering sets the order at once and keeps the server rows afterwards', async () => {
    const { client, bootstrap } = setup();
    const ids = base.stages.map((stage) => stage.id);
    const reversed = [...ids].reverse();
    await send(client, () => useReorderStages('p1'), { pipelineId: 'p1', stageIds: reversed });
    const orderOf = (id: string) => bootstrap().stages.find((entry) => entry.id === id)?.sortOrder;
    expect(orderOf(must(reversed[0], 'first id'))).toBe(0);
    expect(orderOf(must(ids[0], 'last id'))).toBe(ids.length - 1);
    expect(server.sent[0]).toMatchObject({
      path: '/api/stages/reorder',
      body: { pipelineId: 'p1', stageIds: reversed },
    });
    server.answer(200, {
      stages: base.stages.map((stage) => ({
        ...stage,
        sortOrder: reversed.indexOf(stage.id),
        syncId: 20,
      })),
    });
    await waitFor(() =>
      expect(bootstrap().stages.every((entry) => entry.syncId === 20)).toBe(true),
    );
    expectServed(client, 'stage', must(ids[0], 'stage id'), 20);
    expectServed(client, 'stage', must(ids[5], 'stage id'), 20);
  });

  test('archiving a stage removes it and records the server row', async () => {
    const { client, bootstrap } = setup();
    await send(client, useArchiveStage, stageReady);
    expect(bootstrap().stages.map((entry) => entry.id)).not.toContain(stageReady.id);
    server.answer(200, { stage: { ...stageReady, archivedAt: AT, syncId: 18 } });
    await waitFor(() =>
      expect(isSuperseded(echoOf('stage', stageReady.id, 18), client)).toBe(true),
    );
    expectServed(client, 'stage', stageReady.id, 18);
  });

  test('creating a field places the server row and records it', async () => {
    const { client, bootstrap } = setup();
    await send(client, useCreateField, {
      object: 'person',
      pipelineId: null,
      key: 'timezone',
      label: 'Timezone',
      type: 'text',
      options: [],
    });
    server.answer(200, {
      field: {
        ...field,
        id: 'f7',
        object: 'person',
        pipelineId: null,
        key: 'timezone',
        syncId: 21,
      },
    });
    await waitFor(() => expect(bootstrap().fields.map((entry) => entry.id)).toContain('f7'));
    expectServed(client, 'field_definition', 'f7', 21);
  });

  test('updating and archiving a field patch at once and record the server row', async () => {
    const { client, bootstrap } = setup();
    await send(client, useUpdateField, { field, patch: { label: 'Sector' } });
    expect(bootstrap().fields[0]?.label).toBe('Sector');
    server.answer(200, { field: { ...field, label: 'Sector', syncId: 22 } });
    await waitFor(() =>
      expect(isSuperseded(echoOf('field_definition', 'f1', 22), client)).toBe(true),
    );
    expectServed(client, 'field_definition', 'f1', 22);

    await send(client, useArchiveField, field);
    expect(bootstrap().fields).toEqual([]);
    server.answer(200, { field: { ...field, archivedAt: AT, syncId: 23 } });
    await waitFor(() =>
      expect(isSuperseded(echoOf('field_definition', 'f1', 23), client)).toBe(true),
    );
    expectServed(client, 'field_definition', 'f1', 23);
  });

  test('a second reorder of the same pipeline waits for the first, and other pipelines do not', async () => {
    const { client, bootstrap } = setup();
    const ids = base.stages.map((stage) => stage.id);
    const first = [...ids].reverse();
    const second = [...ids].sort();
    await send(client, () => useReorderStages('p1'), { pipelineId: 'p1', stageIds: first });
    const again = renderHook(() => useReorderStages('p1'), { wrapper: wrapperFor(client) });
    act(() => {
      again.result.current.mutate({ pipelineId: 'p1', stageIds: second });
    });
    await waitFor(() =>
      expect(bootstrap().stages.find((entry) => entry.id === second[0])?.sortOrder).toBe(0),
    );
    expect(server.waiting()).toBe(1);
    expect(server.sent).toHaveLength(1);
    server.answer(200, { stages: [] });
    await waitFor(() => expect(server.sent).toHaveLength(2));
    expect(server.sent[1]).toMatchObject({ body: { pipelineId: 'p1', stageIds: second } });
    server.answer(200, { stages: [] });

    const other = renderHook(() => useReorderStages('p2'), { wrapper: wrapperFor(client) });
    act(() => {
      other.result.current.mutate({ pipelineId: 'p2', stageIds: ['x'] });
    });
    await waitFor(() => expect(server.sent).toHaveLength(3));
    server.answer(200, { stages: [] });
  });

  test('unarchiving a stage shows it at once, keeps the server row, and a refusal takes it away again', async () => {
    const archived: StageRow = { ...stageReady, archivedAt: AT, syncId: 30 };
    const { client, bootstrap } = setup({
      stages: base.stages.filter((entry) => entry.id !== stageReady.id),
    });
    await send(client, useUnarchiveStage, archived);
    expect(bootstrap().stages.map((entry) => entry.id)).toContain(stageReady.id);
    expect(bootstrap().stages.find((entry) => entry.id === stageReady.id)?.archivedAt).toBeNull();
    expect(server.sent[0]).toMatchObject({
      path: `/api/stages/${stageReady.id}/unarchive`,
      method: 'POST',
    });
    server.answer(200, { stage: { ...stageReady, syncId: 31 } });
    await waitFor(() =>
      expect(isSuperseded(echoOf('stage', stageReady.id, 31), client)).toBe(true),
    );
    expectServed(client, 'stage', stageReady.id, 31);

    const second = setup({ stages: base.stages.filter((entry) => entry.id !== stageReady.id) });
    await send(second.client, useUnarchiveStage, archived);
    server.answer(404, { error: { code: 'not_found', message: 'That pipeline does not exist.' } });
    await waitFor(() =>
      expect(second.bootstrap().stages.map((entry) => entry.id)).not.toContain(stageReady.id),
    );
    expect(await screen.findByText('Could not restore Ready')).toBeInTheDocument();
  });

  test('unarchiving a field shows it at once and records the server row', async () => {
    const archived: FieldDefinitionRow = { ...field, archivedAt: AT, syncId: 40 };
    const { client, bootstrap } = setup({ fields: [] });
    await send(client, useUnarchiveField, archived);
    expect(bootstrap().fields.map((entry) => entry.id)).toEqual(['f1']);
    expect(server.sent[0]).toMatchObject({ path: '/api/fields/f1/unarchive', method: 'POST' });
    server.answer(200, { field: { ...field, syncId: 41 } });
    await waitFor(() =>
      expect(isSuperseded(echoOf('field_definition', 'f1', 41), client)).toBe(true),
    );
    expectServed(client, 'field_definition', 'f1', 41);
  });
});
