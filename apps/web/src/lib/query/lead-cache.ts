import { leadFilterRegistry } from '@gravity/shared/filters';
import type { FieldDefinitionRow, LeadRow } from '@gravity/shared/records';
import type { QueryClient } from '@tanstack/react-query';
import { COMPANY_ROOT, LEAD_ROOT, LEADS_ROOT, PERSON_ROOT, queryKeys } from './keys.ts';
import {
  cachedRows,
  matchesListQuery,
  newestListed,
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

const readLeads = (page: LeadPage) => page.leads;
const writeLeads = (page: LeadPage, leads: LeadRow[]): LeadPage => ({ ...page, leads });

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

export function cachedLead(client: QueryClient, id: string): LeadRow | undefined {
  const detail = client.getQueryData<LeadRow>(queryKeys.lead(id));
  const listed = newestListed(client, LEADS_ROOT, id, readLeads);
  if (detail === undefined) return listed;
  if (listed === undefined) return detail;
  return listed.syncId >= detail.syncId ? listed : detail;
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

export function placeLead(client: QueryClient, row: LeadRow): void {
  const cached = cachedLead(client, row.id);
  if (cached !== undefined && row.syncId < cached.syncId) return;
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
  const details = client
    .getQueriesData<LeadRow>({ queryKey: [LEAD_ROOT] })
    .flatMap(([, lead]) => (lead === undefined ? [] : [lead]));
  const onRecords = [
    ...client.getQueriesData<PersonRecord>({ queryKey: [PERSON_ROOT] }),
    ...client.getQueriesData<CompanyRecord>({ queryKey: [COMPANY_ROOT] }),
  ].flatMap(([, record]) => record?.leads ?? []);
  return newestRows([...allCachedLeads(client), ...details, ...onRecords]);
}
