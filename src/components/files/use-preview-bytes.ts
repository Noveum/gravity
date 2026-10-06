"use client";

import type { FileEntry } from "@crm/files/validators";
import t from "@crm/i18n/translations/en.json";
import { useQuery } from "@tanstack/react-query";

export function usePreviewBytes(entry: FileEntry, downloadPath: string) {
  return useQuery({
    queryKey: ["file-preview", entry.id, entry.syncId],
    queryFn: async ({ signal }) => {
      if (entry.size > 32 * 1024 * 1024)
        throw new Error(t.files.thisDocumentExceedsThe32MBPreview);
      const response = await fetch(downloadPath, { signal, cache: "no-store" });
      if (!response.ok) throw new Error(t.files.thisFileCouldNotBeOpenedCheck);
      return await response.arrayBuffer();
    },
    staleTime: 60_000,
    gcTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
