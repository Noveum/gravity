'use client';

import { LEAD_PRIORITY_LABELS, STAGE_CATEGORY_LABELS } from '@gravity/shared/constants';
import type { LeadRow, PipelineRow, StageRow } from '@gravity/shared/records';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace, type WorkspaceData } from '@/features/workspace/use-workspace.ts';
import { useContextPanel } from '@/lib/context-panel.tsx';
import { HOTKEY_PRIORITY, useHotkey } from '@/lib/keyboard/index.ts';
import { asPriority, StageGlyph } from './lead-glyphs.tsx';
import {
  buildLeadRows,
  groupLeadsByStage,
  type LeadGroup,
  type LeadListRow,
  personHref,
  selectionTargets,
  selectionThrough,
} from './lead-groups.ts';
import { LeadPeek } from './lead-peek.tsx';
import { LEAD_ROW_HEIGHT, LeadRowView } from './lead-row.tsx';

export const GROUP_HEADER_HEIGHT = 32;

export interface LeadListSelection {
  readonly targets: readonly LeadRow[];
  readonly active: LeadRow | undefined;
  readonly clear: () => void;
}

export interface LeadListProps {
  readonly pipeline: PipelineRow;
  readonly stages: readonly StageRow[];
  readonly leads: readonly LeadRow[];
  readonly renderActions?: (selection: LeadListSelection) => ReactNode;
}

const SURFACE = {
  section: 'Records',
  scope: 'records',
  priority: HOTKEY_PRIORITY.surface,
} as const;

function rowKey(row: LeadListRow | undefined, index: number): string | number {
  if (row === undefined) return index;
  if (row.kind === 'lead') return row.lead.id;
  return `stage-${row.group.stage.id}`;
}

function toggled(current: readonly string[], id: string): readonly string[] {
  return current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
}

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

function StageHeader({ group }: { readonly group: LeadGroup }) {
  return (
    <div
      className="flex h-8 items-center gap-2 border-border border-b bg-surface-2/60 px-3"
      data-testid={`stage-group-${group.stage.name}`}
    >
      <StageGlyph
        category={group.stage.category}
        label={STAGE_CATEGORY_LABELS[group.stage.category]}
      />
      <h2 className="font-medium text-dense text-text">{group.stage.name}</h2>
      <span data-numeric className="text-2xs text-faint">
        {group.leads.length}
      </span>
    </div>
  );
}

export function LeadList({ pipeline, stages, leads, renderActions }: LeadListProps) {
  const router = useRouter();
  const workspace = useWorkspace();
  const panel = useContextPanel();
  const { show, hide } = panel;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const groups = useMemo(() => groupLeadsByStage(leads, stages), [leads, stages]);
  const rows = useMemo(() => buildLeadRows(groups), [groups]);
  const ordered = useMemo(
    () => rows.flatMap((row) => (row.kind === 'lead' ? [row.lead] : [])),
    [rows],
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [peeking, setPeeking] = useState(false);
  const active = ordered.find((lead) => lead.id === activeId) ?? ordered[0];
  const peekOpen = peeking && panel.open;
  const brandColor = workspace.brandById.get(pipeline.brandId)?.color;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.kind === 'lead' ? LEAD_ROW_HEIGHT : GROUP_HEADER_HEIGHT),
    getItemKey: (index) => rowKey(rows[index], index),
    overscan: 12,
  });

  const focusLead = useCallback(
    (lead: LeadRow | undefined) => {
      if (lead === undefined) return;
      setActiveId(lead.id);
      const index = rows.findIndex((row) => row.kind === 'lead' && row.lead.id === lead.id);
      if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
    },
    [rows, virtualizer],
  );

  const step = useCallback(
    (delta: 1 | -1): LeadRow | undefined => {
      const index = active === undefined ? -1 : ordered.indexOf(active);
      return ordered[Math.min(ordered.length - 1, Math.max(0, index + delta))];
    },
    [active, ordered],
  );

  const extend = (delta: 1 | -1) => {
    const next = step(delta);
    if (next === undefined || active === undefined) return;
    setSelected((current) => selectionThrough(current, active.id, next.id));
    focusLead(next);
  };

  const showPeek = useCallback(
    (id: string, key: string) => show(<LeadPeek key={id} leadId={id} />, `Lead ${key}`),
    [show],
  );

  const closePeek = useCallback(() => {
    setPeeking(false);
    hide();
  }, [hide]);

  const openPeek = (lead: LeadRow | undefined) => {
    if (lead === undefined) return;
    setPeeking(true);
    showPeek(lead.id, lead.key);
  };

  const activeLeadId = active?.id;
  const activeKey = active?.key;
  useEffect(() => {
    if (peekOpen && activeLeadId !== undefined && activeKey !== undefined) {
      showPeek(activeLeadId, activeKey);
    }
  }, [peekOpen, activeLeadId, activeKey, showPeek]);

  const peekShowing = useRef(false);
  peekShowing.current = peekOpen;
  useEffect(
    () => () => {
      if (peekShowing.current) hide();
    },
    [hide],
  );

  useHotkey('j', () => focusLead(step(1)), { ...SURFACE, label: 'Next lead', aliases: ['down'] });
  useHotkey('k', () => focusLead(step(-1)), {
    ...SURFACE,
    label: 'Previous lead',
    aliases: ['up'],
  });
  useHotkey('shift+j', () => extend(1), {
    ...SURFACE,
    label: 'Extend the selection down',
    aliases: ['shift+down'],
  });
  useHotkey('shift+k', () => extend(-1), {
    ...SURFACE,
    label: 'Extend the selection up',
    aliases: ['shift+up'],
  });
  useHotkey(
    'x',
    () => {
      if (active !== undefined) setSelected((current) => toggled(current, active.id));
    },
    { ...SURFACE, label: 'Select or deselect' },
  );
  useHotkey(
    'space',
    () => {
      if (peekOpen) closePeek();
      else openPeek(active);
    },
    { ...SURFACE, label: 'Toggle the peek' },
  );
  useHotkey(
    'enter',
    () => {
      if (active !== undefined) router.push(personHref(active));
    },
    { ...SURFACE, label: 'Open the record', aliases: ['o'] },
  );
  useHotkey('mod+a', () => setSelected(ordered.map((lead) => lead.id)), {
    ...SURFACE,
    label: 'Select every lead that matches',
  });
  useHotkey(
    'escape',
    () => {
      if (peekOpen) closePeek();
      else setSelected([]);
    },
    {
      ...SURFACE,
      label: 'Close the peek, then clear the selection',
      preventDefault: false,
      enabled: peekOpen || selected.length > 0,
    },
  );

  const targets = useMemo(
    () => selectionTargets(ordered, selected, active),
    [ordered, selected, active],
  );
  const clear = useCallback(() => setSelected([]), []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p role="status" aria-live="polite" className="sr-only">
        {active === undefined ? '' : announceLead(active, workspace)}
      </p>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" data-testid="lead-list">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (row === undefined) return null;
            return (
              <div
                key={item.key}
                data-index={item.index}
                className={
                  row.kind === 'lead'
                    ? 'absolute top-0 left-0 w-full'
                    : 'absolute top-0 left-0 z-10 w-full bg-bg'
                }
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                {row.kind === 'header' ? (
                  <StageHeader group={row.group} />
                ) : (
                  <LeadRowView
                    lead={row.lead}
                    active={row.lead.id === active?.id}
                    selected={selected.includes(row.lead.id)}
                    owner={
                      row.lead.ownerId === null
                        ? undefined
                        : workspace.memberByUserId.get(row.lead.ownerId)
                    }
                    brandColor={brandColor}
                    onFocus={() => setActiveId(row.lead.id)}
                    onPeek={() => openPeek(row.lead)}
                    onToggleSelected={() => setSelected((current) => toggled(current, row.lead.id))}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {renderActions?.({ targets, active, clear })}
    </div>
  );
}
