import { TIMELINE_FILTERS, timelineFilterMatches } from '@gravity/shared/constants';
import { companyFilterRegistry, personFilterRegistry } from '@gravity/shared/filters';
import type { ActivityRow, CompanyRow, EmploymentRow, PersonRow } from '@gravity/shared/records';
import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { COMPANIES_ROOT, COMPANY_ROOT, PEOPLE_ROOT, queryKeys, TIMELINE_ROOT } from './keys.ts';
import { cacheContextOf, patchLeads } from './lead-cache.ts';
import { cachedRows, matchesListQuery, newestListed, type Pages, placeInLists } from './pages.ts';
import type {
  Bootstrap,
  CompanyPage,
  CompanyRecord,
  PersonPage,
  PersonRecord,
  TimelinePage,
} from './schemas.ts';

const readPeople = (page: PersonPage) => page.people;
const writePeople = (page: PersonPage, people: PersonRow[]): PersonPage => ({ ...page, people });
const readCompanies = (page: CompanyPage) => page.companies;
const writeCompanies = (page: CompanyPage, companies: CompanyRow[]): CompanyPage => ({
  ...page,
  companies,
});

function fieldsOf(client: QueryClient) {
  return client.getQueryData<Bootstrap>(queryKeys.bootstrap)?.fields ?? [];
}

function searchOf(key: readonly unknown[]): string | null {
  const search = key[1];
  return typeof search === 'string' ? search : null;
}

export function allCachedPeople(client: QueryClient): PersonRow[] {
  return cachedRows(client, PEOPLE_ROOT, readPeople);
}

export function allCachedCompanies(client: QueryClient): CompanyRow[] {
  return cachedRows(client, COMPANIES_ROOT, readCompanies);
}

function isStale(known: { readonly syncId: number } | undefined, row: { readonly syncId: number }) {
  return known !== undefined && row.syncId < known.syncId;
}

export function placePerson(client: QueryClient, row: PersonRow): void {
  const record = client.getQueryData<PersonRecord>(queryKeys.person(row.id));
  if (isStale(newestListed(client, PEOPLE_ROOT, row.id, readPeople), row)) return;
  if (isStale(record?.person, row)) return;
  const registry = personFilterRegistry(fieldsOf(client));
  const context = cacheContextOf(client);
  placeInLists(
    client,
    PEOPLE_ROOT,
    row,
    (key) => {
      const search = searchOf(key);
      return search === null ? null : matchesListQuery(row, search, registry, context);
    },
    readPeople,
    writePeople,
  );
  if (record !== undefined) {
    client.setQueryData<PersonRecord>(queryKeys.person(row.id), { ...record, person: row });
  }
  for (const [key, company] of client.getQueriesData<CompanyRecord>({ queryKey: [COMPANY_ROOT] })) {
    if (company === undefined || !company.people.some((entry) => entry.person.id === row.id)) {
      continue;
    }
    client.setQueryData<CompanyRecord>(key, {
      ...company,
      people: company.people.map((entry) =>
        entry.person.id === row.id ? { ...entry, person: row } : entry,
      ),
    });
  }
  patchLeads(
    client,
    (lead) =>
      lead.personId === row.id &&
      (lead.personName !== row.name ||
        lead.personEmail !== row.primaryEmail ||
        lead.personLinkedinUrl !== row.linkedinUrl),
    (lead) => ({
      ...lead,
      personName: row.name,
      personEmail: row.primaryEmail,
      personLinkedinUrl: row.linkedinUrl,
    }),
  );
}

export function placeCompany(client: QueryClient, row: CompanyRow): void {
  const record = client.getQueryData<CompanyRecord>(queryKeys.company(row.id));
  if (isStale(newestListed(client, COMPANIES_ROOT, row.id, readCompanies), row)) return;
  if (isStale(record?.company, row)) return;
  const registry = companyFilterRegistry(fieldsOf(client));
  const context = cacheContextOf(client);
  placeInLists(
    client,
    COMPANIES_ROOT,
    row,
    (key) => {
      const search = searchOf(key);
      return search === null ? null : matchesListQuery(row, search, registry, context);
    },
    readCompanies,
    writeCompanies,
  );
  if (record !== undefined) {
    client.setQueryData<CompanyRecord>(queryKeys.company(row.id), { ...record, company: row });
  }
  patchLeads(
    client,
    (lead) => lead.companyId === row.id && lead.companyName !== row.name,
    (lead) => ({ ...lead, companyName: row.name }),
  );
}

export function applyEmployment(client: QueryClient, row: EmploymentRow): void {
  const record = client.getQueryData<PersonRecord>(queryKeys.person(row.personId));
  if (record !== undefined) {
    const others = record.employments.filter((job) => job.id !== row.id);
    const employments = [row, ...others].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
    const person = row.isCurrent
      ? {
          ...record.person,
          companyId: row.companyId,
          companyName: row.companyName,
          title: row.title,
        }
      : record.person;
    client.setQueryData<PersonRecord>(queryKeys.person(row.personId), {
      ...record,
      employments,
      person,
    });
  }
  if (row.isCurrent) {
    patchLeads(
      client,
      (lead) =>
        lead.personId === row.personId &&
        (lead.companyId !== row.companyId || lead.companyName !== row.companyName),
      (lead) => ({ ...lead, companyId: row.companyId, companyName: row.companyName }),
    );
    return;
  }
  patchLeads(
    client,
    (lead) => lead.personId === row.personId && lead.companyId === row.companyId,
    (lead) => ({ ...lead, companyId: null, companyName: null }),
  );
}

const timelineFilterSchema = z.enum(TIMELINE_FILTERS);

export function prependActivity(client: QueryClient, row: ActivityRow): void {
  for (const [key, pages] of client.getQueriesData<Pages<TimelinePage>>({
    queryKey: [TIMELINE_ROOT],
  })) {
    const [, subjectType, subjectId, rawFilter] = key;
    const filter = timelineFilterSchema.safeParse(rawFilter);
    if (pages === undefined || !filter.success) continue;
    const linked = row.links.some(
      (link) => link.entityType === subjectType && link.entityId === subjectId,
    );
    if (!(linked && timelineFilterMatches(filter.data, row.kind))) continue;
    const [first, ...rest] = pages.pages;
    if (first === undefined) continue;
    if (pages.pages.some((page) => page.activities.some((activity) => activity.id === row.id))) {
      continue;
    }
    client.setQueryData<Pages<TimelinePage>>(key, {
      ...pages,
      pages: [{ ...first, activities: [row, ...first.activities] }, ...rest],
    });
  }
}
