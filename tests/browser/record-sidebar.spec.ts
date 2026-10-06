import { expect, test } from "@playwright/test";
import { demoId } from "../../packages/database/seed";

test("records and files share a persistent resizable inspector", async ({
  page,
  request,
}) => {
  await page.goto("/people");
  const list = page.locator("#records-panel table");
  await list.evaluate((element) =>
    element.setAttribute("data-preserved", "true"),
  );
  await page.getByRole("link", { name: "Mira Chen", exact: true }).click();
  const panel = page.locator("#record-inspector");
  await expect(
    panel.getByRole("heading", { name: "Mira Chen", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/people$/);
  const resize = page.getByRole("separator", { name: "Resize detail panel" });
  const before = await panel.boundingBox();
  const grip = await resize.boundingBox();
  if (!before || !grip) throw new Error("Missing inspector geometry");
  await resize.hover();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x - 100, grip.y + grip.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await panel.boundingBox())?.width)
    .toBeGreaterThan(before.width + 50);
  const width = (await panel.boundingBox())?.width;
  await page
    .getByRole("link", { name: "Jonah Reed", exact: true })
    .press("Enter");
  await expect(
    panel.getByRole("heading", { name: "Jonah Reed", exact: true }),
  ).toBeVisible();
  await expect(list).toHaveAttribute("data-preserved", "true");
  expect((await panel.boundingBox())?.width).toBe(width);
  await panel
    .getByRole("button", { name: "Harbor Analytics", exact: true })
    .first()
    .click();
  await expect(
    panel.getByRole("heading", { name: "Harbor Analytics", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/people$/);
  await panel.getByRole("button", { name: /Jonah Reed/ }).click();
  await expect(
    panel.getByRole("heading", { name: "Jonah Reed", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Expand detail panel" }).click();
  await expect(page.locator(".workspace-content")).toHaveClass(
    /inspector-expanded/,
  );
  await panel.getByRole("button", { name: "Restore split view" }).click();
  const scope = { organizationId: demoId(1), productId: demoId(10) };
  const names: string[] = [];
  for (const index of [1, 2]) {
    const name = `Panel document ${index} ${crypto.randomUUID()}`;
    names.push(name);
    const response = await request.post("/api/files", {
      headers: { Origin: String(test.info().project.use.baseURL) },
      data: {
        ...scope,
        operation: "create",
        kind: "markdown",
        name,
        body: `# Preview ${index}\n\n[Person](/people/${demoId(200)})`,
        visibility: "private",
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
  await page.goto("/files");
  for (const [index, name] of names.entries()) {
    await page
      .getByRole("treeitem")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(
      panel.getByRole("heading", { name: `Preview ${index + 1}`, exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/files$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await expect(
    page
      .getByRole("treeitem")
      .getByRole("button", { name: names[0], exact: true }),
  ).toBeVisible();
  await panel.getByRole("link", { name: "Person", exact: true }).click();
  await expect(
    panel.getByRole("heading", { name: "Mira Chen", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/files$/);
  await panel.getByRole("button", { name: "Back to previous record" }).click();
  await expect(
    panel.getByRole("heading", { name: "Preview 2", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Edit Markdown" }).click();
  await panel.getByLabel("Markdown source").fill("# Saved in the panel");
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    panel.getByRole("heading", { name: "Saved in the panel" }),
  ).toBeVisible();
});

test("the inspector stays on the right and resizes on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await page.goto("/people");
  await page.getByRole("link", { name: "Mira Chen", exact: true }).click();
  const panel = page.locator("#record-inspector");
  await expect(
    panel.getByRole("heading", { name: "Mira Chen", exact: true }),
  ).toBeVisible();
  const box = await panel.boundingBox();
  if (!box) throw new Error("Inspector missing");
  expect(box.x + box.width).toBeCloseTo(692, 0);
  const resize = page.getByRole("separator", { name: "Resize detail panel" });
  await expect(resize).toBeVisible();
  await resize.press("ArrowLeft");
  await expect
    .poll(async () => (await panel.boundingBox())?.width)
    .toBeGreaterThan(box.width);
  await panel.getByRole("button", { name: "Expand detail panel" }).click();
  await expect.poll(async () => (await panel.boundingBox())?.width).toBe(684);
  await panel.getByRole("button", { name: "Restore split view" }).click();
  await expect(page).toHaveURL(/\/people$/);
});
