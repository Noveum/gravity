'use client';

import { STAGE_CATEGORY_LABELS } from '@gravity/shared/constants';
import type { LeadRow, PipelineRow, StageRow } from '@gravity/shared/records';
import { useVirtualizer } from '@tanstack/react-virtual';
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { StageGlyph } from './lead-glyphs.tsx';
import {
  buildLeadRows,
  groupLeadsByStage,
  type LeadGroup,
  type LeadListRow,
} from './lead-groups.ts';
import { LEAD_ROW_HEIGHT, LeadRowView } from './lead-row.tsx';
import { LeadVerbMenu } from './lead-verb-menu.tsx';
import {
  announceLead,
  type LeadListSelection,
  type LeadStep,
  useLeadCursor,
} from './use-lead-cursor.tsx';

export const GROUP_HEADER_HEIGHT = 32;

export interface LeadListProps {
  readonly pipeline: PipelineRow;
  readonly stages: readonly StageRow[];
  readonly leads: readonly LeadRow[];
  readonly renderActions?: (selection: LeadListSelection) => ReactNode;
}

function rowKey(row: LeadListRow | undefined, index: number): string | number {
  if (row === undefined) return index;
  if (row.kind === 'lead') return row.lead.id;
  return `stage-${row.group.stage.id}`;
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
  const workspace = useWorkspace();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const groups = useMemo(() => groupLeadsByStage(leads, stages), [leads, stages]);
  const rows = useMemo(() => buildLeadRows(groups), [groups]);
  const ordered = useMemo(
    () => rows.flatMap((row) => (row.kind === 'lead' ? [row.lead] : [])),
    [rows],
  );
  const step = useCallback<LeadStep>(
    (from, delta) => {
      const index = from === undefined ? -1 : ordered.indexOf(from);
      return ordered[Math.min(ordered.length - 1, Math.max(0, index + delta))];
    },
    [ordered],
  );
  const cursor = useLeadCursor({ ordered, step });
  const { active, selectedIds, selection } = cursor;
  const activeLeadId = active?.id;
  const activeStageId = active?.stageId;
  const brandColor = workspace.brandById.get(pipeline.brandId)?.color;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.kind === 'lead' ? LEAD_ROW_HEIGHT : GROUP_HEADER_HEIGHT),
    getItemKey: (index) => rowKey(rows[index], index),
    overscan: 12,
  });

  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (activeLeadId === undefined) return;
    const position = `${activeLeadId}:${activeStageId}`;
    if (scrolledTo.current === position) return;
    scrolledTo.current = position;
    const index = rows.findIndex((row) => row.kind === 'lead' && row.lead.id === activeLeadId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [activeLeadId, activeStageId, rows, virtualizer]);

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
                    active={row.lead.id === activeLeadId}
                    selected={selectedIds.has(row.lead.id)}
                    owner={
                      row.lead.ownerId === null
                        ? undefined
                        : workspace.memberByUserId.get(row.lead.ownerId)
                    }
                    brandColor={brandColor}
                    onFocus={() => cursor.focus(row.lead)}
                    onPeek={() => cursor.openPeek(row.lead)}
                    onTogglePeek={cursor.togglePeek}
                    onOpenActive={cursor.openActive}
                    onToggleSelected={() => cursor.toggleSelected(row.lead.id)}
                    menu={
                      renderActions === undefined ? null : (
                        <LeadVerbMenu
                          lead={row.lead}
                          visible={row.lead.id === activeLeadId}
                          onVerb={cursor.requestVerb}
                        />
                      )
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {renderActions?.(selection)}
    </div>
  );
}
