'use client';

import {
  conditionFor,
  containsCondition,
  type FilterCondition,
  type FilterGroup,
  type FilterProperty,
  type FilterRegistry,
  inCondition,
  replaceCondition,
} from '@gravity/shared/filters';
import { Command } from 'cmdk';
import { Check, ListFilter } from 'lucide-react';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import { labelFilter, pickerItemClassName } from '@/features/leads/verb-picker.tsx';
import { useHotkey } from '@/lib/keyboard/index.ts';
import { DATE_PRESETS, type FilterSources, valueOptionsFor } from './filter-values.ts';

export interface FilterMenuProps<T> {
  readonly registry: FilterRegistry<T>;
  readonly sources: FilterSources;
  readonly filter: FilterGroup;
  readonly onChange: (filter: FilterGroup) => void;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const inputClassName =
  'h-9 w-full border-border border-b bg-transparent px-3 text-dense text-text outline-none placeholder:text-faint';

function useFocusOnMount(ref: RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    ref.current?.focus();
  }, [ref]);
}

function toggledValues(current: readonly string[], value: string): string[] {
  return current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
}

function withoutCondition(
  filter: FilterGroup,
  condition: FilterCondition | undefined,
): FilterGroup {
  return condition === undefined
    ? filter
    : { ...filter, children: filter.children.filter((child) => child !== condition) };
}

interface StepProps<T> {
  readonly property: FilterProperty<T>;
  readonly sources: FilterSources;
  readonly filter: FilterGroup;
  readonly onCommit: (filter: FilterGroup, close: boolean) => void;
}

function PropertyStep<T>({
  registry,
  onPick,
}: {
  readonly registry: FilterRegistry<T>;
  readonly onPick: (property: FilterProperty<T>) => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  useFocusOnMount(input);
  return (
    <Command loop filter={labelFilter}>
      <Command.Input ref={input} placeholder="Filter by" className={inputClassName} />
      <Command.List className="max-h-72 overflow-y-auto p-1">
        <Command.Empty className="px-2 py-3 text-center text-dense text-muted">
          No property matches.
        </Command.Empty>
        {registry.properties.map((entry) => (
          <Command.Item
            key={entry.key}
            value={entry.key}
            keywords={[entry.label]}
            onSelect={() => onPick(entry)}
            className={pickerItemClassName}
          >
            {entry.label}
          </Command.Item>
        ))}
      </Command.List>
    </Command>
  );
}

function TextStep<T>({ property, filter, onCommit }: StepProps<T>) {
  const existing = conditionFor(filter, property.key);
  const [text, setText] = useState(existing?.operator === 'contains' ? existing.value : '');
  const input = useRef<HTMLInputElement | null>(null);
  useFocusOnMount(input);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const value = text.trim();
        onCommit(
          value.length === 0
            ? withoutCondition(filter, existing)
            : replaceCondition(
                filter,
                containsCondition(property.key, value, existing?.negate ?? false),
              ),
          true,
        );
      }}
    >
      <input
        ref={input}
        aria-label={`${property.label} contains`}
        placeholder={`${property.label} contains`}
        value={text}
        maxLength={200}
        onChange={(event) => setText(event.target.value)}
        className={inputClassName}
      />
    </form>
  );
}

function ValueStep<T>({ property, sources, filter, onCommit }: StepProps<T>) {
  const input = useRef<HTMLInputElement | null>(null);
  useFocusOnMount(input);
  const existing = conditionFor(filter, property.key);
  const selected = existing?.operator === 'in' ? existing.values : [];
  const presets = property.kind === 'date' ? DATE_PRESETS : [];
  const toggle = (value: string) => {
    const values = toggledValues(selected, value);
    onCommit(
      values.length === 0
        ? withoutCondition(filter, existing)
        : replaceCondition(filter, inCondition(property.key, values, existing?.negate ?? false)),
      false,
    );
  };
  return (
    <Command loop filter={labelFilter}>
      <Command.Input ref={input} placeholder={property.label} className={inputClassName} />
      <Command.List className="max-h-72 overflow-y-auto p-1">
        <Command.Empty className="px-2 py-3 text-center text-dense text-muted">
          Nothing matches that.
        </Command.Empty>
        {valueOptionsFor(property, sources).map((option) => (
          <Command.Item
            key={option.value}
            value={option.value}
            keywords={[option.label]}
            onSelect={() => toggle(option.value)}
            className={pickerItemClassName}
          >
            <Check
              className={selected.includes(option.value) ? 'size-3.5' : 'size-3.5 opacity-0'}
              aria-hidden="true"
            />
            {option.label}
          </Command.Item>
        ))}
        {presets.map((preset) => (
          <Command.Item
            key={preset.label}
            value={preset.label}
            keywords={[preset.label]}
            onSelect={() =>
              onCommit(
                replaceCondition(filter, {
                  kind: 'condition',
                  property: property.key,
                  operator: 'relative',
                  relative: preset.relative,
                  negate: false,
                }),
                true,
              )
            }
            className={pickerItemClassName}
          >
            <span className="size-3.5" aria-hidden="true" />
            {preset.label}
          </Command.Item>
        ))}
      </Command.List>
    </Command>
  );
}

export function FilterMenu<T>({
  registry,
  sources,
  filter,
  onChange,
  open,
  onOpenChange,
}: FilterMenuProps<T>) {
  const [property, setProperty] = useState<FilterProperty<T> | null>(null);
  const openedByKey = useRef(false);
  const focusBefore = useRef<HTMLElement | null>(null);
  useHotkey(
    'f',
    () => {
      openedByKey.current = true;
      focusBefore.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      onOpenChange(true);
    },
    { label: 'Filter', section: 'Records', scope: 'filters', enabled: !open },
  );

  const setOpen = (next: boolean) => {
    if (next) openedByKey.current = false;
    else setProperty(null);
    onOpenChange(next);
  };
  const commit = (next: FilterGroup, close: boolean) => {
    onChange(next);
    if (close) setOpen(false);
  };

  function body() {
    if (property === null) return <PropertyStep registry={registry} onPick={setProperty} />;
    const step = { property, sources, filter, onCommit: commit };
    if (property.kind === 'text') return <TextStep key={property.key} {...step} />;
    return <ValueStep key={property.key} {...step} />;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" aria-label="Filter">
          <ListFilter className="size-3.5" aria-hidden="true" />
          Filter
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-0"
        aria-label="Filter"
        onEscapeKeyDown={(event) => {
          if (property === null) return;
          event.preventDefault();
          setProperty(null);
        }}
        onCloseAutoFocus={(event) => {
          if (!openedByKey.current) return;
          event.preventDefault();
          const before = focusBefore.current;
          focusBefore.current = null;
          if (before?.isConnected === true) before.focus({ preventScroll: true });
        }}
      >
        {body()}
      </PopoverContent>
    </Popover>
  );
}
