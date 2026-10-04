'use client';

import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { LeadRow, MemberRow, PipelineRow, StageRow } from '@gravity/shared/records';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  type FocusEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { RelativeTime } from '@/components/ui/relative-time.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { useCan } from '@/features/workspace/use-can.ts';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { cn } from '@/lib/cn.ts';
import { cardHover } from '@/lib/interaction.ts';
import { useHotkey, useHotkeyRegistry } from '@/lib/keyboard/index.ts';
import { isWindowRefocus } from '@/lib/window-refocus.ts';
import {
  BOARD_KEYBOARD_CODES,
  boardCollision,
  columnCoordinates,
  moveToStage,
} from './board-drop.ts';
import { OwedByChip, PriorityGlyph, StageGlyph } from './lead-glyphs.tsx';
import { groupLeadsByStage, type LeadGroup, nextMovableStage, personHref } from './lead-groups.ts';
import { RowOwner } from './lead-row.tsx';
import { LeadVerbMenu, type VerbRequest } from './lead-verb-menu.tsx';
import { LeadVerbs } from './lead-verbs.tsx';
import { useCommitLeadChange } from './use-commit-lead-change.ts';
import { announceLead, LEAD_SURFACE, type LeadStep, useLeadCursor } from './use-lead-cursor.tsx';

const CARD_SLOT = 64;
const DRAG_ACTIVATION_PX = 4;
const COLUMN_INITIAL_RECT = { width: 272, height: CARD_SLOT * 12 };
export const BOARD_CARD_PREFIX = 'board-card-';

const SCREEN_READER_INSTRUCTIONS = {
  draggable:
    'Space peeks the card and Enter opens it. To move it, press M, use the left and right arrow keys to choose a stage, then press Space or Enter to drop it there, or Escape to cancel.',
};

interface CardHandlers {
  readonly onFocus: () => void;
  readonly onPeek: () => void;
  readonly onOpen: () => void;
  readonly onVerb: (request: VerbRequest) => void;
}

interface CardViewProps {
  readonly lead: LeadRow;
  readonly owner: MemberRow | undefined;
  readonly active: boolean;
  readonly selected: boolean;
  readonly lifted?: boolean;
}

function stopPointer(event: { stopPropagation: () => void }): void {
  event.stopPropagation();
}

function BoardCardView({ lead, owner, active, selected, lifted = false }: CardViewProps) {
  return (
    <div
      className={cn(
        'flex h-14 flex-col justify-between rounded-lg border border-border bg-surface px-2.5 py-2',
        cardHover,
        active && 'border-accent hover:border-accent',
        selected && 'bg-accent-soft hover:bg-accent-soft',
        lifted && 'cursor-grabbing border-border-strong shadow-pop',
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-2xs text-faint">
        <PriorityGlyph priority={lead.priority} />
        <span data-numeric className="shrink-0 whitespace-nowrap font-medium">
          {lead.key}
        </span>
        {lead.nextActionAt === null ? null : (
          <span data-numeric className="truncate" title={lead.nextAction ?? undefined}>
            <RelativeTime at={lead.nextActionAt} />
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <OwedByChip owedBy={lead.owedBy} />
          <span aria-hidden="true" className="size-5" />
          <RowOwner owner={owner} />
        </span>
      </div>
      <div className="flex min-w-0 items-baseline gap-1.5 text-dense text-text">
        <span className="truncate">{lead.personName}</span>
        {lead.companyName === null ? null : (
          <span className="truncate text-muted">{lead.companyName}</span>
        )}
      </div>
    </div>
  );
}

interface BoardCardProps extends CardViewProps {
  readonly handlers: CardHandlers;
}

function cardLabel(lead: LeadRow): string {
  return lead.companyName === null
    ? `${lead.key} ${lead.personName}`
    : `${lead.key} ${lead.personName}, ${lead.companyName}`;
}

function BoardCard({ lead, owner, active, selected, handlers }: BoardCardProps) {
  const movable = useCan('record:write');
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
    disabled: !movable,
    attributes: { role: 'article', roleDescription: movable ? 'movable card' : 'card' },
  });
  const card = {
    ...attributes,
    ...listeners,
    'aria-label': cardLabel(lead),
    onFocus: (event: FocusEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget && !isWindowRefocus(event)) handlers.onFocus();
    },
    onClick: (event: MouseEvent<HTMLDivElement>) => {
      if (event.metaKey || event.ctrlKey) {
        window.open(personHref(lead), '_blank', 'noopener');
        return;
      }
      handlers.onFocus();
      handlers.onPeek();
    },
    onDoubleClick: () => {
      handlers.onFocus();
      handlers.onOpen();
    },
  };
  return (
    <div className="group relative">
      <div
        ref={setNodeRef}
        {...card}
        id={`${BOARD_CARD_PREFIX}${lead.id}`}
        data-lead-id={lead.id}
        data-testid={`board-card-${lead.key}`}
        data-active={active ? 'true' : undefined}
        data-selected={selected ? 'true' : undefined}
        data-lifted={isDragging ? 'true' : undefined}
        className={cn(
          'rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent',
          isDragging
            ? 'border border-accent border-dashed bg-accent-soft/40 [&>*]:invisible'
            : movable && 'cursor-grab',
        )}
      >
        <BoardCardView lead={lead} owner={owner} active={active} selected={selected} />
      </div>
      {isDragging ? null : (
        <span onPointerDown={stopPointer} className="absolute top-[9px] right-[35px] flex">
          <LeadVerbMenu lead={lead} visible={active} onVerb={handlers.onVerb} />
        </span>
      )}
    </div>
  );
}

interface BoardColumnProps {
  readonly group: LeadGroup;
  readonly activeId: string | undefined;
  readonly selectedIds: ReadonlySet<string>;
  readonly ownerOf: (lead: LeadRow) => MemberRow | undefined;
  readonly handlersFor: (lead: LeadRow) => CardHandlers;
}

function BoardColumn({ group, activeId, selectedIds, ownerOf, handlersFor }: BoardColumnProps) {
  const { stage, leads } = group;
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const sectionRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: leads.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_SLOT,
    getItemKey: (index) => leads[index]?.id ?? index,
    initialRect: COLUMN_INITIAL_RECT,
    overscan: 6,
  });
  const activeIndex = leads.findIndex((lead) => lead.id === activeId);
  useEffect(() => {
    if (activeIndex < 0) return;
    sectionRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    virtualizer.scrollToIndex(activeIndex, { align: 'auto' });
  }, [activeIndex, virtualizer]);
  const setSection = useCallback(
    (node: HTMLElement | null) => {
      sectionRef.current = node;
      setNodeRef(node);
    },
    [setNodeRef],
  );
  return (
    <section
      ref={setSection}
      aria-label={stage.name}
      data-testid={`board-column-${stage.name}`}
      className={cn(
        'flex h-full w-72 shrink-0 flex-col rounded-lg bg-surface-2/60',
        isOver && 'bg-accent-soft/40',
      )}
    >
      <header className="flex items-center gap-2 px-2.5 py-2">
        <StageGlyph category={stage.category} label={stage.name} />
        <h2 className="font-medium text-dense text-text">{stage.name}</h2>
        <span data-numeric className="text-2xs text-faint">
          {leads.length}
        </span>
      </header>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2">
        <ul
          aria-label={`${stage.name} leads`}
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const lead = leads[item.index];
            if (lead === undefined) return null;
            return (
              <li
                key={item.key}
                className="absolute top-0 left-0 w-full list-none"
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                <BoardCard
                  lead={lead}
                  owner={ownerOf(lead)}
                  active={lead.id === activeId}
                  selected={selectedIds.has(lead.id)}
                  handlers={handlersFor(lead)}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function columnOf(columns: readonly LeadGroup[], lead: LeadRow | undefined): number {
  if (lead === undefined) return -1;
  return columns.findIndex((column) => column.leads.some((entry) => entry.id === lead.id));
}

export interface LeadBoardProps {
  readonly pipeline: PipelineRow;
  readonly stages: readonly StageRow[];
  readonly leads: readonly LeadRow[];
}

export function LeadBoard({ pipeline, stages, leads }: LeadBoardProps) {
  const workspace = useWorkspace();
  const canWrite = useCan('record:write');
  const commit = useCommitLeadChange();
  const registry = useHotkeyRegistry();
  const columns = useMemo(
    () => groupLeadsByStage(leads, stages, { showEmpty: true }),
    [leads, stages],
  );
  const ordered = useMemo(() => columns.flatMap((column) => [...column.leads]), [columns]);
  const [dragging, setDragging] = useState<UniqueIdentifier | null>(null);
  const step = useCallback<LeadStep>(
    (from, delta) => {
      const column = columns[columnOf(columns, from)];
      if (column === undefined || from === undefined) return ordered[0];
      const index = column.leads.findIndex((lead) => lead.id === from.id);
      return column.leads[Math.min(column.leads.length - 1, Math.max(0, index + delta))];
    },
    [columns, ordered],
  );
  const cursor = useLeadCursor({ ordered, step });
  const { active, selectedIds, requestVerb } = cursor;
  const activePlace = active === undefined ? undefined : `${active.id}:${active.stageId}`;
  const boardRef = useRef<HTMLDivElement | null>(null);
  const cardFocused = useRef(false);
  const releaseKeys = useRef<(() => void) | null>(null);

  const holdKeys = () => {
    releaseKeys.current?.();
    releaseKeys.current = registry.suspend();
  };
  const freeKeys = () => {
    releaseKeys.current?.();
    releaseKeys.current = null;
  };
  useEffect(
    () => () => {
      releaseKeys.current?.();
    },
    [],
  );

  useEffect(() => {
    const board = boardRef.current;
    const [activeId] = activePlace?.split(':') ?? [];
    if (!cardFocused.current || activeId === undefined || board === null) return;
    const focusActive = (): boolean => {
      const target = board.querySelector<HTMLElement>(`[data-lead-id="${activeId}"]`);
      if (target === null) return false;
      const current = document.activeElement;
      const elsewhere =
        current instanceof HTMLElement &&
        current !== document.body &&
        current.isConnected &&
        !current.hasAttribute('data-lead-id');
      if (current !== target && !elsewhere) target.focus({ preventScroll: true });
      return true;
    };
    if (focusActive()) return;
    const frame = requestAnimationFrame(() => {
      focusActive();
    });
    return () => cancelAnimationFrame(frame);
  }, [activePlace]);

  const trackFocus = {
    onFocus: (event: FocusEvent<HTMLDivElement>) => {
      cardFocused.current =
        event.target instanceof HTMLElement && event.target.hasAttribute('data-lead-id');
    },
    onBlur: (event: FocusEvent<HTMLDivElement>) => {
      const left = event.target;
      const next = event.relatedTarget;
      if (next instanceof HTMLElement && next.hasAttribute('data-lead-id')) return;
      queueMicrotask(() => {
        if (left.isConnected) cardFocused.current = false;
      });
    },
  };

  const across = (direction: 1 | -1) => {
    const from = columnOf(columns, active);
    if (from < 0 || active === undefined) return;
    const row = columns[from]?.leads.findIndex((lead) => lead.id === active.id) ?? 0;
    for (let index = from + direction; index >= 0 && index < columns.length; index += direction) {
      const candidates = columns[index]?.leads ?? [];
      const target = candidates[Math.min(row, candidates.length - 1)];
      if (target !== undefined) {
        cursor.focus(target);
        return;
      }
    }
  };

  const move = (lead: LeadRow, target: StageRow | undefined) => {
    const outcome = moveToStage(lead, target);
    if (outcome.kind === 'hold') {
      requestVerb({ lead, verb: 'hold', origin: null, announce: false });
    }
    if (outcome.kind === 'change') commit([lead], outcome.change, false);
  };

  const shift = (direction: 1 | -1) => {
    if (active !== undefined) move(active, nextMovableStage(stages, active.stageId, direction));
  };

  useHotkey('right', () => across(1), {
    ...LEAD_SURFACE,
    label: 'Next stage column',
  });
  useHotkey('left', () => across(-1), {
    ...LEAD_SURFACE,
    label: 'Previous stage column',
  });
  useHotkey('shift+right', () => shift(1), {
    ...LEAD_SURFACE,
    label: 'Move the card one stage right',
    enabled: canWrite,
  });
  useHotkey('shift+left', () => shift(-1), {
    ...LEAD_SURFACE,
    label: 'Move the card one stage left',
    enabled: canWrite,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_PX } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: columnCoordinates,
      keyboardCodes: BOARD_KEYBOARD_CODES,
      scrollBehavior: 'auto',
    }),
  );

  const leadOf = (id: UniqueIdentifier | null | undefined) =>
    id === null || id === undefined ? undefined : ordered.find((lead) => lead.id === id);
  const stageOf = (id: UniqueIdentifier | null | undefined) =>
    id === null || id === undefined ? undefined : stages.find((stage) => stage.id === id);

  const onDragStart = (event: DragStartEvent) => {
    holdKeys();
    setDragging(event.active.id);
    cursor.focus(leadOf(event.active.id));
  };
  const onDragEnd = (event: DragEndEvent) => {
    freeKeys();
    setDragging(null);
    const lead = leadOf(event.active.id);
    if (lead !== undefined) move(lead, stageOf(event.over?.id));
  };

  const keyOf = (id: UniqueIdentifier) => leadOf(id)?.key ?? 'The card';
  const nameOf = (id: UniqueIdentifier) => stageOf(id)?.name ?? 'that column';
  const announcements: Announcements = {
    onDragStart: ({ active: picked }) => `Picked up ${keyOf(picked.id)}.`,
    onDragOver: ({ active: picked, over }) =>
      over === null
        ? `${keyOf(picked.id)} is not over a stage.`
        : `${keyOf(picked.id)} is over ${nameOf(over.id)}.`,
    onDragEnd: ({ active: picked, over }) =>
      over === null
        ? `${keyOf(picked.id)} was dropped back where it was.`
        : `${keyOf(picked.id)} was dropped on ${nameOf(over.id)}.`,
    onDragCancel: ({ active: picked }) => `Moving ${keyOf(picked.id)} was cancelled.`,
  };

  const ownerOf = (lead: LeadRow) =>
    lead.ownerId === null ? undefined : workspace.memberByUserId.get(lead.ownerId);
  const handlersFor = (lead: LeadRow): CardHandlers => ({
    onFocus: () => cursor.focus(lead),
    onPeek: () => cursor.openPeek(lead),
    onOpen: cursor.openActive,
    onVerb: requestVerb,
  });
  const lifted = leadOf(dragging);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p role="status" aria-live="polite" className="sr-only">
        {active === undefined ? '' : announceLead(active, workspace)}
      </p>
      <DndContext
        id={`lead-board-${pipeline.id}`}
        sensors={sensors}
        collisionDetection={boardCollision}
        accessibility={{ announcements, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          freeKeys();
          setDragging(null);
        }}
      >
        <div
          ref={boardRef}
          {...trackFocus}
          className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3"
          data-testid="lead-board"
        >
          {columns.map((column) => (
            <BoardColumn
              key={column.stage.id}
              group={column}
              activeId={active?.id}
              selectedIds={selectedIds}
              ownerOf={ownerOf}
              handlersFor={handlersFor}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {lifted === undefined ? null : (
            <div aria-hidden="true" inert className="pointer-events-none">
              <BoardCardView
                lead={lifted}
                owner={ownerOf(lifted)}
                active={false}
                selected={false}
                lifted
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>
      <LeadVerbs
        selection={cursor.selection}
        pipelineId={pipeline.id}
        anchorPrefix={BOARD_CARD_PREFIX}
      />
    </div>
  );
}

const SKELETON_COLUMNS = [
  { id: 'first', cards: ['a', 'b', 'c'] },
  { id: 'second', cards: ['a', 'b'] },
  { id: 'third', cards: ['a', 'b', 'c', 'd'] },
  { id: 'fourth', cards: ['a'] },
];

export function BoardSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3"
      data-testid="board-skeleton"
    >
      {SKELETON_COLUMNS.map((column) => (
        <div
          key={column.id}
          className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-surface-2/60 px-2 pb-2"
        >
          <div className="flex items-center gap-2 px-0.5 py-2">
            <Skeleton className="size-3 rounded-full" />
            <Skeleton className="h-3 w-20" />
          </div>
          {column.cards.map((card) => (
            <div
              key={card}
              className="flex h-14 flex-col justify-between rounded-lg border border-border bg-surface px-2.5 py-2"
            >
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-40" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
