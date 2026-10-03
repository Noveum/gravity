'use client';

import type { CompanyRow, PersonRow } from '@gravity/shared/records';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './fetcher.ts';
import { COMPANIES_ROOT, COMPANY_ROOT, LEADS_ROOT, PEOPLE_ROOT, PERSON_ROOT } from './keys.ts';
import { cancelLoadedQueries } from './pages.ts';
import { placeCompany, placePerson } from './record-cache.ts';
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

export function useUpdatePerson() {
  const client = useQueryClient();
  const failed = useRetryToast();
  const mutation = useMutation({
    mutationFn: (input: UpdatePersonInput) =>
      apiFetch(`/api/people/${encodeURIComponent(input.person.id)}`, personEnvelopeSchema, {
        method: 'PATCH',
        body: input.patch,
      }),
    onMutate: async (input: UpdatePersonInput) => {
      await cancelLoadedQueries(client, PEOPLE_ROOT, PERSON_ROOT, COMPANY_ROOT, LEADS_ROOT);
      const emails = input.patch.emails;
      placePerson(client, {
        ...input.person,
        ...input.patch,
        fields: mergedFields(input.person.fields, input.patch.fields),
        ...(emails === undefined ? {} : { primaryEmail: emails[0] ?? null }),
      });
    },
    onError: (error, input) => {
      placePerson(client, input.person);
      failed(`Could not update ${input.person.name}`, error, () => mutation.mutate(input));
    },
    onSuccess: (result) => placePerson(client, result.person),
  });
  return mutation;
}

export interface UpdateCompanyInput {
  readonly company: CompanyRow;
  readonly patch: Partial<
    Pick<CompanyRow, 'name' | 'domains' | 'size' | 'segment' | 'location' | 'fields'>
  >;
}

export function useUpdateCompany() {
  const client = useQueryClient();
  const failed = useRetryToast();
  const mutation = useMutation({
    mutationFn: (input: UpdateCompanyInput) =>
      apiFetch(`/api/companies/${encodeURIComponent(input.company.id)}`, companyEnvelopeSchema, {
        method: 'PATCH',
        body: input.patch,
      }),
    onMutate: async (input: UpdateCompanyInput) => {
      await cancelLoadedQueries(client, COMPANIES_ROOT, COMPANY_ROOT, LEADS_ROOT);
      const domains = input.patch.domains;
      placeCompany(client, {
        ...input.company,
        ...input.patch,
        fields: mergedFields(input.company.fields, input.patch.fields),
        ...(domains === undefined ? {} : { primaryDomain: domains[0] ?? null }),
      });
    },
    onError: (error, input) => {
      placeCompany(client, input.company);
      failed(`Could not update ${input.company.name}`, error, () => mutation.mutate(input));
    },
    onSuccess: (result) => placeCompany(client, result.company),
  });
  return mutation;
}
