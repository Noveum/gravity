'use client';

import {
  SAVED_VIEW_VISIBILITIES,
  SAVED_VIEW_VISIBILITY_LABELS,
  type SavedViewObject,
  type SavedViewVisibility,
} from '@gravity/shared/constants';
import type { FilterGroup } from '@gravity/shared/filters';
import type { SavedViewRow } from '@gravity/shared/records';
import { randomUUIDv7 } from '@gravity/shared/utils';
import { type FormEvent, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { useHotkey } from '@/lib/keyboard/index.ts';
import { upsertById } from '@/lib/query/bootstrap-cache.ts';
import { apiFetch } from '@/lib/query/fetcher.ts';
import { viewEnvelopeSchema } from '@/lib/query/schemas.ts';
import { useBootstrapMutation } from '@/lib/query/use-bootstrap-mutation.ts';

export interface SaveViewDialogProps {
  readonly object: SavedViewObject;
  readonly pipelineId: string | null;
  readonly filter: FilterGroup;
  readonly viewId: string | null;
  readonly onSaved?: (view: SavedViewRow) => void;
}

interface SaveInput {
  readonly view: SavedViewRow;
  readonly create: boolean;
}

export function SaveViewDialog({
  object,
  pipelineId,
  filter,
  viewId,
  onSaved,
}: SaveViewDialogProps) {
  const workspace = useWorkspace();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<SavedViewVisibility>('private');
  const nameInput = useRef<HTMLInputElement | null>(null);
  const form = useRef<HTMLFormElement | null>(null);
  const owned = workspace.savedViews.find(
    (view) => view.id === viewId && view.ownerId === workspace.userId,
  );
  const save = useBootstrapMutation<SaveInput, SavedViewRow>({
    mutationFn: async ({ view, create }) =>
      (
        await apiFetch(create ? '/api/views' : `/api/views/${view.id}`, viewEnvelopeSchema, {
          method: create ? 'POST' : 'PATCH',
          body: create
            ? {
                id: view.id,
                object: view.object,
                pipelineId: view.pipelineId,
                name: view.name,
                filter: view.filter,
                visibility: view.visibility,
              }
            : { filter: view.filter },
        })
      ).view,
    optimistic: (bootstrap, { view }) => ({
      ...bootstrap,
      savedViews: upsertById(bootstrap.savedViews, view),
    }),
    settle: (bootstrap, view) => ({
      ...bootstrap,
      savedViews: upsertById(bootstrap.savedViews, view),
    }),
    served: (view) => [{ model: 'saved_view', id: view.id, syncId: view.syncId }],
    failure: ({ view }) => `Could not save ${view.name}`,
  });

  const persist = (input: SaveInput, announce: boolean) => {
    save
      .mutateAsync(input)
      .then((view) => {
        if (announce) toast({ title: `Saved ${view.name}` });
        onSaved?.(view);
      })
      .catch(() => undefined);
  };

  useHotkey(
    'mod+s',
    () => {
      if (open) {
        form.current?.requestSubmit();
        return;
      }
      if (owned === undefined) {
        setOpen(true);
        return;
      }
      persist({ view: { ...owned, filter }, create: false }, true);
    },
    {
      label: 'Save these filters as a view',
      section: 'Records',
      scope: 'filters',
      allowInInput: true,
    },
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    const now = new Date().toISOString();
    persist(
      {
        create: true,
        view: {
          id: randomUUIDv7(),
          object,
          pipelineId,
          name: trimmed,
          filter,
          display: {},
          visibility,
          ownerId: workspace.userId,
          position: workspace.savedViews.length,
          syncId: 0,
          createdAt: now,
          updatedAt: now,
        },
      },
      false,
    );
    setOpen(false);
    setName('');
    setVisibility('private');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          nameInput.current?.focus();
        }}
      >
        <form ref={form} onSubmit={submit} className="flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Save view</DialogTitle>
          </DialogHeader>
          <Input
            ref={nameInput}
            aria-label="View name"
            placeholder="Hot leads"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-faint text-xs">Who sees it</legend>
            {SAVED_VIEW_VISIBILITIES.map((option) => (
              <label key={option} className="flex items-center gap-2 text-dense">
                <input
                  type="radio"
                  name="visibility"
                  checked={visibility === option}
                  onChange={() => setVisibility(option)}
                />
                {SAVED_VIEW_VISIBILITY_LABELS[option]}
              </label>
            ))}
          </fieldset>
          <DialogFooter>
            <Button type="submit" variant="primary">
              Save view
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
