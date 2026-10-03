import { and, asc, db, desc, eq, isNull, lt, type SQL, schema, sql } from '@gravity/db';
import { validationFailed } from '@gravity/shared/errors';
import {
  assertFilterFits,
  companyFilterRegistry,
  leadFilterRegistry,
  personFilterRegistry,
} from '@gravity/shared/filters';
import { assertCan, type Principal } from '@gravity/shared/policy';
import type { CompanyRow, LeadRow, PersonRow } from '@gravity/shared/records';
import { leadListQuerySchema, recordListQuerySchema } from '@gravity/shared/validators';
import { selectCompanyRows } from './company-service.ts';
import { decodeCursor, encodeCursor } from './cursor.ts';
import { loadFieldDefinitions } from './field-service.ts';
import { filterToSql, searchToSql } from './filter-sql.ts';
import { selectLeadRows } from './lead-rows.ts';
import { livePipeline } from './lookups.ts';
import { selectPersonRows } from './person-lookup.ts';
import {
  COMPANY_SEARCH_EXPRESSIONS,
  companySqlRegistry,
  LEAD_SEARCH_EXPRESSIONS,
  leadSqlRegistry,
  PERSON_SEARCH_EXPRESSIONS,
  personSqlRegistry,
} from './sql-registries.ts';

export interface LeadPage {
  readonly leads: LeadRow[];
  readonly nextCursor: string | null;
}

export interface PersonPage {
  readonly people: PersonRow[];
  readonly nextCursor: string | null;
}

export interface CompanyPage {
  readonly companies: CompanyRow[];
  readonly nextCursor: string | null;
}

interface Named {
  readonly id: string;
  readonly name: string;
}

const INVALID_CURSOR = 'That page cursor is not valid. Reload the list.';

function leadNumberCursor(raw: string | undefined): SQL | undefined {
  if (raw === undefined) return undefined;
  const [number] = decodeCursor(raw, 1);
  if (typeof number !== 'number' || !Number.isSafeInteger(number)) {
    throw validationFailed(INVALID_CURSOR);
  }
  return lt(schema.lead.number, number);
}

function nameCursor(
  table: typeof schema.person | typeof schema.company,
  raw: string | undefined,
): SQL | undefined {
  if (raw === undefined) return undefined;
  const [name, id] = decodeCursor(raw, 2);
  if (typeof name !== 'string' || typeof id !== 'string') throw validationFailed(INVALID_CURSOR);
  return sql`(lower(${table.name}), ${table.id}) > (lower(${name}), ${id})`;
}

function byName(table: typeof schema.person | typeof schema.company): SQL[] {
  return [sql`lower(${table.name})`, asc(table.id)];
}

function page<T>(rows: readonly T[], limit: number, cursorOf: (last: T) => string) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last !== undefined ? cursorOf(last) : null };
}

function nameCursorOf(row: Named): string {
  return encodeCursor([row.name, row.id]);
}

function filterContextFor(principal: Principal) {
  return { now: new Date(), userId: principal.userId };
}

export async function listLeads(principal: Principal, input: unknown): Promise<LeadPage> {
  assertCan(principal, 'record:read');
  const query = leadListQuerySchema.parse(input);
  const pipeline = await livePipeline(db, principal.organizationId, query.pipelineId);
  const definitions = await loadFieldDefinitions(db, principal.organizationId, 'lead', pipeline.id);
  assertFilterFits(query.filter, leadFilterRegistry(definitions, pipeline.id));
  const rows = await selectLeadRows(
    db,
    principal.organizationId,
    and(
      eq(schema.lead.pipelineId, pipeline.id),
      isNull(schema.lead.archivedAt),
      filterToSql(
        query.filter,
        leadSqlRegistry(definitions, pipeline.id),
        filterContextFor(principal),
      ),
      searchToSql(query.q, LEAD_SEARCH_EXPRESSIONS),
      leadNumberCursor(query.cursor),
    ),
    { orderBy: [desc(schema.lead.number)], limit: query.limit + 1 },
  );
  const { items, nextCursor } = page(rows, query.limit, (last) => encodeCursor([last.number]));
  return { leads: items, nextCursor };
}

export async function listPeople(principal: Principal, input: unknown): Promise<PersonPage> {
  assertCan(principal, 'record:read');
  const query = recordListQuerySchema.parse(input);
  const definitions = await loadFieldDefinitions(db, principal.organizationId, 'person', null);
  assertFilterFits(query.filter, personFilterRegistry(definitions));
  const rows = await selectPersonRows(
    db,
    principal.organizationId,
    and(
      isNull(schema.person.archivedAt),
      filterToSql(query.filter, personSqlRegistry(definitions), filterContextFor(principal)),
      searchToSql(query.q, PERSON_SEARCH_EXPRESSIONS),
      nameCursor(schema.person, query.cursor),
    ),
    { orderBy: byName(schema.person), limit: query.limit + 1 },
  );
  const { items, nextCursor } = page(rows, query.limit, nameCursorOf);
  return { people: items, nextCursor };
}

export async function listCompanies(principal: Principal, input: unknown): Promise<CompanyPage> {
  assertCan(principal, 'record:read');
  const query = recordListQuerySchema.parse(input);
  const definitions = await loadFieldDefinitions(db, principal.organizationId, 'company', null);
  assertFilterFits(query.filter, companyFilterRegistry(definitions));
  const rows = await selectCompanyRows(
    db,
    principal.organizationId,
    and(
      isNull(schema.company.archivedAt),
      filterToSql(query.filter, companySqlRegistry(definitions), filterContextFor(principal)),
      searchToSql(query.q, COMPANY_SEARCH_EXPRESSIONS),
      nameCursor(schema.company, query.cursor),
    ),
    { orderBy: byName(schema.company), limit: query.limit + 1 },
  );
  const { items, nextCursor } = page(rows, query.limit, nameCursorOf);
  return { companies: items, nextCursor };
}
