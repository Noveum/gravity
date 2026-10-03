'use client';

import type { SyncAction, SyncModel } from '@gravity/shared/events';
import {
  activityRowSchema,
  companyRowSchema,
  employmentRowSchema,
  leadRowSchema,
  personRowSchema,
} from '@gravity/shared/records';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { z } from 'zod';
import { applyBootstrapDelta } from '@/lib/query/bootstrap-cache.ts';
import { clientId } from '@/lib/query/client-id.ts';
import {
  BOOTSTRAP_ROOT,
  COMPANIES_ROOT,
  COMPANY_ROOT,
  LEAD_ROOT,
  LEADS_ROOT,
  PEOPLE_ROOT,
  PERSON_ROOT,
  TIMELINE_ROOT,
} from '@/lib/query/keys.ts';
import { placeLead, removeLead } from '@/lib/query/lead-cache.ts';
import {
  applyEmployment,
  placeCompany,
  placePerson,
  prependActivity,
} from '@/lib/query/record-cache.ts';
import { type DeltaHandler, registerDeltaHandler } from './delta-bridge.tsx';

export function isOwnEcho(action: SyncAction): boolean {
  return action.originClientId !== undefined && action.originClientId === clientId();
}

const ECHOED_MODELS: ReadonlySet<SyncModel> = new Set(['lead', 'person', 'company']);

const LEAD_ROOTS = [LEADS_ROOT, LEAD_ROOT, PERSON_ROOT, COMPANY_ROOT] as const;

const BOOTSTRAP_MODELS = [
  'organization',
  'member',
  'brand',
  'pipeline',
  'stage',
  'field_definition',
  'saved_view',
] as const satisfies readonly SyncModel[];

type CrmModel =
  | 'lead'
  | 'person'
  | 'company'
  | 'employment'
  | 'activity'
  | (typeof BOOTSTRAP_MODELS)[number];

const BOOTSTRAP_ROOTS = [BOOTSTRAP_ROOT] as const;

const AFFECTED_ROOTS: Record<CrmModel, readonly string[]> = {
  lead: LEAD_ROOTS,
  person: [PEOPLE_ROOT, ...LEAD_ROOTS],
  company: [COMPANIES_ROOT, ...LEAD_ROOTS],
  employment: LEAD_ROOTS,
  activity: [TIMELINE_ROOT],
  organization: BOOTSTRAP_ROOTS,
  member: BOOTSTRAP_ROOTS,
  brand: BOOTSTRAP_ROOTS,
  pipeline: BOOTSTRAP_ROOTS,
  stage: BOOTSTRAP_ROOTS,
  field_definition: BOOTSTRAP_ROOTS,
  saved_view: BOOTSTRAP_ROOTS,
};

function refetchRoots(client: QueryClient, roots: readonly string[]): void {
  for (const root of roots) {
    client.invalidateQueries({ queryKey: [root] }).catch(() => undefined);
  }
}

function placing<T>(
  model: CrmModel,
  schema: z.ZodType<T>,
  place: (client: QueryClient, row: T) => void,
): DeltaHandler {
  return (action, client) => {
    const parsed = schema.safeParse(action.data);
    if (parsed.success) {
      place(client, parsed.data);
      return;
    }
    console.warn(
      `Could not read the ${action.model} ${action.action} for ${action.modelId}, refetching.`,
    );
    refetchRoots(client, AFFECTED_ROOTS[model]);
  };
}

const placeLeadRow = placing('lead', leadRowSchema, placeLead);

function handleLead(action: SyncAction, client: QueryClient): void {
  if (action.action === 'delete') {
    removeLead(client, action.modelId);
    return;
  }
  placeLeadRow(action, client);
}

function handleBootstrap(action: SyncAction, client: QueryClient): void {
  applyBootstrapDelta(client, action);
}

export const CRM_DELTA_HANDLERS: readonly (readonly [CrmModel, DeltaHandler])[] = [
  ['lead', handleLead],
  ['person', placing('person', personRowSchema, placePerson)],
  ['company', placing('company', companyRowSchema, placeCompany)],
  ['employment', placing('employment', employmentRowSchema, applyEmployment)],
  ['activity', placing('activity', activityRowSchema, prependActivity)],
  ...BOOTSTRAP_MODELS.map((model) => [model, handleBootstrap] as const),
];

interface FetchWatch {
  readonly due: Map<string, (() => void)[]>;
}

const watches = new WeakMap<QueryClient, FetchWatch>();

function watchOf(client: QueryClient): FetchWatch {
  const existing = watches.get(client);
  if (existing !== undefined) return existing;
  const watch: FetchWatch = { due: new Map() };
  watches.set(client, watch);
  const stop = client.getQueryCache().subscribe((event) => {
    const hash = event.query.queryHash;
    if (event.type === 'removed') {
      watch.due.delete(hash);
    } else if (event.type === 'updated' && event.query.state.fetchStatus === 'idle') {
      const replays = watch.due.get(hash);
      if (replays === undefined) return;
      watch.due.delete(hash);
      for (const replay of replays) replay();
    } else {
      return;
    }
    if (watch.due.size === 0) {
      stop();
      watches.delete(client);
    }
  });
  return watch;
}

function replayAfterFetches(
  client: QueryClient,
  roots: readonly string[],
  replay: () => void,
): void {
  const fetching = client.getQueryCache().findAll({
    fetchStatus: 'fetching',
    predicate: (query) => roots.some((root) => query.queryKey[0] === root),
  });
  if (fetching.length === 0) return;
  const watch = watchOf(client);
  for (const query of fetching) {
    const replays = watch.due.get(query.queryHash) ?? [];
    watch.due.set(query.queryHash, [...replays, replay]);
  }
}

function crmHandler(model: CrmModel, handler: DeltaHandler): DeltaHandler {
  const skipsEchoes = ECHOED_MODELS.has(model);
  const roots = AFFECTED_ROOTS[model];
  return (action, client) => {
    if (skipsEchoes && isOwnEcho(action)) return;
    handler(action, client);
    replayAfterFetches(client, roots, () => handler(action, client));
  };
}

export function registerCrmDeltaHandlers(): () => void {
  const disposers = CRM_DELTA_HANDLERS.map(([model, handler]) =>
    registerDeltaHandler(model, crmHandler(model, handler)),
  );
  return () => {
    for (const dispose of disposers) dispose();
  };
}

export function CrmDeltaHandlers() {
  useEffect(() => registerCrmDeltaHandlers(), []);
  return null;
}
