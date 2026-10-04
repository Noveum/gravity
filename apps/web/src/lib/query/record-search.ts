import { searchTokens } from '@gravity/shared/filters';
import type { CompanyRow, LeadRow, PersonRow } from '@gravity/shared/records';
import type { QueryClient } from '@tanstack/react-query';
import { allCachedLeads } from './lead-cache.ts';
import { allCachedCompanies, allCachedPeople } from './record-cache.ts';

export interface PersonHit {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly companyName: string | null;
  readonly linkedinUrl: string | null;
}

export interface RecordProbe {
  readonly email: string | null;
  readonly linkedinUrl: string | null;
  readonly name: string | null;
  readonly domain: string | null;
}

export interface LocalHits {
  readonly people: PersonHit[];
  readonly companies: CompanyRow[];
  readonly leads: LeadRow[];
}

export const EMPTY_HITS: LocalHits = { people: [], companies: [], leads: [] };

export const HIT_LIMIT = 8;

const PENDING_PERSON = 'pending-';

export function personHitOf(person: PersonRow): PersonHit {
  return {
    id: person.id,
    name: person.name,
    email: person.primaryEmail,
    companyName: person.companyName,
    linkedinUrl: person.linkedinUrl,
  };
}

export function mergeHits<T extends { readonly id: string }>(
  first: readonly T[],
  second: readonly T[],
  limit = Number.POSITIVE_INFINITY,
): T[] {
  const seen = new Set(first.map((row) => row.id));
  return [...first, ...second.filter((row) => !seen.has(row.id))].slice(0, limit);
}

function isPending(lead: LeadRow): boolean {
  return lead.personId.startsWith(PENDING_PERSON);
}

function cachedPeople(client: QueryClient): PersonHit[] {
  const byId = new Map<string, PersonHit>();
  const known = new Set<string>();
  for (const person of allCachedPeople(client)) {
    known.add(person.id);
    if (person.archivedAt === null) byId.set(person.id, personHitOf(person));
  }
  for (const lead of allCachedLeads(client)) {
    if (known.has(lead.personId) || byId.has(lead.personId) || isPending(lead)) continue;
    byId.set(lead.personId, {
      id: lead.personId,
      name: lead.personName,
      email: lead.personEmail,
      companyName: lead.companyName,
      linkedinUrl: lead.personLinkedinUrl,
    });
  }
  return [...byId.values()];
}

function matches(fields: readonly (string | null)[], tokens: readonly string[]): boolean {
  const haystack = fields
    .filter((field): field is string => field !== null)
    .map((field) => field.toLowerCase());
  return tokens.every((token) => haystack.some((field) => field.includes(token)));
}

export function searchCachedRecords(
  client: QueryClient,
  term: string,
  limit = HIT_LIMIT,
): LocalHits {
  const tokens = searchTokens(term);
  if (tokens.length === 0) return EMPTY_HITS;
  return {
    people: cachedPeople(client)
      .filter((person) => matches([person.name, person.email, person.companyName], tokens))
      .slice(0, limit),
    companies: allCachedCompanies(client)
      .filter(
        (company) =>
          company.archivedAt === null && matches([company.name, company.primaryDomain], tokens),
      )
      .slice(0, limit),
    leads: allCachedLeads(client)
      .filter(
        (lead) =>
          lead.archivedAt === null &&
          !isPending(lead) &&
          matches([lead.key, lead.personName], tokens),
      )
      .slice(0, limit),
  };
}

export function matchCachedPeople(client: QueryClient, probe: RecordProbe): PersonHit[] {
  const email = probe.email?.toLowerCase() ?? null;
  const name = probe.name?.trim().toLowerCase() ?? null;
  return cachedPeople(client).filter(
    (person) =>
      (email !== null && person.email?.toLowerCase() === email) ||
      (probe.linkedinUrl !== null && person.linkedinUrl === probe.linkedinUrl) ||
      (name !== null && name.length > 0 && person.name.toLowerCase() === name),
  );
}

export function matchCachedCompanies(client: QueryClient, domain: string | null): CompanyRow[] {
  if (domain === null) return [];
  return allCachedCompanies(client).filter(
    (company) => company.archivedAt === null && company.domains.includes(domain),
  );
}
