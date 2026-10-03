import { and, asc, db, eq, isNull, or, schema, sql } from '@gravity/db';
import type { SavedViewObject } from '@gravity/shared/constants';
import { forbidden, notFound, validationFailed } from '@gravity/shared/errors';
import { scopes } from '@gravity/shared/events';
import {
  assertFilterFits,
  companyFilterRegistry,
  type FilterGroup,
  leadFilterRegistry,
  personFilterRegistry,
} from '@gravity/shared/filters';
import type { Principal } from '@gravity/shared/policy';
import { assertCan, can } from '@gravity/shared/policy';
import type { SavedViewRow } from '@gravity/shared/records';
import { savedViewCreateSchema, savedViewUpdateSchema } from '@gravity/shared/validators';
import { type Executor, newId, requireRow } from '../internal.ts';
import { asConflict } from './conflicts.ts';
import { loadFieldDefinitions } from './field-service.ts';
import { livePipeline } from './lookups.ts';
import { savedViewRowOf } from './rows.ts';
import { type SyncBatch, type WithActions, withBatch } from './sync-batch.ts';
import type { WriteContext } from './write-context.ts';

export function viewScopes(
  organizationId: string,
  view: { visibility: string; ownerId: string },
): string[] {
  return view.visibility === 'workspace'
    ? [scopes.workspace(organizationId)]
    : [scopes.user(view.ownerId)];
}

async function assertViewFilter(
  executor: Executor,
  organizationId: string,
  object: SavedViewObject,
  pipelineId: string | null,
  filter: FilterGroup,
): Promise<void> {
  if (object === 'lead') {
    const definitions = await loadFieldDefinitions(executor, organizationId, 'lead', pipelineId);
    assertFilterFits(filter, leadFilterRegistry(definitions, pipelineId));
    return;
  }
  if (object === 'person') {
    assertFilterFits(
      filter,
      personFilterRegistry(await loadFieldDefinitions(executor, organizationId, 'person', null)),
    );
    return;
  }
  assertFilterFits(
    filter,
    companyFilterRegistry(await loadFieldDefinitions(executor, organizationId, 'company', null)),
  );
}

async function editableView(batch: SyncBatch, viewId: string) {
  const principal = batch.context.principal;
  const [row] = await batch.tx
    .select()
    .from(schema.savedView)
    .where(
      and(
        eq(schema.savedView.id, viewId),
        eq(schema.savedView.organizationId, batch.organizationId),
      ),
    )
    .limit(1)
    .for('update');
  if (row === undefined || (row.visibility === 'private' && row.ownerId !== principal.userId)) {
    throw notFound('That view does not exist.');
  }
  if (row.ownerId !== principal.userId && !can(principal, 'workspace:manage')) {
    throw forbidden('Only the owner or an admin can change a shared view.');
  }
  return row;
}

export async function createSavedView(
  context: WriteContext,
  input: unknown,
): Promise<WithActions<{ view: SavedViewRow }>> {
  assertCan(context.principal, 'view:manage');
  const parsed = savedViewCreateSchema.parse(input);
  if (parsed.object !== 'lead' && parsed.pipelineId !== null) {
    throw validationFailed('Only lead views belong to a pipeline.');
  }
  try {
    return await withBatch(context, async (batch) => {
      if (parsed.pipelineId !== null) {
        await livePipeline(batch.tx, batch.organizationId, parsed.pipelineId, true);
      }
      await assertViewFilter(
        batch.tx,
        batch.organizationId,
        parsed.object,
        parsed.pipelineId,
        parsed.filter,
      );
      const [last] = await batch.tx
        .select({ position: sql<number>`coalesce(max(${schema.savedView.position}), -1)` })
        .from(schema.savedView)
        .where(
          and(
            eq(schema.savedView.organizationId, batch.organizationId),
            eq(schema.savedView.ownerId, context.principal.userId),
          ),
        );
      const syncId = await batch.nextSyncId();
      const [row] = await batch.tx
        .insert(schema.savedView)
        .values({
          id: parsed.id ?? newId(),
          organizationId: batch.organizationId,
          object: parsed.object,
          pipelineId: parsed.pipelineId,
          name: parsed.name,
          filter: { ...parsed.filter },
          display: parsed.display,
          visibility: parsed.visibility,
          ownerId: context.principal.userId,
          position: (last?.position ?? -1) + 1,
          syncId,
        })
        .returning();
      const view = savedViewRowOf(requireRow(row, 'The view could not be saved.'));
      batch.emit({
        syncId,
        action: 'insert',
        model: 'saved_view',
        modelId: view.id,
        data: view,
        scopes: viewScopes(batch.organizationId, view),
      });
      return { view };
    });
  } catch (error: unknown) {
    throw asConflict(error);
  }
}

export async function updateSavedView(
  context: WriteContext,
  viewId: string,
  input: unknown,
): Promise<WithActions<{ view: SavedViewRow }>> {
  assertCan(context.principal, 'view:manage');
  const parsed = savedViewUpdateSchema.parse(input);
  return await withBatch(context, async (batch) => {
    const current = await editableView(batch, viewId);
    if (parsed.filter !== undefined) {
      await assertViewFilter(
        batch.tx,
        batch.organizationId,
        savedViewRowOf(current).object,
        current.pipelineId,
        parsed.filter,
      );
    }
    const narrowed = current.visibility === 'workspace' && parsed.visibility === 'private';
    if (narrowed) {
      batch.emit({
        syncId: await batch.nextSyncId(),
        action: 'delete',
        model: 'saved_view',
        modelId: viewId,
        data: { id: viewId },
        scopes: [scopes.workspace(batch.organizationId)],
      });
    }
    const syncId = await batch.nextSyncId();
    const [row] = await batch.tx
      .update(schema.savedView)
      .set({
        ...(parsed.name === undefined ? {} : { name: parsed.name }),
        ...(parsed.filter === undefined ? {} : { filter: { ...parsed.filter } }),
        ...(parsed.display === undefined ? {} : { display: parsed.display }),
        ...(parsed.visibility === undefined ? {} : { visibility: parsed.visibility }),
        syncId,
        updatedAt: new Date(),
      })
      .where(eq(schema.savedView.id, viewId))
      .returning();
    const view = savedViewRowOf(requireRow(row, 'That view does not exist.'));
    batch.emit({
      syncId,
      action: 'update',
      model: 'saved_view',
      modelId: view.id,
      data: view,
      scopes: viewScopes(batch.organizationId, view),
    });
    return { view };
  });
}

export async function deleteSavedView(
  context: WriteContext,
  viewId: string,
): Promise<WithActions<{ id: string }>> {
  assertCan(context.principal, 'view:manage');
  return await withBatch(context, async (batch) => {
    const current = await editableView(batch, viewId);
    const syncId = await batch.nextSyncId();
    await batch.tx.delete(schema.savedView).where(eq(schema.savedView.id, viewId));
    batch.emit({
      syncId,
      action: 'delete',
      model: 'saved_view',
      modelId: viewId,
      data: { id: viewId },
      scopes: viewScopes(batch.organizationId, current),
    });
    return { id: viewId };
  });
}

export async function listSavedViews(principal: Principal): Promise<SavedViewRow[]> {
  assertCan(principal, 'record:read');
  const rows = await db
    .select({ view: schema.savedView })
    .from(schema.savedView)
    .leftJoin(schema.pipeline, eq(schema.pipeline.id, schema.savedView.pipelineId))
    .where(
      and(
        eq(schema.savedView.organizationId, principal.organizationId),
        isNull(schema.pipeline.archivedAt),
        or(
          eq(schema.savedView.visibility, 'workspace'),
          eq(schema.savedView.ownerId, principal.userId),
        ),
      ),
    )
    .orderBy(asc(schema.savedView.position), asc(schema.savedView.name), asc(schema.savedView.id));
  return rows.map((row) => savedViewRowOf(row.view));
}

export async function dropViewsOfPipelineIn(batch: SyncBatch, pipelineId: string): Promise<void> {
  const views = await batch.tx
    .select()
    .from(schema.savedView)
    .where(
      and(
        eq(schema.savedView.pipelineId, pipelineId),
        eq(schema.savedView.organizationId, batch.organizationId),
      ),
    )
    .orderBy(asc(schema.savedView.position), asc(schema.savedView.id));
  for (const view of views) {
    batch.emit({
      syncId: await batch.nextSyncId(),
      action: 'delete',
      model: 'saved_view',
      modelId: view.id,
      data: { id: view.id },
      scopes: viewScopes(batch.organizationId, view),
    });
  }
}
