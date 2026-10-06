'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef } from 'react';
import { FileRow } from './file-row.tsx';
import type { FileBrowser } from './use-file-browser.ts';

export function FileTable({ browser }: { readonly browser: FileBrowser }) {
  const {
    visible,
    selection,
    clipboard,
    files,
    choose,
    act,
    startDrag,
    drop,
    busy,
    setSelection,
    anchor,
  } = browser;
  const table = useRef<HTMLTableElement | null>(null);
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => table.current?.parentElement ?? null,
    estimateSize: () => 48,
    getItemKey: (index) => visible[index]?.id ?? index,
    overscan: 10,
    initialRect: { height: 640, width: 1000 },
  });
  const virtual = visible.length > 100;
  const virtualRows = virtualizer.getVirtualItems();
  const rendered = virtual ? virtualRows.flatMap((row) => visible[row.index] ?? []) : visible;
  const top = virtual ? (virtualRows[0]?.start ?? 0) : 0;
  const bottom = virtual ? virtualizer.getTotalSize() - (virtualRows.at(-1)?.end ?? 0) : 0;
  useEffect(() => {
    const index = visible.findIndex((entry) => entry.id === anchor);
    if (virtual && index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [anchor, virtual, virtualizer, visible]);
  return (
    <table
      ref={table}
      aria-label="Files in this folder"
      className="w-full table-fixed border-collapse"
    >
      <thead>
        <tr className="h-9 border-border border-b text-left text-faint text-xs">
          <th className="w-10">
            <input
              type="checkbox"
              aria-label="Select all files"
              checked={visible.length > 0 && visible.every((entry) => selection.has(entry.id))}
              onChange={(event) =>
                setSelection(new Set(event.target.checked ? visible.map((entry) => entry.id) : []))
              }
            />
          </th>
          <th className="px-2 font-normal">Name</th>
          <th className="hidden w-44 px-3 font-normal sm:table-cell">Access</th>
          <th className="hidden w-24 px-3 font-normal md:table-cell">Kind</th>
          <th className="hidden w-28 px-3 font-normal lg:table-cell">Modified</th>
          <th className="hidden w-24 px-3 text-right font-normal sm:table-cell">Size</th>
          <th className="w-10">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {top > 0 ? (
          <tr>
            <td colSpan={7} style={{ height: top }} />
          </tr>
        ) : null}
        {rendered.map((entry) => (
          <FileRow
            key={entry.id}
            entry={entry}
            selected={selection.has(entry.id)}
            cut={clipboard?.operation === 'move' && clipboard.ids.includes(entry.id)}
            userId={files.userId}
            select={(shift, toggle) => choose(entry, shift, toggle)}
            action={(action) => act(entry, action)}
            drag={(event) => startDrag(event, entry)}
            drop={drop}
            prefetch={() => browser.prefetch(entry)}
            disabled={busy || entry.syncId === 0}
          />
        ))}
        {bottom > 0 ? (
          <tr>
            <td colSpan={7} style={{ height: bottom }} />
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}
