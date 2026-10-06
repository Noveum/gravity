import { describe, expect, test } from 'bun:test';
import type { FileListing } from '@gravity/shared/validators';
import { QueryClient } from '@tanstack/react-query';
import {
  cachedFiles,
  fileKey,
  fileRevision,
  folderKey,
  patchFiles,
  restoreFileChanges,
} from '@/features/files/file-cache.ts';

import { fileFixture } from '../../support/file-fixture.ts';

describe('folder cache', () => {
  test('late mutation responses cannot restore revocations or overwrite newer versions', () => {
    const client = new QueryClient();
    const document = fileFixture();
    client.setQueryData(folderKey('org', null), { entries: [document], ancestors: [] });
    expect(patchFiles(client, 'org', [{ ...document, name: 'New.md', syncId: 3 }])).toHaveLength(1);
    expect(patchFiles(client, 'org', [{ ...document, name: 'Old.md', syncId: 2 }])).toEqual([]);
    expect(client.getQueryData<FileListing>(folderKey('org', null))?.entries[0]?.name).toBe(
      'New.md',
    );
    patchFiles(client, 'org', [], [document.id], 4);
    expect(patchFiles(client, 'org', [{ ...document, syncId: 3 }])).toEqual([]);
    expect(patchFiles(client, 'org', [{ ...document, syncId: 4 }])).toEqual([]);
    expect(client.getQueryData<FileListing>(folderKey('org', null))?.entries).toEqual([]);
    expect(patchFiles(client, 'org', [{ ...document, syncId: 5 }])).toHaveLength(1);
    patchFiles(client, 'org', [], [document.id], 4);
    expect(client.getQueryData<FileListing>(folderKey('org', null))?.entries[0]?.syncId).toBe(5);
    client.clear();
  });

  test('rolls back only the failed change while preserving a concurrent upload', () => {
    const client = new QueryClient();
    const document = fileFixture();
    const upload = fileFixture({ id: '93d85465-83bf-4a48-95cd-b21f32e435b4', name: 'New.pdf' });
    client.setQueryData(folderKey('org', null), { entries: [document], ancestors: [] });
    const before = cachedFiles(client, 'org');
    patchFiles(client, 'org', [{ ...document, name: 'Optimistic.md' }]);
    const changed = new Map([[document.id, fileRevision(client, 'org', document.id)]]);
    patchFiles(client, 'org', [upload]);
    restoreFileChanges(client, 'org', before, changed);
    expect(client.getQueryData<FileListing>(folderKey('org', null))?.entries).toEqual([
      document,
      upload,
    ]);
    client.clear();
  });

  test('failed mutations cannot restore revoked access or overwrite a newer realtime change', () => {
    const client = new QueryClient();
    const document = fileFixture();
    client.setQueryData(folderKey('org', null), { entries: [document], ancestors: [] });
    const before = cachedFiles(client, 'org');
    patchFiles(client, 'org', [{ ...document, name: 'Optimistic.md' }]);
    const changed = new Map([[document.id, fileRevision(client, 'org', document.id)]]);
    patchFiles(client, 'org', [{ ...document, name: 'Saved elsewhere.md', syncId: 2 }]);
    restoreFileChanges(client, 'org', before, changed);
    expect(client.getQueryData<FileListing>(folderKey('org', null))?.entries[0]?.name).toBe(
      'Saved elsewhere.md',
    );
    patchFiles(client, 'org', [{ ...document, name: 'Another pending.md', syncId: 2 }]);
    const next = new Map([[document.id, fileRevision(client, 'org', document.id)]]);
    patchFiles(client, 'org', [], [document.id]);
    restoreFileChanges(client, 'org', before, next);
    expect(client.getQueryData<FileListing>(folderKey('org', null))?.entries).toEqual([]);
    client.clear();
  });

  test('moves rows between cached folders, updates ancestors and keeps a single copy', () => {
    const client = new QueryClient();
    const document = fileFixture();
    const folder = fileFixture({
      id: '93d85465-83bf-4a48-95cd-b21f32e435b4',
      name: 'Documents',
      kind: 'folder',
    });
    client.setQueryData(folderKey('org', null), { entries: [document, folder], ancestors: [] });
    client.setQueryData(folderKey('org', folder.id), { entries: [], ancestors: [folder] });
    patchFiles(client, 'org', [
      { ...document, parentId: folder.id },
      { ...folder, name: 'Renamed' },
    ]);
    patchFiles(client, 'org', [{ ...document, parentId: folder.id }]);
    expect(
      client.getQueryData<FileListing>(folderKey('org', null))?.entries.map((entry) => entry.name),
    ).toEqual(['Renamed']);
    expect(client.getQueryData<FileListing>(folderKey('org', folder.id))?.entries).toHaveLength(1);
    expect(client.getQueryData<FileListing>(folderKey('org', folder.id))?.ancestors[0]?.name).toBe(
      'Renamed',
    );
    client.clear();
  });

  test('revocation removes metadata and cached document content without touching another workspace', () => {
    const client = new QueryClient();
    const document = fileFixture();
    client.setQueryData(folderKey('org', null), { entries: [document], ancestors: [] });
    client.setQueryData(fileKey('org', document.id), { entry: document, body: 'Secret' });
    client.setQueryData(['file-preview', document.id], new ArrayBuffer(10));
    client.setQueryData(folderKey('other', null), { entries: [document], ancestors: [] });
    patchFiles(client, 'org', [], [document.id]);
    expect(client.getQueryData<FileListing>(folderKey('org', null))?.entries).toEqual([]);
    expect(client.getQueryData(fileKey('org', document.id))).toBeUndefined();
    expect(client.getQueryData(['file-preview', document.id])).toBeUndefined();
    expect(client.getQueryData<FileListing>(folderKey('other', null))?.entries).toHaveLength(1);
    client.clear();
  });
});
