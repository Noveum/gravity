'use client';

import type { FileEntry } from '@gravity/shared/validators';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight, File, FileText, Folder, MoreHorizontal } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { cn } from '@/lib/cn.ts';
import { ACCESS_LABELS } from './file-dialogs.tsx';
import { fileSize, type RowAction } from './file-row.tsx';
import type { FileBrowser } from './use-file-browser.ts';
import { useFiles } from './use-files.ts';

function FileTile({
  entry,
  browser,
  compact = false,
  siblings,
}: {
  readonly entry: FileEntry;
  readonly browser: FileBrowser;
  readonly compact?: boolean;
  readonly siblings?: readonly FileEntry[];
}) {
  const Icon = { folder: Folder, markdown: FileText, file: File }[entry.kind];
  const selected = browser.selection.has(entry.id);
  const editable = entry.canEdit && entry.ownerId === browser.files.userId;
  const actions: { action: RowAction; label: string; disabled: boolean }[] = [
    { action: 'open', label: 'Open', disabled: false },
    { action: 'rename', label: 'Rename', disabled: !entry.canEdit },
    { action: 'share', label: 'Share', disabled: false },
    { action: 'copy', label: 'Copy', disabled: false },
    { action: 'cut', label: 'Cut', disabled: !editable },
    { action: 'move', label: 'Move to…', disabled: !editable },
    { action: 'duplicate', label: 'Copy to…', disabled: false },
    { action: 'delete', label: 'Delete', disabled: !editable },
  ];
  return (
    <div
      className={cn(
        'group relative rounded-md',
        selected ? 'bg-accent-subtle' : 'hover:bg-surface-2',
        compact ? 'flex items-center px-1' : 'border border-border p-3',
        browser.clipboard?.operation === 'move' &&
          browser.clipboard.ids.includes(entry.id) &&
          'opacity-50',
      )}
    >
      <input
        type="checkbox"
        aria-label={`Select ${entry.name}`}
        checked={selected}
        onChange={() => browser.choose(entry, false, true, siblings)}
        className={compact ? 'mr-2' : 'absolute top-2 left-2'}
      />
      <button
        draggable={!browser.busy && entry.syncId !== 0}
        onDragStart={(event) => browser.startDrag(event, entry)}
        onDragOver={(event) => {
          if (entry.kind === 'folder' && entry.canEdit) event.preventDefault();
        }}
        onDrop={(event) => {
          if (entry.kind === 'folder') browser.drop(event, entry.id);
        }}
        type="button"
        onMouseEnter={() => browser.prefetch(entry)}
        onFocus={() => browser.prefetch(entry)}
        onClick={(event) => {
          if (event.shiftKey || event.metaKey || event.ctrlKey)
            browser.choose(entry, event.shiftKey, event.metaKey || event.ctrlKey, siblings);
          else browser.act(entry, 'open');
        }}
        className={cn(
          'flex min-w-0 flex-1 text-text',
          compact
            ? 'items-center gap-2 py-2 text-xs'
            : 'w-full flex-col items-center gap-2 pt-4 text-sm',
        )}
      >
        <Icon
          className={cn(
            'shrink-0',
            compact ? 'size-4' : 'size-12',
            entry.kind === 'folder' ? 'fill-accent-subtle text-accent' : 'text-muted',
          )}
        />
        <span className={compact ? 'truncate' : 'line-clamp-2 min-h-10 break-all text-center'}>
          {entry.name}
        </span>
        {compact && entry.kind === 'folder' ? (
          <ChevronRight className="ml-auto size-3 text-faint" />
        ) : null}
      </button>
      {compact ? null : (
        <p className="mt-1 truncate text-center text-faint text-xs">
          {ACCESS_LABELS[entry.visibility]}
          {entry.kind === 'folder' ? '' : ` · ${fileSize(entry.size)}`}
        </p>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Actions for ${entry.name}`}
            className={compact ? 'shrink-0' : 'absolute top-0 right-0'}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {actions.map((item) => (
            <DropdownMenuItem
              key={item.action}
              disabled={browser.busy || item.disabled}
              onSelect={() => browser.act(entry, item.action)}
            >
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function FileGrid({ browser }: { readonly browser: FileBrowser }) {
  const host = useRef<HTMLElement | null>(null);
  const columns = 4;
  const count = Math.ceil(browser.visible.length / columns);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => host.current?.parentElement ?? null,
    estimateSize: () => 174,
    overscan: 3,
    initialRect: { height: 640, width: 1000 },
  });
  const virtual = browser.visible.length > 100;
  return (
    <section
      ref={host}
      aria-label="Files in grid view"
      className="relative pt-3"
      style={virtual ? { height: virtualizer.getTotalSize() } : undefined}
    >
      {virtual ? (
        virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            className="absolute top-0 left-0 grid w-full grid-cols-4 gap-3"
            style={{ transform: `translateY(${row.start}px)`, height: row.size, paddingBottom: 12 }}
          >
            {browser.visible.slice(row.index * columns, (row.index + 1) * columns).map((entry) => (
              <FileTile key={entry.id} entry={entry} browser={browser} />
            ))}
          </div>
        ))
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5">
          {browser.visible.map((entry) => (
            <FileTile key={entry.id} entry={entry} browser={browser} />
          ))}
        </div>
      )}
    </section>
  );
}

function FolderColumn({
  id,
  browser,
}: {
  readonly id: string | null;
  readonly browser: FileBrowser;
}) {
  const files = useFiles(id);
  const entries = files.listing.data?.entries ?? [];
  const host = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => host.current,
    estimateSize: () => 40,
    overscan: 8,
    initialRect: { height: 640, width: 256 },
  });
  const virtual = entries.length > 100;
  return (
    <section
      aria-label={`Column ${files.listing.data?.ancestors.at(-1)?.name ?? 'Files'}`}
      className="flex h-full w-64 shrink-0 flex-col border-border border-r p-2"
      onDragOver={(event) => {
        if (id === null || files.listing.data?.ancestors.at(-1)?.canEdit) event.preventDefault();
      }}
      onDrop={(event) => browser.drop(event, id)}
    >
      <p className="mb-2 truncate px-1 font-medium text-muted text-xs">
        {files.listing.data?.ancestors.at(-1)?.name ?? 'Files'}
      </p>
      <div ref={host} className="min-h-0 flex-1 overflow-auto">
        <div
          className="relative"
          style={virtual ? { height: virtualizer.getTotalSize() } : undefined}
        >
          {virtual
            ? virtualizer.getVirtualItems().map((row) => {
                const entry = entries[row.index];
                return entry === undefined ? null : (
                  <div
                    key={entry.id}
                    className="absolute top-0 left-0 w-full"
                    style={{ transform: `translateY(${row.start}px)` }}
                  >
                    <FileTile entry={entry} browser={browser} compact siblings={entries} />
                  </div>
                );
              })
            : entries.map((entry) => (
                <FileTile
                  key={entry.id}
                  entry={entry}
                  browser={browser}
                  compact
                  siblings={entries}
                />
              ))}
        </div>
        {files.listing.isPending ? <p className="p-2 text-muted text-xs">Loading…</p> : null}
        {files.listing.error === null ? null : (
          <p role="alert" className="p-2 text-danger text-xs">
            Could not open this folder.
          </p>
        )}
      </div>
    </section>
  );
}

export function FileColumns({ browser }: { readonly browser: FileBrowser }) {
  if (browser.search !== '') return <FileGrid browser={browser} />;
  return (
    <section aria-label="Files in columns view" className="flex h-full min-h-80 overflow-x-auto">
      <FolderColumn id={null} browser={browser} />
      {browser.files.listing.data?.ancestors.map((entry) => (
        <FolderColumn key={entry.id} id={entry.id} browser={browser} />
      ))}
    </section>
  );
}
