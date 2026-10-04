import { TIMELINE_FILTERS, timelineFilterMatches } from '@gravity/shared/constants';
import { companyFilterRegistry, personFilterRegistry } from '@gravity/shared/filters';
import type { ActivityRow, CompanyRow, EmploymentRow, PersonRow } from '@gravity/shared/records';
import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  COMPANIES_ROOT,
  COMPANY_ROOT,
  PEOPLE_ROOT,
  PERSON_ROOT,
  queryKeys,
  TIMELINE_ROOT,
} from './keys.ts';
import { cacheContextOf, patchLeads } from './lead-cache.ts';
import {
  cachedRows,
  isStale,
  matchesListQuery,
  newestListed,
  newestOf,
  newestRows,
  type Pages,
  placeInLists,
} from './pages.ts';
import type {
  Bootstrap,
  CompanyPage,
  CompanyRecord,
  PersonPage,
  PersonRecord,
  TimelinePage,
} from './schemas.ts';

export const readPeople = (page: PersonPage) => page.people;
export const writePeople = (page: PersonPage, people: PersonRow[]): PersonPage => ({
  ...page,
  people,
});
export const readCompanies = (page: CompanyPage) => page.companies;
export const writeCompanies = (page: CompanyPage, companies: CompanyRow[]): CompanyPage => ({
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

function companyRecords(client: QueryClient): (readonly [readonly unknown[], CompanyRecord])[] {
  return client
    .getQueriesData<CompanyRecord>({ queryKey: [COMPANY_ROOT] })
    .flatMap(([key, record]) => (record === undefined ? [] : [[key, record] as const]));
}

function personRecords(client: QueryClient): PersonRecord[] {
  return client
    .getQueriesData<PersonRecord>({ queryKey: [PERSON_ROOT] })
    .flatMap(([, record]) => (record === undefined ? [] : [record]));
}

export function allCachedPeople(client: QueryClient): PersonRow[] {
  return newestRows([
    ...cachedRows(client, PEOPLE_ROOT, readPeople),
    ...personRecords(client).map((record) => record.person),
    ...companyRecords(client).flatMap(([, record]) => record.people.map((entry) => entry.person)),
  ]);
}

export function allCachedCompanies(client: QueryClient): CompanyRow[] {
  return newestRows([
    ...cachedRows(client, COMPANIES_ROOT, readCompanies),
    ...companyRecords(client).map(([, record]) => record.company),
  ]);
}

export function cachedPerson(client: QueryClient, id: string): PersonRow | undefined {
  return newestOf([
    newestListed(client, PEOPLE_ROOT, id, readPeople),
    client.getQueryData<PersonRecord>(queryKeys.person(id))?.person,
    ...companyRecords(client).flatMap(([, record]) =>
      record.people.filter((entry) => entry.person.id === id).map((entry) => entry.person),
    ),
  ]);
}

export function cachedCompany(client: QueryClient, id: string): CompanyRow | undefined {
  return newestOf([
    newestListed(client, COMPANIES_ROOT, id, readCompanies),
    client.getQueryData<CompanyRecord>(queryKeys.company(id))?.company,
  ]);
}

function cachedEmployment(client: QueryClient, id: string): EmploymentRow | undefined {
  const personRecords = client
    .getQueriesData<PersonRecord>({ queryKey: [PERSON_ROOT] })
    .flatMap(([, record]) => record?.employments ?? []);
  const onCompanies = companyRecords(client).flatMap(([, record]) =>
    record.people.map((entry) => entry.employment),
  );
  return newestOf([...personRecords, ...onCompanies].filter((job) => job.id === id));
}

export function placePerson(client: QueryClient, row: PersonRow): void {
  if (isStale(cachedPerson(client, row.id), row)) return;
  const record = client.getQueryData<PersonRecord>(queryKeys.person(row.id));
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
  for (const [key, company] of companyRecords(client)) {
    if (!company.people.some((entry) => entry.person.id === row.id)) continue;
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
  if (isStale(cachedCompany(client, row.id), row)) return;
  const record = client.getQueryData<CompanyRecord>(queryKeys.company(row.id));
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

function placeEmploymentOnCompany(client: QueryClient, row: EmploymentRow): void {
  const key = queryKeys.company(row.companyId);
  const record = client.getQueryData<CompanyRecord>(key);
  if (record === undefined) return;
  const listed = record.people.find((entry) => entry.person.id === row.personId);
  const sameJob = listed !== undefined && listed.employment.id === row.id;
  if (!row.isCurrent) {
    if (!sameJob) return;
    client.setQueryData<CompanyRecord>(key, {
      ...record,
      people: record.people.filter((entry) => entry.person.id !== row.personId),
    });
    return;
  }
  const person = listed?.person ?? cachedPerson(client, row.personId);
  if (person === undefined) {
    client.invalidateQueries({ queryKey: key, exact: true }).catch(() => undefined);
    return;
  }
  const entry = { person, employment: row };
  client.setQueryData<CompanyRecord>(key, {
    ...record,
    people:
      listed === undefined
        ? [...record.people, entry]
        : record.people.map((known) => (known.person.id === row.personId ? entry : known)),
  });
}

export function applyEmployment(client: QueryClient, row: EmploymentRow): void {
  if (isStale(cachedEmployment(client, row.id), row)) return;
  placeEmploymentOnCompany(client, row);
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

export const readActivities = (page: TimelinePage) => page.activities;
export const writeActivities = (page: TimelinePage, activities: ActivityRow[]): TimelinePage => ({
  ...page,
  activities,
});

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
