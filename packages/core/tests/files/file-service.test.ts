import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { db, eq, schema } from '@gravity/db';
import type { Principal } from '@gravity/shared/policy';
import type { FileEntry } from '@gravity/shared/validators';
import {
  completeFileUpload,
  createFile,
  fileDownload,
  getFile,
  getPublicFile,
  listFiles,
  startFileUpload,
  transferFiles,
  updateFile,
} from '../../src/files/file-service.ts';
import type { FileStorage } from '../../src/files/storage.ts';
import { readOutboxSince } from '../../src/realtime/outbox.ts';
import {
  createMemberPrincipal,
  createWorkspace,
  resetDatabase,
  type TestWorkspace,
} from '../../src/test-support.ts';

let workspace: TestWorkspace;
let member: Principal;
const storage: FileStorage = {
  uploadUrl: async () => 'https://storage.test/upload',
  sealUpload: async () => {
    await Promise.resolve();
  },
  downloadUrl: async () => 'https://storage.test/download',
  readText: async () => '# Uploaded Markdown',
};

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
  member = await createMemberPrincipal(workspace, 'member');
});

async function create(
  input: Record<string, unknown>,
  principal = workspace.admin,
): Promise<FileEntry> {
  const result = await createFile({ principal }, { kind: 'folder', ...input });
  const entry = result.entries[0];
  if (entry === undefined) throw new Error('Missing file');
  return entry;
}

function afterSelect(ordinal: number, run: () => Promise<void>) {
  let remaining = ordinal;
  function observe(query: object): object {
    return new Proxy(query, {
      get(target, property, receiver) {
        const value: unknown = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') return value;
        if (property === 'then') {
          return (resolve: (rows: unknown) => unknown, reject: (error: unknown) => unknown) =>
            Reflect.apply(value, target, [
              async (rows: unknown) => {
                remaining -= 1;
                if (remaining === 0) await run();
                return resolve(rows);
              },
              reject,
            ]);
        }
        return (...args: unknown[]) => {
          const result: unknown = Reflect.apply(value, target, args);
          return typeof result === 'object' && result !== null ? observe(result) : result;
        };
      },
    });
  }
  const select = new Proxy(db.select, {
    apply(target, receiver, args) {
      const query: unknown = Reflect.apply(target, receiver, args);
      if (typeof query !== 'object' || query === null) throw new Error('Missing select query');
      return observe(query);
    },
  });
  return spyOn(db, 'select').mockImplementation(select);
}

describe('file access', () => {
  test.each(['detail', 'public detail', 'download', 'public download'])(
    '%s reads content and access from the same database snapshot during revocation',
    async (mode) => {
      const entry = await create({
        name: 'Shared.md',
        kind: 'markdown',
        body: 'Previously public content',
        visibility: 'public',
      });
      const token = entry.publicToken ?? '';
      const read = async () => {
        if (mode === 'detail') return await getFile(member, entry.id);
        if (mode === 'public detail') return await getPublicFile(token);
        if (mode === 'download') return await fileDownload(member, entry.id, false, storage);
        return await fileDownload(null, token, false, storage);
      };
      const barrier = afterSelect(mode.startsWith('public') ? 2 : 1, async () => {
        await updateFile({ principal: workspace.admin }, entry.id, {
          access: { visibility: 'private' },
          body: 'New private content',
          expectedSyncId: entry.syncId,
        });
      });
      try {
        expect((await read()).body).toBe('Previously public content');
      } finally {
        barrier.mockRestore();
      }
      await expect(read()).rejects.toMatchObject({ status: 404 });
      expect((await getFile(workspace.admin, entry.id)).body).toBe('New private content');
    },
  );

  test('private is the default and workspace admins cannot read another person’s private files', async () => {
    const privateFile = await create(
      { name: 'Secret', kind: 'markdown', body: 'Private content' },
      member,
    );
    expect((await listFiles(workspace.admin, {})).entries).toEqual([]);
    await expect(getFile(workspace.admin, privateFile.id)).rejects.toMatchObject({ status: 404 });
    expect((await getFile(member, privateFile.id)).body).toBe('Private content');
    const events = await readOutboxSince(
      { userId: workspace.admin.userId, organizationId: workspace.organizationId },
      privateFile.syncId - 1,
      50,
    );
    expect(events.actions.filter((action) => action.model === 'file_entry')).toEqual([]);
  });

  test('workspace files permit reads but guest writes and sharing by nonowners are refused', async () => {
    const entry = await create({ name: 'Team', visibility: 'workspace' });
    const guest = await createMemberPrincipal(workspace, 'guest');
    expect((await getFile(guest, entry.id)).entry.canEdit).toBe(false);
    await expect(
      updateFile({ principal: guest }, entry.id, { name: 'No', expectedSyncId: entry.syncId }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      updateFile({ principal: member }, entry.id, {
        access: { visibility: 'public' },
        expectedSyncId: entry.syncId,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  test('specific people receive viewer or editor access and other members stay excluded', async () => {
    const viewer = await createMemberPrincipal(workspace, 'member');
    const entry = await create({
      name: 'Shared.md',
      kind: 'markdown',
      visibility: 'shared',
      grants: [
        { userId: member.userId, role: 'editor' },
        { userId: viewer.userId, role: 'viewer' },
      ],
    });
    expect((await getFile(viewer, entry.id)).entry).toMatchObject({ canEdit: false, grants: [] });
    await expect(
      updateFile({ principal: viewer }, entry.id, { body: 'No', expectedSyncId: entry.syncId }),
    ).rejects.toMatchObject({ status: 403 });
    await updateFile({ principal: member }, entry.id, {
      body: 'Edited',
      expectedSyncId: entry.syncId,
    });
    expect((await getFile(workspace.admin, entry.id)).body).toBe('Edited');
  });

  test('inherited documents remain editable below an explicit folder inside a viewer-only ancestor', async () => {
    const root = await create({
      name: 'Read access',
      visibility: 'shared',
      grants: [{ userId: member.userId, role: 'viewer' }],
    });
    const folder = await create({
      name: 'Editable folder',
      parentId: root.id,
      visibility: 'workspace',
    });
    const document = await create({
      name: 'Inherited.md',
      parentId: folder.id,
      visibility: 'inherit',
      kind: 'markdown',
      body: 'Before',
    });
    expect((await getFile(member, document.id)).entry.canEdit).toBe(true);
    await updateFile({ principal: member }, document.id, {
      body: 'After',
      expectedSyncId: document.syncId,
    });
    expect((await getFile(workspace.admin, document.id)).body).toBe('After');
    const metadata = await getFile(workspace.admin, document.id, true);
    expect(metadata.body).toBeNull();
    expect(metadata.entry).not.toHaveProperty('body');
    expect(metadata.entry).not.toHaveProperty('storageKey');
    await updateFile({ principal: workspace.admin }, root.id, {
      access: { visibility: 'private' },
      expectedSyncId: root.syncId,
    });
    await expect(getFile(member, document.id)).rejects.toMatchObject({ status: 404 });
  });

  test('public descendants cannot bypass a private parent and inherited access follows the folder', async () => {
    const folder = await create({ name: 'Private folder' });
    const child = await create({
      name: 'Visible.md',
      kind: 'markdown',
      parentId: folder.id,
      visibility: 'public',
    });
    const inherited = await create({
      name: 'Inherited.md',
      kind: 'markdown',
      parentId: folder.id,
      visibility: 'inherit',
    });
    const [row] = await db.select().from(schema.fileEntry).where(eq(schema.fileEntry.id, child.id));
    await expect(getPublicFile(row?.publicToken ?? '')).rejects.toMatchObject({ status: 404 });
    await expect(getFile(member, child.id)).rejects.toMatchObject({ status: 404 });
    const changed = await updateFile({ principal: workspace.admin }, folder.id, {
      access: { visibility: 'public' },
      expectedSyncId: folder.syncId,
    });
    expect(changed.actions.map((action) => action.modelId)).toContain(inherited.id);
    const publicChild = (await getFile(workspace.admin, child.id)).entry;
    expect(publicChild.publicToken).not.toBeNull();
    expect((await getPublicFile(publicChild.publicToken ?? '')).entry.canEdit).toBe(false);
    const publicFolder = changed.entries.find((entry) => entry.id === folder.id);
    expect(
      (await getPublicFile(publicFolder?.publicToken ?? '')).entries.map((entry) => entry.id),
    ).toContain(inherited.id);
  });

  test('revoking folder access also revokes descendant downloads and emits no content or names', async () => {
    const folder = await create({ name: 'Public', visibility: 'public' });
    const child = await create({
      name: 'Sensitive.md',
      kind: 'markdown',
      body: '# Secret',
      parentId: folder.id,
      visibility: 'inherit',
    });
    const token = child.publicToken ?? '';
    expect((await fileDownload(null, token, false, storage)).body).toBe('# Secret');
    const result = await updateFile({ principal: workspace.admin }, folder.id, {
      access: { visibility: 'private' },
      expectedSyncId: folder.syncId,
    });
    await expect(fileDownload(null, token, false, storage)).rejects.toMatchObject({ status: 404 });
    await expect(getFile(member, child.id)).rejects.toMatchObject({ status: 404 });
    expect(result.actions.every((action) => Object.keys(action.data).join() === 'id')).toBe(true);
    expect(result.actions.find((action) => action.modelId === child.id)?.scopes).toContain(
      `user:${member.userId}`,
    );
    const history = await readOutboxSince(
      { userId: member.userId, organizationId: workspace.organizationId },
      0,
      100,
    );
    expect(
      history.actions
        .filter((action) => action.model === 'file_entry')
        .every((action) => !JSON.stringify(action.data).includes('Secret')),
    ).toBe(true);
  });

  test('rejects foreign parents, foreign grants, root inheritance and duplicate names', async () => {
    const other = await createWorkspace('Other');
    const folder = await create({ name: 'Foreign' }, other.admin);
    await expect(create({ name: 'No', parentId: folder.id })).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      create({
        name: 'No',
        visibility: 'shared',
        grants: [{ userId: other.admin.userId, role: 'viewer' }],
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(create({ name: 'No', visibility: 'inherit' })).rejects.toMatchObject({
      status: 422,
    });
    await create({ name: 'Duplicate' });
    await expect(create({ name: 'duplicate' })).rejects.toMatchObject({ status: 409 });
  });
});

describe('folder operations', () => {
  test('moves a whole tree, supplies breadcrumbs and refuses cycles atomically', async () => {
    const first = await create({ name: 'First' });
    const second = await create({ name: 'Second' });
    const child = await create({ name: 'Child', parentId: first.id, visibility: 'inherit' });
    await expect(
      transferFiles(
        { principal: workspace.admin },
        { ids: [first.id], parentId: child.id, operation: 'move' },
      ),
    ).rejects.toMatchObject({ status: 422 });
    const result = await transferFiles(
      { principal: workspace.admin },
      { ids: [first.id], parentId: second.id, operation: 'move' },
    );
    expect(result.entries.find((entry) => entry.id === first.id)?.parentId).toBe(second.id);
    expect(
      (await listFiles(workspace.admin, { parentId: child.id })).ancestors.map(
        (entry) => entry.name,
      ),
    ).toEqual(['Second', 'First', 'Child']);
    expect(result.actions.map((action) => action.modelId)).toContain(child.id);
  });

  test('moving an inherited item to the root makes it private', async () => {
    const folder = await create({ name: 'Team', visibility: 'workspace' });
    const child = await create({ name: 'Child', parentId: folder.id, visibility: 'inherit' });
    const result = await transferFiles(
      { principal: workspace.admin },
      { ids: [child.id], parentId: null, operation: 'move' },
    );
    expect(result.entries[0]).toMatchObject({ parentId: null, visibility: 'private' });
    await expect(getFile(member, child.id)).rejects.toMatchObject({ status: 404 });
  });

  test('copies folder trees privately, deduplicates selected descendants, and preserves Markdown content', async () => {
    const folder = await create({ name: 'Public', visibility: 'public' });
    const child = await create({
      name: 'Guide.md',
      kind: 'markdown',
      body: '# Guide',
      parentId: folder.id,
      visibility: 'inherit',
    });
    const result = await transferFiles(
      { principal: member },
      { ids: [folder.id, child.id], parentId: null, operation: 'copy' },
    );
    expect(result.entries).toHaveLength(2);
    const copy = result.entries.find((entry) => entry.kind === 'folder');
    const childCopy = result.entries.find((entry) => entry.kind === 'markdown');
    expect(copy).toMatchObject({
      visibility: 'private',
      publicToken: null,
      ownerId: member.userId,
    });
    expect(childCopy).toMatchObject({
      parentId: copy?.id,
      visibility: 'inherit',
      publicToken: null,
    });
    expect((await getFile(member, childCopy?.id ?? '')).body).toBe('# Guide');
    await expect(getFile(workspace.admin, copy?.id ?? '')).rejects.toMatchObject({ status: 404 });
    const again = await transferFiles(
      { principal: member },
      { ids: [folder.id], parentId: null, operation: 'copy' },
    );
    expect(again.entries.find((entry) => entry.kind === 'folder')?.name).toBe('Public copy');
  });

  test('refuses a tree copy containing unreadable children and rejects nonowner moves or deletion', async () => {
    const folder = await create({ name: 'Team', visibility: 'workspace' });
    await create({ name: 'Secret', parentId: folder.id });
    for (const operation of ['copy', 'move', 'delete'])
      await expect(
        transferFiles({ principal: member }, { ids: [folder.id], parentId: null, operation }),
      ).rejects.toMatchObject({ status: operation === 'copy' ? 404 : 403 });
    expect((await listFiles(workspace.admin, {})).entries).toHaveLength(1);
  });

  test('deletes descendants, prevents stale saves, and refuses editing binary files', async () => {
    const folder = await create({ name: 'Folder' });
    const child = await create({
      name: 'Doc.md',
      kind: 'markdown',
      parentId: folder.id,
      visibility: 'inherit',
    });
    await updateFile({ principal: workspace.admin }, child.id, {
      body: '# Changed',
      expectedSyncId: child.syncId,
    });
    await expect(
      updateFile({ principal: workspace.admin }, child.id, {
        body: '# Old',
        expectedSyncId: child.syncId,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const deleted = await transferFiles(
      { principal: workspace.admin },
      { ids: [folder.id], parentId: null, operation: 'delete' },
    );
    expect(deleted.actions.map((action) => action.modelId)).toContain(child.id);
    expect(deleted.entries).toEqual([]);
    await expect(getFile(workspace.admin, child.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('uploads', () => {
  test.each(['Deck.pptx', 'Document.docx', 'Report.pdf', 'Data.csv'])(
    'uploads %s, finalizes once and downloads through an access check',
    async (name) => {
      const upload = await startFileUpload(
        workspace.admin,
        { name, size: 1024, mimeType: 'application/octet-stream' },
        storage,
      );
      await expect(
        completeFileUpload({ principal: member }, { uploadId: upload.uploadId }, storage),
      ).rejects.toMatchObject({ status: 404 });
      const result = await completeFileUpload(
        { principal: workspace.admin },
        { uploadId: upload.uploadId },
        storage,
      );
      const entry = result.entries[0];
      expect(entry).toMatchObject({ name, kind: 'file', visibility: 'private', size: 1024 });
      await expect(
        completeFileUpload({ principal: workspace.admin }, { uploadId: upload.uploadId }, storage),
      ).rejects.toMatchObject({ status: 404 });
      await expect(fileDownload(member, entry?.id ?? '', false, storage)).rejects.toMatchObject({
        status: 404,
      });
      expect((await fileDownload(workspace.admin, entry?.id ?? '', false, storage)).url).toBe(
        'https://storage.test/download',
      );
      await expect(
        updateFile({ principal: workspace.admin }, entry?.id ?? '', {
          body: 'No',
          expectedSyncId: entry?.syncId,
        }),
      ).rejects.toMatchObject({ status: 422 });
    },
  );

  test('rechecks destination access at completion, validates sizes and imports Markdown as editable text', async () => {
    const folder = await create({ name: 'Team', visibility: 'workspace' });
    const upload = await startFileUpload(
      member,
      { name: 'Doc.md', size: 100, mimeType: 'text/markdown', parentId: folder.id },
      storage,
    );
    await updateFile({ principal: workspace.admin }, folder.id, {
      access: { visibility: 'private' },
      expectedSyncId: folder.syncId,
    });
    await expect(
      completeFileUpload({ principal: member }, { uploadId: upload.uploadId }, storage),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      startFileUpload(
        workspace.admin,
        { name: 'Too big.pdf', size: 101 * 1024 * 1024, mimeType: 'application/pdf' },
        storage,
      ),
    ).rejects.toThrow();
    const markdown = await startFileUpload(
      workspace.admin,
      { name: 'Doc.md', size: 100, mimeType: 'text/markdown' },
      storage,
    );
    const result = await completeFileUpload(
      { principal: workspace.admin },
      { uploadId: markdown.uploadId },
      storage,
    );
    expect((await getFile(workspace.admin, result.entries[0]?.id ?? '')).body).toBe(
      '# Uploaded Markdown',
    );
  });
});
