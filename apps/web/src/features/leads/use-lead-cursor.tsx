'use client';

import { LEAD_PRIORITY_LABELS } from '@gravity/shared/constants';
import type { LeadRow } from '@gravity/shared/records';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceData } from '@/features/workspace/use-workspace.ts';
import { useContextPanel } from '@/lib/context-panel.tsx';
import { HOTKEY_PRIORITY, useHotkey } from '@/lib/keyboard/index.ts';
import { setLeadTrail } from '@/lib/record-trail.ts';
import { watchWindowRefocus } from '@/lib/window-refocus.ts';
import { asPriority } from './lead-glyphs.tsx';
import {
  personHref,
  selectionTargets,
  selectionThrough,
  survivingNeighbour,
} from './lead-groups.ts';
import { LeadPeek } from './lead-peek.tsx';
import type { VerbRequest } from './lead-verb-menu.tsx';

export interface LeadListSelection {
  readonly targets: readonly LeadRow[];
  readonly active: LeadRow | undefined;
  readonly hasSelection: boolean;
  readonly selectionLeft: boolean;
  readonly request: VerbRequest | null;
  readonly settleRequest: () => void;
  readonly clear: () => void;
}

export type LeadStep = (from: LeadRow | undefined, delta: 1 | -1) => LeadRow | undefined;

export interface LeadCursorOptions {
  readonly ordered: readonly LeadRow[];
  readonly step: LeadStep;
}

export interface LeadCursor {
  readonly active: LeadRow | undefined;
  readonly focus: (lead: LeadRow | undefined) => void;
  readonly selectedIds: ReadonlySet<string>;
  readonly toggleSelected: (id: string) => void;
  readonly peekOpen: boolean;
  readonly openPeek: (lead: LeadRow | undefined) => void;
  readonly togglePeek: () => void;
  readonly openActive: () => void;
  readonly requestVerb: (request: VerbRequest) => void;
  readonly selection: LeadListSelection;
}

export const LEAD_SURFACE = {
  section: 'Records',
  scope: 'records',
  priority: HOTKEY_PRIORITY.surface,
} as const;

export function announceLead(lead: LeadRow, workspace: WorkspaceData): string {
  const stage = workspace.stageById.get(lead.stageId)?.name ?? 'Unknown stage';
  const owner =
    lead.ownerId === null
      ? 'unassigned'
      : `owned by ${workspace.memberByUserId.get(lead.ownerId)?.name ?? 'a teammate'}`;
  const priority = LEAD_PRIORITY_LABELS[asPriority(lead.priority)];
  return [lead.key, lead.personName, lead.companyName ?? 'no company', stage, owner, priority].join(
    ', ',
  );
}

function toggled(current: readonly string[], id: string): readonly string[] {
  return current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
}

export function useLeadCursor({ ordered, step }: LeadCursorOptions): LeadCursor {
  const router = useRouter();
  const { open: panelOpen, show, clear: clearPanel } = useContextPanel();
  const orderedIds = useMemo(() => new Set(ordered.map((lead) => lead.id)), [ordered]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [peeking, setPeeking] = useState(false);
  const [leftFor, setLeftFor] = useState<string | null>(null);
  const [request, setRequest] = useState<VerbRequest | null>(null);
  const previousOrder = useRef<readonly string[]>([]);

  useEffect(() => watchWindowRefocus(), []);

  const active = useMemo(() => {
    if (activeId === null) return ordered[0];
    const found = ordered.find((lead) => lead.id === activeId);
    if (found !== undefined) return found;
    const neighbour = survivingNeighbour(previousOrder.current, orderedIds, activeId);
    return ordered.find((lead) => lead.id === neighbour) ?? ordered[0];
  }, [ordered, orderedIds, activeId]);
  const activeLeadId = active?.id;
  const activeKey = active?.key;

  useEffect(() => {
    previousOrder.current = ordered.map((lead) => lead.id);
  }, [ordered]);

  useEffect(() => {
    if (activeLeadId !== undefined && activeLeadId !== activeId) setActiveId(activeLeadId);
  }, [activeLeadId, activeId]);

  const visibleSelected = useMemo(
    () => selected.filter((id) => orderedIds.has(id)),
    [selected, orderedIds],
  );
  const selectedIds = useMemo(() => new Set(visibleSelected), [visibleSelected]);
  useEffect(() => {
    if (visibleSelected.length === selected.length) return;
    setSelected(visibleSelected);
    if (visibleSelected.length === 0) setLeftFor(activeLeadId ?? null);
  }, [visibleSelected, selected, activeLeadId]);
  useEffect(() => {
    if (leftFor !== null && (leftFor !== activeLeadId || visibleSelected.length > 0)) {
      setLeftFor(null);
    }
  }, [leftFor, activeLeadId, visibleSelected]);
  const selectionLeft =
    leftFor !== null && leftFor === activeLeadId && visibleSelected.length === 0;

  const peekOpen = peeking && panelOpen;

  const focus = useCallback((lead: LeadRow | undefined) => {
    if (lead !== undefined) setActiveId(lead.id);
  }, []);

  const extend = (delta: 1 | -1) => {
    const next = step(active, delta);
    if (next === undefined || active === undefined) return;
    setSelected((current) => selectionThrough(current, active.id, next.id));
    setActiveId(next.id);
  };

  const showPeek = useCallback(
    (id: string, key: string) => show(<LeadPeek key={id} leadId={id} />, `Lead ${key}`),
    [show],
  );

  const closePeek = () => {
    setPeeking(false);
    clearPanel();
  };

  const openPeek = (lead: LeadRow | undefined) => {
    if (lead === undefined) return;
    setActiveId(lead.id);
    setPeeking(true);
    showPeek(lead.id, lead.key);
  };

  const togglePeek = () => {
    if (peekOpen) closePeek();
    else openPeek(active);
  };

  const openActive = () => {
    if (active === undefined) return;
    setLeadTrail(ordered);
    router.push(personHref(active));
  };

  useEffect(() => {
    if (peekOpen && activeLeadId !== undefined && activeKey !== undefined) {
      showPeek(activeLeadId, activeKey);
    }
  }, [peekOpen, activeLeadId, activeKey, showPeek]);

  const peekingNow = useRef(false);
  useEffect(() => {
    peekingNow.current = peeking;
  }, [peeking]);
  useEffect(
    () => () => {
      if (peekingNow.current) clearPanel();
    },
    [clearPanel],
  );

  useHotkey('j', () => focus(step(active, 1)), {
    ...LEAD_SURFACE,
    label: 'Next lead',
    aliases: ['down'],
  });
  useHotkey('k', () => focus(step(active, -1)), {
    ...LEAD_SURFACE,
    label: 'Previous lead',
    aliases: ['up'],
  });
  useHotkey('shift+j', () => extend(1), {
    ...LEAD_SURFACE,
    label: 'Extend the selection down',
    aliases: ['shift+down'],
  });
  useHotkey('shift+k', () => extend(-1), {
    ...LEAD_SURFACE,
    label: 'Extend the selection up',
    aliases: ['shift+up'],
  });
  useHotkey(
    'x',
    () => {
      if (active === undefined) return;
      setActiveId(active.id);
      setSelected((current) => toggled(current, active.id));
    },
    { ...LEAD_SURFACE, label: 'Select or deselect' },
  );
  useHotkey('space', togglePeek, { ...LEAD_SURFACE, label: 'Toggle the peek' });
  useHotkey('enter', openActive, {
    ...LEAD_SURFACE,
    label: 'Open the record',
    aliases: ['o'],
  });
  useHotkey('mod+a', () => setSelected(ordered.map((lead) => lead.id)), {
    ...LEAD_SURFACE,
    label: 'Select every lead that matches',
  });
  useHotkey(
    'escape',
    () => {
      if (peekOpen) closePeek();
      else setSelected([]);
    },
    {
      ...LEAD_SURFACE,
      label: 'Close the peek, then clear the selection',
      preventDefault: false,
      enabled: peekOpen || visibleSelected.length > 0,
    },
  );

  const targets = useMemo(
    () => selectionTargets(ordered, selectedIds, active),
    [ordered, selectedIds, active],
  );
  const clear = useCallback(() => setSelected([]), []);
  const settleRequest = useCallback(() => setRequest(null), []);
  const requestVerb = useCallback((next: VerbRequest) => {
    setActiveId(next.lead.id);
    setRequest(next);
  }, []);
  const toggleSelected = useCallback(
    (id: string) => setSelected((current) => toggled(current, id)),
    [],
  );
  const hasSelection = visibleSelected.length > 0;
  const selection = useMemo<LeadListSelection>(
    () => ({ targets, active, hasSelection, selectionLeft, request, settleRequest, clear }),
    [targets, active, hasSelection, selectionLeft, request, settleRequest, clear],
  );

  return {
    active,
    focus,
    selectedIds,
    toggleSelected,
    peekOpen,
    openPeek,
    togglePeek,
    openActive,
    requestVerb,
    selection,
  };
}
