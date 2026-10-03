import type { OwedBy, StageCategory } from '../constants/crm.ts';
import { validationFailed } from '../errors/index.ts';
import type { LeadChange, LeadPatch } from '../validators/records.ts';
import type { LeadRow } from './rows.ts';

export interface LeadState {
  readonly pipelineId: string;
  readonly stageId: string;
  readonly stageCategory: StageCategory;
  readonly ownerId: string | null;
  readonly priority: number;
  readonly nextAction: string | null;
  readonly nextActionAt: string | null;
  readonly holdReason: string | null;
  readonly holdUntil: string | null;
  readonly owedBy: OwedBy;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface StageLike {
  readonly id: string;
  readonly pipelineId: string;
  readonly category: StageCategory;
  readonly sortOrder: number;
  readonly archivedAt: string | null;
}

export function leadStateOf(row: LeadRow): LeadState {
  return {
    pipelineId: row.pipelineId,
    stageId: row.stageId,
    stageCategory: row.stageCategory,
    ownerId: row.ownerId,
    priority: row.priority,
    nextAction: row.nextAction,
    nextActionAt: row.nextActionAt,
    holdReason: row.holdReason,
    holdUntil: row.holdUntil,
    owedBy: row.owedBy,
    fields: row.fields,
  };
}

function liveStages(stages: readonly StageLike[], pipelineId: string): StageLike[] {
  return stages
    .filter((stage) => stage.pipelineId === pipelineId && stage.archivedAt === null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function stageIn(stages: readonly StageLike[], pipelineId: string, stageId: string): StageLike {
  const stage = liveStages(stages, pipelineId).find((candidate) => candidate.id === stageId);
  if (stage === undefined) {
    throw validationFailed('That stage is not in this pipeline.', { details: { stageId } });
  }
  return stage;
}

function patched<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

function mergedFields(
  current: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({ ...current, ...patch }).filter(([, value]) => value !== null),
  );
}

function resolveHold(
  lead: LeadState,
  reason: string,
  until: string | null,
  stages: readonly StageLike[],
): LeadState {
  const target = liveStages(stages, lead.pipelineId).find((stage) => stage.category === 'hold');
  if (target === undefined) {
    throw validationFailed('This pipeline has no hold stage. Add one in Settings.');
  }
  return {
    ...lead,
    stageId: target.id,
    stageCategory: 'hold',
    holdReason: reason,
    holdUntil: until,
  };
}

function resolveClose(
  lead: LeadState,
  stageId: string | undefined,
  stages: readonly StageLike[],
): LeadState {
  const target =
    stageId === undefined
      ? liveStages(stages, lead.pipelineId).find((stage) => stage.category === 'lost')
      : stageIn(stages, lead.pipelineId, stageId);
  if (target === undefined) {
    throw validationFailed('This pipeline has no lost stage. Add one in Settings.');
  }
  if (target.category !== 'won' && target.category !== 'lost') {
    throw validationFailed('Close a lead into a won or lost stage.');
  }
  return {
    ...lead,
    stageId: target.id,
    stageCategory: target.category,
    holdReason: null,
    holdUntil: null,
    nextAction: null,
    nextActionAt: null,
  };
}

function resolveUpdate(lead: LeadState, patch: LeadPatch, stages: readonly StageLike[]): LeadState {
  const stage =
    patch.stageId === undefined ? undefined : stageIn(stages, lead.pipelineId, patch.stageId);
  const stageCategory = stage?.category ?? lead.stageCategory;
  const leavesHold = stage !== undefined && stageCategory !== 'hold';
  const holdReason = patched(patch.holdReason, leavesHold ? null : lead.holdReason);
  const holdUntil = patched(patch.holdUntil, leavesHold ? null : lead.holdUntil);
  if (stageCategory === 'hold' && holdReason === null) {
    throw validationFailed('A hold needs a reason.');
  }
  return {
    ...lead,
    stageId: stage?.id ?? lead.stageId,
    stageCategory,
    ownerId: patched(patch.ownerId, lead.ownerId),
    priority: patched(patch.priority, lead.priority),
    nextAction: patched(patch.nextAction, lead.nextAction),
    nextActionAt: patched(patch.nextActionAt, lead.nextActionAt),
    holdReason,
    holdUntil,
    owedBy: patched(patch.owedBy, lead.owedBy),
    fields: patch.fields === undefined ? lead.fields : mergedFields(lead.fields, patch.fields),
  };
}

export function resolveLeadChange(
  lead: LeadState,
  change: LeadChange,
  stages: readonly StageLike[],
): LeadState {
  if (change.type === 'hold') return resolveHold(lead, change.reason, change.until, stages);
  if (change.type === 'close') return resolveClose(lead, change.stageId, stages);
  return resolveUpdate(lead, change.patch, stages);
}

function fieldRestore(before: LeadState, after: LeadState): Record<string, unknown> | undefined {
  const keys = new Set([...Object.keys(before.fields), ...Object.keys(after.fields)]);
  const restore: Record<string, unknown> = {};
  for (const key of keys) {
    const previous = before.fields[key];
    if (JSON.stringify(previous) !== JSON.stringify(after.fields[key])) {
      restore[key] = previous === undefined ? null : previous;
    }
  }
  return Object.keys(restore).length === 0 ? undefined : restore;
}

export function inverseLeadChange(before: LeadState, after: LeadState): LeadChange | null {
  const fields = fieldRestore(before, after);
  const patch: LeadPatch = {
    ...(before.stageId === after.stageId ? {} : { stageId: before.stageId }),
    ...(before.ownerId === after.ownerId ? {} : { ownerId: before.ownerId }),
    ...(before.priority === after.priority ? {} : { priority: before.priority }),
    ...(before.nextAction === after.nextAction ? {} : { nextAction: before.nextAction }),
    ...(before.nextActionAt === after.nextActionAt ? {} : { nextActionAt: before.nextActionAt }),
    ...(before.holdReason === after.holdReason ? {} : { holdReason: before.holdReason }),
    ...(before.holdUntil === after.holdUntil ? {} : { holdUntil: before.holdUntil }),
    ...(before.owedBy === after.owedBy ? {} : { owedBy: before.owedBy }),
    ...(fields === undefined ? {} : { fields }),
  };
  return Object.keys(patch).length === 0 ? null : { type: 'update', patch };
}
