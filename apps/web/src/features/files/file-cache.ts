import type { FileDetail, FileEntry, FileListing } from '@gravity/shared/validators';
import type { QueryClient } from '@tanstack/react-query';

const revisions = new WeakMap<QueryClient, Map<string, number>>();
const confirmedVersions = new WeakMap<
  QueryClient,
  Map<string, { syncId: number; removed: boolean }>
>();

function fileRevisionKey(organizationId: string, id: string): string {
  return JSON.stringify([organizationId, id]);
}

export function fileRevision(client: QueryClient, organizationId: string, id: string): number {
  return revisions.get(client)?.get(fileRevisionKey(organizationId, id)) ?? 0;
}

export function cachedFiles(client: QueryClient, organizationId: string): FileEntry[] {
  const entries = client
    .getQueriesData<FileListing>({ queryKey: filesKey(organizationId) })
    .flatMap(([, listing]) => [...(listing?.entries ?? []), ...(listing?.ancestors ?? [])])
    .concat(
      client
        .getQueriesData<FileDetail>({ queryKey: ['file', organizationId] })
        .flatMap(([, detail]) => (detail === undefined ? [] : [detail.entry])),
    );
  const latest = new Map<string, FileEntry>();
  for (const entry of entries) {
    if ((latest.get(entry.id)?.syncId ?? -1) < entry.syncId) latest.set(entry.id, entry);
  }
  return [...latest.values()];
}

export function restoreFileChanges(
  client: QueryClient,
  organizationId: string,
  before: readonly FileEntry[],
  changed: ReadonlyMap<string, number>,
): void {
  const unchanged = [...changed.keys()].filter(
    (id) => fileRevision(client, organizationId, id) === changed.get(id),
  );
  const restored = before.filter((entry) => unchanged.includes(entry.id));
  const restoredIds = new Set(restored.map((entry) => entry.id));
  patchFiles(
    client,
    organizationId,
    restored,
    unchanged.filter((id) => !restoredIds.has(id)),
  );
}

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
  removedSyncId?: number,
): FileEntry[] {
  const confirmed =
    confirmedVersions.get(client) ?? new Map<string, { syncId: number; removed: boolean }>();
  confirmedVersions.set(client, confirmed);
  const current = new Map(cachedFiles(client, organizationId).map((entry) => [entry.id, entry]));
  const accepted = entries.filter((entry) => {
    const key = fileRevisionKey(organizationId, entry.id);
    const previous = confirmed.get(key);
    const latestSyncId = Math.max(previous?.syncId ?? -1, current.get(entry.id)?.syncId ?? -1);
    if (entry.syncId < latestSyncId || (previous?.removed && entry.syncId === latestSyncId))
      return false;
    confirmed.set(key, { syncId: entry.syncId, removed: false });
    return true;
  });
  const removals = removed.filter(
    (id) =>
      removedSyncId === undefined ||
      removedSyncId >=
        Math.max(
          confirmed.get(fileRevisionKey(organizationId, id))?.syncId ?? -1,
          current.get(id)?.syncId ?? -1,
        ),
  );
  if (removedSyncId !== undefined) {
    for (const id of removals) {
      const key = fileRevisionKey(organizationId, id);
      if ((confirmed.get(key)?.syncId ?? -1) <= removedSyncId)
        confirmed.set(key, { syncId: removedSyncId, removed: true });
    }
  }
  const versions = revisions.get(client) ?? new Map<string, number>();
  revisions.set(client, versions);
  for (const id of new Set([...accepted.map((entry) => entry.id), ...removals])) {
    const key = fileRevisionKey(organizationId, id);
    versions.set(key, (versions.get(key) ?? 0) + 1);
  }
  const replacements = new Map(accepted.map((entry) => [entry.id, entry]));
  const removedIds = new Set(removals);
  for (const [key, listing] of client.getQueriesData<FileListing>({
    queryKey: filesKey(organizationId),
  })) {
    if (listing === undefined) continue;
    const parentId = key[2] ?? null;
    const kept = listing.entries.filter(
      (entry) => !(removedIds.has(entry.id) || replacements.has(entry.id)),
    );
    const added = accepted.filter((entry) => entry.parentId === parentId);
    client.setQueryData<FileListing>(key, {
      entries: sortFiles([...kept, ...added]),
      ancestors: listing.ancestors
        .filter((entry) => !removedIds.has(entry.id))
        .map((entry) => replacements.get(entry.id) ?? entry),
    });
  }
  for (const id of removals) {
    client.removeQueries({ queryKey: fileKey(organizationId, id) });
    client.removeQueries({ queryKey: ['file-preview', id] });
  }
  return accepted;
}
