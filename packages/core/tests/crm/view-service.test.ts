import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, schema } from '@gravity/db';
import { containsCondition } from '@gravity/shared/filters';
import type { Principal } from '@gravity/shared/policy';
import { randomUUIDv7 } from '@gravity/shared/utils';
import { archiveBrand, createBrand } from '../../src/crm/brand-service.ts';
import { createFieldDefinition } from '../../src/crm/field-service.ts';
import { archivePipeline } from '../../src/crm/pipeline-service.ts';
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  updateSavedView,
} from '../../src/crm/view-service.ts';
import { readOutboxSince } from '../../src/realtime/outbox.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import {
  addMember,
  createMemberPrincipal,
  createWorkspace,
  refusal,
  resetDatabase,
  type TestWorkspace,
} from '../../src/test-support.ts';

let workspace: TestWorkspace;
let teammate: Principal;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
  teammate = await addMember(workspace, 'Tess', 'member');
});

afterAll(async () => {
  await closeRealtime();
});

describe('saved views', () => {
  test('a private view reaches its owner alone', async () => {
    const created = await createSavedView(
      { principal: teammate },
      { object: 'person', name: 'Mine' },
    );
    expect(created.actions[0]?.scopes).toEqual([`user:${teammate.userId}`]);
    expect((await listSavedViews(workspace.admin)).map((view) => view.name)).toEqual([]);
    expect((await listSavedViews(teammate)).map((view) => view.name)).toEqual(['Mine']);
  });

  test('a workspace view reaches everyone', async () => {
    const created = await createSavedView(
      { principal: teammate },
      { object: 'company', name: 'Shared', visibility: 'workspace' },
    );
    expect(created.actions[0]?.scopes).toEqual([`workspace:${workspace.organizationId}`]);
    expect((await listSavedViews(workspace.admin)).map((view) => view.name)).toEqual(['Shared']);
  });

  test('only the owner touches a private view and only the owner or an admin a shared one', async () => {
    const mine = await createSavedView({ principal: teammate }, { object: 'person', name: 'Mine' });
    await expect(
      updateSavedView({ principal: workspace.admin }, mine.view.id, { name: 'X' }),
    ).rejects.toThrow('That view does not exist.');
    await expect(deleteSavedView({ principal: workspace.admin }, mine.view.id)).rejects.toThrow(
      'That view does not exist.',
    );
    const shared = await createSavedView(
      { principal: workspace.admin },
      { object: 'person', name: 'Team', visibility: 'workspace' },
    );
    await expect(
      updateSavedView({ principal: teammate }, shared.view.id, { name: 'X' }),
    ).rejects.toThrow('Only the owner or an admin can change a shared view.');
    const renamed = await updateSavedView({ principal: workspace.admin }, shared.view.id, {
      name: 'Team view',
    });
    expect(renamed.view.name).toBe('Team view');
  });

  test('narrowing a shared view tells the workspace to drop it', async () => {
    const shared = await createSavedView(
      { principal: workspace.admin },
      { object: 'person', name: 'Team', visibility: 'workspace' },
    );
    const narrowed = await updateSavedView({ principal: workspace.admin }, shared.view.id, {
      visibility: 'private',
    });
    expect(narrowed.actions.map((action) => [action.action, action.scopes])).toEqual([
      ['delete', [`workspace:${workspace.organizationId}`]],
      ['update', [`user:${workspace.admin.userId}`]],
    ]);
    const [removal, update] = narrowed.actions;
    expect(removal?.syncId).toBeLessThan(update?.syncId ?? 0);
    expect(await listSavedViews(teammate)).toHaveLength(0);
  });

  test('a teammate catching up after a narrowing gets the delete and never the private update', async () => {
    const shared = await createSavedView(
      { principal: workspace.admin },
      { object: 'person', name: 'Team', visibility: 'workspace' },
    );
    const narrowed = await updateSavedView({ principal: workspace.admin }, shared.view.id, {
      visibility: 'private',
    });
    const reader = {
      organizationId: workspace.organizationId,
      userId: teammate.userId,
    };
    const fromStart = await readOutboxSince(reader, 0, 50);
    const seen = fromStart.actions.filter((action) => action.model === 'saved_view');
    expect(seen.map((action) => action.action)).toEqual(['insert', 'delete']);
    const afterCreate = await readOutboxSince(reader, shared.view.syncId, 50);
    expect(afterCreate.actions.map((action) => [action.action, action.model])).toEqual([
      ['delete', 'saved_view'],
    ]);
    const privateUpdate = narrowed.actions.find((action) => action.action === 'update');
    const reached = [...fromStart.actions, ...afterCreate.actions].map((action) => action.syncId);
    expect(reached).not.toContain(privateUpdate?.syncId);
    const owner = await readOutboxSince(
      { organizationId: workspace.organizationId, userId: workspace.admin.userId },
      shared.view.syncId,
      50,
    );
    expect(owner.actions.map((action) => action.action)).toEqual(['delete', 'update']);
  });

  test('refuses a filter on an unknown property and a pipeline on a person view', async () => {
    const filter = {
      kind: 'group',
      combinator: 'and',
      children: [{ kind: 'condition', property: 'ghost', operator: 'in', values: ['x'] }],
    };
    await expect(
      createSavedView({ principal: teammate }, { object: 'person', name: 'Bad', filter }),
    ).rejects.toThrow('There is no person filter called ghost.');
    await expect(
      createSavedView({ principal: teammate }, { object: 'person', name: 'Bad', pipelineId: 'p1' }),
    ).rejects.toThrow('Only lead views belong to a pipeline.');
  });

  test('a lead view is checked against its pipeline and a foreign pipeline is refused', async () => {
    const yodu = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
    const other = await createBrand({ principal: workspace.admin }, { name: 'Orbit' });
    await createFieldDefinition(
      { principal: workspace.admin },
      { object: 'lead', pipelineId: yodu.pipeline.id, key: 'tier', label: 'Tier', type: 'text' },
    );
    const filter = {
      kind: 'group',
      combinator: 'and',
      children: [containsCondition('fields.tier', 'gold')],
    };
    const created = await createSavedView(
      { principal: teammate },
      { object: 'lead', name: 'Gold', pipelineId: yodu.pipeline.id, filter },
    );
    expect(created.view.pipelineId).toBe(yodu.pipeline.id);
    await expect(
      createSavedView(
        { principal: teammate },
        { object: 'lead', name: 'Gold', pipelineId: other.pipeline.id, filter },
      ),
    ).rejects.toThrow('There is no lead filter called fields.tier.');
    const foreign = await createWorkspace('Rival');
    const foreignBrand = await createBrand({ principal: foreign.admin }, { name: 'Rival' });
    const refused = await refusal(
      createSavedView(
        { principal: teammate },
        { object: 'lead', name: 'Nope', pipelineId: foreignBrand.pipeline.id },
      ),
    );
    expect(refused.status).toBe(404);
    expect(await listSavedViews(teammate)).toHaveLength(1);
  });

  test('an update re-checks the filter against the view and its pipeline', async () => {
    const created = await createSavedView(
      { principal: teammate },
      { object: 'company', name: 'Co' },
    );
    const filter = {
      kind: 'group',
      combinator: 'and',
      children: [{ kind: 'condition', property: 'ghost', operator: 'in', values: ['x'] }],
    };
    await expect(
      updateSavedView({ principal: teammate }, created.view.id, { filter }),
    ).rejects.toThrow('There is no company filter called ghost.');
    const good = await updateSavedView({ principal: teammate }, created.view.id, {
      filter: { kind: 'group', combinator: 'and', children: [containsCondition('name', 'ac')] },
    });
    expect(good.view.filter.children).toHaveLength(1);
    expect(good.view.syncId).toBeGreaterThan(created.view.syncId);
  });

  test('widening a private view reaches the workspace and deleting follows its audience', async () => {
    const created = await createSavedView(
      { principal: teammate },
      { object: 'person', name: 'Mine' },
    );
    const widened = await updateSavedView({ principal: teammate }, created.view.id, {
      visibility: 'workspace',
    });
    expect(widened.actions.map((action) => [action.action, action.scopes])).toEqual([
      ['update', [`workspace:${workspace.organizationId}`]],
    ]);
    expect((await listSavedViews(workspace.admin)).map((view) => view.name)).toEqual(['Mine']);
    const removed = await deleteSavedView({ principal: workspace.admin }, created.view.id);
    expect(removed.actions.map((action) => [action.action, action.scopes])).toEqual([
      ['delete', [`workspace:${workspace.organizationId}`]],
    ]);
    const private_ = await createSavedView(
      { principal: teammate },
      { object: 'person', name: 'Own' },
    );
    const gone = await deleteSavedView({ principal: teammate }, private_.view.id);
    expect(gone.actions[0]?.scopes).toEqual([`user:${teammate.userId}`]);
    expect(await listSavedViews(teammate)).toHaveLength(0);
  });

  test('a duplicate client id is a 409 and creates nothing', async () => {
    const id = randomUUIDv7();
    await createSavedView({ principal: teammate }, { id, object: 'person', name: 'One' });
    const refused = await refusal(
      createSavedView({ principal: workspace.admin }, { id, object: 'company', name: 'Two' }),
    );
    expect(refused).toMatchObject({ status: 409, message: 'That id is already in use.' });
    expect(await db.select().from(schema.savedView)).toHaveLength(1);
    expect(await listSavedViews(workspace.admin)).toHaveLength(0);
  });

  test('a view from another workspace is invisible and a guest cannot write', async () => {
    const created = await createSavedView(
      { principal: workspace.admin },
      { object: 'person', name: 'Team', visibility: 'workspace' },
    );
    const foreign = await createWorkspace('Rival');
    expect(await listSavedViews(foreign.admin)).toHaveLength(0);
    const refused = await refusal(
      updateSavedView({ principal: foreign.admin }, created.view.id, { name: 'Mine now' }),
    );
    expect(refused.status).toBe(404);
    const guest = await createMemberPrincipal(workspace, 'guest');
    const denied = await refusal(
      createSavedView({ principal: guest }, { object: 'person', name: 'X' }),
    );
    expect(denied.status).toBe(403);
    expect((await listSavedViews(guest)).map((view) => view.name)).toEqual(['Team']);
  });

  test('a new view goes after the highest position, even once an earlier view is deleted', async () => {
    const first = await createSavedView({ principal: teammate }, { object: 'person', name: 'A' });
    const second = await createSavedView({ principal: teammate }, { object: 'person', name: 'B' });
    await deleteSavedView({ principal: teammate }, first.view.id);
    const third = await createSavedView({ principal: teammate }, { object: 'person', name: 'C' });
    expect([first.view.position, second.view.position, third.view.position]).toEqual([0, 1, 2]);
    expect((await listSavedViews(teammate)).map((view) => view.name)).toEqual(['B', 'C']);
  });

  test('views sharing a position list by name, then id', async () => {
    const ids = ['00000000-0000-7000-8000-000000000002', '00000000-0000-7000-8000-000000000001'];
    for (const [index, id] of ids.entries()) {
      await db.insert(schema.savedView).values({
        id,
        organizationId: workspace.organizationId,
        object: 'person',
        name: 'Same',
        ownerId: teammate.userId,
        position: 5,
        syncId: index + 1,
      });
    }
    await db.insert(schema.savedView).values({
      id: '00000000-0000-7000-8000-000000000003',
      organizationId: workspace.organizationId,
      object: 'person',
      name: 'Alpha',
      ownerId: teammate.userId,
      position: 5,
      syncId: 3,
    });
    expect((await listSavedViews(teammate)).map((view) => view.id)).toEqual([
      '00000000-0000-7000-8000-000000000003',
      '00000000-0000-7000-8000-000000000001',
      '00000000-0000-7000-8000-000000000002',
    ]);
  });

  test('lists views in position order and numbers each owner from zero', async () => {
    await createSavedView({ principal: teammate }, { object: 'person', name: 'B' });
    const second = await createSavedView({ principal: teammate }, { object: 'person', name: 'A' });
    const first = await createSavedView(
      { principal: workspace.admin },
      { object: 'person', name: 'Z', visibility: 'workspace' },
    );
    expect(first.view.position).toBe(0);
    expect(second.view.position).toBe(1);
    expect((await listSavedViews(teammate)).map((view) => view.name)).toEqual(['B', 'Z', 'A']);
  });
});

describe('saved views of an archived pipeline', () => {
  async function viewsOnPipeline(pipelineId: string) {
    const mine = await createSavedView(
      { principal: teammate },
      { object: 'lead', name: 'Mine', pipelineId },
    );
    const shared = await createSavedView(
      { principal: workspace.admin },
      { object: 'lead', name: 'Team', pipelineId, visibility: 'workspace' },
    );
    const person = await createSavedView(
      { principal: workspace.admin },
      { object: 'person', name: 'People', visibility: 'workspace' },
    );
    return { mine, shared, person };
  }

  test('archiving a pipeline drops its views from the list and tells their audiences', async () => {
    const brand = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
    const { mine, shared } = await viewsOnPipeline(brand.pipeline.id);
    const archived = await archivePipeline({ principal: workspace.admin }, brand.pipeline.id);
    const removals = archived.actions.filter((action) => action.model === 'saved_view');
    expect(removals).toHaveLength(2);
    const removalOf = (id: string) => removals.find((action) => action.modelId === id);
    expect(removalOf(mine.view.id)).toMatchObject({
      action: 'delete',
      data: { id: mine.view.id },
      scopes: [`user:${teammate.userId}`],
    });
    expect(removalOf(shared.view.id)).toMatchObject({
      action: 'delete',
      data: { id: shared.view.id },
      scopes: [`workspace:${workspace.organizationId}`],
    });
    expect((await listSavedViews(teammate)).map((view) => view.name)).toEqual(['People']);
    expect((await listSavedViews(workspace.admin)).map((view) => view.name)).toEqual(['People']);
  });

  test('archiving a brand does the same for every pipeline under it', async () => {
    const brand = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
    const { mine, shared } = await viewsOnPipeline(brand.pipeline.id);
    const archived = await archiveBrand({ principal: workspace.admin }, brand.brand.id);
    const removed = archived.actions
      .filter((action) => action.model === 'saved_view')
      .map((action) => action.modelId)
      .sort();
    expect(removed).toEqual([mine.view.id, shared.view.id].sort());
    expect((await listSavedViews(teammate)).map((view) => view.name)).toEqual(['People']);
  });

  test('a view on a live pipeline is untouched by archiving another', async () => {
    const yodu = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
    const orbit = await createBrand({ principal: workspace.admin }, { name: 'Orbit' });
    await createSavedView(
      { principal: teammate },
      { object: 'lead', name: 'Orbit view', pipelineId: orbit.pipeline.id },
    );
    const archived = await archivePipeline({ principal: workspace.admin }, yodu.pipeline.id);
    expect(archived.actions.filter((action) => action.model === 'saved_view')).toHaveLength(0);
    expect((await listSavedViews(teammate)).map((view) => view.name)).toEqual(['Orbit view']);
  });
});
