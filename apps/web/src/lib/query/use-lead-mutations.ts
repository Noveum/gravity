'use client';

import { type LeadRow, leadStateOf, resolveLeadChange } from '@gravity/shared/records';
import type { LeadChange, quickCreateSchema } from '@gravity/shared/validators';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { noteServerRow } from '@/lib/realtime/delta-bridge.tsx';
import { ApiError, apiFetch } from './fetcher.ts';
import {
  COMPANIES_ROOT,
  COMPANY_ROOT,
  LEAD_ROOT,
  LEADS_ROOT,
  PEOPLE_ROOT,
  PERSON_ROOT,
  queryKeys,
} from './keys.ts';
import { cachedLead, placeLead, removeLead } from './lead-cache.ts';
import { cancelLoadedQueries } from './pages.ts';
import { placeCompany, placePerson } from './record-cache.ts';
import {
  type Bootstrap,
  leadEnvelopeSchema,
  leadsEnvelopeSchema,
  quickCreateEnvelopeSchema,
} from './schemas.ts';
import { useRetryToast } from './use-retry-toast.ts';

export interface ChangeLeadsInput {
  readonly leads: readonly LeadRow[];
  readonly change: LeadChange;
}

interface ChangeLeadsContext {
  readonly previous: readonly LeadRow[];
}

function optimisticRow(
  lead: LeadRow,
  change: LeadChange,
  bootstrap: Bootstrap | undefined,
): LeadRow | null {
  try {
    return { ...lead, ...resolveLeadChange(leadStateOf(lead), change, bootstrap?.stages ?? []) };
  } catch {
    return null;
  }
}

function failureTitle(leads: readonly LeadRow[]): string {
  const [only] = leads;
  return leads.length === 1 && only !== undefined
    ? `Could not update ${only.key}`
    : `Could not update ${leads.length} leads`;
}

async function sendChange(input: ChangeLeadsInput): Promise<LeadRow[]> {
  const [only] = input.leads;
  if (input.leads.length === 1 && only !== undefined) {
    const result = await apiFetch(`/api/leads/${encodeURIComponent(only.id)}`, leadEnvelopeSchema, {
      method: 'PATCH',
      body: input.change,
    });
    return [result.lead];
  }
  const result = await apiFetch('/api/leads/bulk', leadsEnvelopeSchema, {
    method: 'POST',
    body: { leadIds: input.leads.map((lead) => lead.id), change: input.change },
  });
  return result.leads;
}

export function useChangeLeads() {
  const client = useQueryClient();
  const failed = useRetryToast();
  const mutation = useMutation<LeadRow[], Error, ChangeLeadsInput, ChangeLeadsContext>({
    mutationFn: sendChange,
    onMutate: async (input) => {
      await cancelLoadedQueries(client, LEADS_ROOT, LEAD_ROOT, PERSON_ROOT, COMPANY_ROOT);
      const bootstrap = client.getQueryData<Bootstrap>(queryKeys.bootstrap);
      const previous = input.leads.map((lead) => cachedLead(client, lead.id) ?? lead);
      for (const lead of previous) {
        const optimistic = optimisticRow(lead, input.change, bootstrap);
        if (optimistic !== null) placeLead(client, optimistic);
      }
      return { previous };
    },
    onError: (error, input, context) => {
      for (const lead of context?.previous ?? []) placeLead(client, lead);
      failed(failureTitle(input.leads), error, () => mutation.mutate(input));
    },
    onSuccess: (leads) => {
      for (const lead of leads) {
        noteServerRow(client, 'lead', lead.id, lead.syncId);
        placeLead(client, lead);
      }
    },
  });
  return mutation;
}

export type QuickCreateBody = z.input<typeof quickCreateSchema> & { readonly leadId: string };

export interface QuickCreateInput {
  readonly body: QuickCreateBody;
  readonly preview: LeadRow;
}

const QUICK_CREATE_ROOTS = [
  LEADS_ROOT,
  LEAD_ROOT,
  PEOPLE_ROOT,
  PERSON_ROOT,
  COMPANIES_ROOT,
  COMPANY_ROOT,
] as const;

const REFUSAL_STATUSES: readonly number[] = [409, 422];

export interface QuickCreateOptions {
  readonly onRefused?: (input: QuickCreateInput, message: string) => boolean;
}

export function useQuickCreateLead(options: QuickCreateOptions = {}) {
  const client = useQueryClient();
  const failed = useRetryToast();
  const mutation = useMutation({
    mutationFn: (input: QuickCreateInput) =>
      apiFetch('/api/leads/quick', quickCreateEnvelopeSchema, { method: 'POST', body: input.body }),
    onMutate: async (input: QuickCreateInput) => {
      await cancelLoadedQueries(client, ...QUICK_CREATE_ROOTS);
      placeLead(client, input.preview);
    },
    onError: (error, input) => {
      removeLead(client, input.preview.id);
      const refused = error instanceof ApiError && REFUSAL_STATUSES.includes(error.status);
      if (refused && options.onRefused?.(input, error.message) === true) return;
      failed(`Could not add ${input.preview.personName}`, error, () => mutation.mutate(input));
    },
    onSuccess: async (result) => {
      await cancelLoadedQueries(client, ...QUICK_CREATE_ROOTS);
      noteServerRow(client, 'person', result.person.id, result.person.syncId);
      placePerson(client, result.person);
      if (result.company !== null) {
        noteServerRow(client, 'company', result.company.id, result.company.syncId);
        placeCompany(client, result.company);
      }
      noteServerRow(client, 'lead', result.lead.id, result.lead.syncId);
      placeLead(client, result.lead);
    },
  });
  return mutation;
}
