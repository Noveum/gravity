'use client';

import type { CompanyRow, PersonRow } from '@gravity/shared/records';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './fetcher.ts';
import {
  COMPANIES_ROOT,
  COMPANY_ROOT,
  LEAD_ROOT,
  LEADS_ROOT,
  PEOPLE_ROOT,
  PERSON_ROOT,
} from './keys.ts';
import { cancelLoadedQueries } from './pages.ts';
import { cachedCompany, cachedPerson, placeCompany, placePerson } from './record-cache.ts';
import { companyEnvelopeSchema, personEnvelopeSchema } from './schemas.ts';
import { useRetryToast } from './use-retry-toast.ts';

function mergedFields(
  current: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  if (patch === undefined) return { ...current };
  return Object.fromEntries(
    Object.entries({ ...current, ...patch }).filter(([, value]) => value !== null),
  );
}

export interface UpdatePersonInput {
  readonly person: PersonRow;
  readonly patch: Partial<
    Pick<
      PersonRow,
      | 'name'
      | 'emails'
      | 'phones'
      | 'linkedinUrl'
      | 'location'
      | 'timezone'
      | 'doNotContact'
      | 'fields'
    >
  >;
}

interface PersonContext {
  readonly previous: PersonRow;
}

export function useUpdatePerson() {
  const client = useQueryClient();
  const failed = useRetryToast();
  const mutation = useMutation<PersonRow, Error, UpdatePersonInput, PersonContext>({
    mutationFn: async (input) =>
      (
        await apiFetch(`/api/people/${encodeURIComponent(input.person.id)}`, personEnvelopeSchema, {
          method: 'PATCH',
          body: input.patch,
        })
      ).person,
    onMutate: async (input) => {
      await cancelLoadedQueries(
        client,
        PEOPLE_ROOT,
        PERSON_ROOT,
        COMPANY_ROOT,
        LEADS_ROOT,
        LEAD_ROOT,
      );
      const previous = cachedPerson(client, input.person.id) ?? input.person;
      const emails = input.patch.emails;
      placePerson(client, {
        ...previous,
        ...input.patch,
        fields: mergedFields(previous.fields, input.patch.fields),
        ...(emails === undefined ? {} : { primaryEmail: emails[0] ?? null }),
      });
      return { previous };
    },
    onError: (error, input, context) => {
      if (context !== undefined) placePerson(client, context.previous);
      failed(`Could not update ${input.person.name}`, error, () => mutation.mutate(input));
    },
    onSuccess: (person) => placePerson(client, person),
  });
  return mutation;
}

export interface UpdateCompanyInput {
  readonly company: CompanyRow;
  readonly patch: Partial<
    Pick<CompanyRow, 'name' | 'domains' | 'size' | 'segment' | 'location' | 'fields'>
  >;
}

interface CompanyContext {
  readonly previous: CompanyRow;
}

export function useUpdateCompany() {
  const client = useQueryClient();
  const failed = useRetryToast();
  const mutation = useMutation<CompanyRow, Error, UpdateCompanyInput, CompanyContext>({
    mutationFn: async (input) =>
      (
        await apiFetch(
          `/api/companies/${encodeURIComponent(input.company.id)}`,
          companyEnvelopeSchema,
          { method: 'PATCH', body: input.patch },
        )
      ).company,
    onMutate: async (input) => {
      await cancelLoadedQueries(
        client,
        COMPANIES_ROOT,
        COMPANY_ROOT,
        PERSON_ROOT,
        LEADS_ROOT,
        LEAD_ROOT,
      );
      const previous = cachedCompany(client, input.company.id) ?? input.company;
      const domains = input.patch.domains;
      placeCompany(client, {
        ...previous,
        ...input.patch,
        fields: mergedFields(previous.fields, input.patch.fields),
        ...(domains === undefined ? {} : { primaryDomain: domains[0] ?? null }),
      });
      return { previous };
    },
    onError: (error, input, context) => {
      if (context !== undefined) placeCompany(client, context.previous);
      failed(`Could not update ${input.company.name}`, error, () => mutation.mutate(input));
    },
    onSuccess: (company) => placeCompany(client, company),
  });
  return mutation;
}
