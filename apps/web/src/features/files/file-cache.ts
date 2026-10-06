import type { FileEntry, FileListing } from '@gravity/shared/validators';
import type { QueryClient } from '@tanstack/react-query';

export const filesKey = (organizationId: string) => ['files', organizationId] as const;
export const folderKey = (organizationId: string, parentId: string | null) =>
  [...filesKey(organizationId), parentId] as const;
export const fileKey = (organizationId: string, id: string) =>
  ['file', organizationId, id] as const;

export function sortFiles(entries: readonly FileEntry[]): FileEntry[] {
  return [...entries].sort(
    (left, right) =>
      Number(right.kind === 'folder') - Number(left.kind === 'folder') ||
      left.name.localeCompare(right.name, undefined, { numeric: true }),
  );
}

export function patchFiles(
  client: QueryClient,
  organizationId: string,
  entries: readonly FileEntry[],
  removed: readonly string[] = [],
): void {
  const replacements = new Map(entries.map((entry) => [entry.id, entry]));
  const removedIds = new Set(removed);
  for (const [key, listing] of client.getQueriesData<FileListing>({
    queryKey: filesKey(organizationId),
  })) {
    if (listing === undefined) continue;
    const parentId = key[2] ?? null;
    const kept = listing.entries.filter(
      (entry) => !(removedIds.has(entry.id) || replacements.has(entry.id)),
    );
    const added = entries.filter((entry) => entry.parentId === parentId);
    client.setQueryData<FileListing>(key, {
      entries: sortFiles([...kept, ...added]),
      ancestors: listing.ancestors
        .filter((entry) => !removedIds.has(entry.id))
        .map((entry) => replacements.get(entry.id) ?? entry),
    });
  }
  for (const id of removed) {
    client.removeQueries({ queryKey: fileKey(organizationId, id) });
    client.removeQueries({ queryKey: ['file-preview', id] });
  }
}
