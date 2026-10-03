'use client';

import { type FilterGroup, type FilterRegistry, removeCondition } from '@gravity/shared/filters';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { describeCondition, type FilterSources } from './filter-values.ts';

export interface FilterBarProps<T> {
  readonly registry: FilterRegistry<T>;
  readonly sources: FilterSources;
  readonly filter: FilterGroup;
  readonly onChange: (filter: FilterGroup) => void;
  readonly onClear: () => void;
}

export function FilterBar<T>({ registry, sources, filter, onChange, onClear }: FilterBarProps<T>) {
  if (filter.children.length === 0) return null;
  return (
    <ul aria-label="Active filters" className="flex flex-wrap items-center gap-1">
      {filter.children.map((child) => {
        if (child.kind !== 'condition') return null;
        const label = describeCondition(child, registry, sources);
        return (
          <li
            key={child.property}
            className="flex h-6 items-center gap-1 rounded-md border border-border bg-surface-2 pr-0.5 pl-2 text-muted text-xs"
          >
            <span>{label}</span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove ${label}`}
              className="size-5 px-0"
              onClick={() => onChange(removeCondition(filter, child.property))}
            >
              <X className="size-3" aria-hidden="true" />
            </Button>
          </li>
        );
      })}
      <li>
        <Button size="sm" variant="ghost" className="h-6" onClick={onClear}>
          Clear
        </Button>
      </li>
    </ul>
  );
}
