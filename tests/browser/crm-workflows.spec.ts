import { mkdir } from "node:fs/promises";
import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import type { ClientContext, ClientSnapshot } from "../../packages/core/dto";
import { demoId } from "../../packages/database/seed";
import t from "../../packages/i18n/translations/en.json" with { type: "json" };

const scope = { organizationId: demoId(1), productId: demoId(10) };
const screenshotDirectory = ".data/crm-workflows";
test.use({
  actionTimeout: 15_000,
  navigationTimeout: 60_000,
  trace: "retain-on-failure",
  screenshot: "only-on-failure",
});
interface Person {
  personId: string;
  relationshipId: string;
  productId: string;
}
interface Draft {
  id: string;
  version: number;
  title: string;
  body: string;
  sourceHash: string;
  scheduledActionId: string | null;
}

async function post<T>(
  request: APIRequestContext,
  operation: string,
  input: object,
): Promise<T> {
  const response = await request.post("/api/crm", {
    headers: { Origin: String(test.info().project.use.baseURL) },
    data: { ...scope, operation, ...input },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function read<T>(
  request: APIRequestContext,
  operation: string,
  input: Record<string, string> = {},
): Promise<T> {
  const response = await request.get(
    `/api/crm?${new URLSearchParams({ ...scope, operation, ...input })}`,
  );
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function createPerson(request: APIRequestContext, name: string) {
  return post<Person>(request, "person", {
    name,
    email: `browser-${crypto.randomUUID()}@example.test`,
    purpose: "buyer",
    ownerId: "demo-you",
    review: false,
  });
}
const context = (request: APIRequestContext, person: Person) =>
  read<ClientContext>(request, "context", {
    relationshipId: person.relationshipId,
  });
const drafts = (request: APIRequestContext, person: Person) =>
  read<{ items: Draft[] }>(request, "native-drafts", {
    relationshipId: person.relationshipId,
  });
async function workspaceZone(request: APIRequestContext) {
  const organizations = await read<{ id: string; timezone: string }[]>(
    request,
    "organizations",
  );
  const organization = organizations.find(
    (item) => item.id === scope.organizationId,
  );
  if (!organization) throw new Error("Fictional workspace missing");
  return organization.timezone;
}
function localInput(instant: string, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond}`;
}
const editor = (page: Page, title: string) =>
  page.getByRole(
    [
      t.nativeIngestion.addHistory,
      t.nativeIngestion.addDraft,
      t.nativeIngestion.edit,
      t.nativeIngestion.schedule,
    ].includes(title)
      ? "dialog"
      : "region",
    { name: title, exact: true },
  );
async function screenshots(page: Page, name: string) {
  await mkdir(screenshotDirectory, { recursive: true });
  const viewport = page.viewportSize();
  if (name === "native-history-drafts" && viewport) {
    await page.setViewportSize({ ...viewport, height: 1100 });
  }
  const dismiss = page
    .getByRole("region", { name: t.notifications, exact: true })
    .getByRole("button", { name: t.dismiss, exact: true });
  while (await dismiss.count()) await dismiss.first().click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  await page.screenshot({
    animations: "disabled",
    path: `${screenshotDirectory}/${name}-light.png`,
  });
  await page.getByRole("button", { name: t.toggleTheme, exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.screenshot({
    animations: "disabled",
    path: `${screenshotDirectory}/${name}-dark.png`,
  });
  await page.getByRole("button", { name: t.toggleTheme, exact: true }).click();
  if (viewport) await page.setViewportSize(viewport);
}
function monitor(page: Page) {
  const errors: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().includes("/api/")) return;
    const body = request.postData();
    if (body)
      writes.push((JSON.parse(body) as { operation: string }).operation);
  });
  return { errors, writes };
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() =>
    localStorage.setItem("gravity-theme", "light"),
  );
});

test("native history and undated drafts persist through the UI, and legacy reasons can be replaced without approval or dispatch", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const monitored = monitor(page);
  const suffix = crypto.randomUUID().slice(0, 8);
  const person = await createPerson(
    request,
    `Fictional native workflow ${suffix}`,
  );
  const zone = await workspaceZone(request);
  const before = await context(request, person);
  await page.goto(
    `/people/${person.personId}?relationship=${person.relationshipId}`,
  );
  await page
    .getByRole("tab", { name: t.contactWorkspace.overview, exact: true })
    .click();
  const native = page.getByRole("region", {
    name: t.nativeIngestion.title,
    exact: true,
  });
  await native
    .getByRole("button", { name: t.nativeIngestion.addHistory, exact: true })
    .click();
  const historyEditor = editor(page, t.nativeIngestion.addHistory);
  await historyEditor
    .getByLabel(t.nativeIngestion.sourceThread, { exact: true })
    .fill(`fictional-browser-thread-${suffix}`);
  await historyEditor
    .getByLabel(t.nativeIngestion.sourceMessage, { exact: true })
    .fill(`fictional-browser-message-${suffix}`);
  const occurredAt = "2025-01-01T12:34:56.789Z";
  await historyEditor
    .getByLabel(t.nativeIngestion.occurredAt, { exact: true })
    .fill(localInput(occurredAt, zone));
  await historyEditor
    .getByRole("textbox", { name: t.nativeIngestion.body, exact: true })
    .fill("Fictional historical evaluation request.");
  await historyEditor
    .getByRole("button", { name: t.nativeIngestion.record, exact: true })
    .click();
  await expect(historyEditor).toHaveCount(0);
  const history = page.getByRole("region", {
    name: t.contactWorkspace.history,
    exact: true,
  });
  await expect(history.locator(`time[datetime="${occurredAt}"]`)).toContainText(
    "56.789",
  );
  await expect(
    history.getByText(t.nativeIngestion.historySource, { exact: true }),
  ).toBeVisible();
  const imported = await context(request, person);
  expect(imported.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ occurredAt, provenance: "native" }),
    ]),
  );
  expect(imported.conversations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        visibility: "private",
        ownerId: "demo-you",
        provenance: "native",
      }),
    ]),
  );
  expect(imported.actions).toEqual(before.actions);

  await native
    .getByRole("button", { name: t.nativeIngestion.addDraft, exact: true })
    .click();
  const draftEditor = editor(page, t.nativeIngestion.addDraft);
  const draftTitle = `Fictional undated preparation ${suffix}`;
  const originalReason =
    '{"context":"Fictional legacy import","send_permission":true}';
  await draftEditor
    .getByLabel(t.nativeIngestion.sourceDraft, { exact: true })
    .fill(`fictional-browser-draft-${suffix}`);
  await draftEditor.getByLabel(t.actionTitle, { exact: true }).fill(draftTitle);
  await draftEditor
    .getByRole("textbox", { name: t.reason, exact: true })
    .fill(originalReason);
  await draftEditor
    .getByRole("textbox", { name: t.nativeIngestion.draftBody, exact: true })
    .fill("Subject: Fictional review\n\nA fictional unscheduled draft.");
  await draftEditor
    .getByRole("button", { name: t.nativeIngestion.saveDraft, exact: true })
    .click();
  await expect(draftEditor).toHaveCount(0);
  const card = native.locator("article").filter({ hasText: draftTitle });
  await expect(
    card.getByText(t.nativeIngestion.undated, { exact: true }),
  ).toBeVisible();
  const [undated] = (await drafts(request, person)).items;
  expect(undated.scheduledActionId).toBeNull();
  expect(undated).not.toHaveProperty("dueAt");
  expect((await context(request, person)).actions).toEqual(before.actions);

  await card
    .getByRole("button", { name: t.nativeIngestion.edit, exact: true })
    .click();
  const editDraft = editor(page, t.nativeIngestion.edit);
  const editedTitle = `Fictional edited preparation ${suffix}`;
  const editedBody =
    "Subject: Fictional reviewed draft\n\nUpdated fictional preparation.";
  await editDraft.getByLabel(t.actionTitle, { exact: true }).fill(editedTitle);
  await expect(editDraft).toHaveAccessibleName(t.nativeIngestion.edit);
  await editDraft
    .getByRole("textbox", { name: t.nativeIngestion.draftBody, exact: true })
    .fill(editedBody);
  await editDraft
    .getByRole("button", { name: t.nativeIngestion.saveDraft, exact: true })
    .click();
  await expect(editDraft).toHaveCount(0);
  const editedCard = native.locator("article").filter({ hasText: editedTitle });
  await expect(editedCard).toContainText(editedBody);
  const [edited] = (await drafts(request, person)).items;
  expect(edited).toMatchObject({
    id: undated.id,
    version: 2,
    sourceHash: undated.sourceHash,
    scheduledActionId: null,
  });
  await editedCard
    .getByRole("button", { name: t.nativeIngestion.schedule, exact: true })
    .click();
  const scheduler = editor(page, t.nativeIngestion.schedule);
  const dueAt = `${new Date().getUTCFullYear() + 4}-03-04T04:30:18.125Z`;
  await scheduler
    .getByLabel(t.nativeIngestion.dueAt, { exact: true })
    .fill(localInput(dueAt, zone));
  await scheduler
    .getByRole("button", { name: t.nativeIngestion.schedule, exact: true })
    .click();
  await expect(scheduler).toHaveCount(0);
  await expect(
    editedCard.getByText(t.nativeIngestion.scheduled, { exact: true }),
  ).toBeVisible();
  const [scheduled] = (await drafts(request, person)).items;
  const scheduledAction = (await context(request, person)).actions.find(
    (action) => action.id === scheduled.scheduledActionId,
  );
  expect(scheduledAction).toMatchObject({
    title: editedTitle,
    draft: editedBody,
    reason: originalReason,
    dueAt,
    approvedHash: null,
    approvedBy: null,
    status: "open",
  });

  await page.goto(
    `/people/${person.personId}?relationship=${person.relationshipId}&action=${scheduled.scheduledActionId}`,
  );
  await page
    .getByRole("tab", { name: t.contactWorkspace.overview, exact: true })
    .click();
  await page
    .getByRole("button", { name: t.actionReasons.edit, exact: true })
    .click();
  const reason = page.getByRole("textbox", { name: t.reason, exact: true });
  await expect(reason).toHaveValue(originalReason);
  await reason.fill("Review the fictional request before preparing a reply.");
  await reason
    .locator("..")
    .locator("..")
    .getByRole("button", { name: t.save, exact: true })
    .click();
  await expect(reason).toHaveCount(0);
  await expect(
    page.getByText(t.actionReasons.original, { exact: true }),
  ).toBeVisible();
  const reviewed = (await context(request, person)).actions.find(
    (action) => action.id === scheduled.scheduledActionId,
  );
  expect(reviewed).toMatchObject({
    reason: "Review the fictional request before preparing a reply.",
    reasonSource: originalReason,
    approvedHash: null,
    approvedBy: null,
    dueAt,
    status: "open",
  });
  await native.scrollIntoViewIfNeeded();
  await screenshots(page, "native-history-drafts");
  await page.reload();
  await page
    .getByRole("tab", { name: t.contactWorkspace.overview, exact: true })
    .click();
  await expect(native.getByText(editedTitle, { exact: true })).toBeVisible();
  expect(monitored.writes).toEqual(
    expect.arrayContaining([
      "ingest-history",
      "ingest-draft",
      "edit-native-draft",
      "schedule-native-draft",
      "action-details",
    ]),
  );
  expect(
    monitored.writes.filter((operation) =>
      ["send-action", "send-touch"].includes(operation),
    ),
  ).toEqual([]);
  expect(monitored.errors).toEqual([]);
});

test("a monthly internal task preserves exact local time and its month-end anchor without dispatch", async ({
  page,
  request,
}) => {
  const monitored = monitor(page);
  const title = `Fictional month-end preparation ${crypto.randomUUID().slice(0, 8)}`;
  const year = new Date().getUTCFullYear() + 2;
  const january = `${year}-01-31T04:30:18.125Z`;
  const february = `${year}-02-${new Date(Date.UTC(year, 2, 0)).getUTCDate()}T04:30:18.125Z`;
  const march = `${year}-03-31T04:30:18.125Z`;
  const before = await read<ClientSnapshot>(request, "snapshot");
  await page.goto("/actions");
  await page.getByRole("button", { name: t.allProducts, exact: true }).click();
  const tasks = page.getByRole("region", {
    name: t.internalTasks.heading,
    exact: true,
  });
  await tasks
    .getByRole("button", { name: t.internalTasks.new, exact: true })
    .click();
  const taskEditor = editor(page, t.internalTasks.new);
  await taskEditor
    .getByRole("combobox", { name: t.product, exact: true })
    .selectOption(scope.productId);
  await taskEditor.getByLabel(t.actionTitle, { exact: true }).fill(title);
  await expect(taskEditor).toHaveAccessibleName(t.internalTasks.new);
  await taskEditor
    .getByRole("textbox", { name: t.internalTasks.description, exact: true })
    .fill("Fictional internal review; no customer message.");
  await taskEditor
    .getByLabel(t.internalTasks.timeZone, { exact: true })
    .fill("Asia/Kolkata");
  await taskEditor
    .getByLabel(t.internalTasks.dueAt, { exact: true })
    .fill(`${year}-01-31T10:00:18.125`);
  await taskEditor
    .getByRole("combobox", { name: t.internalTasks.frequency, exact: true })
    .selectOption("monthly");
  await taskEditor
    .getByLabel(t.internalTasks.interval, { exact: true })
    .fill("1");
  await taskEditor.getByRole("button", { name: t.save, exact: true }).click();
  await expect(taskEditor).toHaveCount(0);
  const taskCard = tasks.locator("article").filter({ hasText: title });
  await expect(taskCard.locator(`time[datetime="${january}"]`)).toContainText(
    "18.125",
  );
  await taskCard
    .getByRole("button", { name: t.internalTasks.complete, exact: true })
    .click();
  await expect(taskCard.locator(`time[datetime="${february}"]`)).toContainText(
    "18.125",
  );
  let task = (
    await read<ClientSnapshot["internalTasks"]>(request, "internal-tasks")
  ).find((item) => item.title === title);
  expect(task).toMatchObject({
    status: "open",
    relationshipId: null,
    version: 2,
    recurrence: { frequency: "monthly", interval: 1, anchorDay: 31 },
  });
  await taskCard
    .getByRole("button", { name: t.internalTasks.complete, exact: true })
    .click();
  await expect(taskCard.locator(`time[datetime="${march}"]`)).toBeVisible();
  task = (
    await read<ClientSnapshot["internalTasks"]>(request, "internal-tasks")
  ).find((item) => item.title === title);
  expect(task).toMatchObject({
    status: "open",
    version: 3,
    dueAt: march,
  });
  const after = await read<ClientSnapshot>(request, "snapshot");
  expect(after.actions).toEqual(before.actions);
  expect(after.messageStats).toEqual(before.messageStats);
  expect(after.touchStats).toEqual(before.touchStats);
  await taskCard.scrollIntoViewIfNeeded();
  await screenshots(page, "monthly-internal-task");
  await page.reload();
  await expect(taskCard.locator(`time[datetime="${march}"]`)).toBeVisible();
  expect(
    monitored.writes.filter((operation) =>
      ["send-action", "send-touch"].includes(operation),
    ),
  ).toEqual([]);
  expect(monitored.errors).toEqual([]);
});

test("precise custom fields and product-wide filters preserve numeric zero, false and milliseconds", async ({
  page,
  request,
}) => {
  const monitored = monitor(page);
  const suffix = crypto.randomUUID().slice(0, 8);
  const name = `Fictional field workflow ${suffix}`;
  const person = await createPerson(request, name);
  const zone = await workspaceZone(request);
  await page.goto(
    `/people/${person.personId}?relationship=${person.relationshipId}`,
  );
  await page
    .getByRole("tab", { name: t.contactWorkspace.context, exact: true })
    .click();
  await page
    .getByRole("button", { name: t.contextFields.edit, exact: true })
    .click();
  const fieldEditor = editor(page, t.contextFields.edit);
  for (const [index, field] of [
    { label: `Seats ${suffix}`, type: "number", value: "0" },
    { label: `Verified ${suffix}`, type: "boolean", value: "false" },
    {
      label: `Review time ${suffix}`,
      type: "datetime",
      value: localInput("2030-03-04T04:30:18.125Z", zone),
    },
  ].entries()) {
    await fieldEditor
      .getByRole("button", { name: t.contextFields.addField, exact: true })
      .click();
    const group = fieldEditor.getByRole("group", {
      name: `${t.contextFields.field} ${index + 1}`,
      exact: true,
    });
    await group.getByLabel(t.name, { exact: true }).fill(field.label);
    await group
      .getByRole("combobox", { name: t.contextFields.fieldType, exact: true })
      .selectOption(field.type);
    if (field.type === "boolean")
      await group
        .getByRole("combobox", { name: t.contextFields.value, exact: true })
        .selectOption(field.value);
    else
      await group
        .getByLabel(t.contextFields.value, { exact: true })
        .fill(field.value);
  }
  await fieldEditor.getByRole("button", { name: t.save, exact: true }).click();
  await expect(fieldEditor).toHaveCount(0);
  expect(
    (await context(request, person)).relationship.contextDetails.fields,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        label: `Seats ${suffix}`,
        type: "number",
        value: 0,
      }),
      expect.objectContaining({
        label: `Verified ${suffix}`,
        type: "boolean",
        value: false,
      }),
      expect.objectContaining({
        label: `Review time ${suffix}`,
        type: "datetime",
        value: "2030-03-04T04:30:18.125Z",
      }),
    ]),
  );
  await page.goto("/people");
  await page.getByRole("button", { name: t.allProducts, exact: true }).click();
  await page.locator(".record-filters > summary").click();
  const filters = page.locator(".record-filters");
  for (const [index, field] of [
    { key: `number:seats ${suffix}`, type: "number", value: "0" },
    { key: `boolean:verified ${suffix}`, type: "boolean", value: "false" },
    {
      key: `datetime:review time ${suffix}`,
      type: "datetime",
      value: localInput("2030-03-04T04:30:18.125Z", zone),
    },
  ].entries()) {
    await filters
      .getByRole("button", { name: t.contextFields.addField, exact: true })
      .click();
    const group = filters.getByRole("group", {
      name: `${t.fieldFilters.field} ${index + 1}`,
      exact: true,
    });
    await group
      .getByRole("combobox", { name: t.fieldFilters.field, exact: true })
      .selectOption(field.key);
    if (field.type === "boolean")
      await group
        .getByRole("combobox", { name: t.fieldFilters.value, exact: true })
        .selectOption(field.value);
    else
      await group
        .getByLabel(t.fieldFilters.value, { exact: true })
        .fill(field.value);
  }
  const list = page.locator("#records-panel table");
  await expect(list.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(list.locator("tbody tr")).toHaveCount(1);
  const datetimeFilter = filters.getByRole("group", {
    name: `${t.fieldFilters.field} 3`,
    exact: true,
  });
  await datetimeFilter
    .getByLabel(t.fieldFilters.value, { exact: true })
    .fill(localInput("2030-03-04T04:30:18.124Z", zone));
  await expect(list.getByRole("link", { name, exact: true })).toHaveCount(0);
  await datetimeFilter
    .getByRole("combobox", { name: t.fieldFilters.operator, exact: true })
    .selectOption("gt");
  await expect(list.getByRole("link", { name, exact: true })).toBeVisible();
  await screenshots(page, "precise-field-filters");
  expect(monitored.errors).toEqual([]);
});
