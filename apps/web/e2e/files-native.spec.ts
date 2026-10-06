import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileListingSchema, fileMutationSchema } from '@gravity/shared/validators';
import { expect, test } from '@playwright/test';
import { BASE } from './base-url.ts';
import { readFixture } from './fixture.ts';
import { signIn } from './sign-in.ts';

test('native folder uploads preserve hierarchy across tree, grid and column views', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await signIn(context, readFixture().ownerEmail);
  const temporary = await mkdtemp(path.join(tmpdir(), 'gravity-folders-'));
  const folderPath = path.join(temporary, 'Native projects');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await mkdir(path.join(folderPath, 'Reports'), { recursive: true });
    await writeFile(path.join(folderPath, 'Overview.md'), '# Native folder upload');
    await writeFile(path.join(folderPath, 'Reports', 'Notes.txt'), 'Saved inside a nested folder.');
    await page.goto(`${BASE}/files`);
    await page.getByLabel('Upload folder', { exact: true }).setInputFiles(folderPath);
    await expect(page.getByText('Uploaded', { exact: true })).toHaveCount(2);
    const contents = page.getByRole('region', { name: 'Folder contents', exact: true });
    await contents.getByRole('button', { name: 'Native projects', exact: true }).click();
    await expect(contents.getByRole('button', { name: 'Reports', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Open folder Reports', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Grid view', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Files in grid view', exact: true }),
    ).toBeVisible();
    await contents.getByRole('button', { name: 'Reports', exact: true }).click();
    await expect(contents.getByRole('button', { name: 'Notes.txt', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Grid view', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(contents.getByRole('button', { name: 'Notes.txt', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Columns view', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Column Reports', exact: true })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Column Native projects', exact: true }),
    ).toBeVisible();
    const screenshots = path.resolve('test-results/file-visuals');
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({
      path: path.join(screenshots, 'nested-columns.png'),
      fullPage: true,
      caret: 'initial',
    });
    await page.getByRole('button', { name: 'List view', exact: true }).click();
    await contents.getByRole('button', { name: 'Notes.txt', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('Saved inside a nested folder.')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Go to parent folder' }).click();
    await page.getByRole('button', { name: 'Grid view', exact: true }).click();
    await expect(contents.getByRole('button', { name: 'Reports', exact: true })).toBeVisible();
    await page.screenshot({
      path: path.join(screenshots, 'nested-grid.png'),
      fullPage: true,
      caret: 'initial',
    });
    const toolbar = await page.getByRole('toolbar', { name: 'File toolbar' }).boundingBox();
    expect(toolbar?.height).toBeLessThan(60);
    await page.getByRole('button', { name: 'All files', exact: true }).click();
    await page.getByLabel('Upload folder', { exact: true }).setInputFiles(folderPath);
    await expect(page.getByText('Uploaded', { exact: true })).toHaveCount(2);
    await expect(
      contents.getByRole('button', { name: 'Native projects (2)', exact: true }),
    ).toBeVisible();
    const roots = fileListingSchema.parse(
      await (await page.request.get(`${BASE}/api/files`)).json(),
    );
    expect(roots.entries.find((entry) => entry.name === 'Native projects (2)')?.visibility).toBe(
      'private',
    );
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

test('native file drops show feedback and upload into the targeted folder', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await signIn(context, readFixture().ownerEmail);
  try {
    await page.goto(`${BASE}/files`);
    const transfer = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(new File(['Native drop is saved.'], 'Dropped.txt', { type: 'text/plain' }));
      return data;
    });
    const contents = page.getByRole('region', { name: 'Folder contents', exact: true });
    await expect(page.getByRole('button', { name: 'New', exact: true })).toBeEnabled();
    await contents.dispatchEvent('dragenter', { dataTransfer: transfer });
    await expect(page.getByText('Drop files or folders to upload', { exact: true })).toBeVisible();
    await contents.dispatchEvent('dragover', { dataTransfer: transfer });
    await contents.dispatchEvent('drop', { dataTransfer: transfer });
    await expect(page.getByText('Uploaded', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Drop files or folders to upload', { exact: true }),
    ).not.toBeVisible();
    await page.reload();
    await contents.getByRole('button', { name: 'Dropped.txt', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('Native drop is saved.')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    const listing = fileListingSchema.parse(
      await (await page.request.get(`${BASE}/api/files`)).json(),
    );
    expect(
      listing.entries.some((entry) => entry.name === 'Dropped.txt' && entry.parentId === null),
    ).toBe(true);
    const created = await page.request.post(`${BASE}/api/files`, {
      data: { name: 'Drop target', kind: 'folder' },
    });
    const folder = fileMutationSchema.parse(await created.json()).entries[0];
    if (folder === undefined) throw new Error('Missing drop folder');
    await expect(contents.getByRole('button', { name: folder.name, exact: true })).toBeVisible();
    const folderTransfer = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(
        new File(['Saved in the targeted folder.'], 'Folder drop.txt', { type: 'text/plain' }),
      );
      return data;
    });
    await contents
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: folder.name, exact: true }) })
      .dispatchEvent('drop', { dataTransfer: folderTransfer });
    await expect(page.getByText('Uploaded', { exact: true })).toBeVisible();
    await contents.getByRole('button', { name: folder.name, exact: true }).click();
    await expect(
      contents.getByRole('button', { name: 'Folder drop.txt', exact: true }),
    ).toBeVisible();
    const saved = fileListingSchema.parse(
      await (await page.request.get(`${BASE}/api/files?parentId=${folder.id}`)).json(),
    );
    expect(
      saved.entries.some(
        (entry) => entry.name === 'Folder drop.txt' && entry.parentId === folder.id,
      ),
    ).toBe(true);
    await folderTransfer.dispose();
    await transfer.dispose();
  } finally {
    await context.close();
  }
});
