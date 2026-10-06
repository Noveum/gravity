'use client';

import {
  type FileDetail,
  type FileEntry,
  type FileListing,
  fileListingSchema,
  fileMutationSchema,
  fileUploadResponseSchema,
  MAX_UPLOAD_BYTES,
} from '@gravity/shared/validators';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { apiFetch, messageOf } from '@/lib/api/client.ts';
import { useBootstrap } from '@/lib/query/use-bootstrap.ts';
import {
  cachedFiles,
  fileKey,
  fileRevision,
  filesKey,
  folderKey,
  patchFiles,
  restoreFileChanges,
} from './file-cache.ts';
import { availableUploadName, selectedUpload, type UploadBatch } from './native-file-drop.ts';

export type FileCommand =
  | {
      type: 'create';
      body: {
        name: string;
        kind: 'folder' | 'markdown';
        parentId: string | null;
        visibility: FileEntry['visibility'];
      };
    }
  | { type: 'update'; id: string; body: Record<string, unknown> }
  | {
      type: 'transfer';
      body: { ids: string[]; operation: 'move' | 'copy' | 'delete'; parentId: string | null };
    };

function optimisticEntries(
  command: FileCommand,
  listings: readonly (FileListing | undefined)[],
  userId: string,
): { entries: FileEntry[]; removed: string[] } {
  const entries = [
    ...new Map(
      listings.flatMap((listing) => listing?.entries ?? []).map((entry) => [entry.id, entry]),
    ).values(),
  ];
  if (command.type === 'update')
    return {
      entries: entries
        .filter((entry) => entry.id === command.id)
        .map((entry) =>
          typeof command.body['name'] === 'string'
            ? { ...entry, name: command.body['name'] }
            : entry,
        ),
      removed: [],
    };
  if (command.type === 'transfer')
    return {
      entries:
        command.body.operation === 'move'
          ? entries
              .filter((entry) => command.body.ids.includes(entry.id))
              .map((entry) => ({ ...entry, parentId: command.body.parentId }))
          : [],
      removed: command.body.operation === 'delete' ? command.body.ids : [],
    };
  const now = new Date().toISOString();
  return {
    entries: [
      {
        ...command.body,
        id: crypto.randomUUID(),
        ownerId: userId,
        grants: [],
        mimeType: command.body.kind === 'markdown' ? 'text/markdown' : null,
        size: 0,
        syncId: 0,
        createdAt: now,
        updatedAt: now,
        canEdit: true,
        canShare: true,
        publicToken: null,
      },
    ],
    removed: [],
  };
}

async function uploadFolders(
  batch: UploadBatch,
  destination: string | null,
  client: QueryClient,
  organizationId: string,
  create: (command: FileCommand) => Promise<{ entries: FileEntry[] }>,
) {
  const folderIds = new Map<string, string | null>([['[]', destination]]);
  for (const path of [...batch.folders].sort((a, b) => a.length - b.length)) {
    const folderParent = folderIds.get(JSON.stringify(path.slice(0, -1)));
    const name = path.at(-1);
    if (folderParent === undefined || name === undefined)
      throw new Error('The upload folder path could not be read.');
    const listing = await client.fetchQuery({
      queryKey: folderKey(organizationId, folderParent),
      queryFn: ({ signal }) =>
        apiFetch(
          `/api/files${folderParent === null ? '' : `?parentId=${folderParent}`}`,
          fileListingSchema,
          { signal },
        ),
      staleTime: 60_000,
    });
    const existing =
      folderParent === null
        ? undefined
        : listing.entries.find(
            (item) => item.kind === 'folder' && item.name.toLowerCase() === name.toLowerCase(),
          );
    const folderName =
      folderParent === null
        ? availableUploadName(
            name,
            listing.entries.map((entry) => entry.name),
          )
        : name;
    if (existing !== undefined && !existing.canEdit)
      throw new Error(`You cannot upload into ${name}.`);
    const folder =
      existing ??
      (
        await create({
          type: 'create',
          body: {
            name: folderName,
            kind: 'folder',
            parentId: folderParent,
            visibility: folderParent === null ? 'private' : 'inherit',
          },
        })
      ).entries[0];
    if (folder === undefined) throw new Error(`The folder ${name} could not be created.`);
    folderIds.set(JSON.stringify(path), folder.id);
  }
  return folderIds;
}

function putFile(file: File, url: string, mimeType: string, update: (progress: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('Content-Type', mimeType);
    request.timeout = 600_000;
    request.upload.onprogress = (event) =>
      update(
        event.lengthComputable ? Math.min(95, Math.round((event.loaded / event.total) * 95)) : 0,
      );
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error('Upload failed. Try again.'));
    request.onerror = () => reject(new Error('Upload failed. Check your connection.'));
    request.ontimeout = () => reject(new Error('Upload timed out. Try again.'));
    request.send(file);
  });
}

async function uploadFile(
  file: File,
  fileParent: string | null | undefined,
  update: (progress: number) => void,
) {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Choose a file up to 100 MB.');
  if (fileParent === undefined) throw new Error('The destination folder is unavailable.');
  const mimeType = file.type || 'application/octet-stream';
  const reservation = await apiFetch('/api/files/uploads', fileUploadResponseSchema, {
    method: 'POST',
    body: { name: file.name, size: file.size, mimeType, parentId: fileParent },
  });
  await putFile(file, reservation.url, mimeType, update);
  const result = await apiFetch('/api/files/uploads/complete', fileMutationSchema, {
    method: 'POST',
    body: { uploadId: reservation.uploadId },
  });

  return result.entries;
}

export function useFiles(parentId: string | null) {
  const { data: bootstrap } = useBootstrap();
  const organizationId = bootstrap?.organization.id ?? '';
  const userId = bootstrap?.me.userId ?? '';
  const client = useQueryClient();
  const listing = useQuery({
    queryKey: folderKey(organizationId, parentId),
    queryFn: ({ signal }) =>
      apiFetch(`/api/files${parentId === null ? '' : `?parentId=${parentId}`}`, fileListingSchema, {
        signal,
      }),
    enabled: organizationId.length > 0,
    staleTime: 60_000,
  });
  const mutation = useMutation({
    mutationFn: async (command: FileCommand) => {
      let path = '/api/files/transfer';
      if (command.type === 'create') path = '/api/files';
      if (command.type === 'update') path = `/api/files/${command.id}`;
      return await apiFetch(path, fileMutationSchema, {
        method: command.type === 'update' ? 'PATCH' : 'POST',
        body: command.body,
      });
    },
    onMutate: async (command) => {
      await client.cancelQueries({ queryKey: filesKey(organizationId) });
      const snapshots = client.getQueriesData<FileListing>({ queryKey: filesKey(organizationId) });
      const before = cachedFiles(client, organizationId);
      const optimistic = optimisticEntries(
        command,
        snapshots.map(([, data]) => data),
        userId,
      );
      patchFiles(client, organizationId, optimistic.entries, optimistic.removed);
      const changed = new Map(
        [...optimistic.entries.map((entry) => entry.id), ...optimistic.removed].map((id) => [
          id,
          fileRevision(client, organizationId, id),
        ]),
      );
      return { before, changed, optimistic };
    },
    onError: (_error, _command, context) => {
      if (context !== undefined)
        restoreFileChanges(client, organizationId, context.before, context.changed);
    },
    onSuccess: (result, command, context) => {
      let removed: string[] = [];
      if (command.type === 'create')
        removed = context?.optimistic.entries.map((entry) => entry.id) ?? [];
      if (command.type === 'transfer' && command.body.operation === 'delete')
        removed = command.body.ids;
      const accepted = patchFiles(client, organizationId, result.entries, removed);
      for (const entry of accepted) {
        client.setQueryData<FileDetail>(fileKey(organizationId, entry.id), (current) => {
          if (current === undefined) return undefined;
          const body =
            command.type === 'update' &&
            command.id === entry.id &&
            typeof command.body['body'] === 'string'
              ? command.body['body']
              : current.body;
          return { entry, body };
        });
        client
          .invalidateQueries({ queryKey: fileKey(organizationId, entry.id), refetchType: 'none' })
          .catch((error: unknown) => console.error('Could not mark file stale.', error));
      }
    },
  });
  const [uploads, setUploads] = useState<
    { id: string; name: string; progress: number; error: string | null }[]
  >([]);
  const uploadingRef = useRef(false);
  async function uploadBatch(batch: UploadBatch, destination = parentId) {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    setUploads(
      batch.files.map(({ file }) => ({
        id: crypto.randomUUID(),
        name: file.name,
        progress: 0,
        error: null,
      })),
    );
    let folderIds: Map<string, string | null>;
    try {
      folderIds = await uploadFolders(
        batch,
        destination,
        client,
        organizationId,
        mutation.mutateAsync,
      );
    } catch (failure: unknown) {
      uploadingRef.current = false;
      setUploads((items) => items.map((item) => ({ ...item, error: messageOf(failure) })));
      throw failure;
    }
    function updateProgress(index: number, progress: number, error: string | null) {
      setUploads((current) =>
        current.map((item, itemIndex) =>
          itemIndex === index ? { ...item, progress, error } : item,
        ),
      );
    }
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const index = cursor++;
        const item = batch.files[index];
        if (item === undefined) return;
        const { file, path } = item;
        const fileParent = folderIds.get(JSON.stringify(path));
        const update = (progress: number, error: string | null = null) =>
          updateProgress(index, progress, error);
        try {
          const uploaded = await uploadFile(file, fileParent, update);
          patchFiles(client, organizationId, uploaded);
          update(100);
        } catch (error: unknown) {
          update(0, messageOf(error));
        }
      }
    };
    try {
      await Promise.all([worker(), worker(), worker()]);
    } finally {
      uploadingRef.current = false;
    }
  }
  const upload = (files: readonly File[], destination = parentId) =>
    uploadBatch(selectedUpload(files), destination);
  return { listing, mutation, upload, uploadBatch, uploads, organizationId, userId };
}
