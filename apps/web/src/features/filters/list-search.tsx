'use client';

import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useHotkey } from '@/lib/keyboard/index.ts';
import { useDebouncedValue } from '@/lib/use-debounced-value.ts';
import { MAX_LIST_SEARCH_LENGTH } from './list-query.ts';

export interface ListSearchProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
}

function sameTerm(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

export function ListSearch({ value, onChange }: ListSearchProps) {
  const [draft, setDraft] = useState(value);
  const settled = useDebouncedValue(draft);
  const box = useRef<HTMLInputElement | null>(null);
  const sent = useRef(value);
  const latestOnChange = useRef(onChange);
  useHotkey('/', () => box.current?.focus(), { label: 'Search this list', section: 'Records' });

  useEffect(() => {
    latestOnChange.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (sameTerm(value, sent.current)) return;
    sent.current = value;
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (sameTerm(settled, sent.current)) return;
    sent.current = settled;
    latestOnChange.current(settled);
  }, [settled]);

  return (
    <label className="flex h-7 w-56 min-w-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-dense">
      <Search className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
      <input
        ref={box}
        type="search"
        aria-label="Search this list"
        placeholder="Search"
        value={draft}
        maxLength={MAX_LIST_SEARCH_LENGTH}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          box.current?.blur();
        }}
        className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-faint"
      />
    </label>
  );
}
