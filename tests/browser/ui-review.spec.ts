import { expect, test } from "@playwright/test";
import t from "../../packages/i18n/translations/en.json" with { type: "json" };

const screenshot = async (
  page: import("@playwright/test").Page,
  name: string,
) =>
  page.screenshot({
    animations: "disabled",
    path: `.data/ui-review-${name}.png`,
  });

test("product, pipeline and sequence setup keep their page, protect drafts and use inline forms", async ({
  page,
}) => {
  await page.goto("/people");
  await page
    .getByRole("button", { name: t.newProduct, exact: true })
    .first()
    .click();
  const product = page.getByRole("region", { name: t.newProduct, exact: true });
  await expect(product).toBeVisible();
  await product.getByLabel(t.productName).fill("Fictional product draft");
  await page.getByRole("link", { name: t.companies, exact: true }).click();
  await expect(page).toHaveURL(/\/people$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await screenshot(page, "product-inline");
  await product.getByRole("button", { name: t.cancel, exact: true }).click();
  await page.goto("/opportunities");
  await page.getByRole("button", { name: t.newPipeline, exact: true }).click();
  const pipeline = page.getByRole("region", {
    name: t.newPipeline,
    exact: true,
  });
  await pipeline
    .getByLabel(t.name, { exact: true })
    .fill("Fictional pipeline draft");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await screenshot(page, "pipeline-inline");
  await page.getByRole("button", { name: t.toggleTheme }).click();
  await screenshot(page, "pipeline-inline-dark");
  await page.getByRole("button", { name: t.toggleTheme }).click();
  await pipeline.getByRole("button", { name: t.cancel, exact: true }).click();
  await page.goto("/outreach/sequences");
  await page.getByRole("button", { name: t.newSequence, exact: true }).click();
  const sequence = page.getByRole("region", {
    name: t.newSequence,
    exact: true,
  });
  await sequence.getByLabel(t.sequenceName).fill("Fictional sequence draft");
  await sequence.getByRole("button", { name: t.addStep, exact: true }).click();
  await expect(
    sequence.getByRole("group", { name: t.stepLabel.replace("{number}", "2") }),
  ).toBeVisible();
  await page.getByRole("link", { name: t.companies, exact: true }).click();
  await expect(page).toHaveURL(/\/outreach\/sequences$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await screenshot(page, "sequence-inline");
  await page.setViewportSize({ width: 560, height: 900 });
  await screenshot(page, "sequence-narrow");
  const overflow = await sequence.evaluate(
    (element) => element.scrollWidth > element.clientWidth + 2,
  );
  expect(overflow).toBe(false);
  await sequence.getByRole("button", { name: t.cancel, exact: true }).click();
});

test("outreach editing and status forms stay inline, while actual sending remains an explicit dialog", async ({
  page,
}) => {
  await page.goto("/outreach/today");
  const rowAction = async (name: string) => {
    const button = page.getByRole("button", { name, exact: true });
    const row = page.locator(".touch-row").filter({ has: button });
    await row.hover({ timeout: 5000 });
    await expect(row.locator(".touch-actions")).toHaveCSS(
      "pointer-events",
      "auto",
    );
    await button.click({ timeout: 5000 });
  };
  await rowAction(`${t.touchVerbs.edit}: Noor Haddad`);
  const drawer = page.getByRole("region", {
    name: t.draftEditorTitle.replace("{name}", "Noor Haddad"),
  });
  await drawer
    .getByLabel(t.draftLabel)
    .fill("Fictional outreach draft retained in place.");
  await rowAction(`${t.touchVerbs.sent}: Noor Haddad`);
  await expect(page.getByRole("region", { name: t.markSentTitle })).toHaveCount(
    0,
  );
  await drawer.getByRole("button", { name: t.close, exact: true }).click();
  await expect(drawer).toBeVisible();
  await screenshot(page, "outreach-inline");
  await drawer.getByRole("button", { name: t.cancel, exact: true }).click();
  await drawer.getByRole("button", { name: t.close, exact: true }).click();
  await rowAction(`${t.touchVerbs.sent}: Noor Haddad`);
  const sent = page.getByRole("region", { name: t.markSentTitle, exact: true });
  await expect(sent).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await sent.getByRole("button", { name: t.cancel, exact: true }).click();
  await rowAction(`${t.touchVerbs.skip}: Noor Haddad`);
  const skipped = page.getByRole("region", { name: t.skipTitle, exact: true });
  await expect(skipped).toBeVisible();
  await screenshot(page, "outreach-status-inline");
  await skipped.getByRole("button", { name: t.cancel, exact: true }).click();
  const dispatches: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.postData()?.includes('"send-touch"')
    )
      dispatches.push(request.postData() ?? "");
  });
  await rowAction(`${t.touchVerbs.send}: Amara Stone`);
  const sending = page.getByRole("dialog", {
    name: t.sendTitle.replace("{name}", "Amara Stone"),
  });
  await expect(sending).toBeVisible();
  expect(dispatches).toHaveLength(0);
  await sending.getByRole("button", { name: t.cancel, exact: true }).click();
  await expect(sending).toHaveCount(0);
  expect(dispatches).toHaveLength(0);
});

test("retained access, help and command dialogs dismiss safely and restore focus", async ({
  page,
}) => {
  await page.goto("/settings/members");
  const invite = page.getByRole("button", {
    name: t.inviteMember,
    exact: true,
  });
  await invite.click();
  const dialog = page.getByRole("dialog", {
    name: t.inviteMember,
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(dialog).toHaveCount(0);
  await expect(invite).toBeFocused();
  await invite.click();
  await dialog
    .getByLabel(t.emailAddress, { exact: true })
    .fill("fictional@example.test");
  await page.mouse.click(2, 2);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(t.emailAddress, { exact: true })).toHaveValue(
    "fictional@example.test",
  );
  await screenshot(page, "access-confirmation");
  await dialog.getByRole("button", { name: t.cancel, exact: true }).click();
  await page.getByRole("button", { name: t.keyboardHelp, exact: true }).click();
  const guide = page.getByRole("dialog", { name: t.keyboardHelp, exact: true });
  await guide.getByLabel(t.shortcutSearch).fill("folder");
  await page.mouse.click(2, 2);
  await expect(guide).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+k");
  const commands = page.getByRole("dialog", { name: t.commands, exact: true });
  await commands.getByLabel(t.commandSearch).fill("people");
  await page.mouse.click(2, 2);
  await expect(commands).toHaveCount(0);
});

test("company, meeting, board and legacy folder editors remain on their originating page", async ({
  page,
}) => {
  await page.goto("/companies");
  await page.getByRole("link", { name: "Cedar Systems", exact: true }).click();
  const inspector = page.locator("#record-inspector");
  await expect(inspector.getByLabel(t.name, { exact: true })).toHaveValue(
    "Cedar Systems",
  );
  await inspector
    .getByLabel(t.description, { exact: true })
    .fill("Fictional company preparation draft");
  await page.getByRole("link", { name: t.people, exact: true }).click();
  await expect(page).toHaveURL(/\/companies$/);
  await screenshot(page, "company-inline");
  await inspector.getByLabel(t.description, { exact: true }).press("Escape");
  await page.goto("/meetings");
  await page
    .getByRole("button", { name: new RegExp(`^${t.editMeeting}:`) })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/meetings$/);
  await expect(
    inspector.getByRole("region", { name: t.editMeeting, exact: true }),
  ).toBeVisible();
  await screenshot(page, "meeting-inline");
  await inspector.getByRole("button", { name: t.cancel, exact: true }).click();
  await page.goto("/opportunities");
  await page
    .getByRole("button", { name: t.inlineEditing.board, exact: true })
    .click();
  await screenshot(page, "opportunities-board");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/materials");
  await page.getByRole("button", { name: t.newFolder, exact: true }).click();
  const folder = page.getByRole("region", { name: t.newFolder, exact: true });
  await expect(folder).toBeVisible();
  await folder
    .getByLabel(t.folderName, { exact: true })
    .fill("Fictional folder draft");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await screenshot(page, "legacy-folder-inline");
  await folder.getByRole("button", { name: t.cancel, exact: true }).last().click();
});
