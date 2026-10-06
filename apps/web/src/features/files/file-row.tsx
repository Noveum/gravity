'use client';

import type { FileEntry } from '@gravity/shared/validators';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { File, FileText, Folder, Globe, Lock, MoreHorizontal, Users } from 'lucide-react';
import type { DragEvent } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { cn } from '@/lib/cn.ts';
import { ACCESS_LABELS } from './file-dialogs.tsx';

export type RowAction =
  | 'open'
  | 'rename'
  | 'share'
  | 'cut'
  | 'copy'
  | 'move'
  | 'duplicate'
  | 'delete';
const MENU_ITEMS: readonly { action: RowAction; label: string }[] = [
  { action: 'open', label: 'Open' },
  { action: 'rename', label: 'Rename' },
  { action: 'share', label: 'Share' },
  { action: 'cut', label: 'Cut' },
  { action: 'copy', label: 'Copy' },
  { action: 'move', label: 'Move to…' },
  { action: 'duplicate', label: 'Copy to…' },
  { action: 'delete', label: 'Delete' },
];

export function fileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileRow({
  entry,
  selected,
  cut,
  userId,
  select,
  action,
  drag,
  drop,
  disabled,
  prefetch,
}: {
  readonly entry: FileEntry;
  readonly selected: boolean;
  readonly cut: boolean;
  readonly userId: string;
  readonly select: (shift: boolean, toggle: boolean) => void;
  readonly action: (action: RowAction) => void;
  readonly drag: (event: DragEvent) => void;
  readonly drop: (event: DragEvent, id: string) => void;
  readonly disabled: boolean;
  readonly prefetch: () => void;
}) {
  const Icon = { folder: Folder, markdown: FileText, file: File }[entry.kind];
  let AccessIcon = Users;
  if (entry.visibility === 'private') AccessIcon = Lock;
  if (entry.publicToken !== null) AccessIcon = Globe;
  const kindLabel = {
    folder: 'Folder',
    markdown: 'Markdown',
    file: entry.name.split('.').at(-1)?.toUpperCase(),
  }[entry.kind];
  function isDisabled(item: RowAction): boolean {
    if (disabled) return true;
    if (item === 'rename') return !entry.canEdit;
    if (item === 'cut' || item === 'move' || item === 'delete')
      return !entry.canEdit || entry.ownerId !== userId;
    return false;
  }
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <tr
          className={cn(
            'h-12 border-border border-b',
            selected ? 'bg-accent-subtle' : 'hover:bg-surface-2',
            cut && 'opacity-50',
          )}
          draggable={!disabled}
          onDragStart={drag}
          onDragOver={(event) => {
            if (entry.kind === 'folder' && entry.canEdit) {
              event.preventDefault();
              event.dataTransfer.dropEffect = event.altKey ? 'copy' : 'move';
            }
          }}
          onDrop={(event) => {
            if (entry.kind === 'folder') drop(event, entry.id);
          }}
          onContextMenu={() => {
            if (!selected) select(false, false);
          }}
        >
          <td className="w-10 px-3">
            <input
              aria-label={`Select ${entry.name}`}
              type="checkbox"
              checked={selected}
              onChange={() => select(false, true)}
            />
          </td>
          <td className="min-w-0 px-2">
            <button
              type="button"
              className="flex w-full items-center gap-2.5 py-2 text-left text-dense text-text"
              onMouseEnter={prefetch}
              onFocus={prefetch}
              onClick={(event) => {
                if (event.shiftKey || event.metaKey || event.ctrlKey)
                  select(event.shiftKey, event.metaKey || event.ctrlKey);
                else action('open');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.stopPropagation();
                  action('open');
                }
              }}
            >
              <Icon
                className={cn(
                  'size-5 shrink-0',
                  entry.kind === 'folder' ? 'text-accent' : 'text-muted',
                )}
                aria-hidden="true"
              />
              <span className="truncate">{entry.name}</span>
            </button>
          </td>
          <td className="hidden px-3 text-muted text-xs sm:table-cell">
            <span className="flex items-center gap-1.5">
              <AccessIcon className="size-3.5" aria-hidden="true" />
              {ACCESS_LABELS[entry.visibility]}
            </span>
          </td>
          <td className="hidden px-3 text-muted text-xs md:table-cell">{kindLabel}</td>
          <td className="hidden px-3 text-muted text-xs lg:table-cell">
            {new Date(entry.updatedAt).toLocaleDateString()}
          </td>
          <td className="hidden px-3 text-right text-muted text-xs sm:table-cell">
            {entry.kind === 'folder' ? '' : fileSize(entry.size)}
          </td>
          <td className="w-10 pr-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" aria-label={`Actions for ${entry.name}`}>
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {MENU_ITEMS.map((item) => (
                  <DropdownMenuItem
                    key={item.action}
                    disabled={isDisabled(item.action)}
                    onSelect={() => action(item.action)}
                  >
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </td>
        </tr>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-pop">
          {MENU_ITEMS.map((item) => (
            <ContextMenu.Item
              key={item.action}
              disabled={isDisabled(item.action)}
              onSelect={() => action(item.action)}
              className="cursor-pointer rounded-sm px-2 py-1.5 text-dense text-text outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2"
            >
              {item.label}
            </ContextMenu.Item>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
