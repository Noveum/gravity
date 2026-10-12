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
  const search = page.getByRole("searchbox", { name: t.search, exact: true });
  await search.fill(name);
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
  await search.fill(name);
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
  await search.fill("");
  await page.getByRole("link", { name: "Mira Chen", exact: true }).click();
  await expect(inspector.getByLabel(t.name, { exact: true })).toHaveValue(
    "Mira Chen",
  );
  await expect(
    inspector.getByRole("button", { name: t.inlineEditing.confirmArchive }),
  ).toHaveCount(0);
  await search.fill(name);
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
  const expectMetricsFit = async () => {
    const metrics = page.locator(".metric-card");
    await expect(metrics).toHaveCount(6);
    for (const metric of await metrics.all()) {
      const geometry = await metric.evaluate((element) => {
        const card = element.getBoundingClientRect();
        const grid = element.parentElement?.getBoundingClientRect();
        const value = element.querySelector("strong");
        if (!grid || !value) throw new Error("Missing metric layout");
        const text = value.getBoundingClientRect();
        return {
          valueHeight: text.height,
          valueFits: value.scrollWidth <= value.clientWidth + 1,
          cardFits: card.left >= grid.left && card.right <= grid.right + 1,
          textFits: text.bottom <= card.bottom && text.right <= card.right,
        };
      });
      expect(geometry.valueHeight).toBeLessThan(50);
      expect(geometry.valueFits).toBe(true);
      expect(geometry.cardFits).toBe(true);
      expect(geometry.textFits).toBe(true);
    }
  };
  await expectMetricsFit();
  await page.screenshot({
    animations: "disabled",
    path: ".data/ui-review-overview.png",
  });
  await page.setViewportSize({ width: 700, height: 900 });
  await expectMetricsFit();
  await expect(report).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: ".data/ui-review-overview-split-narrow.png",
  });
  await page
    .locator("#record-inspector")
    .getByRole("button", { name: t.closeInspector, exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectMetricsFit();
  await expect(
    page.getByRole("combobox", { name: t.reportingPeriod }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: t.channel })).toBeVisible();
  await expect(page).toHaveURL(/\/overview$/);
  await page.screenshot({
    animations: "disabled",
    path: ".data/ui-review-overview-mobile.png",
  });
});

test("one opportunity board keeps filters compact, applies range controls and remembers visibility per workspace", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/opportunities");
  await page.getByRole("button", { name: t.allProducts, exact: true }).click();
  const board = page.getByRole("region", {
    name: t.opportunityBoard.title,
    exact: true,
  });
  const cards = board.locator(".opportunity-card");
  const names = board.locator(".opportunity-card [data-nav-record]");
  const filters = page.getByRole("region", { name: t.filters, exact: true });
  await expect(board).toHaveCount(1);
  await expect(cards).toHaveCount(2);
  await expect(
    board.getByRole("region", { name: "Evaluation", exact: true }),
  ).toHaveCount(1);
  expect(
    new Set(
      await cards.evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-product-id")),
      ),
    ),
  ).toEqual(new Set([demoId(10), demoId(12)]));
  const work = page.locator('[data-section="work"]');
  await expect(
    work.getByRole("link", { name: t.opportunities, exact: true }),
  ).toBeVisible();
  const choose = async (label: string, option: string) => {
    await page.getByRole("combobox", { name: label, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  };
  for (const width of [1440, 1280, 945, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      filters.getByRole("button", { name: t.uiRefresh.hideFilters }),
    ).toBeVisible();
    const geometry = await filters
      .locator(".record-filter-controls")
      .evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const boxes = [...element.querySelectorAll("button")].map((button) =>
          button.getBoundingClientRect(),
        );
        return {
          controlsFit: element.scrollWidth <= element.clientWidth + 1,
          oneRow:
            Math.max(...boxes.map((box) => box.top)) -
              Math.min(...boxes.map((box) => box.top)) <=
            1,
          rowFits: rect.left >= 0 && rect.right <= window.innerWidth,
          pageFits: document.documentElement.scrollWidth <= window.innerWidth,
        };
      });
    expect(geometry.oneRow).toBe(true);
    expect(geometry.rowFits).toBe(true);
    expect(geometry.pageFits).toBe(true);
    if (width >= 1280) expect(geometry.controlsFit).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await choose(t.sortBy, t.uiRefresh.nameDescending);
  await expect(names).toHaveText([
    "Northstar evaluation project",
    "Cedar workflow pilot",
  ]);
  await choose(t.qualification, "engaged");
  await choose(t.status, "open");
  await expect(page).toHaveURL(/qualification=engaged/);
  await expect(page).toHaveURL(/status=open/);
  await expect(cards).toHaveCount(2);
  await filters
    .getByRole("button", { name: t.uiRefresh.dealValue, exact: true })
    .click();
  const value = page.getByRole("dialog", {
    name: t.uiRefresh.dealValue,
    exact: true,
  });
  const minimum = value.getByLabel(t.minimumDealSize, { exact: true });
  const maximum = value.getByLabel(t.maximumDealSize, { exact: true });
  await value
    .getByRole("slider", { name: t.uiRefresh.minimumSlider })
    .press("ArrowRight");
  expect(Number(await minimum.inputValue())).toBeGreaterThan(0);
  await expect(cards).toHaveCount(1);
  await maximum.fill("6000");
  await minimum.fill("1000");
  await expect(page).toHaveURL(/maximum=6000/);
  await expect(page).toHaveURL(/minimum=1000/);
  await value
    .getByRole("slider", { name: t.uiRefresh.maximumSlider })
    .press("ArrowLeft");
  expect(Number(await maximum.inputValue())).toBeLessThan(6000);
  expect(Number(await minimum.inputValue())).toBe(1000);
  await expect(names).toHaveText(["Cedar workflow pilot"]);
  await maximum.fill("4000");
  await expect(board).toHaveCount(0);
  await expect(
    page.getByText(t.uiRefresh.noMatchingDeals, { exact: true }),
  ).toBeVisible();
  await maximum.fill("6000");
  await expect(names).toHaveText(["Cedar workflow pilot"]);
  await value.getByRole("button", { name: t.close, exact: true }).click();
  await filters.getByRole("button", { name: t.uiRefresh.hideFilters }).click();
  await page.reload();
  await expect(
    filters.getByRole("button", { name: t.uiRefresh.showFilters }),
  ).toBeVisible();
  await expect(
    filters.getByRole("combobox", { name: t.qualification }),
  ).toHaveCount(0);
  await expect(names).toHaveText(["Cedar workflow pilot"]);
  await filters.getByRole("button", { name: t.uiRefresh.showFilters }).click();
  await filters
    .getByRole("button", { name: t.clearFilters, exact: true })
    .click();
  await expect(cards).toHaveCount(2);
  await expect(page).toHaveURL(/\/opportunities$/);
  await choose(t.product, "Services");
  await expect(board).toHaveCount(1);
  await expect(names).toHaveText(["Cedar workflow pilot"]);
  await page
    .getByRole("button", { name: t.uiRefresh.clearProduct, exact: true })
    .click();
  await expect(board).toHaveCount(1);
  await expect(cards).toHaveCount(2);
  await filters.getByRole("button", { name: t.uiRefresh.hideFilters }).click();
  const switchOrganization = async (current: string, next: string) => {
    await page
      .getByRole("button", {
        name: `${t.switchOrganization}: ${current}`,
        exact: true,
      })
      .click();
    await page.getByRole("menuitemradio", { name: next, exact: true }).click();
  };
  await switchOrganization("Northstar Collective", "Lunar Studio");
  await expect(
    filters.getByRole("button", { name: t.uiRefresh.hideFilters }),
  ).toBeVisible();
  await switchOrganization("Lunar Studio", "Northstar Collective");
  await expect(
    filters.getByRole("button", { name: t.uiRefresh.showFilters }),
  ).toBeVisible();
  await filters.getByRole("button", { name: t.uiRefresh.showFilters }).click();
  await expect(cards).toHaveCount(2);
  await page.screenshot({
    animations: "disabled",
    path: ".data/ui-review-board-filters.png",
  });
  expect(errors).toEqual([]);
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
  const search = page.getByRole("searchbox", { name: t.search, exact: true });
  await search.fill(name);
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
  await search.fill(name);
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
  const companySelectStyle = await inspector
    .getByLabel(t.company, { exact: true })
    .evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        rightPadding: Number.parseFloat(computed.paddingRight),
        chevron: computed.backgroundImage,
      };
    });
  expect(companySelectStyle.rightPadding).toBeGreaterThanOrEqual(30);
  expect(companySelectStyle.chevron).not.toBe("none");
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
  const supportingWork = inspector.getByRole("heading", {
    name: t.actions,
    exact: true,
  });
  const narrowHistoryBox = await history.boundingBox();
  const narrowWorkBox = await supportingWork.boundingBox();
  const narrowNotesBox = await notes.boundingBox();
  if (!narrowHistoryBox || !narrowWorkBox || !narrowNotesBox)
    throw new Error("Missing narrow preparation layout");
  expect(narrowWorkBox.y).toBeGreaterThan(
    narrowHistoryBox.y + narrowHistoryBox.height,
  );
  expect(narrowNotesBox.y).toBeGreaterThan(narrowWorkBox.y);
  await page.screenshot({
    animations: "disabled",
    path: ".data/contact-preparation-narrow.png",
  });
  await page.setViewportSize({ width: 1280, height: 900 });

  await inspector.getByRole("button", { name: t.expandInspector }).click();
  const historyBox = await history.boundingBox();
  const notesBox = await notes.boundingBox();
  const workBox = await supportingWork.boundingBox();
  if (!historyBox || !notesBox || !workBox)
    throw new Error("Missing preparation layout");
  expect(workBox.x).toBeGreaterThan(historyBox.x + historyBox.width);
  expect(notesBox.x).toBeGreaterThan(historyBox.x + historyBox.width);
  expect(notesBox.y).toBeGreaterThan(workBox.y);
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

test("draft actions share a compact toolbar and stay usable while scheduling at every width", async ({
  page,
  request,
}) => {
  const title = `Fictional toolbar review ${crypto.randomUUID().slice(0, 8)}`;
  const headers = { Origin: String(test.info().project.use.baseURL) };
  const created = await request.post("/api/crm", {
    headers,
    data: {
      operation: "person",
      organizationId: demoId(1),
      productId: demoId(10),
      name: title,
      purpose: "buyer",
      review: false,
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { relationshipId } = await created.json();
  const scheduled = await request.post("/api/crm", {
    headers,
    data: {
      operation: "schedule",
      organizationId: demoId(1),
      productId: demoId(10),
      relationshipId,
      ownerId: "demo-you",
      kind: "reply",
      channel: "gmail",
      owedBy: "us",
      title,
      dueAt: new Date().toISOString(),
    },
  });
  expect(scheduled.ok(), await scheduled.text()).toBe(true);

  await page.goto("/actions");
  await expect(page.locator(".live-status")).toHaveClass(/sync-live/);
  await page
    .getByRole("button", { name: new RegExp(title) })
    .first()
    .click();
  const inspector = page.locator("#record-inspector");
  const draftTab = inspector.getByRole("tab", { name: t.draft, exact: true });
  await draftTab.click();
  await expect(draftTab).toHaveAttribute("aria-selected", "true");
  const panel = inspector.locator(".draft-panel");
  const toolbar = panel.getByRole("group", { name: t.draftFlow.actions });
  const save = toolbar.getByRole("button", { name: t.saveDraft, exact: true });
  const approve = toolbar.getByRole("button", {
    name: t.approveDraft,
    exact: true,
  });
  const schedule = toolbar.getByRole("button", {
    name: t.draftFlow.schedule,
    exact: true,
  });
  const send = toolbar.getByRole("button", {
    name: t.touchVerbs.send,
    exact: true,
  });
  const editor = panel.getByRole("textbox", { name: t.draftLabel });
  await expect(panel.locator(".draft-state")).toHaveText(t.draftFlow.empty);
  await editor.fill("Hello, here is the fictional review agenda we discussed.");
  await expect(save).toBeEnabled();
  await expect(approve).toBeDisabled();
  await expect(schedule).toBeDisabled();
  await expect(send).toBeDisabled();
  await editor.press("ControlOrMeta+Enter");
  await expect(approve).toBeEnabled();
  await expect(schedule).toBeEnabled();
  await expect(save).toBeDisabled();
  await expect(send).toBeDisabled();

  const expectToolbarFit = async (oneRow: boolean) => {
    const geometry = await toolbar.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const buttons = [...element.querySelectorAll("button")].map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          label: button.textContent,
          top: rect.top,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
        };
      });
      return {
        composerWidth: element.closest(".draft-panel")?.clientWidth,
        toolbarWidth: bounds.width,
        display: getComputedStyle(element).display,
        buttons,
        oneRow:
          Math.max(...buttons.map((button) => button.top)) -
            Math.min(...buttons.map((button) => button.top)) <=
          1,
        fits:
          element.scrollWidth <= element.clientWidth + 1 &&
          buttons.every(
            (button) =>
              button.left >= bounds.left && button.right <= bounds.right + 1,
          ),
        pageFits: document.documentElement.scrollWidth <= window.innerWidth,
      };
    });
    const detail = JSON.stringify(geometry);
    expect(geometry.fits, detail).toBe(true);
    expect(geometry.pageFits, detail).toBe(true);
    expect(geometry.oneRow, detail).toBe(oneRow);
    if (!oneRow) expect(geometry.display, detail).toBe("grid");
  };
  const resize = page.getByRole("separator", { name: t.resizeInspector });
  await resize.dblclick();
  for (const width of [480, 440, 400]) {
    while (Number(await resize.getAttribute("aria-valuenow")) > width)
      await resize.press("ArrowRight");
    await expectToolbarFit(true);
    if (width === 400) {
      const originalPadding = await inspector.evaluate((element) => {
        const previous = element.style.paddingRight;
        element.style.paddingRight = `${Number.parseFloat(getComputedStyle(element).paddingRight) + 15}px`;
        return previous;
      });
      try {
        await expectToolbarFit(true);
      } finally {
        await inspector.evaluate((element, padding) => {
          element.style.paddingRight = padding;
        }, originalPadding);
      }
    }
    if (width === 480) {
      await expect(
        inspector.getByRole("tab", { name: t.draft, exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await page.screenshot({
        animations: "disabled",
        type: "jpeg",
        quality: 85,
        path: ".data/draft-toolbar-inspector-light.jpg",
      });
    }
  }
  await page.setViewportSize({ width: 945, height: 900 });
  await expectToolbarFit(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await inspector.getByRole("button", { name: t.expandInspector }).click();
  await expectToolbarFit(true);
  const workspace = inspector.locator(".contact-draft-workspace");
  const history = workspace.getByRole("region", {
    name: t.contactWorkspace.history,
    exact: true,
  });
  const emptyWorkspace = await workspace.boundingBox();
  const emptyComposer = await panel.boundingBox();
  if (!emptyWorkspace || !emptyComposer)
    throw new Error("Missing empty draft workspace");
  expect(emptyComposer.width).toBeGreaterThanOrEqual(emptyWorkspace.width - 2);
  await page.screenshot({
    animations: "disabled",
    path: ".data/draft-toolbar-expanded-empty.png",
  });
  const imported = await request.post("/api/crm", {
    headers,
    data: {
      operation: "ingest-history",
      organizationId: demoId(1),
      productId: demoId(10),
      relationshipId,
      channel: "gmail",
      sourceThreadId: title,
      messages: [
        {
          sourceMessageId: `${title}-outgoing`,
          direction: "outbound",
          body: "Could we review the fictional rollout agenda together?",
          occurredAt: new Date(Date.now() - 120_000).toISOString(),
        },
        {
          sourceMessageId: `${title}-incoming`,
          direction: "inbound",
          body: "Yes, please include the rollout plan in our review.",
          occurredAt: new Date(Date.now() - 60_000).toISOString(),
        },
      ],
    },
  });
  expect(imported.ok(), await imported.text()).toBe(true);
  await expect(history.locator("article")).toHaveCount(2, { timeout: 10_000 });
  const populatedHistory = await history.boundingBox();
  const populatedComposer = await panel.boundingBox();
  if (!populatedHistory || !populatedComposer)
    throw new Error("Missing populated draft workspace");
  expect(populatedComposer.x).toBeGreaterThan(
    populatedHistory.x + populatedHistory.width,
  );
  await expectToolbarFit(true);
  await expect(draftTab).toHaveAttribute("aria-selected", "true");
  await page.screenshot({
    animations: "disabled",
    type: "jpeg",
    quality: 85,
    path: ".data/draft-toolbar-expanded-light.jpg",
  });
  await page.setViewportSize({ width: 1100, height: 900 });
  const navigationResize = page.getByRole("separator", {
    name: t.resizeNavigation,
  });
  await navigationResize.press("End");
  const narrowWorkspace = await workspace.boundingBox();
  const narrowComposer = await panel.boundingBox();
  const narrowHistory = await history.boundingBox();
  if (!narrowWorkspace || !narrowComposer || !narrowHistory)
    throw new Error("Missing narrow draft workspace");
  expect(narrowWorkspace.width).toBeLessThan(800);
  expect(narrowComposer.width).toBeGreaterThanOrEqual(
    narrowWorkspace.width - 2,
  );
  expect(narrowComposer.y).toBeGreaterThan(
    narrowHistory.y + narrowHistory.height,
  );
  await expectToolbarFit(true);
  await page.screenshot({
    animations: "disabled",
    path: ".data/draft-toolbar-narrow-workspace.png",
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await navigationResize.dblclick();
  await page.getByRole("button", { name: t.toggleTheme }).click();
  await expectToolbarFit(true);
  for (const width of [700, 480, 360, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expectToolbarFit(width >= 480);
    await schedule.scrollIntoViewIfNeeded();
    await schedule.click();
    const dialog = page.getByRole("dialog", {
      name: t.draftFlow.scheduleTitle,
    });
    const due = dialog.getByLabel(t.nativeIngestion.dueAt, { exact: true });
    await expect(due).toBeFocused();
    const fit = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        width: element.scrollWidth <= element.clientWidth + 1,
        viewport: rect.left >= 0 && rect.right <= window.innerWidth,
      };
    });
    expect(fit.width).toBe(true);
    expect(fit.viewport).toBe(true);
    await due.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(schedule).toBeFocused();
  }
  await expect(draftTab).toHaveAttribute("aria-selected", "true");
  await page.screenshot({
    animations: "disabled",
    type: "jpeg",
    quality: 85,
    path: ".data/draft-toolbar-mobile-dark.jpg",
  });
  await approve.click();
  await expect(approve).toHaveCount(0);
  await expect(send).toBeEnabled();
  await expectToolbarFit(false);
  await editor.fill("A changed fictional agenda that needs fresh approval.");
  await expect(save).toBeEnabled();
  await expect(schedule).toBeDisabled();
  await expect(send).toBeDisabled();
});
