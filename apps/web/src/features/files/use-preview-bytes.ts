'use client';

import type { FileEntry } from '@gravity/shared/validators';
import { useQuery } from '@tanstack/react-query';

export function usePreviewBytes(entry: FileEntry, downloadPath: string) {
  return useQuery({
    queryKey: ['file-preview', entry.id, entry.syncId],
    queryFn: async ({ signal }) => {
      if (entry.size > 32 * 1024 * 1024)
        throw new Error(
          'This document exceeds the 32 MB preview limit. The original file is saved and available to download.',
        );
      const response = await fetch(downloadPath, { signal, cache: 'no-store' });
      if (!response.ok)
        throw new Error('This file could not be opened. Check that you still have access.');
      return await response.arrayBuffer();
    },
    staleTime: 60_000,
    gcTime: 60_000,
  });
}
