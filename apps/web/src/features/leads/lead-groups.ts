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

export function groupLeadsByStage(
  leads: readonly LeadRow[],
  stages: readonly StageRow[],
  options: { readonly showEmpty?: boolean } = {},
): LeadGroup[] {
  const byStage = new Map<string, LeadRow[]>();
  for (const lead of leads) {
    const list = byStage.get(lead.stageId) ?? [];
    list.push(lead);
    byStage.set(lead.stageId, list);
  }
  return liveStages(stages)
    .map((stage) => ({ stage, leads: sortLeads(byStage.get(stage.id) ?? []) }))
    .filter((group) => options.showEmpty === true || group.leads.length > 0);
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
  return index === -1 ? undefined : ordered[index + direction];
}

export function selectionTargets(
  ordered: readonly LeadRow[],
  selected: readonly string[],
  active: LeadRow | undefined,
): readonly LeadRow[] {
  if (selected.length > 0) return ordered.filter((lead) => selected.includes(lead.id));
  return active === undefined ? [] : [active];
}

export function personHref(lead: Pick<LeadRow, 'personId' | 'id'>): string {
  return `/people/${lead.personId}?lead=${lead.id}`;
}
