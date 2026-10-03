'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { survivingNeighbour } from '@/features/leads/lead-groups.ts';
import { cn } from '@/lib/cn.ts';
import { listRowHover } from '@/lib/interaction.ts';
import { HOTKEY_PRIORITY, useHotkey } from '@/lib/keyboard/index.ts';
import { type RecordBasePath, setRecordTrail } from '@/lib/record-trail.ts';
import { isWindowRefocus, watchWindowRefocus } from '@/lib/window-refocus.ts';

export const RECORD_ROW_HEIGHT = 28;

const SURFACE = {
  section: 'Records',
  scope: 'records',
  priority: HOTKEY_PRIORITY.surface,
} as const;

export interface RecordColumn<T> {
  readonly key: string;
  readonly className: string;
  readonly read: (row: T) => string | null;
}

export interface RecordListProps<T extends { readonly id: string }> {
  readonly rows: readonly T[];
  readonly basePath: RecordBasePath;
  readonly title: (row: T) => string;
  readonly detail: (row: T) => string | null;
  readonly columns: readonly RecordColumn<T>[];
  readonly describe: (row: T) => string;
}

function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function RecordList<T extends { readonly id: string }>({
  rows,
  basePath,
  title,
  detail,
  columns,
  describe,
}: RecordListProps<T>) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const previousOrder = useRef<readonly string[]>([]);
  const ids = useMemo(() => rows.map((row) => row.id), [rows]);

  useEffect(() => watchWindowRefocus(), []);

  const active = useMemo(() => {
    if (activeId === null) return rows[0];
    const found = rows.find((row) => row.id === activeId);
    if (found !== undefined) return found;
    const neighbour = survivingNeighbour(previousOrder.current, new Set(ids), activeId);
    return rows.find((row) => row.id === neighbour) ?? rows[0];
  }, [rows, ids, activeId]);
  const activeRowId = active?.id;

  useEffect(() => {
    previousOrder.current = ids;
  }, [ids]);
  useEffect(() => {
    if (activeRowId !== undefined && activeRowId !== activeId) setActiveId(activeRowId);
  }, [activeRowId, activeId]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => RECORD_ROW_HEIGHT,
    getItemKey: (index) => rows[index]?.id ?? index,
    overscan: 12,
  });

  const open = (row: T) => {
    setRecordTrail(basePath, ids);
    router.push(`${basePath}/${row.id}`);
  };
  const move = (delta: 1 | -1) => {
    const index = active === undefined ? -1 : ids.indexOf(active.id);
    const nextIndex = Math.min(rows.length - 1, Math.max(0, index + delta));
    const next = rows[nextIndex];
    if (next === undefined) return;
    setActiveId(next.id);
    virtualizer.scrollToIndex(nextIndex, { align: 'auto' });
  };

  useHotkey('j', () => move(1), { ...SURFACE, label: 'Next record', aliases: ['down'] });
  useHotkey('k', () => move(-1), { ...SURFACE, label: 'Previous record', aliases: ['up'] });
  useHotkey(
    'enter',
    () => {
      if (active !== undefined) open(active);
    },
    { ...SURFACE, label: 'Open the record', aliases: ['o'] },
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p role="status" aria-live="polite" className="sr-only">
        {active === undefined ? '' : describe(active)}
      </p>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" data-testid="record-list">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (row === undefined) return null;
            const isActive = row.id === activeRowId;
            const secondary = detail(row);
            return (
              <div
                key={item.key}
                data-testid={`record-row-${row.id}`}
                data-active={isActive ? 'true' : undefined}
                className={cn(
                  'absolute top-0 left-0 flex h-7 w-full items-center gap-2 px-3 text-dense',
                  listRowHover,
                  isActive && 'bg-surface-2 hover:bg-surface-2',
                )}
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <Link
                  href={`${basePath}/${row.id}`}
                  prefetch={false}
                  onFocus={(event) => {
                    if (!isWindowRefocus(event)) setActiveId(row.id);
                  }}
                  onClick={(event) => {
                    if (!isPlainClick(event)) return;
                    event.preventDefault();
                    open(row);
                  }}
                  className="flex min-w-0 flex-1 items-baseline gap-2 rounded-sm text-text"
                >
                  <span className="truncate">{title(row)}</span>
                  {secondary === null ? null : (
                    <span className="truncate text-muted">{secondary}</span>
                  )}
                </Link>
                {columns.map((column) => (
                  <span key={column.key} className={cn('truncate', column.className)}>
                    {column.read(row) ?? ''}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const SKELETON_ROWS = [
  { id: 'a', width: 'w-56' },
  { id: 'b', width: 'w-72' },
  { id: 'c', width: 'w-48' },
  { id: 'd', width: 'w-64' },
  { id: 'e', width: 'w-60' },
  { id: 'f', width: 'w-44' },
  { id: 'g', width: 'w-68' },
  { id: 'h', width: 'w-52' },
];

export function RecordListSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="list-skeleton"
    >
      {SKELETON_ROWS.map((row) => (
        <div key={row.id} className="flex h-7 items-center gap-2 px-3">
          <Skeleton className={`h-3 ${row.width}`} />
          <Skeleton className="ml-auto hidden h-3 w-32 md:block" />
        </div>
      ))}
    </div>
  );
}
