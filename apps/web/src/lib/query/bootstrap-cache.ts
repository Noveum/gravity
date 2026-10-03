import type { SyncAction } from '@gravity/shared/events';
import { policyRole } from '@gravity/shared/policy';
import {
  brandRowSchema,
  fieldDefinitionRowSchema,
  pipelineRowSchema,
  savedViewRowSchema,
  stageRowSchema,
} from '@gravity/shared/records';
import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { BOOTSTRAP_ROOT, queryKeys } from './keys.ts';
import type { Bootstrap } from './schemas.ts';

interface Versioned {
  readonly id: string;
  readonly syncId: number;
  readonly archivedAt?: string | null;
}

export function upsertById<T extends { readonly id: string }>(list: readonly T[], row: T): T[] {
  const index = list.findIndex((entry) => entry.id === row.id);
  return index === -1 ? [...list, row] : list.with(index, row);
}

export function withoutId<T extends { readonly id: string }>(list: readonly T[], id: string): T[] {
  return list.filter((entry) => entry.id !== id);
}

export function patchBootstrap(
  client: QueryClient,
  update: (bootstrap: Bootstrap) => Bootstrap,
): void {
  const current = client.getQueryData<Bootstrap>(queryKeys.bootstrap);
  if (current === undefined) return;
  const next = update(current);
  if (next !== current) client.setQueryData<Bootstrap>(queryKeys.bootstrap, next);
}

function refetchBootstrap(client: QueryClient): void {
  client.invalidateQueries({ queryKey: [BOOTSTRAP_ROOT] }).catch(() => undefined);
}

interface BootstrapPatch {
  readonly client: QueryClient;
  readable: boolean;
}

function unreadable(patch: BootstrapPatch, action: SyncAction): void {
  patch.readable = false;
  console.warn(`Ignored a ${action.model} update for ${action.modelId} it could not read.`);
  refetchBootstrap(patch.client);
}

function removes(action: SyncAction): boolean {
  return (
    action.action === 'archive' ||
    action.action === 'delete' ||
    typeof action.data['archivedAt'] === 'string'
  );
}

function withoutPipelines(bootstrap: Bootstrap, pipelineIds: readonly string[]): Bootstrap {
  if (pipelineIds.length === 0) return bootstrap;
  const gone = (pipelineId: string | null) =>
    pipelineId !== null && pipelineIds.includes(pipelineId);
  return {
    ...bootstrap,
    pipelines: bootstrap.pipelines.filter((pipeline) => !gone(pipeline.id)),
    stages: bootstrap.stages.filter((stage) => !gone(stage.pipelineId)),
    fields: bootstrap.fields.filter((field) => !gone(field.pipelineId)),
    savedViews: bootstrap.savedViews.filter((view) => !gone(view.pipelineId)),
  };
}

function applyPipeline(patch: BootstrapPatch, bootstrap: Bootstrap, action: SyncAction): Bootstrap {
  const next = {
    ...bootstrap,
    pipelines: applyRow(patch, bootstrap.pipelines, action, pipelineRowSchema),
  };
  return removes(action) ? withoutPipelines(next, [action.modelId]) : next;
}

function applyBrand(patch: BootstrapPatch, bootstrap: Bootstrap, action: SyncAction): Bootstrap {
  const next = { ...bootstrap, brands: applyRow(patch, bootstrap.brands, action, brandRowSchema) };
  if (!removes(action)) return next;
  const pipelineIds = next.pipelines
    .filter((pipeline) => pipeline.brandId === action.modelId)
    .map((pipeline) => pipeline.id);
  return withoutPipelines(next, pipelineIds);
}

function applyRow<T extends Versioned>(
  patch: BootstrapPatch,
  list: T[],
  action: SyncAction,
  schema: z.ZodType<T>,
): T[] {
  if (action.action === 'delete' || action.action === 'archive') {
    return withoutId(list, action.modelId);
  }
  const parsed = schema.safeParse(action.data);
  if (!parsed.success) {
    unreadable(patch, action);
    return list;
  }
  const row = parsed.data;
  if ((row.archivedAt ?? null) !== null) return withoutId(list, row.id);
  const existing = list.find((entry) => entry.id === row.id);
  if (existing !== undefined && existing.syncId > row.syncId) return list;
  return upsertById(list, row);
}

const memberPatchSchema = z.object({ id: z.string(), role: z.string(), syncId: z.number() });

const organizationPatchSchema = z.object({ name: z.string() });

function applyMember(patch: BootstrapPatch, bootstrap: Bootstrap, action: SyncAction): Bootstrap {
  if (action.action === 'delete') {
    return {
      ...bootstrap,
      members: bootstrap.members.filter((member) => member.memberId !== action.modelId),
    };
  }
  const parsed = memberPatchSchema.safeParse(action.data);
  if (!parsed.success) {
    unreadable(patch, action);
    return bootstrap;
  }
  const known = bootstrap.members.find((member) => member.memberId === action.modelId);
  if (known === undefined) {
    refetchBootstrap(patch.client);
    return bootstrap;
  }
  if (known.syncId > parsed.data.syncId) return bootstrap;
  const role = policyRole(parsed.data.role);
  return {
    ...bootstrap,
    me: known.userId === bootstrap.me.userId ? { ...bootstrap.me, role } : bootstrap.me,
    members: bootstrap.members.map((member) =>
      member.memberId === known.memberId ? { ...member, role, syncId: parsed.data.syncId } : member,
    ),
  };
}

export function applyBootstrapDelta(client: QueryClient, action: SyncAction): boolean {
  const patch: BootstrapPatch = { client, readable: true };
  patchBootstrap(client, (bootstrap) => {
    switch (action.model) {
      case 'brand':
        return applyBrand(patch, bootstrap, action);
      case 'pipeline':
        return applyPipeline(patch, bootstrap, action);
      case 'stage':
        return { ...bootstrap, stages: applyRow(patch, bootstrap.stages, action, stageRowSchema) };
      case 'field_definition':
        return {
          ...bootstrap,
          fields: applyRow(patch, bootstrap.fields, action, fieldDefinitionRowSchema),
        };
      case 'saved_view':
        return {
          ...bootstrap,
          savedViews: applyRow(patch, bootstrap.savedViews, action, savedViewRowSchema),
        };
      case 'member':
        return applyMember(patch, bootstrap, action);
      case 'organization': {
        const parsed = organizationPatchSchema.safeParse(action.data);
        if (!parsed.success) {
          unreadable(patch, action);
          return bootstrap;
        }
        return {
          ...bootstrap,
          organization: { ...bootstrap.organization, name: parsed.data.name },
        };
      }
      default:
        return bootstrap;
    }
  });
  return patch.readable;
}
