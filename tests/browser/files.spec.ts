import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import samples from "../fixtures/file-samples.json" with { type: "json" };

const require = createRequire(import.meta.url);
const ExcelJS: typeof import("exceljs") = require("exceljs");
const JSZip: typeof import("jszip") = require("jszip");
const scope = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  productId: "00000000-0000-4000-8000-000000000010",
};
test("persistent native uploads, nested navigation, transfers and every preview", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const post = async (operation: string, input: object) => {
    const response = await request.post("/api/files", {
      headers: { Origin: "http://127.0.0.1:3024" },
      data: { ...scope, operation, ...input },
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const root = (
    await post("create", {
      kind: "folder",
      name: `Browser formats ${crypto.randomUUID()}`,
      visibility: "private",
    })
  ).entries[0];
  await post("create", {
    kind: "folder",
    name: "Nested folder",
    parentId: root.id,
    visibility: "inherit",
  });
  await page.goto(`/files?folder=${root.id}`);
  await expect(
    page.getByRole("button", { name: "Upload files", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Upload files", { exact: true }).setInputFiles(
    samples.map((file) => ({
      name: file.name,
      mimeType: file.mimeType,
      buffer: Buffer.from(file.base64, "base64"),
    })),
  );
  await expect(page.getByRole("treeitem")).toHaveCount(12);
  for (const sample of samples) {
    await page
      .getByRole("treeitem")
      .getByRole("button", { name: sample.name, exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: sample.name, exact: true }),
    ).toBeVisible();
    if (sample.name === "Presentation.pptx") {
      const frame = dialog.frameLocator("iframe");
      await expect(
        frame.getByText("Gravity file library: slide 1", { exact: true }),
      ).toBeVisible();
      const dimensions = await dialog.locator("iframe").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      expect(dimensions.width / dimensions.height).toBeCloseTo(16 / 9, 1);
      await page.screenshot({ path: ".data/file-browser-results/slides.png" });
      await dialog.getByRole("button", { name: "Next slide" }).click();
      await expect(
        frame.getByText("Gravity file library: slide 2", { exact: true }),
      ).toBeVisible();
    } else if (sample.name === "Document.docx")
      await expect(
        dialog
          .frameLocator("iframe")
          .getByText("A valid DOCX document.", { exact: false }),
      ).toBeVisible();
    else if (sample.name === "Spreadsheet.xlsx") {
      await expect(dialog.getByRole("table")).toBeVisible();
      await expect(
        dialog.getByRole("cell", { name: "Report", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: ".data/file-browser-results/spreadsheet.png",
      });
    } else if (sample.name === "Report.pdf")
      await expect(dialog.locator("canvas")).toHaveAttribute(
        "data-rendered",
        "true",
      );
    else if (["Image.png", "Photo.jpg", "Image.webp"].includes(sample.name)) {
      await expect(dialog.getByRole("img")).toBeVisible();
      expect(
        await dialog
          .getByRole("img")
          .evaluate((element: HTMLImageElement) =>
            element.decode().then(() => element.naturalWidth),
          ),
      ).toBeGreaterThan(0);
    } else if (sample.name === "Résumé.md") {
      await expect(
        dialog.getByRole("heading", {
          name: "Rendered Markdown",
          exact: true,
        }),
      ).toBeVisible();
      await dialog.getByRole("button", { name: "Edit Markdown" }).click();
      await dialog
        .getByLabel("Markdown source")
        .fill("# Saved in production app\n\nA persisted document.");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        dialog.getByRole("button", { name: "Edit Markdown" }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("heading", { name: "Saved in production app" }),
      ).toBeVisible();
    } else if (sample.name === "Empty.bin")
      await expect(
        dialog.getByText("This file is empty.", { exact: true }),
      ).toBeVisible();
    else await expect(dialog.locator("pre")).toBeVisible();
    if (sample.name !== "Résumé.md") {
      const download = page.waitForEvent("download");
      await dialog
        .getByRole("link", { name: `Download ${sample.name}`, exact: true })
        .click();
      const downloaded = await download;
      expect(downloaded.suggestedFilename()).toBe(sample.name);
      const path = await downloaded.path();
      if (!path) throw new Error("Download unavailable");
      const { readFile } = await import("node:fs/promises");
      expect(await readFile(path)).toEqual(
        Buffer.from(sample.base64, "base64"),
      );
    }
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  }
  await page.reload();
  await expect(page.getByRole("treeitem")).toHaveCount(12);
  await page
    .getByRole("checkbox", { name: "Select Notes.txt", exact: true })
    .check();
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await page
    .getByRole("treeitem")
    .getByRole("button", { name: "Nested folder", exact: true })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "Folder path" })
      .getByRole("button", { name: "Nested folder" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Paste", exact: true }).click();
  await expect(
    page
      .getByRole("treeitem")
      .getByRole("button", { name: "Notes.txt", exact: true }),
  ).toBeVisible();
  await page.getByRole("treeitem").locator("summary").click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("Copied notes.txt");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Select Copied notes.txt", exact: true })
    .check();
  await page.getByRole("button", { name: "Cut", exact: true }).click();
  await page.getByRole("button", { name: "Go to parent folder" }).click();
  await page.getByRole("button", { name: "Paste", exact: true }).click();
  await expect(
    page
      .getByRole("treeitem")
      .getByRole("button", { name: "Copied notes.txt", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  await expect(page.locator(".library-tile")).toHaveCount(13);
  await page.getByRole("button", { name: "Columns view", exact: true }).click();
  await expect(page.locator(".library-column")).toHaveCount(2);
  await page.getByRole("button", { name: "List view", exact: true }).click();
  const rootLabel = page
    .getByRole("navigation", { name: "Folder path" })
    .getByRole("button", { name: "Files", exact: true });
  expect(
    await rootLabel.evaluate(
      (element) => element.clientWidth >= element.scrollWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".data/file-browser-results/library.png" });
  expect(errors).toEqual([]);
});
test("large workbooks page in a worker, jump to distant cells, and keep oversized originals", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Large sheet");
  sheet.getCell("A1").value = "First cell";
  sheet.getCell("BL199").value = "Distant cell";
  const tall = workbook.addWorksheet("Tall sheet");
  tall.getCell("T50000").value = "Last cell";
  const other = workbook.addWorksheet("Second sheet");
  other.getCell("A1").value = "Second worksheet";
  const bytes = await workbook.xlsx.writeBuffer();
  const upload = async (name: string, buffer: Buffer) => {
    const reservation = await request.post("/api/files", {
      headers: { Origin: "http://127.0.0.1:3024" },
      data: {
        ...scope,
        operation: "reserve",
        name,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: buffer.length,
      },
    });
    expect(reservation.ok()).toBe(true);
    const pending = await reservation.json();
    const put = await request.put(
      `${pending.url}&${new URLSearchParams(scope)}`,
      { headers: { Origin: "http://127.0.0.1:3024" }, data: buffer },
    );
    expect(put.ok()).toBe(true);
    const completed = await request.post("/api/files", {
      headers: { Origin: "http://127.0.0.1:3024" },
      data: { ...scope, operation: "complete", uploadId: pending.uploadId },
    });
    expect(completed.ok()).toBe(true);
    return (await completed.json()).entries[0];
  };
  const file = await upload(
    `Large ${crypto.randomUUID()}.xlsx`,
    Buffer.from(bytes),
  );
  await page.goto("/files");
  await page
    .getByRole("treeitem")
    .getByRole("button", { name: file.name, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("table")).toBeVisible();
  const jumpInput = await dialog
    .getByLabel("Go to cell", { exact: true })
    .boundingBox();
  const jumpButton = await dialog
    .getByRole("button", { name: "Go", exact: true })
    .boundingBox();
  if (!jumpInput || !jumpButton) throw new Error("Cell navigation unavailable");
  expect(Math.abs(jumpInput.y - jumpButton.y)).toBeLessThan(4);
  await expect(
    dialog.getByRole("cell", { name: "First cell", exact: true }),
  ).toBeVisible();
  expect(await dialog.locator("tbody tr").count()).toBe(100);
  expect(await dialog.locator("tbody td").count()).toBe(3000);
  await dialog.getByLabel("Go to cell", { exact: true }).fill("BL199");
  await dialog.getByRole("button", { name: "Go", exact: true }).click();
  await expect(
    dialog.getByRole("cell", { name: "Distant cell", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".data/file-browser-results/large-workbook.png",
  });
  await dialog
    .getByLabel("Worksheet", { exact: true })
    .selectOption({ label: "Tall sheet" });
  await dialog.getByLabel("Go to cell", { exact: true }).fill("T50000");
  await dialog.getByRole("button", { name: "Go", exact: true }).click();
  await expect(
    dialog.getByRole("cell", { name: "Last cell", exact: true }),
  ).toBeVisible();
  await dialog
    .getByLabel("Worksheet", { exact: true })
    .selectOption({ label: "Second sheet" });
  await expect(
    dialog.getByRole("cell", { name: "Second worksheet", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const zip = await JSZip.loadAsync(bytes);
  zip.file(
    "xl/worksheets/sheet1.xml",
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1048576"><c r="XFD1048576" t="inlineStr"><is><t>Oversized</t></is></c></row></sheetData></worksheet>',
  );
  const hugeBytes = await zip.generateAsync({ type: "nodebuffer" });
  const huge = await upload(
    `Beyond preview limits ${crypto.randomUUID()}.xlsx`,
    hugeBytes,
  );
  await page.reload();
  await page
    .getByRole("treeitem")
    .getByRole("button", { name: huge.name, exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("This workbook exceeds the preview limits", { exact: false }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("dialog")
    .getByRole("link", { name: `Download ${huge.name}` })
    .click();
  const path = await (await download).path();
  if (!path) throw new Error("Original download unavailable");
  const { readFile } = await import("node:fs/promises");
  expect(await readFile(path)).toEqual(hugeBytes);
});

test("native drops move into folders and public ancestor revocation hides open previews", async ({
  page,
  request,
}) => {
  const post = async (operation: string, input: object) => {
    const result = await request.post(`/api/files?operation=${operation}`, {
      headers: { Origin: "http://127.0.0.1:3024" },
      data: { ...scope, ...input },
    });
    expect(result.ok(), await result.text()).toBe(true);
    return result.json();
  };
  const root = (
    await post("create", {
      name: `Native drops ${crypto.randomUUID()}`,
      kind: "folder",
      visibility: "private",
    })
  ).entries[0];
  const nested = (
    await post("create", {
      name: "Drop destination",
      kind: "folder",
      visibility: "inherit",
      parentId: root.id,
    })
  ).entries[0];
  await page.goto(`/files?folder=${root.id}`);
  await expect(page.getByRole("treeitem")).toHaveCount(1);
  await page.locator(".file-library").evaluate((element) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File(["Native dropped bytes"], "Drop me.txt", { type: "text/plain" }),
    );
    element.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }),
    );
  });
  const dropped = page.getByRole("treeitem").filter({
    has: page.getByRole("button", { name: "Drop me.txt", exact: true }),
  });
  await expect(dropped).toBeVisible();
  await dropped.dragTo(
    page.getByRole("treeitem").filter({
      has: page.getByRole("button", {
        name: "Drop destination",
        exact: true,
      }),
    }),
  );
  await expect(dropped).toHaveCount(0);
  await page
    .getByRole("treeitem")
    .getByRole("button", { name: "Drop destination", exact: true })
    .click();
  await expect(
    page
      .getByRole("treeitem")
      .getByRole("button", { name: "Drop me.txt", exact: true }),
  ).toBeVisible();
  const listing = await request.get(
    `/api/files?${new URLSearchParams({ ...scope, parentId: nested.id })}`,
  );
  const moved = (await listing.json()).entries.find(
    (entry: { name: string }) => entry.name === "Drop me.txt",
  );
  expect(moved.parentId).toBe(nested.id);
  const shared = (
    await post("create", {
      name: "Public document.md",
      kind: "markdown",
      visibility: "public",
      parentId: root.id,
      body: "# Published document\n\nA revocable preview.",
    })
  ).entries[0];
  expect(shared.publicToken).toBeNull();
  const publishedRoot = (
    await post("update", {
      id: root.id,
      expectedSyncId: root.syncId,
      access: { visibility: "public", grants: [] },
    })
  ).entries.find((entry: { id: string }) => entry.id === root.id);
  const detail = await request.get(
    `/api/files?${new URLSearchParams({ ...scope, operation: "detail", id: shared.id })}`,
  );
  const token = (await detail.json()).entry.publicToken;
  expect(token).toBeTruthy();
  await page.goto(`/shared/files/${token}`);
  await expect(
    page.getByRole("heading", { name: "Published document", exact: true }),
  ).toBeVisible();
  await post("update", {
    id: root.id,
    expectedSyncId: publishedRoot.syncId,
    access: { visibility: "private", grants: [] },
  });
  await expect(
    page.getByText("This public link is no longer available.", { exact: true }),
  ).toBeVisible({ timeout: 12_000 });
  await expect(
    page.getByRole("heading", { name: "Published document", exact: true }),
  ).toHaveCount(0);
  const denied = await request.get(
    `/api/files?operation=public-download&token=${token}`,
  );
  expect(denied.status()).toBe(404);
});

test("native directory chooser preserves nested paths and keyboard transfer selection", async ({
  page,
  request,
}) => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const directory = await mkdtemp(join(tmpdir(), "gravity-folder-upload-"));
  const parentName = directory.split("/").at(-1);
  if (!parentName) throw new Error("Directory name missing");
  try {
    await mkdir(join(directory, "Child"));
    await writeFile(
      join(directory, "Child", "Nested.txt"),
      "Native folder bytes",
    );
    const response = await request.post("/api/files?operation=create", {
      headers: { Origin: "http://127.0.0.1:3024" },
      data: {
        ...scope,
        name: `Directory check ${crypto.randomUUID()}`,
        kind: "folder",
        visibility: "private",
      },
    });
    expect(response.ok()).toBe(true);
    const root = (await response.json()).entries[0];
    await page.goto(`/files?folder=${root.id}`);
    await page.locator("input[webkitdirectory]").setInputFiles(directory);
    await page
      .getByRole("treeitem")
      .getByRole("button", { name: parentName, exact: true })
      .click();
    await page
      .getByRole("treeitem")
      .getByRole("button", { name: "Child", exact: true })
      .click();
    const file = page.getByRole("treeitem").filter({
      has: page.getByRole("button", { name: "Nested.txt", exact: true }),
    });
    await expect(file).toBeVisible();
    await file.focus();
    await page.keyboard.press("Control+a");
    await expect(
      page.getByRole("checkbox", { name: "Select Nested.txt" }),
    ).toBeChecked();
    await page.keyboard.press("Control+c");
    await page.getByRole("button", { name: "Go to parent folder" }).click();
    await page.locator(".file-library").focus();
    await page.keyboard.press("Control+v");
    await expect(
      page
        .getByRole("treeitem")
        .getByRole("button", { name: "Nested.txt", exact: true }),
    ).toBeVisible();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("large folders render a window in every view and select offscreen files", async ({
  page,
  request,
}) => {
  const post = async (input: object) => {
    const response = await request.post("/api/files?operation=create", {
      headers: { Origin: "http://127.0.0.1:3024" },
      data: { ...scope, ...input },
    });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).entries[0];
  };
  const folder = await post({
    name: `Large folder ${crypto.randomUUID()}`,
    kind: "folder",
    visibility: "private",
  });
  for (let index = 0; index < 140; index++)
    await post({
      name: `Document ${String(index).padStart(3, "0")}.md`,
      kind: "markdown",
      visibility: "inherit",
      parentId: folder.id,
      body: `# Document ${index}`,
    });
  await page.goto(`/files?folder=${folder.id}`);
  for (const view of ["List", "Grid", "Columns"]) {
    await page
      .getByRole("button", { name: `${view} view`, exact: true })
      .click();
    const surface =
      view === "Columns"
        ? page.locator(".library-column").last()
        : page.locator(view === "Grid" ? ".library-grid" : ".library-rows");
    await expect(
      surface.getByRole("button", { name: "Document 000.md", exact: true }),
    ).toBeVisible();
    expect(await surface.getByRole("treeitem").count()).toBeLessThan(140);
    await surface.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(
      surface.getByRole("button", { name: "Document 139.md", exact: true }),
    ).toBeVisible();
    expect(await surface.getByRole("treeitem").count()).toBeLessThan(140);
    await page.locator(".file-library").focus();
    await page.keyboard.press("Control+a");
    await expect(page.locator(".library-selection")).toContainText("140");
    await page.keyboard.press("Escape");
  }
  await page.screenshot({
    path: ".data/file-browser-results/large-folder.png",
  });
});
