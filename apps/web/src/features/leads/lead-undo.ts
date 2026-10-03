'use client';

import { LEAD_PRIORITY_LABELS } from '@gravity/shared/constants';
import {
  inverseLeadChange,
  type LeadRow,
  type LeadState,
  leadStateOf,
} from '@gravity/shared/records';
import type { LeadChange } from '@gravity/shared/validators';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { useToast } from '@/components/ui/toast.tsx';
import { useHotkey } from '@/lib/keyboard/index.ts';
import { cachedLead, placeLead } from '@/lib/query/lead-cache.ts';
import { useChangeLeads } from '@/lib/query/use-lead-mutations.ts';
import { fetchLead } from '@/lib/query/use-leads.ts';
import { cacheMayBeStale, noteServerRow } from '@/lib/realtime/delta-bridge.tsx';
import { asPriority } from './lead-glyphs.tsx';

export interface UndoGroup {
  readonly leads: LeadRow[];
  readonly change: LeadChange;
}

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function settledFields(
  before: LeadState['fields'],
  mine: LeadState['fields'],
  now: LeadState['fields'],
): Record<string, unknown> {
  const keys = new Set([...Object.keys(before), ...Object.keys(mine)]);
  const settled: Record<string, unknown> = {};
  for (const key of keys) {
    const value = sameValue(now[key], mine[key]) ? before[key] : mine[key];
    if (value !== undefined) settled[key] = value;
  }
  return settled;
}

function isClosed(state: LeadState): boolean {
  return state.stageCategory === 'won' || state.stageCategory === 'lost';
}

function settledState(before: LeadState, mine: LeadState, now: LeadState): LeadState {
  const keep = <K extends keyof LeadState>(key: K): LeadState[K] =>
    sameValue(now[key], mine[key]) ? before[key] : mine[key];
  const stageHeld =
    sameValue(now.stageId, mine.stageId) && sameValue(now.stageCategory, mine.stageCategory);
  const stageId = stageHeld ? before.stageId : mine.stageId;
  const restoresStage = stageId !== mine.stageId;
  const keepWithStage = <K extends 'holdReason' | 'holdUntil'>(key: K): LeadState[K] =>
    stageHeld ? keep(key) : mine[key];
  const keepAction = <K extends 'nextAction' | 'nextActionAt'>(key: K): LeadState[K] =>
    !restoresStage && isClosed(now) ? mine[key] : keep(key);
  return {
    pipelineId: mine.pipelineId,
    stageId,
    stageCategory: stageHeld ? before.stageCategory : mine.stageCategory,
    ownerId: keep('ownerId'),
    priority: keep('priority'),
    nextAction: keepAction('nextAction'),
    nextActionAt: keepAction('nextActionAt'),
    holdReason: keepWithStage('holdReason'),
    holdUntil: keepWithStage('holdUntil'),
    owedBy: keep('owedBy'),
    fields: settledFields(before.fields, mine.fields, now.fields),
  };
}

export interface UndoPlan {
  readonly groups: UndoGroup[];
  readonly kept: LeadRow[];
}

export function planUndo(
  before: readonly LeadRow[],
  after: readonly LeadRow[],
  current: readonly LeadRow[] = after,
): UndoPlan {
  const mine = new Map(after.map((lead) => [lead.id, lead]));
  const now = new Map(current.map((lead) => [lead.id, lead]));
  const groups = new Map<string, UndoGroup>();
  const kept: LeadRow[] = [];
  for (const previous of before) {
    const changed = mine.get(previous.id);
    if (changed === undefined) continue;
    const latest = now.get(previous.id) ?? changed;
    const mineState = leadStateOf(changed);
    const restore = settledState(leadStateOf(previous), mineState, leadStateOf(latest));
    const change = inverseLeadChange(restore, mineState);
    const wanted = inverseLeadChange(leadStateOf(previous), mineState);
    if (JSON.stringify(change) !== JSON.stringify(wanted)) kept.push(latest);
    if (change === null) continue;
    const key = JSON.stringify(change);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { leads: [latest], change });
    else group.leads.push(latest);
  }
  return { groups: [...groups.values()], kept };
}

export function inverseChanges(
  before: readonly LeadRow[],
  after: readonly LeadRow[],
  current: readonly LeadRow[] = after,
): UndoGroup[] {
  return planUndo(before, after, current).groups;
}

export interface ChangeNames {
  readonly stageName: (id: string) => string | undefined;
  readonly memberName: (id: string) => string | undefined;
}

export function leadsLabel(count: number): string {
  return count === 1 ? '1 lead' : `${count} leads`;
}

export function describeLeadChange(
  change: LeadChange,
  names: ChangeNames,
  subject: string,
): string {
  if (change.type === 'hold') return `Put ${subject} on hold`;
  if (change.type === 'close') return `Closed ${subject}`;
  const { patch } = change;
  if (patch.stageId !== undefined) {
    return `Moved ${subject} to ${names.stageName(patch.stageId) ?? 'another stage'}`;
  }
  if (patch.ownerId === null) return `Unassigned ${subject}`;
  if (patch.ownerId !== undefined) {
    return `Assigned ${subject} to ${names.memberName(patch.ownerId) ?? 'a teammate'}`;
  }
  if (patch.priority !== undefined) {
    return `Set priority to ${LEAD_PRIORITY_LABELS[asPriority(patch.priority)]} on ${subject}`;
  }
  if (patch.nextAction !== undefined || patch.nextActionAt !== undefined) {
    return `Set the next action on ${subject}`;
  }
  return `Updated ${subject}`;
}

export function describeChange(change: LeadChange, names: ChangeNames, count: number): string {
  return describeLeadChange(change, names, leadsLabel(count));
}

export interface UndoEntry {
  readonly sequence: number;
  readonly before: readonly LeadRow[];
  readonly after: Promise<readonly LeadRow[]>;
  readonly label: string;
}

const MAX_HISTORY = 20;
const undoStack: UndoEntry[] = [];
const redoStack: UndoEntry[] = [];
let lastSequence = 0;

export function nextUndoSequence(): number {
  lastSequence += 1;
  return lastSequence;
}

function insertBySequence(stack: UndoEntry[], entry: UndoEntry): void {
  const later = stack.findIndex((item) => item.sequence > entry.sequence);
  if (later === -1) stack.push(entry);
  else stack.splice(later, 0, entry);
  if (stack.length > MAX_HISTORY) stack.shift();
}

export function recordLeadChange(entry: UndoEntry): void {
  redoStack.length = 0;
  insertBySequence(undoStack, entry);
}

export function isLeadChangeRecorded(entry: UndoEntry): boolean {
  return undoStack.includes(entry);
}

function take(stack: UndoEntry[], entry: UndoEntry): boolean {
  const index = stack.indexOf(entry);
  if (index === -1) return false;
  stack.splice(index, 1);
  return true;
}

export function forgetLeadChange(entry: UndoEntry): void {
  take(undoStack, entry);
  take(redoStack, entry);
}

export function clearLeadHistory(): void {
  undoStack.length = 0;
  redoStack.length = 0;
}

let historyWorkspace: string | null = null;

export function bindLeadHistory(workspaceId: string): void {
  if (historyWorkspace !== null && historyWorkspace !== workspaceId) clearLeadHistory();
  historyWorkspace = workspaceId;
}

type Direction = 'undo' | 'redo';
type Outcome = 'done' | 'dropped' | 'retry';

const NAMED_KEYS = 3;

export function keysLabel(leads: readonly LeadRow[]): string {
  const keys = leads.map((lead) => lead.key);
  const named = keys.slice(0, NAMED_KEYS);
  const rest = keys.length - named.length;
  if (rest > 0) return `${named.join(', ')} and ${rest} more`;
  const last = named.pop();
  if (last === undefined) return '';
  return named.length === 0 ? last : `${named.join(', ')} and ${last}`;
}

async function currentRows(client: QueryClient, rows: readonly LeadRow[]): Promise<LeadRow[]> {
  if (!cacheMayBeStale(client)) return rows.map((lead) => cachedLead(client, lead.id) ?? lead);
  const fresh = await Promise.all(rows.map((lead) => fetchLead(lead.id)));
  for (const lead of fresh) {
    noteServerRow(client, 'lead', lead.id, lead.syncId);
    placeLead(client, lead);
  }
  return fresh;
}

async function settledAfter(entry: UndoEntry): Promise<readonly LeadRow[] | null> {
  try {
    return await entry.after;
  } catch {
    return null;
  }
}

export interface LeadUndo {
  readonly undo: () => void;
  readonly redo: () => void;
  readonly undoEntry: (entry: UndoEntry) => void;
}

export function useLeadUndo(): LeadUndo {
  const client = useQueryClient();
  const { mutateAsync } = useChangeLeads();
  const { toast } = useToast();

  const replay = useCallback(
    async (entry: UndoEntry, direction: Direction): Promise<Outcome> => {
      const after = await settledAfter(entry);
      if (after === null) return 'dropped';
      const [restore, mine] = direction === 'undo' ? [entry.before, after] : [after, entry.before];
      let current: LeadRow[];
      try {
        current = await currentRows(client, mine);
      } catch {
        toast({
          title: `Could not ${direction}: the leads did not load. Try again.`,
          tone: 'danger',
        });
        return 'retry';
      }
      const { groups, kept } = planUndo(restore, mine, current);
      if (groups.length === 0) {
        const reason =
          kept.length === 0 ? 'nothing changed' : `a teammate has changed ${keysLabel(kept)} since`;
        toast({ title: `Nothing to ${direction}: ${reason}` });
        return 'dropped';
      }
      try {
        await Promise.all(
          groups.map((group) => mutateAsync({ leads: group.leads, change: group.change })),
        );
      } catch {
        return 'dropped';
      }
      toast({
        title: `${direction === 'undo' ? 'Undid' : 'Redid'}: ${entry.label}`,
        ...(kept.length === 0
          ? {}
          : { description: `Kept a teammate's later change on ${keysLabel(kept)}.` }),
      });
      return 'done';
    },
    [client, mutateAsync, toast],
  );

  const run = useCallback(
    (entry: UndoEntry, direction: Direction) => {
      const [from, to] = direction === 'undo' ? [undoStack, redoStack] : [redoStack, undoStack];
      if (!take(from, entry)) return;
      replay(entry, direction).then((outcome) => {
        if (outcome === 'done') insertBySequence(to, entry);
        if (outcome === 'retry') insertBySequence(from, entry);
      });
    },
    [replay],
  );

  const undoEntry = useCallback((entry: UndoEntry) => run(entry, 'undo'), [run]);

  const undo = useCallback(() => {
    const entry = undoStack.at(-1);
    if (entry !== undefined) run(entry, 'undo');
  }, [run]);

  const redo = useCallback(() => {
    const entry = redoStack.at(-1);
    if (entry !== undefined) run(entry, 'redo');
  }, [run]);

  return { undo, redo, undoEntry };
}

export function LeadUndoHotkeys({ workspaceId }: { readonly workspaceId: string }) {
  const { undo, redo } = useLeadUndo();
  useEffect(() => bindLeadHistory(workspaceId), [workspaceId]);
  useHotkey('mod+z', undo, { label: 'Undo the last change', section: 'General' });
  useHotkey('mod+shift+z', redo, {
    label: 'Redo the last change',
    section: 'General',
    aliases: ['mod+y'],
  });
  return null;
}
