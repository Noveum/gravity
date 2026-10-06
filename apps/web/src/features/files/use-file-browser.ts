'use client';

import { can } from '@gravity/shared/policy';
import {
  type FileEntry,
  fileDetailSchema,
  fileDragSchema,
  fileIdSchema,
  fileListingSchema,
} from '@gravity/shared/validators';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { type DragEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { apiFetch, messageOf } from '@/lib/api/client.ts';
import { useBootstrap } from '@/lib/query/use-bootstrap.ts';
import { fileKey, folderKey } from './file-cache.ts';
import type { RowAction } from './file-row.tsx';
import { type FileShortcut, fileShortcut, isFileInput } from './file-shortcuts.ts';
import { nativeFileDrop } from './native-file-drop.ts';
import { useFiles } from './use-files.ts';

const DRAG_TYPE = 'application/x-gravity-files';
const viewSchema = z.enum(['list', 'grid', 'columns']);

export function useFileBrowser() {
  const params = useSearchParams();
  const rawFolder = params.get('folder');
  const parentId = fileIdSchema.safeParse(rawFolder).data ?? null;
  const files = useFiles(parentId);
  const client = useQueryClient();
  const [view, setView] = useState<z.infer<typeof viewSchema>>('list');
  const [draggingFiles, setDraggingFiles] = useState(false);
  const folderUploadInput = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    try {
      setView(viewSchema.safeParse(localStorage.getItem('gravity-file-view')).data ?? 'list');
    } catch (failure: unknown) {
      console.warn('Could not load file view preference.', failure);
    }
  }, []);
  function changeView(next: z.infer<typeof viewSchema>) {
    setView(next);
    try {
      localStorage.setItem('gravity-file-view', next);
    } catch (failure: unknown) {
      console.warn('Could not save file view preference.', failure);
    }
  }
  const { data: bootstrap } = useBootstrap();
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [clipboard, setClipboard] = useState<{ ids: string[]; operation: 'move' | 'copy' } | null>(
    null,
  );
  const [creating, setCreating] = useState<'folder' | 'markdown' | null>(null);
  const [sharing, setSharing] = useState<FileEntry | null>(null);
  const [renaming, setRenaming] = useState<FileEntry | null>(null);
  const [opened, setOpened] = useState<FileEntry | null>(null);
  const [transfer, setTransfer] = useState<{
    entries: FileEntry[];
    operation: 'move' | 'copy' | 'delete';
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploadInput = useRef<HTMLInputElement | null>(null);
  const browserRef = useRef<HTMLElement | null>(null);
  const pastingRef = useRef(false);
  const entries = files.listing.data?.entries ?? [];
  const visible = entries.filter((entry) =>
    entry.name.toLowerCase().includes(search.toLowerCase()),
  );
  const currentFolder = files.listing.data?.ancestors.at(-1);
  const mayWrite =
    bootstrap !== undefined &&
    can(
      {
        userId: bootstrap.me.userId,
        organizationId: bootstrap.organization.id,
        role: bootstrap.me.role,
      },
      'record:write',
    );
  const writable =
    mayWrite && (currentFolder?.canEdit ?? parentId === null) && files.listing.data !== undefined;
  const busy = files.mutation.isPending;
  const uploading = files.uploads.some((upload) => upload.progress < 100 && upload.error === null);
  const selected = entries.filter((entry) => selection.has(entry.id));
  const mayMove =
    selected.length > 0 &&
    selected.every((entry) => entry.canEdit && entry.ownerId === files.userId);
  const deepId = params.get('open');
  const deepFile = useQuery({
    queryKey: fileKey(files.organizationId, deepId ?? ''),
    queryFn: ({ signal }) => apiFetch(`/api/files/${deepId}`, fileDetailSchema, { signal }),
    enabled:
      deepId !== null && fileIdSchema.safeParse(deepId).success && files.organizationId.length > 0,
  });
  const editorEntry = opened ?? deepFile.data?.entry ?? null;
  const hasDialog = [creating, sharing, renaming, transfer, editorEntry].some(
    (dialog) => dialog !== null,
  );

  function navigate(id: string | null) {
    setSelection(new Set());
    setSearch('');
    setError(null);
    setOpened(null);
    window.history.pushState(null, '', id === null ? '/files' : `/files?folder=${id}`);
    browserRef.current?.focus();
  }
  function prefetch(entry: FileEntry) {
    const request =
      entry.kind === 'folder'
        ? client.prefetchQuery({
            queryKey: folderKey(files.organizationId, entry.id),
            queryFn: ({ signal }) =>
              apiFetch(`/api/files?parentId=${entry.id}`, fileListingSchema, { signal }),
            staleTime: 60_000,
          })
        : client.prefetchQuery({
            queryKey: fileKey(files.organizationId, entry.id),
            queryFn: ({ signal }) =>
              apiFetch(`/api/files/${entry.id}`, fileDetailSchema, { signal }),
            staleTime: 60_000,
          });
    request.catch((failure: unknown) => console.warn('Could not preload folder or file.', failure));
  }
  function uploadSelected(items: readonly File[]) {
    files.upload(items).catch((failure: unknown) => setError(messageOf(failure)));
  }
  function closeEditor() {
    setOpened(null);
    if (deepId !== null)
      window.history.replaceState(
        null,
        '',
        parentId === null ? '/files' : `/files?folder=${parentId}`,
      );
  }
  async function paste(destination = parentId, data = clipboard) {
    if (data === null || busy || pastingRef.current) return;
    pastingRef.current = true;
    try {
      if (destination === parentId && files.listing.data === undefined)
        await files.listing.refetch({ throwOnError: true });
      await files.mutation.mutateAsync({
        type: 'transfer',
        body: { ...data, parentId: destination },
      });
      if (data.operation === 'move') setClipboard(null);
      setSelection(new Set());
      setError(null);
    } catch (failure: unknown) {
      setError(messageOf(failure));
    } finally {
      pastingRef.current = false;
    }
  }
  function choose(entry: FileEntry, shift: boolean, toggle: boolean) {
    if (shift && anchor !== null) {
      const from = visible.findIndex((item) => item.id === anchor);
      const to = visible.findIndex((item) => item.id === entry.id);
      setSelection(
        new Set(
          visible
            .slice(Math.max(0, Math.min(from, to)), Math.max(from, to) + 1)
            .map((item) => item.id),
        ),
      );
    } else if (toggle) {
      setSelection((current) => {
        const next = new Set(current);
        if (next.has(entry.id)) next.delete(entry.id);
        else next.add(entry.id);
        return next;
      });
    } else setSelection(new Set([entry.id]));
    if (!shift) setAnchor(entry.id);
  }
  function act(entry: FileEntry, action: RowAction) {
    const targets = selection.has(entry.id) ? selected : [entry];
    if (action === 'open') {
      if (entry.kind === 'folder') navigate(entry.id);
      else setOpened(entry);
    } else if (action === 'rename') setRenaming(entry);
    else if (action === 'share') setSharing(entry);
    else if (action === 'copy' || action === 'cut')
      setClipboard({
        ids: targets.map((item) => item.id),
        operation: action === 'cut' ? 'move' : 'copy',
      });
    else setTransfer({ entries: targets, operation: action === 'duplicate' ? 'copy' : action });
  }
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (isFileInput(event.target) || busy || hasDialog) return;
    const shortcut = fileShortcut(event);
    if (shortcut === null) return;
    const commands: Record<FileShortcut, () => void> = {
      all: () => setSelection(new Set(visible.map((entry) => entry.id))),
      copy: () => {
        if (selected.length > 0)
          setClipboard({ ids: selected.map((entry) => entry.id), operation: 'copy' });
      },
      cut: () => {
        if (mayMove) setClipboard({ ids: selected.map((entry) => entry.id), operation: 'move' });
      },
      paste: () => {
        if (mayWrite && (parentId === null || currentFolder?.canEdit === true)) paste();
      },
      open: () => {
        const entry = selected[0];
        if (selected.length === 1 && entry !== undefined) act(entry, 'open');
      },
      delete: () => {
        if (mayMove) setTransfer({ entries: selected, operation: 'delete' });
      },
      clear: () => setSelection(new Set()),
      down: () => moveSelection(1, event.shiftKey),
      up: () => moveSelection(-1, event.shiftKey),
    };
    event.preventDefault();
    commands[shortcut]();
  }
  function moveSelection(direction: number, shift: boolean) {
    const index = visible.findIndex((entry) => entry.id === anchor);
    const next = visible[Math.max(0, Math.min(visible.length - 1, index + direction))];
    if (next !== undefined) choose(next, shift, false);
  }
  function startDrag(event: DragEvent, entry: FileEntry) {
    const ids = selection.has(entry.id) ? selected.map((item) => item.id) : [entry.id];
    event.dataTransfer.setData(
      DRAG_TYPE,
      JSON.stringify({ ids, organizationId: files.organizationId }),
    );
    event.dataTransfer.effectAllowed =
      entry.ownerId === files.userId && entry.canEdit ? 'copyMove' : 'copy';
  }
  function drop(event: DragEvent, destination: string | null) {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    setDraggingFiles(false);
    if (event.dataTransfer.types.includes('Files')) {
      if (mayWrite && !uploading)
        nativeFileDrop(event.dataTransfer)
          .then((batch) => files.uploadBatch(batch, destination))
          .catch((failure: unknown) => setError(messageOf(failure)));
      return;
    }
    try {
      const raw = fileDragSchema.parse(JSON.parse(event.dataTransfer.getData(DRAG_TYPE)));
      if (raw.organizationId !== files.organizationId) return;
      paste(destination, {
        ids: raw.ids,
        operation: event.altKey || event.dataTransfer.effectAllowed === 'copy' ? 'copy' : 'move',
      });
    } catch (failure: unknown) {
      setError(messageOf(failure, 'That drag operation could not be read.'));
    }
  }
  const run = (command: Parameters<typeof files.mutation.mutateAsync>[0]) =>
    files.mutation.mutateAsync(command);
  return {
    files,
    entries,
    parentId,
    busy,
    writable,
    uploading,
    currentFolder,
    selection,
    selected,
    visible,
    clipboard,
    search,
    setSearch,
    navigate,
    drop,
    setCreating,
    uploadInput,
    browserRef,
    setSelection,
    setClipboard,
    mayMove,
    setTransfer,
    error,
    deepFile,
    creating,
    sharing,
    renaming,
    transfer,
    editorEntry,
    closeEditor,
    setSharing,
    setRenaming,
    choose,
    act,
    startDrag,
    run,
    paste,
    onKeyDown,
    setOpened,
    anchor,
    view,
    changeView,
    prefetch,
    uploadSelected,
    folderUploadInput,
    draggingFiles,
    setDraggingFiles,
  };
}

export type FileBrowser = ReturnType<typeof useFileBrowser>;
