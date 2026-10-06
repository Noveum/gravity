import type { FileEntry } from '@gravity/shared/validators';

export function fileFixture(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    id: 'a6f33bf5-1969-4d04-88a6-38d2416e8c28',
    parentId: null,
    ownerId: 'owner',
    name: 'Guide.md',
    kind: 'markdown',
    visibility: 'private',
    grants: [],
    mimeType: 'text/markdown',
    size: 10,
    syncId: 1,
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
    canEdit: true,
    canShare: true,
    publicToken: null,
    ...overrides,
  };
}
