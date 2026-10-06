'use client';

import {
  type FileAccess,
  type FileEntry,
  type FileGrant,
  fileMutationSchema,
  fileNameSchema,
} from '@gravity/shared/validators';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { messageOf } from '@/lib/api/client.ts';
import type { FileCommand } from './use-files.ts';

const SELECT_CLASS = 'h-9 rounded-md border border-border bg-surface px-2 text-dense text-text';
export const ACCESS_LABELS: Readonly<Record<FileEntry['visibility'], string>> = {
  private: 'Private',
  workspace: 'Workspace',
  public: 'Public',
  shared: 'Specific people',
  inherit: 'Inherit from folder',
};

const ACCESS_DESCRIPTIONS: Readonly<Record<FileEntry['visibility'], string>> = {
  private: 'Only you can access this item.',
  public: 'Anyone with the public link can view. Parent folder restrictions still apply.',
  workspace: 'All workspace members can view. Contributors and members can edit.',
  inherit: 'Uses the parent folder’s access, including its viewer and editor roles.',
  shared:
    'Only you and the selected people can access this item. Parent folder restrictions still apply.',
};

function AccessFields({
  value,
  onChange,
  parentId,
}: {
  readonly value: FileAccess;
  readonly onChange: (value: FileAccess) => void;
  readonly parentId: string | null;
}) {
  const workspace = useWorkspace();
  const accessId = useId();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5 text-dense">
        <label htmlFor={accessId}>Access</label>
        <select
          id={accessId}
          className={SELECT_CLASS}
          value={value.visibility}
          onChange={(event) => {
            const visibility = event.target.value as FileEntry['visibility'];
            onChange({ visibility, grants: visibility === 'shared' ? value.grants : [] });
          }}
        >
          {Object.entries(ACCESS_LABELS)
            .filter(([scope]) => scope !== 'inherit' || parentId !== null)
            .map(([scope, label]) => (
              <option key={scope} value={scope}>
                {label}
              </option>
            ))}
        </select>
      </div>
      <p className="text-muted text-xs">{ACCESS_DESCRIPTIONS[value.visibility]}</p>
      {value.visibility === 'shared' ? (
        <fieldset className="max-h-64 overflow-y-auto rounded-md border border-border p-3">
          <legend className="px-1 text-xs">Workspace members</legend>
          {workspace.members
            .filter((member) => member.userId !== workspace.userId)
            .map((member) => {
              const grant = value.grants.find((candidate) => candidate.userId === member.userId);
              return (
                <div key={member.userId} className="flex items-center justify-between gap-2 py-2">
                  <label className="flex min-w-0 items-center gap-2 text-dense">
                    <input
                      type="checkbox"
                      checked={grant !== undefined}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          grants: event.target.checked
                            ? [...value.grants, { userId: member.userId, role: 'viewer' }]
                            : value.grants.filter((item) => item.userId !== member.userId),
                        })
                      }
                    />
                    <span className="truncate">
                      {member.name}
                      <span className="ml-2 text-muted text-xs">{member.email}</span>
                    </span>
                  </label>
                  {grant === undefined ? null : (
                    <select
                      aria-label={`Access for ${member.name}`}
                      className={SELECT_CLASS}
                      value={grant.role}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          grants: value.grants.map((item) =>
                            item.userId === member.userId
                              ? { ...item, role: event.target.value as FileGrant['role'] }
                              : item,
                          ),
                        })
                      }
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>
                  )}
                </div>
              );
            })}
        </fieldset>
      ) : null}
      {parentId === null ? null : (
        <p className="text-muted text-xs">
          Access also requires permission to every parent folder. Share the parent folder with these
          people if needed.
        </p>
      )}
    </div>
  );
}

export function NewFileDialog({
  kind,
  parentId,
  close,
  run,
  pending,
}: {
  readonly kind: 'folder' | 'markdown';
  readonly parentId: string | null;
  readonly close: () => void;
  readonly run: (command: FileCommand) => Promise<unknown>;
  readonly pending: boolean;
}) {
  const nameId = useId();
  const [name, setName] = useState(kind === 'markdown' ? 'Untitled.md' : '');
  const [access, setAccess] = useState<FileAccess>({
    visibility: parentId === null ? 'private' : 'inherit',
    grants: [],
  });
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    try {
      const parsed = fileNameSchema.parse(name);
      await run({ type: 'create', body: { name: parsed, kind, parentId, ...access } });
      close();
    } catch (failure: unknown) {
      setError(messageOf(failure));
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent>
        <DialogTitle className="font-medium text-lg">
          New {kind === 'folder' ? 'folder' : 'Markdown document'}
        </DialogTitle>
        <DialogDescription className="mt-1 text-muted text-dense">
          Choose a name and who can access it.
        </DialogDescription>
        <form
          className="mt-5 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label htmlFor={nameId} className="flex flex-col gap-1.5 text-dense">
            Name
            <Input
              id={nameId}
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={255}
            />
          </label>
          <AccessFields value={access} onChange={setAccess} parentId={parentId} />
          {error === null ? null : (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={pending || name.trim() === ''}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ShareFileDialog({
  entry,
  close,
  run,
  pending,
}: {
  readonly entry: FileEntry;
  readonly close: () => void;
  readonly run: (command: FileCommand) => Promise<unknown>;
  readonly pending: boolean;
}) {
  const [access, setAccess] = useState<FileAccess>({
    visibility: entry.visibility,
    grants: entry.grants,
  });
  const [version, setVersion] = useState(entry.syncId);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState<FileEntry>(entry);
  async function save() {
    try {
      const result = await run({
        type: 'update',
        id: entry.id,
        body: { access, expectedSyncId: version },
      });
      const current = fileMutationSchema.parse(result).entries.find((item) => item.id === entry.id);
      if (current !== undefined) {
        setSaved(current);
        setVersion(current.syncId);
      }
      setError(null);
    } catch (failure: unknown) {
      setError(messageOf(failure));
    }
  }
  async function copyLink() {
    try {
      const path =
        saved.publicToken === null
          ? `/files?${new URLSearchParams({ open: saved.id, ...(saved.parentId === null ? {} : { folder: saved.parentId }) })}`
          : `/share/files/${saved.publicToken}`;
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(true);
    } catch (failure: unknown) {
      setError(messageOf(failure));
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent>
        <DialogTitle className="pr-8 font-medium text-lg">Share {entry.name}</DialogTitle>
        <DialogDescription className="mt-1 text-muted text-dense">
          Folder access applies to every item inside it.
        </DialogDescription>
        <div className="mt-5 flex flex-col gap-4">
          {entry.canShare ? (
            <AccessFields
              value={access}
              onChange={(next) => {
                setAccess(next);
                setCopied(false);
              }}
              parentId={entry.parentId}
            />
          ) : (
            <p className="text-muted text-dense">
              Only the owner can change access. You can copy a link for people who already have
              access.
            </p>
          )}
          {error === null ? null : (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          )}
          {saved.visibility === 'public' && saved.publicToken === null ? (
            <p className="text-muted text-xs">
              A parent folder restricts this item. Make all parent folders public before sharing a
              public link.
            </p>
          ) : null}
          <DialogFooter>
            <Button onClick={() => copyLink()}>{copied ? 'Link copied' : 'Copy link'}</Button>
            {entry.canShare ? (
              <Button variant="primary" disabled={pending} onClick={() => save()}>
                Save access
              </Button>
            ) : null}
            <Button onClick={close}>Done</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RenameFileDialog({
  entry,
  close,
  run,
  pending,
}: {
  readonly entry: FileEntry;
  readonly close: () => void;
  readonly run: (command: FileCommand) => Promise<unknown>;
  readonly pending: boolean;
}) {
  const [name, setName] = useState(entry.name);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent>
        <DialogTitle className="font-medium text-lg">
          Rename {entry.kind === 'folder' ? 'folder' : 'file'}
        </DialogTitle>
        <DialogDescription className="mt-1 text-muted text-dense">
          Enter a new name.
        </DialogDescription>
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              fileNameSchema.parse(name);
            } catch (failure: unknown) {
              setError(messageOf(failure));
              return;
            }
            run({ type: 'update', id: entry.id, body: { name, expectedSyncId: entry.syncId } })
              .then(close)
              .catch((failure: unknown) => setError(messageOf(failure)));
          }}
        >
          <Input
            aria-label="New name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={255}
            required
          />
          {error === null ? null : (
            <p role="alert" className="mt-2 text-danger text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={pending}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
