import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { SyncAction } from '@gravity/shared/events';
import type { FileListing } from '@gravity/shared/validators';
import { QueryClient } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import { fileKey, folderKey } from '@/features/files/file-cache.ts';
import { fileDeltaHandler } from '@/features/files/file-deltas.tsx';
import { fileFixture } from '../../support/file-fixture.ts';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function action(syncId: number): SyncAction {
  return {
    syncId,
    organizationId: 'org',
    model: 'file_entry',
    modelId: fileFixture().id,
    action: 'update',
    data: { id: fileFixture().id },
    scopes: ['user:owner'],
    actor: { type: 'user', id: 'owner' },
    at: '2026-10-06T00:00:00.000Z',
  };
}

describe('file realtime access', () => {
  test('fetches just the changed item and patches the cached list without refetching it', async () => {
    const client = new QueryClient();
    client.setQueryData(folderKey('org', null), { entries: [], ancestors: [] });
    const paths: string[] = [];
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      paths.push(String(input));
      return Promise.resolve(Response.json({ entry: fileFixture(), body: null }));
    }) as unknown as typeof fetch;
    fileDeltaHandler(client, 'org')(action(2));
    await waitFor(() =>
      expect(client.getQueryData<FileListing>(folderKey('org', null))?.entries).toHaveLength(1),
    );
    expect(paths).toEqual([`/api/files/${fileFixture().id}?metadata=true`]);
    client.clear();
  });

  test('an older in-flight response cannot restore a document after access is revoked', async () => {
    const client = new QueryClient();
    const document = fileFixture();
    client.setQueryData(folderKey('org', null), { entries: [document], ancestors: [] });
    client.setQueryData(fileKey('org', document.id), { entry: document, body: 'Secret' });
    let resolveOld: (response: Response) => void = () => {
      throw new Error('Missing request');
    };
    let requests = 0;
    globalThis.fetch = mock(async () => {
      requests += 1;
      if (requests === 1)
        return await new Promise<Response>((resolve) => {
          resolveOld = resolve;
        });
      return Response.json({ error: { code: 'not_found', message: 'No access' } }, { status: 404 });
    }) as unknown as typeof fetch;
    const handler = fileDeltaHandler(client, 'org');
    handler(action(2));
    handler(action(3));
    await waitFor(() =>
      expect(client.getQueryData<FileListing>(folderKey('org', null))?.entries).toEqual([]),
    );
    resolveOld(Response.json({ entry: document, body: 'Secret' }));
    await waitFor(() => expect(requests).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(client.getQueryData<FileListing>(folderKey('org', null))?.entries).toEqual([]);
    expect(client.getQueryData(fileKey('org', document.id))).toBeUndefined();
    client.clear();
  });
});
