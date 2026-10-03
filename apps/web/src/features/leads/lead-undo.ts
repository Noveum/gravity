'use client';

import { LEAD_PRIORITY_LABELS } from '@gravity/shared/constants';
import {
  inverseLeadChange,
  type LeadRow,
  type LeadState,
  leadStateOf,
} from '@gravity/shared/records';
import type { LeadChange } from '@gravity/shared/validators';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { useToast } from '@/components/ui/toast.tsx';
import { useHotkey } from '@/lib/keyboard/index.ts';
import { cachedLead } from '@/lib/query/lead-cache.ts';
import { useChangeLeads } from '@/lib/query/use-lead-mutations.ts';
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

function settledState(before: LeadState, mine: LeadState, now: LeadState): LeadState {
  const keep = <K extends keyof LeadState>(key: K): LeadState[K] =>
    sameValue(now[key], mine[key]) ? before[key] : mine[key];
  return {
    pipelineId: mine.pipelineId,
    stageId: keep('stageId'),
    stageCategory: keep('stageCategory'),
    ownerId: keep('ownerId'),
    priority: keep('priority'),
    nextAction: keep('nextAction'),
    nextActionAt: keep('nextActionAt'),
    holdReason: keep('holdReason'),
    holdUntil: keep('holdUntil'),
    owedBy: keep('owedBy'),
    fields: settledFields(before.fields, mine.fields, now.fields),
  };
}

export function inverseChanges(
  before: readonly LeadRow[],
  after: readonly LeadRow[],
  current: readonly LeadRow[] = after,
): UndoGroup[] {
  const mine = new Map(after.map((lead) => [lead.id, lead]));
  const now = new Map(current.map((lead) => [lead.id, lead]));
  const groups = new Map<string, UndoGroup>();
  for (const previous of before) {
    const changed = mine.get(previous.id);
    if (changed === undefined) continue;
    const latest = now.get(previous.id) ?? changed;
    const mineState = leadStateOf(changed);
    const restore = settledState(leadStateOf(previous), mineState, leadStateOf(latest));
    const change = inverseLeadChange(restore, mineState);
    if (change === null) continue;
    const key = JSON.stringify(change);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { leads: [latest], change });
    else group.leads.push(latest);
  }
  return [...groups.values()];
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
  readonly after: readonly LeadRow[];
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

export function recordLeadChange(entry: UndoEntry): void {
  redoStack.length = 0;
  const later = undoStack.findIndex((item) => item.sequence > entry.sequence);
  if (later === -1) undoStack.push(entry);
  else undoStack.splice(later, 0, entry);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
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

function take(stack: UndoEntry[], entry: UndoEntry): boolean {
  const index = stack.indexOf(entry);
  if (index === -1) return false;
  stack.splice(index, 1);
  return true;
}

type Direction = 'undo' | 'redo';

function teammateNote(leads: readonly LeadRow[]): string {
  const [only] = leads;
  const subject =
    leads.length === 1 && only !== undefined ? only.key : `these ${leads.length} leads`;
  return `a teammate has changed ${subject} since`;
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
    async (entry: UndoEntry, direction: Direction): Promise<boolean> => {
      const [restore, mine] =
        direction === 'undo' ? [entry.before, entry.after] : [entry.after, entry.before];
      const current = mine.map((lead) => cachedLead(client, lead.id) ?? lead);
      const groups = inverseChanges(restore, mine, current);
      const replayed = new Set(groups.flatMap((group) => group.leads.map((lead) => lead.id)));
      const wanted = new Set(
        inverseChanges(restore, mine).flatMap((group) => group.leads.map((lead) => lead.id)),
      );
      const kept = current.filter((lead) => wanted.has(lead.id) && !replayed.has(lead.id));
      if (groups.length === 0) {
        const reason = kept.length === 0 ? 'nothing changed' : teammateNote(kept);
        toast({ title: `Nothing to ${direction}: ${reason}` });
        return false;
      }
      try {
        await Promise.all(
          groups.map((group) => mutateAsync({ leads: group.leads, change: group.change })),
        );
      } catch {
        return false;
      }
      toast({
        title: `${direction === 'undo' ? 'Undid' : 'Redid'}: ${entry.label}`,
        ...(kept.length === 0 ? {} : { description: `Left alone: ${teammateNote(kept)}.` }),
      });
      return true;
    },
    [client, mutateAsync, toast],
  );

  const undoEntry = useCallback(
    (entry: UndoEntry) => {
      if (!take(undoStack, entry)) return;
      replay(entry, 'undo').then((done) => {
        if (done) redoStack.push(entry);
      });
    },
    [replay],
  );

  const undo = useCallback(() => {
    const entry = undoStack.at(-1);
    if (entry !== undefined) undoEntry(entry);
  }, [undoEntry]);

  const redo = useCallback(() => {
    const entry = redoStack.at(-1);
    if (entry === undefined || !take(redoStack, entry)) return;
    replay(entry, 'redo').then((done) => {
      if (done) undoStack.push(entry);
    });
  }, [replay]);

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
