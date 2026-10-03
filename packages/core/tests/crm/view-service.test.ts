import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { containsCondition } from '@gravity/shared/filters';
import type { Principal } from '@gravity/shared/policy';
import { createBrand } from '../../src/crm/brand-service.ts';
import { createFieldDefinition } from '../../src/crm/field-service.ts';
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  updateSavedView,
} from '../../src/crm/view-service.ts';
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
    expect(await listSavedViews(teammate)).toHaveLength(0);
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
