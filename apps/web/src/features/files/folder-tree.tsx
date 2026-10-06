'use client';

import type { FileEntry } from '@gravity/shared/validators';
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn.ts';
import type { FileBrowser } from './use-file-browser.ts';
import { useFiles } from './use-files.ts';

function TreeBranch({
  entry,
  depth,
  browser,
}: {
  readonly entry: FileEntry;
  readonly depth: number;
  readonly browser: FileBrowser;
}) {
  const activePath =
    browser.files.listing.data?.ancestors.some((item) => item.id === entry.id) === true;
  const [preference, setPreference] = useState<boolean | null>(null);
  const expanded = preference ?? activePath;
  return (
    <li>
      <div
        style={{ paddingLeft: depth * 12 }}
        className={cn(
          'flex items-center rounded-md',
          browser.parentId === entry.id
            ? 'bg-accent-subtle text-accent'
            : 'text-muted hover:bg-surface-2',
        )}
      >
        <button
          type="button"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${entry.name}`}
          className="p-1.5"
          onClick={() => setPreference(!expanded)}
        >
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>
        <button
          type="button"
          onDragOver={(event) => {
            if (entry.canEdit) event.preventDefault();
          }}
          onDrop={(event) => browser.drop(event, entry.id)}
          aria-label={`Open folder ${entry.name}`}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-2 text-left text-xs"
          onMouseEnter={() => browser.prefetch(entry)}
          onClick={() => browser.navigate(entry.id)}
        >
          <Folder className="size-4 shrink-0 text-accent" />
          <span className="truncate">{entry.name}</span>
        </button>
      </div>
      {expanded && depth < 32 ? (
        <TreeChildren parentId={entry.id} depth={depth + 1} browser={browser} />
      ) : null}
    </li>
  );
}

function TreeChildren({
  parentId,
  depth,
  browser,
}: {
  readonly parentId: string | null;
  readonly depth: number;
  readonly browser: FileBrowser;
}) {
  const files = useFiles(parentId);
  return (
    <ul>
      {files.listing.data?.entries
        .filter((entry) => entry.kind === 'folder')
        .map((entry) => (
          <TreeBranch key={entry.id} entry={entry} depth={depth} browser={browser} />
        ))}
      {files.listing.isPending ? (
        <li className="p-2 text-faint text-xs">Loading folders…</li>
      ) : null}
      {files.listing.error === null ? null : (
        <li className="p-2 text-danger text-xs">Folders unavailable</li>
      )}
    </ul>
  );
}

export function FolderTree({ browser }: { readonly browser: FileBrowser }) {
  return (
    <aside
      aria-label="Folder navigation"
      className="hidden w-48 shrink-0 overflow-auto border-border border-r px-2 py-3 md:block"
    >
      <p className="mb-2 px-2 font-medium text-faint text-xs">Folders</p>
      <button
        type="button"
        className={cn(
          'mb-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs',
          browser.parentId === null
            ? 'bg-accent-subtle text-accent'
            : 'text-muted hover:bg-surface-2',
        )}
        onClick={() => browser.navigate(null)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => browser.drop(event, null)}
      >
        <FolderOpen className="size-4" />
        All files
      </button>
      <div>
        <TreeChildren parentId={null} depth={0} browser={browser} />
      </div>
    </aside>
  );
}
