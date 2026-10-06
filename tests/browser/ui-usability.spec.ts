import { expect, test } from "@playwright/test";
import { demoId } from "../../packages/database/seed";
import t from "../../packages/i18n/translations/en.json" with { type: "json" };

test("inline notes save, dirty navigation stays put, and archive requires confirmation", async ({
  page,
  request,
}) => {
  const name = `Fictional UI review ${crypto.randomUUID().slice(0, 8)}`;
  const created = await request.post("/api/crm", {
    headers: { Origin: String(test.info().project.use.baseURL) },
    data: {
      operation: "person",
      organizationId: demoId(1),
      productId: demoId(10),
      name,
      purpose: "buyer",
      ownerId: "demo-you",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  await page.goto("/people");
  await expect(page.locator(".live-status")).toHaveClass(/sync-live/);
  await page.getByRole("button", { name: t.allProducts, exact: true }).click();
  await expect(
    page.getByRole("button", { name: t.allProducts, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name, exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/people$/);
  const inspector = page.locator("#record-inspector");
  await expect(inspector.getByLabel(t.name, { exact: true })).toHaveValue(name);
  await expect(page).toHaveURL(/\/people$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const notes = inspector.getByRole("textbox", {
    name: t.personNotes,
    exact: true,
  });
  await notes.fill("Editable notes, saved without leaving this list.");
  await page.getByRole("link", { name: t.companies, exact: true }).click();
  await expect(page).toHaveURL(/\/people$/);
  await expect(notes).toHaveValue(
    "Editable notes, saved without leaving this list.",
  );
  await notes.press("ControlOrMeta+Enter");
  await expect(inspector.getByRole("status")).toHaveText(t.inlineEditing.saved);
  await page.reload();
  await page.getByRole("link", { name, exact: true }).click();
  await expect(notes).toHaveValue(
    "Editable notes, saved without leaving this list.",
  );
  const archives: string[] = [];
  page.on("request", (event) => {
    if (
      event.method() === "POST" &&
      event.postData()?.includes('"person-archive"')
    )
      archives.push(event.postData() ?? "");
  });
  await inspector.getByRole("button", { name: t.archive, exact: true }).click();
  await expect(
    inspector.getByRole("button", { name: t.inlineEditing.confirmArchive }),
  ).toBeVisible();
  expect(archives).toHaveLength(0);
  await page.getByRole("link", { name: "Mira Chen", exact: true }).click();
  await expect(inspector.getByLabel(t.name, { exact: true })).toHaveValue(
    "Mira Chen",
  );
  await expect(
    inspector.getByRole("button", { name: t.inlineEditing.confirmArchive }),
  ).toHaveCount(0);
  await page.getByRole("link", { name, exact: true }).click();
  await inspector.getByRole("button", { name: t.archive, exact: true }).click();
  await inspector
    .getByRole("button", { name: t.inlineEditing.cancelArchive })
    .click();
  await expect(
    inspector.getByRole("button", { name: t.inlineEditing.confirmArchive }),
  ).toHaveCount(0);
  await page.screenshot({ path: ".data/ui-review-inline.png" });
  await page.getByRole("button", { name: t.toggleTheme }).click();
  await page.screenshot({ path: ".data/ui-review-inline-dark.png" });
  await page.getByRole("button", { name: t.toggleTheme }).click();
  await inspector.getByRole("button", { name: t.archive, exact: true }).click();
  await inspector
    .getByRole("button", { name: t.inlineEditing.confirmArchive })
    .click();
  await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  expect(archives).toHaveLength(1);
});

test("Overview results and deal editing preserve the report route", async ({
  page,
}) => {
  await page.goto("/overview");
  await page.getByRole("button", { name: t.allProducts, exact: true }).click();
  await page
    .getByRole("button", { name: new RegExp(`^${t.pipelineValue}`) })
    .click();
  const report = page.getByRole("region", {
    name: new RegExp(`^${t.openPipeline}`),
  });
  await expect(report).toBeVisible();
  await report.getByRole("button", { name: /Cedar workflow pilot/ }).click();
  await expect(
    page
      .locator("#record-inspector")
      .getByRole("region", { name: t.editOpportunity }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(report).toBeVisible();
  for (const value of await page.locator(".metric-card strong").all()) {
    expect(
      await value.evaluate((element) => element.getBoundingClientRect().height),
    ).toBeLessThan(50);
  }
  await page.screenshot({ path: ".data/ui-review-overview.png" });
});
