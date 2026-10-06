import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  fileDetailSchema,
  fileListingSchema,
  fileMutationSchema,
} from '@gravity/shared/validators';
import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { z } from 'zod';
import { BASE } from './base-url.ts';
import fileSamples from './file-samples.json' with { type: 'json' };
import { readFixture } from './fixture.ts';
import { signIn } from './sign-in.ts';

async function presentationWithImage(data: Buffer, image: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(data);
  zip.file('ppt/media/review-image.png', image);
  const types = zip.file('[Content_Types].xml');
  if (types === null) throw new Error('Missing presentation content types');
  zip.file(
    types.name,
    (await types.async('string')).replace(
      '</Types>',
      '<Default Extension="png" ContentType="image/png"/></Types>',
    ),
  );
  for (const page of [1, 2]) {
    const slide = zip.file(`ppt/slides/slide${page}.xml`);
    const relationships = zip.file(`ppt/slides/_rels/slide${page}.xml.rels`);
    if (slide === null || relationships === null) throw new Error('Missing slide');
    zip.file(
      relationships.name,
      (await relationships.async('string')).replace(
        '</Relationships>',
        '<Relationship Id="rIdReviewImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/review-image.png"/></Relationships>',
      ),
    );
    zip.file(
      slide.name,
      (await slide.async('string')).replace(
        '</p:spTree>',
        '<p:pic><p:nvPicPr><p:cNvPr id="4" name="Review image" descr="Embedded preview image"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdReviewImage"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="731520" y="3200400"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree>',
      ),
    );
  }
  return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

test('folders, Markdown edits, keyboard transfers and drag moves persist after reload', async ({
  browser,
}) => {
  const fixture = readFixture();
  const context = await browser.newContext();
  const page = await signIn(context, fixture.ownerEmail);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(`${BASE}/files`);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New folder', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill('Working files');
    await dialog.getByLabel('Access', { exact: true }).selectOption('workspace');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('button', { name: 'Working files', exact: true }).click();
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New document', exact: true }).click();
    await dialog.getByLabel('Name', { exact: true }).fill('Guide.md');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('button', { name: 'Guide.md', exact: true }).click();
    await dialog.getByRole('button', { name: 'Edit Markdown', exact: true }).click();
    await dialog.getByLabel('Markdown source').fill('# A saved guide\n\n**Persistent** content.');
    await expect(dialog.getByRole('heading', { name: 'A saved guide' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Edit Markdown', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Guide.md', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'A saved guide' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Select Guide.md', exact: true }).check();
    await page.keyboard.press('ControlOrMeta+x');
    let releaseRoot: (() => void) | null = null;
    const rootReady = new Promise<void>((resolve) => {
      releaseRoot = resolve;
    });
    await page.route(`${BASE}/api/files`, async (route) => {
      if (route.request().method() === 'GET') await rootReady;
      await route.continue();
    });
    await page.getByRole('button', { name: 'Go to parent folder' }).click();
    await expect(page).toHaveURL(`${BASE}/files`);
    await expect(page.getByRole('button', { name: 'Go to parent folder' })).toBeDisabled();
    await page.keyboard.press('ControlOrMeta+v');
    if (releaseRoot === null) throw new Error('Missing folder response gate');
    (releaseRoot as () => void)();
    await expect(page.getByRole('button', { name: 'Guide.md', exact: true })).toBeVisible();
    const source = page
      .locator('tr')
      .filter({ has: page.getByRole('button', { name: 'Guide.md', exact: true }) });
    const destination = page
      .locator('tr')
      .filter({ has: page.getByRole('button', { name: 'Working files', exact: true }) });
    await expect(page.getByRole('button', { name: 'New', exact: true })).toBeEnabled();
    await source.dragTo(destination);
    await expect(page.getByRole('button', { name: 'Guide.md', exact: true })).not.toBeVisible();
    await page.getByRole('button', { name: 'Working files', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Guide.md', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Guide.md', exact: true })).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('real binary uploads survive reload and download with identical bytes', async ({
  browser,
}) => {
  const fixture = readFixture();
  const context = await browser.newContext();
  const page = await signIn(context, fixture.ownerEmail);
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (
      message.text() ===
      "Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed and the 'allow-scripts' permission is not set."
    )
      return;
    if (message.type() === 'error')
      browserErrors.push(message.text().replace(/https?:\/\/\S+/g, '[URL]'));
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  try {
    await page.goto(`${BASE}/files`);
    const uploads = z
      .array(z.object({ name: z.string(), mimeType: z.string(), base64: z.string() }))
      .parse(fileSamples)
      .map(({ base64, ...file }) => ({
        ...file,
        mimeType: file.name === 'Report.pdf' ? 'application/octet-stream' : file.mimeType,
        buffer: Buffer.from(base64, 'base64'),
      }));
    const presentation = uploads.find((upload) => upload.name === 'Presentation.pptx');
    const image = uploads.find((upload) => upload.name === 'Image.png');
    if (presentation === undefined || image === undefined) throw new Error('Missing slide sample');
    presentation.buffer = Buffer.from(
      await presentationWithImage(presentation.buffer, image.buffer),
    );
    const screenshots = path.resolve('test-results/file-visuals');
    await mkdir(screenshots, { recursive: true });
    await page.getByLabel('Upload files', { exact: true }).setInputFiles(uploads);
    await expect(page.getByText('Uploaded', { exact: true })).toHaveCount(uploads.length);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Report.pdf', exact: true })).toBeVisible();
    await page.screenshot({
      path: path.join(screenshots, 'files.png'),
      fullPage: true,
      caret: 'initial',
    });
    for (const upload of uploads) {
      await page.getByRole('button', { name: upload.name, exact: true }).click();
      const dialog = page.getByRole('dialog');
      if (upload.name === 'Résumé.md')
        await expect(dialog.getByRole('heading', { name: 'Rendered Markdown' })).toBeVisible();
      if (upload.mimeType.startsWith('image/'))
        await expect(dialog.getByRole('img', { name: upload.name })).toBeVisible();
      if (upload.name === 'Notes.txt')
        await expect(dialog.getByText('Plain text stays literal:', { exact: false })).toBeVisible();
      if (upload.name === 'Data.csv')
        await expect(dialog.getByText('name,status', { exact: false })).toBeVisible();
      if (upload.name === 'Document.docx') {
        await expect(
          page.frameLocator('iframe').getByText('A valid DOCX document.', { exact: false }),
        ).toBeVisible();
        await expect(page.frameLocator('iframe').locator('script')).toHaveCount(0);
      }
      if (upload.name === 'Presentation.pptx') {
        await page.setViewportSize({ width: 950, height: 1138 });
        await expect(page.frameLocator('iframe').locator('script')).toHaveCount(0);
        await expect(
          page.frameLocator('iframe').getByText('Gravity file library: slide 1', { exact: false }),
        ).toBeVisible();
        await expect
          .poll(() =>
            page
              .frameLocator('iframe')
              .locator('img')
              .first()
              .evaluate((image) => (image instanceof HTMLImageElement ? image.naturalWidth : 0)),
          )
          .toBeGreaterThan(0);
        await dialog.getByRole('button', { name: 'Next slide', exact: true }).click();
        await expect(
          page.frameLocator('iframe').getByText('Gravity file library: slide 2', { exact: false }),
        ).toBeVisible();
        await expect
          .poll(() =>
            page
              .frameLocator('iframe')
              .locator('img')
              .first()
              .evaluate((image) => (image instanceof HTMLImageElement ? image.naturalWidth : 0)),
          )
          .toBeGreaterThan(0);
        const frame = await dialog.locator('iframe').boundingBox();
        if (frame === null) throw new Error('Missing slide frame');
        expect(frame.width / frame.height).toBeCloseTo(16 / 9, 1);
        expect(frame.height).toBeLessThan(550);
        await page.setViewportSize({ width: 375, height: 812 });
        await expect(
          page.frameLocator('iframe').getByText('Gravity file library: slide 2', { exact: false }),
        ).toBeVisible();
        const mobile = await dialog.locator('iframe').boundingBox();
        if (mobile === null) throw new Error('Missing mobile slide frame');
        expect(mobile.width).toBeLessThan(375);
        expect(mobile.width / mobile.height).toBeCloseTo(16 / 9, 1);
        await page.setViewportSize({ width: 950, height: 1138 });
      }
      if (upload.name === 'Spreadsheet.xlsx') {
        await expect(dialog.getByRole('cell', { name: 'Saved', exact: true })).toBeVisible();
        await expect(
          dialog.getByRole('button', { name: 'Previous rows', exact: true }),
        ).toHaveCount(0);
        const rowHeader = await dialog
          .getByRole('columnheader', { name: 'Row number', exact: true })
          .boundingBox();
        expect(rowHeader?.width).toBeLessThan(65);
      }
      if (upload.name === 'Report.pdf') {
        await expect(dialog.locator('canvas')).toHaveAttribute('data-rendered', 'true');
        await expect(dialog.getByText('Page 1 of 2')).toBeVisible();
        await dialog.getByText('Page text', { exact: true }).click();
        await expect(dialog.getByText('Gravity document storage', { exact: false })).toBeVisible();
        await dialog.getByRole('button', { name: 'Next page', exact: true }).click();
        await expect(dialog.getByText('Page 2 of 2')).toBeVisible();
        await expect(dialog.locator('canvas')).toHaveAttribute('data-rendered', 'true');
      }
      await page.screenshot({
        path: path.join(screenshots, `${upload.name}.png`),
        fullPage: true,
        caret: 'initial',
      });
      const downloading = page.waitForEvent('download');
      await page
        .getByRole('dialog')
        .getByRole('link', { name: `Download ${upload.name}` })
        .click();
      const download = await downloading;
      const downloadPath = await download.path();
      expect(downloadPath).not.toBeNull();
      expect(await readFile(downloadPath ?? '')).toEqual(upload.buffer);
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    }
    const toolbar = await page.getByRole('toolbar', { name: 'File toolbar' }).boundingBox();
    expect(toolbar?.height).toBeLessThan(60);
    await expect(page.getByTestId('top-bar-search')).not.toBeVisible();
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Navigation', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(browserErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('large workbooks stay responsive, page and jump across sheets, and retain the original', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await signIn(context, readFixture().ownerEmail);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const workbook = new ExcelJS.Workbook();
    const tall = workbook.addWorksheet('50,000 rows');
    for (let row = 1; row <= 50_000; row += 1) tall.addRow([row, `Record ${row}`, 'Saved']);
    const wide = workbook.addWorksheet('64 columns');
    for (let row = 1; row <= 200; row += 1)
      wide.addRow(Array.from({ length: 64 }, (_, column) => `Cell ${row},${column + 1}`));
    workbook.addWorksheet('Empty');
    const buffer = Buffer.from(new Uint8Array(await workbook.xlsx.writeBuffer()));
    await page.goto(`${BASE}/files`);
    await page.getByLabel('Upload files', { exact: true }).setInputFiles({
      name: 'Large workbook.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    });
    await expect(page.getByText('Uploaded', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Large workbook.xlsx', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('button', { name: 'Large workbook.xlsx', exact: true }).click();
    await expect(dialog.getByRole('cell', { name: 'Record 1', exact: true })).toBeVisible();
    await expect(dialog.getByRole('table').locator('tbody tr')).toHaveCount(100);
    expect(page.workers()).toHaveLength(1);
    await dialog.getByRole('button', { name: 'Next rows', exact: true }).click();
    await expect(dialog.getByRole('cell', { name: 'Record 101', exact: true })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Go to cell', exact: true }).fill('B49990');
    await dialog.getByRole('button', { name: 'Go', exact: true }).click();
    await expect(dialog.getByRole('cell', { name: 'Record 50000', exact: true })).toBeVisible();
    await expect(dialog.getByRole('table').locator('tbody tr')).toHaveCount(11);
    await dialog.getByRole('button', { name: 'Previous rows', exact: true }).click();
    await expect(dialog.getByRole('cell', { name: 'Record 49890', exact: true })).toBeVisible();
    await dialog.getByLabel('Worksheet', { exact: true }).selectOption({ label: '64 columns' });
    await expect(dialog.getByRole('table').locator('td')).toHaveCount(3000);
    await dialog.getByRole('button', { name: 'Next columns', exact: true }).click();
    await expect(dialog.getByRole('cell', { name: 'Cell 1,31', exact: true })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Go to cell', exact: true }).fill('BL199');
    await dialog.getByRole('button', { name: 'Go', exact: true }).click();
    await expect(dialog.getByRole('cell', { name: 'Cell 200,64', exact: true })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Go to cell', exact: true }).fill('XFD1048576');
    await dialog.getByRole('button', { name: 'Go', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Choose a cell within this worksheet');
    await dialog.getByLabel('Worksheet', { exact: true }).selectOption({ label: 'Empty' });
    await expect(dialog.getByRole('table').locator('tbody tr')).toHaveCount(1);
    await dialog.getByLabel('Worksheet', { exact: true }).selectOption({ label: '50,000 rows' });
    await expect(dialog.getByRole('cell', { name: 'Record 1', exact: true })).toBeVisible();
    await page.screenshot({
      path: path.resolve('test-results/file-visuals/large-workbook.png'),
      fullPage: true,
      caret: 'initial',
    });
    const downloading = page.waitForEvent('download');
    await dialog.getByRole('link', { name: 'Download Large workbook.xlsx', exact: true }).click();
    const download = await downloading;
    expect(await readFile((await download.path()) ?? '')).toEqual(buffer);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect.poll(() => page.workers().length).toBe(0);
    const zip = new JSZip();
    zip.file(
      'xl/worksheets/sheet1.xml',
      '<worksheet><sheetData><row r="1048576"><c r="XFD1048576"><v>1</v></c></row></sheetData></worksheet>',
    );
    await page.getByLabel('Upload files', { exact: true }).setInputFiles({
      name: 'Beyond preview.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: await zip.generateAsync({ type: 'nodebuffer' }),
    });
    await page.getByRole('button', { name: 'Beyond preview.xlsx', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('exceeds the preview limits');
    await expect(
      dialog.getByRole('link', { name: 'Download Beyond preview.xlsx', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('sharing enforces private, workspace, specific people, public and revoked folder access', async ({
  browser,
}) => {
  const fixture = readFixture();
  const ownerContext = await browser.newContext();
  const teammateContext = await browser.newContext();
  const publicContext = await browser.newContext();
  const owner = await signIn(ownerContext, fixture.ownerEmail);
  const teammate = await signIn(teammateContext, fixture.teammateEmail);
  try {
    const response = await owner.request.post(`${BASE}/api/files`, {
      data: { kind: 'folder', name: 'Sharing checks', visibility: 'private' },
    });
    expect(response.ok()).toBe(true);
    let folder = fileMutationSchema.parse(await response.json()).entries[0];
    if (folder === undefined) throw new Error('Missing folder');
    const documentResponse = await owner.request.post(`${BASE}/api/files`, {
      data: {
        kind: 'markdown',
        name: 'Access.md',
        parentId: folder.id,
        visibility: 'inherit',
        body: '# Controlled document',
      },
    });
    const document = fileMutationSchema.parse(await documentResponse.json()).entries[0];
    if (document === undefined) throw new Error('Missing document');
    expect((await teammate.request.get(`${BASE}/api/files/${document.id}`)).status()).toBe(404);
    const workspace = await owner.request.patch(`${BASE}/api/files/${folder.id}`, {
      data: { access: { visibility: 'workspace' }, expectedSyncId: folder.syncId },
    });
    folder = fileMutationSchema
      .parse(await workspace.json())
      .entries.find((entry) => entry.id === folder?.id);
    if (folder === undefined) throw new Error('Missing folder');
    await teammate.goto(`${BASE}/files?folder=${folder.id}`);
    await expect(teammate.getByRole('button', { name: 'Access.md', exact: true })).toBeVisible();
    const bootstrap = await teammate.request.get(`${BASE}/api/bootstrap`);
    const me = (await bootstrap.json()) as { me: { userId: string } };
    const shared = await owner.request.patch(`${BASE}/api/files/${folder.id}`, {
      data: {
        access: { visibility: 'shared', grants: [{ userId: me.me.userId, role: 'viewer' }] },
        expectedSyncId: folder.syncId,
      },
    });
    folder = fileMutationSchema
      .parse(await shared.json())
      .entries.find((entry) => entry.id === folder?.id);
    if (folder === undefined) throw new Error('Missing folder');
    const detail = fileDetailSchema.parse(
      await (await teammate.request.get(`${BASE}/api/files/${document.id}`)).json(),
    );
    expect(detail.entry.canEdit).toBe(false);
    expect(
      (
        await teammate.request.patch(`${BASE}/api/files/${document.id}`, {
          data: { body: 'Unauthorized edit', expectedSyncId: detail.entry.syncId },
        })
      ).status(),
    ).toBe(403);
    const published = await owner.request.patch(`${BASE}/api/files/${folder.id}`, {
      data: { access: { visibility: 'public' }, expectedSyncId: folder.syncId },
    });
    const publicItems = fileMutationSchema.parse(await published.json()).entries;
    folder = publicItems.find((entry) => entry.id === folder?.id);
    if (folder === undefined) throw new Error('Missing folder');
    const token = publicItems.find((entry) => entry.id === document.id)?.publicToken;
    if (token === undefined || token === null) throw new Error('Missing public token');
    const publicPage = await publicContext.newPage();
    await publicPage.goto(`${BASE}/share/files/${token}`);
    await expect(publicPage.getByRole('heading', { name: 'Controlled document' })).toBeVisible();
    await owner.goto(`${BASE}/files?folder=${folder.id}`);
    await expect(owner.getByRole('button', { name: 'Upload files', exact: true })).toBeEnabled();
    const pdf = fileSamples.find((sample) => sample.name === 'Report.pdf');
    if (pdf === undefined) throw new Error('Missing PDF fixture');
    await owner.getByLabel('Upload files', { exact: true }).setInputFiles({
      name: pdf.name,
      mimeType: pdf.mimeType,
      buffer: Buffer.from(pdf.base64, 'base64'),
    });
    await expect(owner.getByText('Uploaded', { exact: true })).toBeVisible();
    const sharedListing = fileListingSchema.parse(
      await (await owner.request.get(`${BASE}/api/files?parentId=${folder.id}`)).json(),
    );
    const pdfToken = sharedListing.entries.find((entry) => entry.name === pdf.name)?.publicToken;
    if (pdfToken === undefined || pdfToken === null) throw new Error('Missing public PDF token');
    await publicPage.goto(`${BASE}/share/files/${pdfToken}`);
    await expect(publicPage.locator('canvas')).toHaveAttribute('data-rendered', 'true');
    await expect(publicPage.getByText('Page 1 of 2')).toBeVisible();
    await teammate.getByRole('button', { name: 'Access.md', exact: true }).click();
    await expect(teammate.getByRole('heading', { name: 'Controlled document' })).toBeVisible();
    const revoked = await owner.request.patch(`${BASE}/api/files/${folder.id}`, {
      data: { access: { visibility: 'private' }, expectedSyncId: folder.syncId },
    });
    expect(revoked.ok()).toBe(true);
    await expect(
      teammate.getByRole('button', { name: 'Access.md', exact: true }),
    ).not.toBeVisible();
    await expect(teammate.getByRole('heading', { name: 'Controlled document' })).not.toBeVisible();
    expect(
      (await publicContext.request.get(`${BASE}/api/public/files/${token}/download`)).status(),
    ).toBe(404);
    expect((await teammate.request.get(`${BASE}/api/files/${document.id}`)).status()).toBe(404);
    expect(
      (await publicContext.request.get(`${BASE}/api/public/files/${pdfToken}/download`)).status(),
    ).toBe(404);
    const listing = fileListingSchema.parse(
      await (await owner.request.get(`${BASE}/api/files?parentId=${folder.id}`)).json(),
    );
    expect(listing.entries.map((entry) => entry.id)).toContain(document.id);
  } finally {
    await ownerContext.close();
    await teammateContext.close();
    await publicContext.close();
  }
});

test('large folders render a bounded window and search across every item', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await signIn(context, readFixture().ownerEmail);
  try {
    const response = await page.request.post(`${BASE}/api/files`, {
      data: { name: 'Large folder', kind: 'folder' },
    });
    const folder = fileMutationSchema.parse(await response.json()).entries[0];
    if (folder === undefined) throw new Error('Missing folder');
    let cursor = 0;
    const worker = async () => {
      while (cursor < 140) {
        const index = cursor++;
        const created = await page.request.post(`${BASE}/api/files`, {
          data: {
            name: `Document ${index}.md`,
            kind: 'markdown',
            parentId: folder.id,
            visibility: 'inherit',
          },
        });
        expect(created.ok()).toBe(true);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    await page.goto(`${BASE}/files?folder=${folder.id}`);
    await expect(page.locator('footer').getByText('140 items', { exact: true })).toBeVisible();
    expect(await page.getByRole('table').locator('tbody tr').count()).toBeLessThan(60);
    await page
      .getByRole('region', { name: 'Folder contents', exact: true })
      .evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await expect(page.getByRole('button', { name: 'Document 139.md', exact: true })).toBeVisible();
    await page.getByLabel('Search this folder').fill('Document 139');
    await expect(page.getByRole('button', { name: 'Document 139.md', exact: true })).toBeVisible();
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);
    await page.getByLabel('Search this folder').fill('');
    await page.getByLabel('Select all files', { exact: true }).check();
    await expect(page.getByText('140 selected', { exact: true })).toBeVisible();
    const targetResponse = await page.request.post(`${BASE}/api/files`, {
      data: { name: 'Bulk move target', kind: 'folder' },
    });
    const target = fileMutationSchema.parse(await targetResponse.json()).entries[0];
    if (target === undefined) throw new Error('Missing bulk destination');
    await page.getByRole('button', { name: 'Cut', exact: true }).click();
    await page.getByRole('button', { name: 'All files', exact: true }).click();
    await page.getByRole('button', { name: 'Bulk move target', exact: true }).click();
    await page.getByRole('button', { name: 'Paste 140 items', exact: true }).click();
    await expect(page.locator('footer').getByText('140 items', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('footer').getByText('140 items', { exact: true })).toBeVisible();
    const source = fileListingSchema.parse(
      await (await page.request.get(`${BASE}/api/files?parentId=${folder.id}`)).json(),
    );
    const moved = fileListingSchema.parse(
      await (await page.request.get(`${BASE}/api/files?parentId=${target.id}`)).json(),
    );
    expect(source.entries).toEqual([]);
    expect(moved.entries).toHaveLength(140);
    expect(moved.entries.every((entry) => entry.parentId === target.id)).toBe(true);
  } finally {
    await context.close();
  }
});

test('a malformed PDF gives a useful error and oversize uploads are rejected', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await signIn(context, readFixture().ownerEmail);
  try {
    await page.goto(`${BASE}/files`);
    await page.getByLabel('Upload files', { exact: true }).setInputFiles({
      name: 'Invalid.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('This is not a PDF.'),
    });
    await expect(page.getByText('Uploaded', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Invalid.pdf', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    await expect(
      page.getByRole('dialog').getByRole('link', { name: 'Download Invalid.pdf', exact: true }),
    ).toBeVisible();
    const oversized = await page.request.post(`${BASE}/api/files/uploads`, {
      data: {
        name: 'Large.bin',
        mimeType: 'application/octet-stream',
        size: 100 * 1024 * 1024 + 1,
      },
    });
    expect(oversized.status()).toBe(422);
  } finally {
    await context.close();
  }
});
