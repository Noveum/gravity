'use client';

import { type FileEntry, fileDetailSchema } from '@gravity/shared/validators';
import { useQuery } from '@tanstack/react-query';
import { Download, X } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { apiFetch, messageOf } from '@/lib/api/client.ts';
import { fileKey } from './file-cache.ts';
import { FilePreview } from './file-preview.tsx';
import { fileSize } from './file-row.tsx';
import { MarkdownPreview } from './markdown-preview.tsx';
import type { FileCommand } from './use-files.ts';

function MarkdownEditor({
  entry,
  body,
  run,
  pending,
}: {
  readonly entry: FileEntry;
  readonly body: string;
  readonly run: (command: FileCommand) => Promise<unknown>;
  readonly pending: boolean;
}) {
  const [draft, setDraft] = useState(body);
  const preview = useDeferredValue(draft);
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState(entry.syncId);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    try {
      await run({ type: 'update', id: entry.id, body: { body: draft, expectedSyncId: version } });
      setEditing(false);
      setError(null);
    } catch (failure: unknown) {
      setError(messageOf(failure));
    }
  }
  return (
    <>
      <div className="my-4 flex items-center justify-between gap-2">
        <p className="text-muted text-xs">
          {editing ? 'Changes are saved when you choose Save.' : 'Markdown document'}
        </p>
        {entry.canEdit && editing ? (
          <div className="flex gap-2">
            <Button disabled={pending} onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={pending} onClick={save}>
              Save
            </Button>
          </div>
        ) : null}
        {entry.canEdit && !editing ? (
          <Button
            onClick={() => {
              setDraft(body);
              setVersion(entry.syncId);
              setEditing(true);
            }}
          >
            Edit Markdown
          </Button>
        ) : null}
      </div>
      {error === null ? null : (
        <p role="alert" className="my-2 text-danger text-sm">
          {error}
        </p>
      )}
      {editing ? (
        <div className="grid gap-4 md:grid-cols-2">
          <textarea
            aria-label="Markdown source"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-96 w-full rounded-lg border border-border bg-surface p-4 font-mono text-sm text-text"
          />
          <div className="rounded-lg border border-border p-4">
            <MarkdownPreview body={preview} />
          </div>
        </div>
      ) : (
        <MarkdownPreview body={body} />
      )}
    </>
  );
}

export function FileEditor({
  entry,
  organizationId,
  close,
  run,
  pending,
}: {
  readonly entry: FileEntry;
  readonly organizationId: string;
  readonly close: () => void;
  readonly run: (command: FileCommand) => Promise<unknown>;
  readonly pending: boolean;
}) {
  const query = useQuery({
    queryKey: fileKey(organizationId, entry.id),
    queryFn: ({ signal }) => apiFetch(`/api/files/${entry.id}`, fileDetailSchema, { signal }),
    staleTime: 0,
  });
  const current = query.data?.entry ?? entry;
  let description = current.canEdit ? 'You can edit this document.' : 'You have view access.';
  if (current.kind === 'file')
    description = `${current.name.split('.').at(-1)?.toUpperCase() ?? 'File'} · ${fileSize(current.size)} · Preview`;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent showClose={false} className="flex max-w-5xl flex-col overflow-hidden p-0">
        <header className="flex shrink-0 items-center gap-3 border-border border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate font-medium text-base" title={current.name}>
              {current.name}
            </DialogTitle>
            <DialogDescription className="mt-1 text-muted text-xs">{description}</DialogDescription>
          </div>
          {query.error === null ? (
            <Button asChild size="sm">
              <a href={`/api/files/${current.id}/download`} aria-label={`Download ${current.name}`}>
                <Download className="size-4" />
                <span className="hidden sm:inline">Download</span>
              </a>
            </Button>
          ) : null}
          <DialogClose asChild>
            <Button size="sm" variant="ghost" aria-label="Close">
              <X className="size-4" />
            </Button>
          </DialogClose>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
          {query.isPending && current.kind === 'markdown' ? (
            <p className="py-8 text-muted">Loading document…</p>
          ) : null}
          {query.error === null ? null : (
            <p role="alert" className="py-8 text-danger">
              {messageOf(query.error)}
            </p>
          )}
          {query.data !== undefined && query.error === null && current.kind === 'markdown' ? (
            <MarkdownEditor
              entry={current}
              body={query.data.body ?? ''}
              run={run}
              pending={pending}
            />
          ) : null}
          {query.error === null && current.kind === 'file' ? (
            <FilePreview entry={current} downloadPath={`/api/files/${current.id}/download`} />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
