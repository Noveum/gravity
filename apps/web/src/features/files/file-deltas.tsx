'use client';

import type { SyncAction } from '@gravity/shared/events';
import { fileDetailSchema } from '@gravity/shared/validators';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError, apiFetch } from '@/lib/api/client.ts';
import { registerDeltaHandler } from '@/lib/realtime/delta-bridge.tsx';
import { fileKey, filesKey, patchFiles } from './file-cache.ts';

export function fileDeltaHandler(client: QueryClient, organizationId: string) {
  const versions = new Map<string, number>();
  return (action: SyncAction) => {
    if (action.organizationId !== organizationId) return;
    if ((versions.get(action.modelId) ?? -1) >= action.syncId) return;
    versions.set(action.modelId, action.syncId);
    if (action.action === 'delete') {
      patchFiles(client, organizationId, [], [action.modelId]);
      return;
    }
    const detailKey = fileKey(organizationId, action.modelId);
    const fetchBody = client.getQueryState(detailKey)?.status === 'success';
    const path = `/api/files/${action.modelId}${fetchBody ? '' : '?metadata=true'}`;
    apiFetch(path, fileDetailSchema)
      .then((detail) => {
        if (versions.get(action.modelId) !== action.syncId) return;
        patchFiles(client, organizationId, [detail.entry]);
        if (fetchBody) client.setQueryData(detailKey, detail);
      })
      .catch((error: unknown) => {
        if (versions.get(action.modelId) !== action.syncId) return;
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
          patchFiles(client, organizationId, [], [action.modelId]);
          return;
        }
        client
          .invalidateQueries({ queryKey: filesKey(organizationId), refetchType: 'none' })
          .catch((failure: unknown) => console.error('Could not mark files stale.', failure));
      });
  };
}

export function FileDeltaHandlers({
  organizationId,
  userId,
}: {
  readonly organizationId: string;
  readonly userId: string;
}) {
  const client = useQueryClient();
  useEffect(() => {
    const offFiles = registerDeltaHandler('file_entry', fileDeltaHandler(client, organizationId));
    const offMember = registerDeltaHandler('member', (action) => {
      if (action.organizationId !== organizationId || action.data['userId'] !== userId) return;
      client.removeQueries({ queryKey: ['file', organizationId] });
      client.removeQueries({ queryKey: ['file-preview'] });
      client
        .invalidateQueries({ queryKey: filesKey(organizationId) })
        .catch((error: unknown) => console.error('Could not refresh file access.', error));
    });
    return () => {
      offFiles();
      offMember();
    };
  }, [client, organizationId, userId]);
  return null;
}
