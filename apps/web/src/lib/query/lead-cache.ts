import { leadFilterRegistry } from '@gravity/shared/filters';
import {
  type FieldDefinitionRow,
  type LeadRow,
  leadStateOf,
  resolveLeadChange,
} from '@gravity/shared/records';
import type { LeadChange } from '@gravity/shared/validators';
import type { QueryClient } from '@tanstack/react-query';
import { COMPANY_ROOT, LEAD_ROOT, LEADS_ROOT, PERSON_ROOT, queryKeys } from './keys.ts';
import {
  cachedRows,
  isStale,
  matchesListQuery,
  newestListed,
  newestOf,
  newestRows,
  placeInLists,
  placeInRows,
  removeFromLists,
  withoutRow,
} from './pages.ts';
import type { Bootstrap, CompanyRecord, LeadPage, PersonRecord } from './schemas.ts';

export interface CacheContext {
  readonly userId: string;
  readonly now: Date;
}

export const readLeads = (page: LeadPage) => page.leads;
export const writeLeads = (page: LeadPage, leads: LeadRow[]): LeadPage => ({ ...page, leads });

function bootstrapOf(client: QueryClient): Bootstrap | undefined {
  return client.getQueryData<Bootstrap>(queryKeys.bootstrap);
}

export function cacheContextOf(client: QueryClient): CacheContext {
  return { userId: bootstrapOf(client)?.me.userId ?? '', now: new Date() };
}

export function leadBelongs(
  row: LeadRow,
  pipelineId: string,
  search: string,
  fields: readonly FieldDefinitionRow[],
  context: CacheContext,
): boolean {
  if (row.pipelineId !== pipelineId) return false;
  return matchesListQuery(row, search, leadFilterRegistry(fields, pipelineId), context);
}

export function allCachedLeads(client: QueryClient): LeadRow[] {
  return cachedRows(client, LEADS_ROOT, readLeads);
}

function leadDetails(client: QueryClient): LeadRow[] {
  return client
    .getQueriesData<LeadRow>({ queryKey: [LEAD_ROOT] })
    .flatMap(([, lead]) => (lead === undefined ? [] : [lead]));
}

function leadsOnRecords(client: QueryClient): LeadRow[] {
  return [
    ...client.getQueriesData<PersonRecord>({ queryKey: [PERSON_ROOT] }),
    ...client.getQueriesData<CompanyRecord>({ queryKey: [COMPANY_ROOT] }),
  ].flatMap(([, record]) => record?.leads ?? []);
}

export function cachedLead(client: QueryClient, id: string): LeadRow | undefined {
  return newestOf([
    newestListed(client, LEADS_ROOT, id, readLeads),
    client.getQueryData<LeadRow>(queryKeys.lead(id)),
    ...leadsOnRecords(client).filter((lead) => lead.id === id),
  ]);
}

interface RecordWithLeads {
  readonly leads: LeadRow[];
}

function placeInRecords<TRecord extends RecordWithLeads>(
  client: QueryClient,
  root: string,
  id: string,
  row: LeadRow | null,
  owns: (record: TRecord, lead: LeadRow) => boolean,
): void {
  for (const [key, record] of client.getQueriesData<TRecord>({ queryKey: [root] })) {
    if (record === undefined) continue;
    const leads =
      row === null
        ? withoutRow(record.leads, id)
        : placeInRows(record.leads, row, row.archivedAt === null && owns(record, row));
    if (leads !== record.leads) client.setQueryData<TRecord>(key, { ...record, leads: [...leads] });
  }
}

function placeInRecordLeads(client: QueryClient, id: string, row: LeadRow | null): void {
  placeInRecords<PersonRecord>(
    client,
    PERSON_ROOT,
    id,
    row,
    (record, lead) => lead.personId === record.person.id,
  );
  placeInRecords<CompanyRecord>(
    client,
    COMPANY_ROOT,
    id,
    row,
    (record, lead) => lead.companyId === record.company.id,
  );
}

interface PendingLead {
  base: LeadRow;
  readonly changes: { readonly change: LeadChange }[];
}

const pendingByClient = new WeakMap<QueryClient, Map<string, PendingLead>>();

function pendingOf(client: QueryClient): Map<string, PendingLead> {
  const existing = pendingByClient.get(client);
  if (existing !== undefined) return existing;
  const created = new Map<string, PendingLead>();
  pendingByClient.set(client, created);
  return created;
}

function withChange(
  lead: LeadRow,
  change: LeadChange,
  bootstrap: Bootstrap | undefined,
): LeadRow | null {
  try {
    return { ...lead, ...resolveLeadChange(leadStateOf(lead), change, bootstrap?.stages ?? []) };
  } catch {
    return null;
  }
}

function shownRow(client: QueryClient, pending: PendingLead): LeadRow {
  const bootstrap = bootstrapOf(client);
  return pending.changes.reduce(
    (row, entry) => withChange(row, entry.change, bootstrap) ?? row,
    pending.base,
  );
}

export function beginLeadChange(
  client: QueryClient,
  lead: LeadRow,
  change: LeadChange,
): (() => void) | null {
  const all = pendingOf(client);
  const pending = all.get(lead.id) ?? { base: cachedLead(client, lead.id) ?? lead, changes: [] };
  if (withChange(shownRow(client, pending), change, bootstrapOf(client)) === null) return null;
  const entry = { change };
  pending.changes.push(entry);
  all.set(lead.id, pending);
  writeLead(client, shownRow(client, pending));
  return () => {
    const index = pending.changes.indexOf(entry);
    if (index === -1) return;
    pending.changes.splice(index, 1);
    if (pending.changes.length === 0 && all.get(lead.id) === pending) all.delete(lead.id);
    const shown = shownRow(client, pending);
    if (!isStale(cachedLead(client, lead.id), shown)) writeLead(client, shown);
  };
}

export function placeLead(client: QueryClient, row: LeadRow): void {
  const pending = pendingByClient.get(client)?.get(row.id);
  if (pending === undefined) {
    if (!isStale(cachedLead(client, row.id), row)) writeLead(client, row);
    return;
  }
  if (isStale(pending.base, row)) return;
  pending.base = row;
  writeLead(client, shownRow(client, pending));
}

function writeLead(client: QueryClient, row: LeadRow): void {
  const fields = bootstrapOf(client)?.fields ?? [];
  const context = cacheContextOf(client);
  placeInLists(
    client,
    LEADS_ROOT,
    row,
    (key) => {
      const [, pipelineId, search] = key;
      if (typeof pipelineId !== 'string' || typeof search !== 'string') return null;
      return leadBelongs(row, pipelineId, search, fields, context);
    },
    readLeads,
    writeLeads,
  );
  if (client.getQueryData<LeadRow>(queryKeys.lead(row.id)) !== undefined) {
    client.setQueryData<LeadRow>(queryKeys.lead(row.id), row);
  }
  placeInRecordLeads(client, row.id, row);
}

export function dropRecordLeadsOfPipelines(
  client: QueryClient,
  pipelineIds: readonly string[],
): void {
  if (pipelineIds.length === 0) return;
  for (const root of [PERSON_ROOT, COMPANY_ROOT]) {
    for (const [key, record] of client.getQueriesData<RecordWithLeads>({ queryKey: [root] })) {
      if (record === undefined) continue;
      const leads = record.leads.filter((lead) => !pipelineIds.includes(lead.pipelineId));
      if (leads.length !== record.leads.length) client.setQueryData(key, { ...record, leads });
    }
  }
}

export function removeLead(client: QueryClient, id: string): void {
  removeFromLists(client, LEADS_ROOT, id, readLeads, writeLeads);
  client.removeQueries({ queryKey: [LEAD_ROOT, id], exact: true });
  placeInRecordLeads(client, id, null);
}

export function patchLeads(
  client: QueryClient,
  matches: (lead: LeadRow) => boolean,
  patch: (lead: LeadRow) => LeadRow,
): void {
  for (const lead of everyCachedLead(client).filter(matches)) placeLead(client, patch(lead));
}

function everyCachedLead(client: QueryClient): LeadRow[] {
  return newestRows([...allCachedLeads(client), ...leadDetails(client), ...leadsOnRecords(client)]);
}
