import type { LeadRow, StageRow } from '@gravity/shared/records';

export interface LeadGroup {
  readonly stage: StageRow;
  readonly leads: readonly LeadRow[];
}

export type LeadListRow =
  | { readonly kind: 'header'; readonly group: LeadGroup }
  | { readonly kind: 'lead'; readonly lead: LeadRow };

function priorityRank(priority: number): number {
  return priority === 0 ? 5 : priority;
}

export function sortLeads(leads: readonly LeadRow[]): LeadRow[] {
  return [...leads].sort(
    (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || b.number - a.number,
  );
}

function liveStages(stages: readonly StageRow[]): StageRow[] {
  return stages
    .filter((stage) => stage.archivedAt === null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export const OTHER_STAGE_ID = 'other';

function otherStage(lead: LeadRow): StageRow {
  return {
    id: OTHER_STAGE_ID,
    pipelineId: lead.pipelineId,
    name: 'Other',
    category: lead.stageCategory,
    sortOrder: Number.MAX_SAFE_INTEGER,
    syncId: 0,
    archivedAt: null,
  };
}

export function groupLeadsByStage(
  leads: readonly LeadRow[],
  stages: readonly StageRow[],
  options: { readonly showEmpty?: boolean } = {},
): LeadGroup[] {
  const live = liveStages(stages);
  const known = new Set(live.map((stage) => stage.id));
  const byStage = new Map<string, LeadRow[]>();
  const unknown: LeadRow[] = [];
  for (const lead of leads) {
    if (!known.has(lead.stageId)) {
      unknown.push(lead);
      continue;
    }
    const list = byStage.get(lead.stageId) ?? [];
    list.push(lead);
    byStage.set(lead.stageId, list);
  }
  const groups = live
    .map((stage) => ({ stage, leads: sortLeads(byStage.get(stage.id) ?? []) }))
    .filter((group) => options.showEmpty === true || group.leads.length > 0);
  const [first] = unknown;
  return first === undefined
    ? groups
    : [...groups, { stage: otherStage(first), leads: sortLeads(unknown) }];
}

export function buildLeadRows(groups: readonly LeadGroup[]): LeadListRow[] {
  return groups.flatMap((group) => [
    { kind: 'header' as const, group },
    ...group.leads.map((lead) => ({ kind: 'lead' as const, lead })),
  ]);
}

export function selectionThrough(
  current: readonly string[],
  from: string | undefined,
  to: string | undefined,
): readonly string[] {
  if (to === undefined || from === to) return current;
  if (from !== undefined && current.includes(to)) return current.filter((id) => id !== from);
  const anchored = from === undefined || current.includes(from) ? [...current] : [...current, from];
  return anchored.includes(to) ? anchored : [...anchored, to];
}

export function adjacentStage(
  stages: readonly StageRow[],
  stageId: string,
  direction: 1 | -1,
): StageRow | undefined {
  const ordered = liveStages(stages);
  const index = ordered.findIndex((stage) => stage.id === stageId);
  if (index === -1) return direction === -1 ? ordered.at(-1) : undefined;
  return ordered[index + direction];
}

export function selectionTargets(
  ordered: readonly LeadRow[],
  selected: Iterable<string>,
  active: LeadRow | undefined,
): readonly LeadRow[] {
  const chosen = new Set(selected);
  if (chosen.size > 0) return ordered.filter((lead) => chosen.has(lead.id));
  return active === undefined ? [] : [active];
}

export function survivingNeighbour(
  previousOrder: readonly string[],
  surviving: ReadonlySet<string>,
  lostId: string,
): string | undefined {
  const index = previousOrder.indexOf(lostId);
  if (index === -1) return undefined;
  const after = previousOrder.slice(index + 1).find((id) => surviving.has(id));
  return after ?? previousOrder.slice(0, index).findLast((id) => surviving.has(id));
}

export function personHref(lead: Pick<LeadRow, 'personId' | 'id'>): string {
  return `/people/${lead.personId}?lead=${lead.id}`;
}
