import { and, desc, eq, type SQL, schema } from '@gravity/db';
import { OWED_BY, STAGE_CATEGORIES } from '@gravity/shared/constants';
import { notFound } from '@gravity/shared/errors';
import type { LeadRow } from '@gravity/shared/records';
import { formatLeadKey } from '@gravity/shared/utils';
import type { Executor } from '../internal.ts';
import { currentCompanyId, currentCompanyName } from './current-company.ts';
import { isoOrNull, oneOf } from './rows.ts';

const leadSelection = {
  lead: schema.lead,
  pipelineKey: schema.pipeline.key,
  brandId: schema.pipeline.brandId,
  personName: schema.person.name,
  personEmail: schema.person.primaryEmail,
  personLinkedinUrl: schema.person.linkedinUrl,
  companyId: currentCompanyId(schema.lead.personId),
  companyName: currentCompanyName(schema.lead.personId),
};

export interface LeadSelection {
  readonly lead: typeof schema.lead.$inferSelect;
  readonly pipelineKey: string;
  readonly brandId: string;
  readonly personName: string;
  readonly personEmail: string | null;
  readonly personLinkedinUrl: string | null;
  readonly companyId: string | null;
  readonly companyName: string | null;
}

export interface LeadQueryOptions {
  readonly orderBy?: readonly SQL[];
  readonly limit?: number;
}

export function leadRowFrom(row: LeadSelection): LeadRow {
  const lead = row.lead;
  return {
    id: lead.id,
    organizationId: lead.organizationId,
    pipelineId: lead.pipelineId,
    brandId: row.brandId,
    number: lead.number,
    key: formatLeadKey(row.pipelineKey, lead.number),
    personId: lead.personId,
    personName: row.personName,
    personEmail: row.personEmail,
    personLinkedinUrl: row.personLinkedinUrl,
    companyId: row.companyId,
    companyName: row.companyName,
    ownerId: lead.ownerId,
    stageId: lead.stageId,
    stageCategory: oneOf(STAGE_CATEGORIES, lead.stageCategory, 'open'),
    source: lead.source,
    priority: lead.priority,
    holdReason: lead.holdReason,
    holdUntil: isoOrNull(lead.holdUntil),
    nextAction: lead.nextAction,
    nextActionAt: isoOrNull(lead.nextActionAt),
    owedBy: oneOf(OWED_BY, lead.owedBy, 'none'),
    lastInboundAt: isoOrNull(lead.lastInboundAt),
    lastOutboundAt: isoOrNull(lead.lastOutboundAt),
    fields: lead.fields,
    syncId: lead.syncId,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    archivedAt: isoOrNull(lead.archivedAt),
  };
}

export async function selectLeadRows(
  executor: Executor,
  organizationId: string,
  where: SQL | undefined,
  options: LeadQueryOptions = {},
): Promise<LeadRow[]> {
  const query = executor
    .select(leadSelection)
    .from(schema.lead)
    .innerJoin(schema.pipeline, eq(schema.pipeline.id, schema.lead.pipelineId))
    .innerJoin(schema.person, eq(schema.person.id, schema.lead.personId))
    .where(and(eq(schema.lead.organizationId, organizationId), where))
    .orderBy(...(options.orderBy ?? [desc(schema.lead.number)]));
  const rows = options.limit === undefined ? await query : await query.limit(options.limit);
  return rows.map(leadRowFrom);
}

export async function leadRowById(
  executor: Executor,
  organizationId: string,
  leadId: string,
): Promise<LeadRow> {
  const [row] = await selectLeadRows(executor, organizationId, eq(schema.lead.id, leadId), {
    limit: 1,
  });
  if (row === undefined) throw notFound('That lead does not exist.');
  return row;
}
