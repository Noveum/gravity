import { and, asc, db, desc, eq, isNull, or, schema, sql } from '@gravity/db';
import { isDomainError } from '@gravity/shared/errors';
import { assertCan, type Principal } from '@gravity/shared/policy';
import type { CompanyRow, LeadRow, PersonRow } from '@gravity/shared/records';
import {
  companyDomainFromEmail,
  normalizeDomain,
  normalizeLinkedinProfileUrl,
  parseLeadKey,
} from '@gravity/shared/utils';
import { duplicateQuerySchema, searchQuerySchema } from '@gravity/shared/validators';
import { arrayOverlaps } from 'drizzle-orm';
import { selectCompanyRows } from './company-service.ts';
import { likePattern, searchToSql } from './filter-sql.ts';
import { selectLeadRows } from './lead-rows.ts';
import { getLeadByKey } from './lead-service.ts';
import { selectPersonRows } from './person-lookup.ts';
import { LEAD_SEARCH_EXPRESSIONS } from './sql-registries.ts';

export interface SearchResult {
  readonly people: PersonRow[];
  readonly companies: CompanyRow[];
  readonly leads: LeadRow[];
}

export interface Duplicates {
  readonly people: PersonRow[];
  readonly companies: CompanyRow[];
}

const SIMILAR = 0.3;
const SAME_NAME = 0.6;
const DUPLICATE_LIMIT = 5;

function duplicateDomain(domain: string | undefined, email: string | undefined): string | null {
  if (domain !== undefined) return normalizeDomain(domain);
  if (email !== undefined) return companyDomainFromEmail(email);
  return null;
}

async function leadByKey(principal: Principal, term: string): Promise<LeadRow[]> {
  if (parseLeadKey(term) === null) return [];
  try {
    return [await getLeadByKey(principal, term)];
  } catch (error: unknown) {
    if (isDomainError(error) && error.code === 'not_found') return [];
    throw error;
  }
}

function searchPeople(principal: Principal, q: string, limit: number): Promise<PersonRow[]> {
  const pattern = likePattern(q);
  return selectPersonRows(
    db,
    principal.organizationId,
    and(
      isNull(schema.person.archivedAt),
      or(
        sql`${schema.person.name} ilike ${pattern}`,
        sql`${schema.person.primaryEmail} ilike ${pattern}`,
        sql`similarity(${schema.person.name}, ${q}) > ${SIMILAR}`,
      ),
    ),
    {
      orderBy: [
        sql`greatest(similarity(${schema.person.name}, ${q}), similarity(coalesce(${schema.person.primaryEmail}, ''), ${q})) desc`,
        asc(schema.person.id),
      ],
      limit,
    },
  );
}

function searchCompanies(principal: Principal, q: string, limit: number): Promise<CompanyRow[]> {
  const pattern = likePattern(q);
  return selectCompanyRows(
    db,
    principal.organizationId,
    and(
      isNull(schema.company.archivedAt),
      or(
        sql`${schema.company.name} ilike ${pattern}`,
        sql`${schema.company.primaryDomain} ilike ${pattern}`,
        sql`similarity(${schema.company.name}, ${q}) > ${SIMILAR}`,
      ),
    ),
    {
      orderBy: [sql`similarity(${schema.company.name}, ${q}) desc`, asc(schema.company.id)],
      limit,
    },
  );
}

function searchLeads(principal: Principal, q: string, limit: number): Promise<LeadRow[]> {
  return selectLeadRows(
    db,
    principal.organizationId,
    and(
      isNull(schema.lead.archivedAt),
      isNull(schema.pipeline.archivedAt),
      searchToSql(q, LEAD_SEARCH_EXPRESSIONS),
    ),
    { orderBy: [desc(schema.lead.updatedAt), asc(schema.lead.id)], limit },
  );
}

export async function searchRecords(principal: Principal, input: unknown): Promise<SearchResult> {
  assertCan(principal, 'record:read');
  const { q, limit } = searchQuerySchema.parse(input);
  const [people, companies, keyed, leads] = await Promise.all([
    searchPeople(principal, q, limit),
    searchCompanies(principal, q, limit),
    leadByKey(principal, q),
    searchLeads(principal, q, limit),
  ]);
  const keyedIds = new Set(keyed.map((lead) => lead.id));
  return {
    people,
    companies,
    leads: [...keyed, ...leads.filter((lead) => !keyedIds.has(lead.id))].slice(0, limit),
  };
}

export async function findDuplicates(principal: Principal, input: unknown): Promise<Duplicates> {
  assertCan(principal, 'record:read');
  const query = duplicateQuerySchema.parse(input);
  const linkedinUrl =
    query.linkedinUrl === undefined ? null : normalizeLinkedinProfileUrl(query.linkedinUrl);
  const domain = duplicateDomain(query.domain, query.email);
  const personConditions = [
    query.email === undefined
      ? undefined
      : arrayOverlaps(schema.person.emails, [query.email.toLowerCase()]),
    linkedinUrl === null ? undefined : eq(schema.person.linkedinUrl, linkedinUrl),
    query.name === undefined
      ? undefined
      : sql`similarity(${schema.person.name}, ${query.name}) > ${SAME_NAME}`,
  ].filter((condition) => condition !== undefined);
  const [people, companies] = await Promise.all([
    personConditions.length === 0
      ? []
      : selectPersonRows(
          db,
          principal.organizationId,
          and(isNull(schema.person.archivedAt), or(...personConditions)),
          {
            orderBy: [asc(schema.person.createdAt), asc(schema.person.id)],
            limit: DUPLICATE_LIMIT,
          },
        ),
    domain === null
      ? []
      : selectCompanyRows(
          db,
          principal.organizationId,
          and(isNull(schema.company.archivedAt), arrayOverlaps(schema.company.domains, [domain])),
          { limit: DUPLICATE_LIMIT },
        ),
  ]);
  return { people, companies };
}
