import { and, asc, db, desc, eq, inArray, isNull, type SQL, schema, sql } from '@gravity/db';
import { assertCan, type Principal } from '@gravity/shared/policy';
import type { CompanyRow, EmploymentRow, LeadRow, PersonRow } from '@gravity/shared/records';
import { companyRowById } from './company-service.ts';
import { currentCompanyId } from './current-company.ts';
import { selectLeadRows } from './lead-rows.ts';
import { personRowById, selectPersonRows } from './person-lookup.ts';
import { employmentRowOf } from './rows.ts';

export interface PersonRecord {
  readonly person: PersonRow;
  readonly employments: EmploymentRow[];
  readonly leads: LeadRow[];
}

export interface CompanyRecord {
  readonly company: CompanyRow;
  readonly people: { readonly person: PersonRow; readonly employment: EmploymentRow }[];
  readonly leads: LeadRow[];
}

function liveLeads(organizationId: string, where: SQL): Promise<LeadRow[]> {
  return selectLeadRows(
    db,
    organizationId,
    and(where, isNull(schema.lead.archivedAt), isNull(schema.pipeline.archivedAt)),
    { orderBy: [desc(schema.lead.createdAt), desc(schema.lead.id)] },
  );
}

export async function getPersonRecord(
  principal: Principal,
  personId: string,
): Promise<PersonRecord> {
  assertCan(principal, 'record:read');
  const person = await personRowById(db, principal.organizationId, personId);
  const [jobs, leads] = await Promise.all([
    db
      .select({ employment: schema.employment, companyName: schema.company.name })
      .from(schema.employment)
      .innerJoin(schema.company, eq(schema.company.id, schema.employment.companyId))
      .where(
        and(
          eq(schema.employment.personId, personId),
          eq(schema.employment.organizationId, principal.organizationId),
        ),
      )
      .orderBy(
        desc(schema.employment.isCurrent),
        sql`${schema.employment.startedAt} desc nulls last`,
        desc(schema.employment.createdAt),
        asc(schema.employment.id),
      ),
    liveLeads(principal.organizationId, eq(schema.lead.personId, personId)),
  ]);
  return {
    person,
    employments: jobs.map((job) => employmentRowOf(job.employment, job.companyName)),
    leads,
  };
}

export async function getCompanyRecord(
  principal: Principal,
  companyId: string,
): Promise<CompanyRecord> {
  assertCan(principal, 'record:read');
  const company = await companyRowById(db, principal.organizationId, companyId);
  const [jobs, leads] = await Promise.all([
    db
      .select()
      .from(schema.employment)
      .where(
        and(
          eq(schema.employment.companyId, companyId),
          eq(schema.employment.isCurrent, true),
          eq(schema.employment.organizationId, principal.organizationId),
        ),
      ),
    liveLeads(
      principal.organizationId,
      sql`${currentCompanyId(schema.lead.personId)} = ${companyId}`,
    ),
  ]);
  const people =
    jobs.length === 0
      ? []
      : await selectPersonRows(
          db,
          principal.organizationId,
          and(
            inArray(
              schema.person.id,
              jobs.map((job) => job.personId),
            ),
            isNull(schema.person.archivedAt),
          ),
        );
  return {
    company,
    people: people.flatMap((person) => {
      const job = jobs.find((entry) => entry.personId === person.id);
      return job === undefined ? [] : [{ person, employment: employmentRowOf(job, company.name) }];
    }),
    leads,
  };
}
