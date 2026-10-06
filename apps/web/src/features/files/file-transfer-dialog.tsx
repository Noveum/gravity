'use client';

import { type FileEntry, fileListingSchema } from '@gravity/shared/validators';
import { useQuery } from '@tanstack/react-query';
import { Folder } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { apiFetch, messageOf } from '@/lib/api/client.ts';
import { folderKey } from './file-cache.ts';
import type { FileCommand } from './use-files.ts';

export function FileTransferDialog({
  entries,
  operation,
  organizationId,
  close,
  run,
  pending,
}: {
  readonly entries: readonly FileEntry[];
  readonly operation: 'move' | 'copy' | 'delete';
  readonly organizationId: string;
  readonly close: () => void;
  readonly run: (command: FileCommand) => Promise<unknown>;
  readonly pending: boolean;
}) {
  const [parentId, setParentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listing = useQuery({
    queryKey: folderKey(organizationId, parentId),
    queryFn: ({ signal }) =>
      apiFetch(`/api/files${parentId === null ? '' : `?parentId=${parentId}`}`, fileListingSchema, {
        signal,
      }),
    enabled: operation !== 'delete',
  });
  async function submit() {
    try {
      await run({
        type: 'transfer',
        body: { operation, parentId, ids: entries.map((entry) => entry.id) },
      });
      close();
    } catch (failure: unknown) {
      setError(messageOf(failure));
    }
  }
  const title = { delete: 'Delete', move: 'Move', copy: 'Copy' }[operation];
  const descriptions = {
    delete: 'This permanently deletes the selected items and everything inside selected folders.',
    copy: 'Copies start private. Select a destination folder.',
    move: 'Items that inherit access use the destination folder’s permissions. Select a destination.',
  };
  const folders =
    listing.data?.entries.filter(
      (entry) =>
        entry.kind === 'folder' &&
        entry.canEdit &&
        !entries.some((selected) => selected.id === entry.id),
    ) ?? [];
  const validDestination =
    !listing.isPending &&
    listing.error === null &&
    (listing.data?.ancestors.at(-1)?.canEdit ?? parentId === null);
  const folder = listing.data?.ancestors.at(-1);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent>
        <DialogTitle className="font-medium text-lg">
          {title} {entries.length === 1 ? entries[0]?.name : `${entries.length} items`}
        </DialogTitle>
        <DialogDescription className="mt-1 text-muted text-dense">
          {descriptions[operation]}
        </DialogDescription>
        {operation === 'delete' ? null : (
          <div className="my-4 flex flex-col gap-2">
            <div className="flex flex-wrap gap-1">
              <Button size="sm" onClick={() => setParentId(null)}>
                Files
              </Button>
              {listing.data?.ancestors.map((ancestor) => (
                <Button key={ancestor.id} size="sm" onClick={() => setParentId(ancestor.id)}>
                  {ancestor.name}
                </Button>
              ))}
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border border-border p-2">
              {listing.isPending ? (
                <p className="p-3 text-muted text-sm">Loading folders…</p>
              ) : null}
              {listing.error === null ? null : (
                <p role="alert" className="p-3 text-danger text-sm">
                  {messageOf(listing.error)}
                </p>
              )}
              {folders.map((entry) => (
                <Button
                  key={entry.id}
                  block
                  variant="ghost"
                  className="justify-start"
                  onClick={() => setParentId(entry.id)}
                >
                  <Folder className="size-4" />
                  {entry.name}
                </Button>
              ))}
            </div>
            <p className="text-muted text-xs">Destination: {folder?.name ?? 'Files'}</p>
          </div>
        )}
        {error === null ? null : (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant={operation === 'delete' ? 'danger' : 'primary'}
            disabled={pending || (operation !== 'delete' && !validDestination)}
            onClick={() => submit()}
          >
            {title}
            {operation === 'delete' ? ' permanently' : ' here'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
