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
  await inspector
    .getByRole("button", { name: t.contactWorkspace.more })
    .click();
  await page.getByRole("menuitem", { name: t.archive, exact: true }).click();
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
  await inspector
    .getByRole("button", { name: t.contactWorkspace.more })
    .click();
  await page.getByRole("menuitem", { name: t.archive, exact: true }).click();
  await inspector
    .getByRole("button", { name: t.inlineEditing.cancelArchive })
    .click();
  await expect(
    inspector.getByRole("button", { name: t.inlineEditing.confirmArchive }),
  ).toHaveCount(0);
  await page.screenshot({
    animations: "disabled",
    path: ".data/ui-review-inline.png",
  });
  await page.getByRole("button", { name: t.toggleTheme }).click();
  await page.screenshot({
    animations: "disabled",
    path: ".data/ui-review-inline-dark.png",
  });
  await page.getByRole("button", { name: t.toggleTheme }).click();
  await inspector
    .getByRole("button", { name: t.contactWorkspace.more })
    .click();
  await page.getByRole("menuitem", { name: t.archive, exact: true }).click();
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
  await page.screenshot({
    animations: "disabled",
    path: ".data/ui-review-overview.png",
  });
});

test("contact preparation separates notes, conversations, context and properties", async ({
  page,
  request,
}) => {
  const name = `Fictional conversation review ${crypto.randomUUID().slice(0, 8)}`;
  const source =
    "SENT by Alex · 2026-09-28T16:47:41.437Z · fictional-source\nHello,\n\nCould we review the evaluation together?\n\nRECEIVED by Contact · 2026-09-29T08:30:00Z · fictional-reply\nTuesday works. Please include the rollout plan.";
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
  const result = await created.json();
  const currentResponse = await request.get(
    `/api/crm?operation=person&organizationId=${demoId(1)}&personId=${result.personId}`,
  );
  expect(currentResponse.ok(), await currentResponse.text()).toBe(true);
  const { person } = await currentResponse.json();
  const updated = await request.post("/api/crm", {
    headers: { Origin: String(test.info().project.use.baseURL) },
    data: {
      operation: "person-update",
      organizationId: demoId(1),
      personId: person.id,
      version: person.version,
      name: person.name,
      title: person.title,
      email: person.email,
      otherEmails: person.otherEmails,
      phone: person.phone,
      linkedinUrl: person.linkedinUrl,
      summary: `Prepare the rollout agenda.\n\n${source}`,
    },
  });
  expect(updated.ok(), await updated.text()).toBe(true);

  await page.goto("/people");
  await page.getByRole("button", { name: t.allProducts, exact: true }).click();
  await page.getByRole("link", { name, exact: true }).click();
  const inspector = page.locator("#record-inspector");
  const notes = inspector.getByRole("textbox", {
    name: t.personNotes,
    exact: true,
  });
  await expect(notes).toHaveValue("Prepare the rollout agenda.");
  const history = inspector.getByRole("region", {
    name: t.contactWorkspace.history,
  });
  await expect(history.locator("article")).toHaveCount(2);
  await expect(
    history.getByText("Tuesday works. Please include the rollout plan."),
  ).toBeVisible();
  await expect(
    inspector.getByRole("button", { name: t.archive, exact: true }),
  ).toHaveCount(0);
  await expect(
    inspector.getByRole("button", { name: t.edit, exact: true }),
  ).toHaveCount(0);
  await expect(inspector.getByText(t.personDealSizeAndTags)).toHaveCount(0);
  await history.getByRole("searchbox").fill("rollout");
  await expect(history.locator("article")).toHaveCount(1);
  await history.getByRole("searchbox").fill("");
  await notes.fill("Updated rollout agenda.");
  await inspector
    .getByRole("tab", { name: t.contactWorkspace.context, exact: true })
    .click();
  await expect(
    inspector.getByRole("tab", {
      name: t.contactWorkspace.overview,
      exact: true,
    }),
  ).toHaveAttribute("aria-selected", "true");
  await notes.press("ControlOrMeta+Enter");
  await expect(inspector.getByRole("status")).toHaveText(t.inlineEditing.saved);
  await page.reload();
  await page.getByRole("link", { name, exact: true }).click();
  await expect(notes).toHaveValue("Updated rollout agenda.");
  await expect(history.locator("article")).toHaveCount(2);
  await inspector
    .getByRole("tab", { name: t.contactWorkspace.context, exact: true })
    .click();
  await expect(
    inspector.getByRole("region", { name: t.contextFields.heading }),
  ).toBeVisible();
  await inspector
    .getByRole("tab", { name: t.contactWorkspace.details, exact: true })
    .click();
  await expect(inspector.getByLabel(t.email, { exact: true })).toBeVisible();
  await inspector
    .getByRole("tab", { name: t.contactWorkspace.overview, exact: true })
    .click();
  await page.screenshot({
    animations: "disabled",
    path: ".data/contact-preparation-light.png",
  });
  await page.getByRole("button", { name: t.toggleTheme }).click();
  await page.screenshot({
    animations: "disabled",
    path: ".data/contact-preparation-dark.png",
  });
  await page.getByRole("button", { name: t.toggleTheme }).click();
  await page.setViewportSize({ width: 700, height: 900 });
  await expect(notes).toBeVisible();
  await expect(inspector).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: ".data/contact-preparation-narrow.png",
  });
  await page.setViewportSize({ width: 1280, height: 900 });

  await inspector.getByRole("button", { name: t.expandInspector }).click();
  const notesBox = await notes.boundingBox();
  const workBox = await inspector
    .getByRole("heading", { name: t.actions, exact: true })
    .boundingBox();
  if (!notesBox || !workBox) throw new Error("Missing preparation layout");
  expect(workBox.x).toBeGreaterThan(notesBox.x + notesBox.width);
  await page.screenshot({
    animations: "disabled",
    path: ".data/contact-preparation-expanded.png",
  });
  await inspector
    .getByRole("link", { name: t.inlineEditing.openFullPage })
    .click();
  await expect(page.locator(".contact-record-page")).toBeVisible();
  const fullHistory = page.getByRole("region", {
    name: t.contactWorkspace.history,
  });
  await expect(fullHistory.locator("article")).toHaveCount(2);
  await expect(
    page.getByRole("textbox", { name: t.personNotes, exact: true }),
  ).toHaveValue("Updated rollout agenda.");
  await page.screenshot({
    animations: "disabled",
    path: ".data/contact-preparation-full.png",
  });
});
