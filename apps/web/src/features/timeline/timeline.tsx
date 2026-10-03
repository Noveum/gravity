'use client';

import {
  type ActivityEntityType,
  TIMELINE_FILTER_LABELS,
  TIMELINE_FILTERS,
  type TimelineFilter,
} from '@gravity/shared/constants';
import type { ActivityRow } from '@gravity/shared/records';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { ErrorState } from '@/components/ui/error-state.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { HOTKEY_PRIORITY, useHotkey } from '@/lib/keyboard/index.ts';
import { useTimeline } from '@/lib/query/use-records.ts';
import { useDelayedFlag } from '@/lib/use-delayed-flag.ts';
import { ActivityItem } from './activity-item.tsx';

const ROW_HEIGHT = 30;
const LOAD_AHEAD = 5;

const EMPTY_COPY: Record<TimelineFilter, string> = {
  all: 'Nothing has happened here yet.',
  messages: 'Messages arrive with LinkedIn and Gmail sync in the next milestone.',
  meetings: 'Meetings arrive with calendar sync in a later milestone.',
  notes: 'Notes arrive in the next milestone.',
  facts: 'Facts arrive with research in the next milestone.',
  changes: 'No changes yet.',
};

const SKELETON_ROWS = ['w-64', 'w-80', 'w-56', 'w-72'];

function FilterKey({
  index,
  filter,
  onSelect,
}: {
  readonly index: number;
  readonly filter: TimelineFilter;
  readonly onSelect: (filter: TimelineFilter) => void;
}) {
  useHotkey(String(index + 1), () => onSelect(filter), {
    label: `Timeline: ${TIMELINE_FILTER_LABELS[filter]}`,
    section: 'Records',
    scope: 'records',
    priority: HOTKEY_PRIORITY.surface,
  });
  return null;
}

function TimelineRows({
  activities,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  readonly activities: readonly ActivityRow[];
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly onLoadMore: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: activities.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => activities[index]?.id ?? index,
    overscan: 10,
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items.at(-1)?.index ?? 0;
  useEffect(() => {
    if (hasMore && !loadingMore && lastIndex >= activities.length - LOAD_AHEAD) onLoadMore();
  }, [hasMore, loadingMore, lastIndex, activities.length, onLoadMore]);
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => {
          const activity = activities[item.index];
          if (activity === undefined) return null;
          return (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <ActivityItem activity={activity} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="flex flex-col px-4">
      {SKELETON_ROWS.map((width) => (
        <div key={width} className="flex h-7.5 items-center gap-2">
          <Skeleton className={`h-3 ${width}`} />
          <Skeleton className="ml-auto h-3 w-10" />
        </div>
      ))}
    </div>
  );
}

export function Timeline({
  subjectType,
  subjectId,
}: {
  readonly subjectType: ActivityEntityType;
  readonly subjectId: string;
}) {
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const timeline = useTimeline(subjectType, subjectId, filter);
  const loading = useDelayedFlag(timeline.isPending);

  function body() {
    if (timeline.data === undefined) {
      if (timeline.error !== null) {
        return (
          <ErrorState
            title="Could not load the timeline"
            error={timeline.error}
            onRetry={() => {
              timeline.refetch().catch(() => undefined);
            }}
          />
        );
      }
      return loading ? <TimelineSkeleton /> : null;
    }
    if (timeline.activities.length === 0) {
      return <p className="px-4 py-6 text-dense text-muted">{EMPTY_COPY[filter]}</p>;
    }
    return (
      <TimelineRows
        activities={timeline.activities}
        hasMore={timeline.hasNextPage}
        loadingMore={timeline.isFetchingNextPage}
        onLoadMore={() => {
          timeline.fetchNextPage().catch(() => undefined);
        }}
      />
    );
  }

  return (
    <section aria-label="Timeline" className="flex min-h-0 flex-1 flex-col">
      {TIMELINE_FILTERS.map((entry, index) => (
        <FilterKey key={entry} index={index} filter={entry} onSelect={setFilter} />
      ))}
      <fieldset className="flex shrink-0 flex-wrap gap-1 border-border border-b px-3 py-2">
        <legend className="sr-only">Timeline filter</legend>
        {TIMELINE_FILTERS.map((entry, index) => (
          <Button
            key={entry}
            size="sm"
            variant={entry === filter ? 'secondary' : 'ghost'}
            aria-pressed={entry === filter}
            onClick={() => setFilter(entry)}
          >
            <span data-numeric className="text-faint">
              {index + 1}
            </span>
            {TIMELINE_FILTER_LABELS[entry]}
          </Button>
        ))}
      </fieldset>
      {body()}
    </section>
  );
}
