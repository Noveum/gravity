import { and, asc, db, eq, isNull, type SQL, schema } from '@gravity/db';
import { notFound, validationFailed } from '@gravity/shared/errors';
import { assertCan, type Principal } from '@gravity/shared/policy';
import { normalizeDomain, normalizeLinkedinProfileUrl, parseLeadKey } from '@gravity/shared/utils';
import { arrayOverlaps } from 'drizzle-orm';
import { getLeadByKey } from './lead-service.ts';

export type RecordRefType = 'person' | 'company' | 'lead';

export interface ResolvedRecordRef {
  readonly type: RecordRefType;
  readonly id: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SHOWN_REF_LENGTH = 80;

function nothingMatches(ref: string) {
  return notFound(
    `Nothing in this workspace matches "${ref.slice(0, SHOWN_REF_LENGTH)}". Use an email, a LinkedIn profile URL, a domain, a lead key like ABC-12, or an id.`,
  );
}

async function personWhere(organizationId: string, condition: SQL): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.person.id })
    .from(schema.person)
    .where(
      and(
        eq(schema.person.organizationId, organizationId),
        isNull(schema.person.archivedAt),
        condition,
      ),
    )
    .orderBy(asc(schema.person.createdAt), asc(schema.person.id))
    .limit(1);
  return row?.id ?? null;
}

async function companyWhere(organizationId: string, condition: SQL): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.company.id })
    .from(schema.company)
    .where(
      and(
        eq(schema.company.organizationId, organizationId),
        isNull(schema.company.archivedAt),
        condition,
      ),
    )
    .orderBy(asc(schema.company.createdAt), asc(schema.company.id))
    .limit(1);
  return row?.id ?? null;
}

async function leadWhere(organizationId: string, leadId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .innerJoin(schema.pipeline, eq(schema.pipeline.id, schema.lead.pipelineId))
    .where(
      and(
        eq(schema.lead.organizationId, organizationId),
        eq(schema.lead.id, leadId),
        isNull(schema.lead.archivedAt),
        isNull(schema.pipeline.archivedAt),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

async function recordById(organizationId: string, id: string): Promise<ResolvedRecordRef | null> {
  const person = await personWhere(organizationId, eq(schema.person.id, id));
  if (person !== null) return { type: 'person', id: person };
  const company = await companyWhere(organizationId, eq(schema.company.id, id));
  if (company !== null) return { type: 'company', id: company };
  const lead = await leadWhere(organizationId, id);
  return lead === null ? null : { type: 'lead', id: lead };
}

function found(type: RecordRefType, id: string | null, ref: string): ResolvedRecordRef {
  if (id === null) throw nothingMatches(ref);
  return { type, id };
}

export async function resolveRecordRef(
  principal: Principal,
  raw: string,
): Promise<ResolvedRecordRef> {
  assertCan(principal, 'record:read');
  const ref = raw.trim();
  if (ref.length === 0) {
    throw validationFailed('Name a record by email, LinkedIn URL, domain, lead key or id.');
  }
  const organizationId = principal.organizationId;
  if (parseLeadKey(ref) !== null) {
    const lead = await getLeadByKey(principal, ref);
    return found('lead', lead.archivedAt === null ? lead.id : null, ref);
  }
  const linkedinUrl = normalizeLinkedinProfileUrl(ref);
  if (linkedinUrl !== null) {
    return found(
      'person',
      await personWhere(organizationId, eq(schema.person.linkedinUrl, linkedinUrl)),
      ref,
    );
  }
  if (EMAIL.test(ref)) {
    return found(
      'person',
      await personWhere(organizationId, arrayOverlaps(schema.person.emails, [ref.toLowerCase()])),
      ref,
    );
  }
  const domain = ref.includes('.') && !/\s/.test(ref) ? normalizeDomain(ref) : null;
  if (domain !== null) {
    return found(
      'company',
      await companyWhere(organizationId, arrayOverlaps(schema.company.domains, [domain])),
      ref,
    );
  }
  const byId = await recordById(organizationId, ref);
  if (byId === null) throw nothingMatches(ref);
  return byId;
}
