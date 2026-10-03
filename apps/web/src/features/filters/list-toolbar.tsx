'use client';

import type { SavedViewObject } from '@gravity/shared/constants';
import type { FilterRegistry } from '@gravity/shared/filters';
import { type ReactNode, useState } from 'react';
import { useHotkey } from '@/lib/keyboard/index.ts';
import { FilterBar } from './filter-bar.tsx';
import { FilterMenu } from './filter-menu.tsx';
import type { FilterSources } from './filter-values.ts';
import { ListSearch } from './list-search.tsx';
import { SaveViewDialog } from './save-view-dialog.tsx';
import type { ListQueryState } from './use-list-query.ts';

export interface ListToolbarProps<T> {
  readonly object: SavedViewObject;
  readonly pipelineId: string | null;
  readonly registry: FilterRegistry<T>;
  readonly sources: FilterSources;
  readonly state: ListQueryState;
  readonly children?: ReactNode;
}

export function ListToolbar<T>({
  object,
  pipelineId,
  registry,
  sources,
  state,
  children,
}: ListToolbarProps<T>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const clearable = state.hasFilter || state.viewId !== null;
  useHotkey(
    'shift+f',
    () => {
      if (clearable) state.clear();
    },
    { label: 'Clear filters', section: 'Records', scope: 'filters' },
  );
  return (
    <div className="flex shrink-0 flex-col gap-2 border-border border-b px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <FilterMenu
          registry={registry}
          sources={sources}
          filter={state.query.filter}
          onChange={state.setFilter}
          open={menuOpen}
          onOpenChange={setMenuOpen}
        />
        <ListSearch value={state.query.q} onChange={state.setQ} />
        {children === undefined ? null : (
          <div className="ml-auto flex items-center gap-1">{children}</div>
        )}
      </div>
      <FilterBar
        registry={registry}
        sources={sources}
        filter={state.query.filter}
        onChange={state.setFilter}
        onClear={state.clear}
      />
      <SaveViewDialog
        object={object}
        pipelineId={pipelineId}
        filter={state.query.filter}
        viewId={state.viewId}
        onSaved={state.openView}
      />
    </div>
  );
}
