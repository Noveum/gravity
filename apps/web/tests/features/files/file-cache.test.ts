import { describe, expect, test } from 'bun:test';
import type { FileListing } from '@gravity/shared/validators';
import { QueryClient } from '@tanstack/react-query';
import { fileKey, folderKey, patchFiles } from '@/features/files/file-cache.ts';

import { fileFixture } from '../../support/file-fixture.ts';

describe('folder cache', () => {
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
