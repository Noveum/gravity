'use client';

import {
  useDeltaHandler,
  useRealtimeStatus,
  useResumeHandler,
  useScopeSubscription,
} from '@gravity/realtime-client/react';
import {
  type SyncAction,
  type SyncCatchup,
  type SyncModel,
  scopes,
  syncCatchupSchema,
} from '@gravity/shared/events';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { apiFetch } from '@/lib/api/client.ts';

export type DeltaHandler = (action: SyncAction, client: QueryClient) => void;

interface AppliedState {
  readonly byRecord: Map<string, number>;
  readonly answered: Map<string, number>;
  cursor: number;
}

const handlers = new Map<SyncModel, Set<DeltaHandler>>();
const appliedByClient = new WeakMap<QueryClient, AppliedState>();

function appliedStateOf(client: QueryClient): AppliedState {
  const existing = appliedByClient.get(client);
  if (existing !== undefined) return existing;
  const created: AppliedState = { byRecord: new Map(), answered: new Map(), cursor: 0 };
  appliedByClient.set(client, created);
  return created;
}

interface Freshness {
  live: boolean;
  catchingUp: number;
}

const freshnessByClient = new WeakMap<QueryClient, Freshness>();

function freshnessOf(client: QueryClient): Freshness {
  const existing = freshnessByClient.get(client);
  if (existing !== undefined) return existing;
  const created: Freshness = { live: false, catchingUp: 0 };
  freshnessByClient.set(client, created);
  return created;
}

export function markRealtimeLive(client: QueryClient, live: boolean): void {
  freshnessOf(client).live = live;
}

export function beginCatchUp(client: QueryClient): () => void {
  const state = freshnessOf(client);
  state.catchingUp += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    state.catchingUp -= 1;
  };
}

export function cacheMayBeStale(client: QueryClient): boolean {
  const state = freshnessByClient.get(client);
  return state !== undefined && (!state.live || state.catchingUp > 0);
}

export function registerDeltaHandler(model: SyncModel, handler: DeltaHandler): () => void {
  const set = handlers.get(model) ?? new Set<DeltaHandler>();
  set.add(handler);
  handlers.set(model, set);
  return () => {
    set.delete(handler);
  };
}

function recordKey(model: SyncModel, id: string): string {
  return `${model}:${id}`;
}

function raise(map: Map<string, number>, record: string, syncId: number): void {
  if (syncId > (map.get(record) ?? 0)) map.set(record, syncId);
}

export function noteServerRow(
  client: QueryClient,
  model: SyncModel,
  id: string,
  syncId: number,
): void {
  const state = appliedStateOf(client);
  const record = recordKey(model, id);
  raise(state.byRecord, record, syncId);
  raise(state.answered, record, syncId);
}

export function isSuperseded(action: SyncAction, client: QueryClient): boolean {
  const state = appliedByClient.get(client);
  if (state === undefined) return false;
  const record = recordKey(action.model, action.modelId);
  return (
    (state.byRecord.get(record) ?? 0) > action.syncId ||
    (state.answered.get(record) ?? 0) >= action.syncId
  );
}

export function applyDelta(action: SyncAction, client: QueryClient): void {
  const state = appliedStateOf(client);
  if (action.syncId > state.cursor) state.cursor = action.syncId;
  const record = recordKey(action.model, action.modelId);
  if (action.syncId <= (state.byRecord.get(record) ?? 0)) return;
  state.byRecord.set(record, action.syncId);
  for (const handler of handlers.get(action.model) ?? []) handler(action, client);
}

export function lastAppliedSyncId(client: QueryClient): number {
  return appliedByClient.get(client)?.cursor ?? 0;
}

function advanceCursor(client: QueryClient, syncId: number): void {
  const state = appliedStateOf(client);
  if (syncId > state.cursor) state.cursor = syncId;
}

export async function catchUp(
  client: QueryClient,
  fetchPage: (since: number | null, cursor: number) => Promise<SyncCatchup>,
  seededCursor = 0,
): Promise<void> {
  let cursor = Math.max(lastAppliedSyncId(client), seededCursor);
  let since: number | null = null;
  for (;;) {
    const page = await fetchPage(since, cursor);
    if (page.reset) {
      advanceCursor(client, page.syncId);
      await client.invalidateQueries();
      return;
    }
    for (const action of page.actions) applyDelta(action, client);
    const stalled = page.actions.length === 0 || (since !== null && page.syncId <= since);
    if (!page.truncated || stalled) return;
    since = page.syncId;
    cursor = Math.max(cursor, page.syncId);
  }
}

export function useDeltaSink(): (action: SyncAction) => void {
  const client = useQueryClient();
  useEffect(
    () => () => {
      appliedByClient.delete(client);
    },
    [client],
  );
  return useCallback((action: SyncAction) => applyDelta(action, client), [client]);
}

function catchUpPath(organizationId: string, since: number | null, cursor: number): string {
  const query = new URLSearchParams({ organizationId, cursor: String(cursor) });
  if (since !== null) query.set('since', String(since));
  return `/api/sync?${query}`;
}

export interface DeltaBridgeProps {
  readonly organizationId: string;
  readonly userId: string;
  readonly initialCursor: number;
}

export function DeltaBridge({ organizationId, userId, initialCursor }: DeltaBridgeProps) {
  const client = useQueryClient();
  const sink = useDeltaSink();
  const status = useRealtimeStatus();
  const resumeAbort = useRef<AbortController | null>(null);
  const firstReadyHandled = useRef(false);

  useScopeSubscription(
    useMemo(
      () => [scopes.workspace(organizationId), scopes.user(userId)],
      [organizationId, userId],
    ),
  );

  useDeltaHandler(
    useCallback(
      (actions: SyncAction[]) => {
        for (const action of actions) sink(action);
      },
      [sink],
    ),
  );

  useEffect(() => () => resumeAbort.current?.abort(), []);

  const runCatchUp = useCallback(() => {
    resumeAbort.current?.abort();
    const controller = new AbortController();
    resumeAbort.current = controller;
    const endCatchUp = beginCatchUp(client);
    catchUp(
      client,
      (since, cursor) =>
        apiFetch(catchUpPath(organizationId, since, cursor), syncCatchupSchema, {
          signal: controller.signal,
        }),
      initialCursor,
    )
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error('Realtime catch-up failed, refetching what is on screen.', error);
        client.invalidateQueries().catch(() => undefined);
      })
      .finally(endCatchUp);
  }, [client, initialCursor, organizationId]);

  useEffect(() => markRealtimeLive(client, status === 'open'), [client, status]);

  useEffect(() => {
    if (status !== 'open' || firstReadyHandled.current) return;
    firstReadyHandled.current = true;
    runCatchUp();
  }, [status, runCatchUp]);

  useResumeHandler(runCatchUp);

  return null;
}
