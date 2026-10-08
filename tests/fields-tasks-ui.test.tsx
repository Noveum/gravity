// @vitest-environment jsdom
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { eq } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import {
  createInternalTaskSchema,
  InternalTaskService,
} from "../packages/core/internal-tasks";
import { OrganizationSettingsService } from "../packages/core/organization-settings";
import {
  RecordListService,
  recordListSchema,
} from "../packages/core/record-list";
import { emptyRelationshipDetails } from "../packages/core/relationship-context";
import * as s from "../packages/database/schema";
import { demoId, demoUser } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { requestJson } from "../src/components/client-api";
import { installCrmHarness, mountCrm } from "./support/crm-harness";
import { chooseSelect } from "./support/select-control";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
const harness = installCrmHarness();
const scope = { organizationId: demoId(1), productId: demoId(10) };
const principal = { userId: demoUser, source: "demo" as const };

test("product-wide custom field filters preserve false, zero and exact millisecond comparisons", async () => {
  await harness.local.db
    .update(s.relationships)
    .set({
      contextDetails: {
        ...emptyRelationshipDetails(),
        fields: [
          { id: demoId(8950), label: "Seats", type: "number", value: 0 },
          {
            id: demoId(8951),
            label: "Verified",
            type: "boolean",
            value: false,
          },
          {
            id: demoId(8952),
            label: "Review time",
            type: "datetime",
            value: "2030-03-04T04:30:18.125Z",
          },
        ],
      },
    })
    .where(eq(s.relationships.id, demoId(300)));
  await mountCrm(harness, "/people", { compact: true });
  fireEvent.click(
    screen.getByRole("button", { name: t.uiRefresh.customFields }),
  );
  const addFilter = async (position: number, option: string) => {
    fireEvent.click(
      screen.getByRole("button", { name: t.contextFields.addField }),
    );
    const group = within(
      screen.getByRole("group", {
        name: `${t.fieldFilters.field} ${position}`,
      }),
    );
    await chooseSelect(group.getByLabelText(t.fieldFilters.field), option);
    return group;
  };
  const number = await addFilter(
    1,
    `Seats · ${t.contextFields.fieldTypes.number}`,
  );
  fireEvent.change(number.getByLabelText(t.fieldFilters.value), {
    target: { value: "0" },
  });
  expect(screen.getByRole("link", { name: "Mira Chen" })).toBeTruthy();
  const boolean = await addFilter(
    2,
    `Verified · ${t.contextFields.fieldTypes.boolean}`,
  );
  expect(boolean.getByLabelText(t.fieldFilters.value).textContent).toContain(
    t.contextFields.no,
  );
  expect(screen.getByRole("link", { name: "Mira Chen" })).toBeTruthy();
  await chooseSelect(
    boolean.getByLabelText(t.fieldFilters.value),
    t.contextFields.yes,
  );
  expect(screen.queryByRole("link", { name: "Mira Chen" })).toBeNull();
  await chooseSelect(
    boolean.getByLabelText(t.fieldFilters.value),
    t.contextFields.no,
  );
  const datetime = await addFilter(
    3,
    `Review time · ${t.contextFields.fieldTypes.datetime}`,
  );
  expect(datetime.getByLabelText(t.fieldFilters.value)).toHaveProperty(
    "step",
    "0.001",
  );
  expect(screen.getByText(t.fieldFilters.invalid)).toHaveProperty(
    "role",
    "alert",
  );
  fireEvent.change(datetime.getByLabelText(t.fieldFilters.value), {
    target: { value: "2030-03-04T04:30:18.125" },
  });
  expect(screen.getByRole("link", { name: "Mira Chen" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Noor Haddad" })).toBeNull();
  fireEvent.change(datetime.getByLabelText(t.fieldFilters.value), {
    target: { value: "2030-03-04T04:30:18.124" },
  });
  expect(screen.queryByRole("link", { name: "Mira Chen" })).toBeNull();
  await chooseSelect(
    datetime.getByLabelText(t.fieldFilters.operator),
    t.fieldFilters.gt,
  );
  expect(screen.getByRole("link", { name: "Mira Chen" })).toBeTruthy();
  expect(
    JSON.parse(
      new URLSearchParams(window.location.search).get("fieldFilters") ?? "[]",
    ),
  ).toEqual([
    { label: "Seats", type: "number", operator: "eq", value: 0 },
    { label: "Verified", type: "boolean", operator: "eq", value: false },
    {
      label: "Review time",
      type: "datetime",
      operator: "gt",
      value: "2030-03-04T04:30:18.124Z",
    },
  ]);
  act(() => {
    fireEvent.change(number.getByLabelText(t.fieldFilters.value), {
      target: { value: "1" },
    });
    fireEvent.change(number.getByLabelText(t.fieldFilters.value), {
      target: { value: "0" },
    });
  });
  expect(
    JSON.parse(
      new URLSearchParams(window.location.search).get("fieldFilters") ?? "[]",
    ),
  ).toHaveLength(3);
  expect(screen.getByRole("link", { name: "Mira Chen" })).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "No fictional match" },
  });
  expect(screen.queryByRole("link", { name: "Mira Chen" })).toBeNull();
  expect(
    screen.getByRole("button", { name: t.uiRefresh.customFields }),
  ).toBeTruthy();
});

test("UTC datetime filters reach an exact second occurrence in a repeated workspace hour", async () => {
  const instant = "2026-11-01T06:30:18.125Z";
  await harness.local.db
    .update(s.organizations)
    .set({ timezone: "America/New_York" })
    .where(eq(s.organizations.id, scope.organizationId));
  await harness.local.db
    .update(s.relationships)
    .set({
      contextDetails: {
        ...emptyRelationshipDetails(),
        fields: [
          {
            id: demoId(8953),
            label: "Review time",
            type: "datetime",
            value: instant,
          },
        ],
      },
    })
    .where(eq(s.relationships.id, demoId(300)));
  await mountCrm(harness, "/people", { compact: true });
  fireEvent.click(
    screen.getByRole("button", { name: t.uiRefresh.customFields }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: t.contextFields.addField }),
  );
  const filter = within(
    screen.getByRole("group", { name: `${t.fieldFilters.field} 1` }),
  );
  await chooseSelect(
    filter.getByLabelText(t.fieldFilters.field),
    `Review time · ${t.contextFields.fieldTypes.datetime}`,
  );
  expect(filter.getByLabelText(t.timezone).textContent).toContain(
    "America/New_York",
  );
  fireEvent.change(filter.getByLabelText(t.fieldFilters.value), {
    target: { value: "2026-11-01T01:30:18.125" },
  });
  expect(screen.queryByRole("link", { name: "Mira Chen" })).toBeNull();
  await chooseSelect(filter.getByLabelText(t.timezone), "UTC");
  fireEvent.change(filter.getByLabelText(t.fieldFilters.value), {
    target: { value: "2026-11-01T06:30:18.125" },
  });
  expect(screen.getByRole("link", { name: "Mira Chen" })).toBeTruthy();
  const page = await new RecordListService(harness.local.db).page(
    principal,
    recordListSchema.parse({
      ...scope,
      entity: "people",
      fieldFilters: [
        {
          label: "Review time",
          type: "datetime",
          operator: "eq",
          value: instant,
        },
      ],
    }),
  );
  expect(page.items.map((person) => person.id)).toEqual([demoId(200)]);
  fireEvent.change(filter.getByLabelText(t.fieldFilters.value), {
    target: { value: "2026-11-01T06:30:18.124" },
  });
  expect(screen.queryByRole("link", { name: "Mira Chen" })).toBeNull();
});

test("a live workspace timezone change preserves the canonical datetime filter instant", async () => {
  const instant = "2030-03-04T04:30:18.125Z";
  await harness.local.db
    .update(s.relationships)
    .set({
      contextDetails: {
        ...emptyRelationshipDetails(),
        fields: [
          {
            id: demoId(8956),
            label: "Review time",
            type: "datetime",
            value: instant,
          },
        ],
      },
    })
    .where(eq(s.relationships.id, demoId(300)));
  await mountCrm(harness, "/people", { compact: true });
  fireEvent.click(
    screen.getByRole("button", { name: t.uiRefresh.customFields }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: t.contextFields.addField }),
  );
  const group = within(
    screen.getByRole("group", { name: `${t.fieldFilters.field} 1` }),
  );
  await chooseSelect(
    group.getByLabelText(t.fieldFilters.field),
    `Review time · ${t.contextFields.fieldTypes.datetime}`,
  );
  fireEvent.change(group.getByLabelText(t.fieldFilters.value), {
    target: { value: "2030-03-04T04:30:18.125" },
  });
  expect(screen.getByRole("link", { name: "Mira Chen" })).toBeTruthy();
  const saved = new URLSearchParams(window.location.search).get("fieldFilters");
  fireEvent.click(
    within(
      screen.getByRole("dialog", { name: t.uiRefresh.customFields }),
    ).getByRole("button", { name: t.close }),
  );
  await new OrganizationSettingsService(harness.local.db).updateOrganization(
    principal,
    {
      organizationId: scope.organizationId,
      name: "Northstar Collective",
      timezone: "America/New_York",
    },
  );
  const request = vi.mocked(requestJson);
  request.mockClear();
  fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
  fireEvent.click(screen.getByRole("option", { name: t.refresh }));
  await waitFor(() =>
    expect(
      request.mock.calls.some(
        ([url]) => url.startsWith("/api/crm?") && !url.includes("operation="),
      ),
    ).toBe(true),
  );
  await act(async () => {
    await Promise.all(request.mock.results.map((result) => result.value));
  });
  fireEvent.click(
    screen.getByRole("button", { name: t.uiRefresh.customFields }),
  );
  const updated = within(
    screen.getByRole("group", { name: `${t.fieldFilters.field} 1` }),
  );
  expect(updated.getByLabelText(t.timezone).textContent).toContain("UTC");
  expect(updated.getByLabelText(t.fieldFilters.value)).toHaveProperty(
    "value",
    "2030-03-04T04:30:18.125",
  );
  expect(new URLSearchParams(window.location.search).get("fieldFilters")).toBe(
    saved,
  );
  expect(screen.getByRole("link", { name: "Mira Chen" })).toBeTruthy();
});

test("URL custom field rules reload typed values and combine atomically with amount filters until cleared", async () => {
  await harness.local.db
    .update(s.relationships)
    .set({
      contextDetails: {
        ...emptyRelationshipDetails(),
        fields: [
          { id: demoId(8954), label: "Seats", type: "number", value: 0 },
          {
            id: demoId(8955),
            label: "Verified",
            type: "boolean",
            value: false,
          },
        ],
      },
    })
    .where(eq(s.relationships.id, demoId(300)));
  const rules = [
    { label: "Seats", type: "number", operator: "eq", value: 0 },
    { label: "Verified", type: "boolean", operator: "eq", value: false },
  ];
  const query = new URLSearchParams({
    fieldFilters: JSON.stringify(rules),
    sort: "name_desc",
  });
  await mountCrm(harness, `/people?${query}`, { compact: true });
  expect(screen.getByRole("link", { name: "Mira Chen" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Noor Haddad" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: t.uiRefresh.customFields }),
  );
  const fields = within(
    screen.getByRole("dialog", { name: t.uiRefresh.customFields }),
  );
  expect(
    within(
      fields.getByRole("group", { name: `${t.fieldFilters.field} 1` }),
    ).getByLabelText(t.fieldFilters.value),
  ).toHaveProperty("value", "0");
  expect(
    within(
      fields.getByRole("group", { name: `${t.fieldFilters.field} 2` }),
    ).getByLabelText(t.fieldFilters.value).textContent,
  ).toContain(t.contextFields.no);
  fireEvent.click(fields.getByRole("button", { name: t.close }));
  fireEvent.click(screen.getByRole("button", { name: t.uiRefresh.dealValue }));
  act(() => {
    fireEvent.change(screen.getByLabelText(t.minimumDealSize), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByLabelText(t.maximumDealSize), {
      target: { value: "200" },
    });
  });
  expect(
    Object.fromEntries(new URLSearchParams(window.location.search)),
  ).toEqual({
    fieldFilters: JSON.stringify(rules),
    sort: "name_desc",
    minimum: "100",
    maximum: "200",
  });
  fireEvent.click(
    within(
      screen.getByRole("dialog", { name: t.uiRefresh.dealValue }),
    ).getByRole("button", { name: t.close }),
  );
  fireEvent.click(screen.getByRole("button", { name: t.clearFilters }));
  expect(window.location.search).toBe("");
  expect(screen.getByRole("link", { name: "Mira Chen" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Noor Haddad" })).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: t.uiRefresh.customFields }),
  );
  expect(screen.queryAllByRole("group", { name: /^Field \d+$/ })).toHaveLength(
    0,
  );
});

test("malformed URL field rules show a recoverable error and clear preserves unrelated view parameters", async () => {
  await mountCrm(harness, "/people?fieldFilters=invalid&layout=list", {
    compact: true,
  });
  expect(screen.getByText(t.fieldFilters.invalid)).toHaveProperty(
    "role",
    "alert",
  );
  expect(screen.queryByRole("link", { name: "Mira Chen" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: t.clearFilters }));
  expect(window.location.search).toBe("?layout=list");
  expect(screen.queryByText(t.fieldFilters.invalid)).toBeNull();
  expect(screen.getByRole("link", { name: "Mira Chen" })).toBeTruthy();
});

test("a malformed typed rule cannot silently coerce into a valid boolean filter", async () => {
  const fieldFilters = JSON.stringify([
    { label: "Verified", type: "boolean", operator: "eq", value: "oops" },
  ]);
  await mountCrm(harness, `/people?${new URLSearchParams({ fieldFilters })}`, {
    compact: true,
  });
  expect(screen.getByText(t.fieldFilters.invalid)).toHaveProperty(
    "role",
    "alert",
  );
  expect(screen.queryByRole("link", { name: "Mira Chen" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: t.uiRefresh.customFields }),
  );
  const filter = within(
    screen.getByRole("group", { name: `${t.fieldFilters.field} 1` }),
  );
  await chooseSelect(
    filter.getByLabelText(t.fieldFilters.value),
    t.contextFields.yes,
  );
  expect(screen.queryByText(t.fieldFilters.invalid)).toBeNull();
  expect(
    JSON.parse(
      new URLSearchParams(window.location.search).get("fieldFilters") ?? "[]",
    )[0].value,
  ).toBe(true);
});

test("an unknown active rule stays recoverable and changing product clears the rule", async () => {
  const fieldFilters = JSON.stringify([
    {
      label: "Old qualification note",
      type: "text",
      operator: "contains",
      value: "old",
    },
  ]);
  await mountCrm(harness, `/people?${new URLSearchParams({ fieldFilters })}`, {
    compact: true,
  });
  fireEvent.click(
    screen.getByRole("button", { name: t.uiRefresh.customFields }),
  );
  const popup = within(
    screen.getByRole("dialog", { name: t.uiRefresh.customFields }),
  );
  const filter = within(
    popup.getByRole("group", { name: `${t.fieldFilters.field} 1` }),
  );
  expect(filter.getByLabelText(t.fieldFilters.field).textContent).toContain(
    "Old qualification note",
  );
  expect(
    filter.getByRole("button", { name: t.contextFields.removeField }),
  ).toBeTruthy();
  fireEvent.click(popup.getByRole("button", { name: t.close }));
  await chooseSelect(
    screen.getByRole("combobox", { name: t.product }),
    "API Marketplace",
  );
  expect(new URLSearchParams(window.location.search).has("fieldFilters")).toBe(
    false,
  );
  expect(
    screen.queryByRole("button", { name: t.uiRefresh.customFields }),
  ).toBeNull();
});

test("internal tasks create and complete precise calendar occurrences through the registry without dispatch", async () => {
  const touchCount = (await harness.local.db.select().from(s.touches)).length;
  await mountCrm(harness, "/actions");
  const taskSection = within(
    screen.getByRole("region", { name: t.internalTasks.heading }),
  );
  fireEvent.click(
    taskSection.getByRole("button", { name: t.internalTasks.new }),
  );
  const editor = within(
    screen.getByRole("region", { name: t.internalTasks.new }),
  );
  fireEvent.change(editor.getByLabelText(t.actionTitle), {
    target: { value: "Fictional monthly preparation" },
  });
  fireEvent.change(editor.getByLabelText(t.internalTasks.timeZone), {
    target: { value: "Asia/Kolkata" },
  });
  fireEvent.change(editor.getByLabelText(t.internalTasks.dueAt), {
    target: { value: "2030-01-31T10:00:18.125" },
  });
  fireEvent.change(editor.getByLabelText(t.internalTasks.frequency), {
    target: { value: "monthly" },
  });
  await userEvent.setup().click(editor.getByRole("button", { name: t.save }));
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: t.internalTasks.new }),
    ).toBeNull(),
  );
  const created = harness.posts.find(
    (post) => post.operation === "internal-task-create",
  );
  expect(created).toMatchObject({
    ...scope,
    relationshipId: null,
    dueAt: "2030-01-31T04:30:18.125Z",
    timeZone: "Asia/Kolkata",
    recurrence: { frequency: "monthly", interval: 1 },
  });
  const article = screen
    .getByText("Fictional monthly preparation")
    .closest("article");
  if (!article) throw new Error("Missing task article");
  expect(article.querySelector("time")?.textContent).toContain("18.125");
  expect(within(article).getByText("Every 1 month")).toBeTruthy();
  fireEvent.click(
    within(article).getByRole("button", { name: t.internalTasks.complete }),
  );
  await waitFor(() =>
    expect(harness.posts.some((post) => post.command === "complete")).toBe(
      true,
    ),
  );
  await waitFor(async () => {
    const [task] = await harness.local.db.select().from(s.internalTasks);
    expect(task.version).toBe(2);
    expect(task.status).toBe("open");
    expect(task.dueAt.toISOString()).toBe("2030-02-28T04:30:18.125Z");
  });
  expect(
    harness.posts.find((post) => post.command === "complete"),
  ).toMatchObject({
    operation: "internal-task-change",
    version: 1,
  });
  expect(await harness.local.db.select().from(s.deliveries)).toHaveLength(0);
  expect(await harness.local.db.select().from(s.touches)).toHaveLength(
    touchCount,
  );
  await waitFor(() =>
    expect(
      within(article).getByRole("button", { name: t.edit }),
    ).toHaveProperty("disabled", false),
  );
  fireEvent.click(within(article).getByRole("button", { name: t.edit }));
  const edit = within(
    screen.getByRole("region", { name: t.internalTasks.edit }),
  );
  expect(edit.getByLabelText(t.internalTasks.dueAt)).toHaveProperty(
    "value",
    "2030-02-28T10:00:18.125",
  );
  fireEvent.change(edit.getByLabelText(t.actionTitle), {
    target: { value: "Updated fictional preparation" },
  });
  fireEvent.change(edit.getByLabelText(t.internalTasks.interval), {
    target: { value: "2" },
  });
  await userEvent.setup().click(edit.getByRole("button", { name: t.save }));
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: t.internalTasks.edit }),
    ).toBeNull(),
  );
  const save = harness.posts.find((post) => post.command === "save");
  expect(save).toMatchObject({ version: 2, dueAt: "2030-02-28T04:30:18.125Z" });
  expect(await screen.findByText("Every 2 months")).toBeTruthy();
});

test("internal task validation keeps invalid timezones and stale saves in the editor", async () => {
  const service = new InternalTaskService(harness.local.db);
  const task = await service.create(
    principal,
    createInternalTaskSchema.parse({
      ...scope,
      ownerId: demoUser,
      title: "Fictional precise review",
      dueAt: "2030-03-04T04:30:18.125Z",
      timeZone: "Asia/Kolkata",
    }),
  );
  await mountCrm(harness, "/actions");
  const taskSection = within(
    screen.getByRole("region", { name: t.internalTasks.heading }),
  );
  fireEvent.click(taskSection.getByRole("button", { name: t.edit }));
  const edit = within(
    screen.getByRole("region", { name: t.internalTasks.edit }),
  );
  fireEvent.change(edit.getByLabelText(t.internalTasks.timeZone), {
    target: { value: "Invalid/Zone" },
  });
  await userEvent.setup().click(edit.getByRole("button", { name: t.save }));
  expect(await edit.findByRole("alert")).toHaveProperty(
    "textContent",
    t.internalTasks.invalid,
  );
  expect(harness.posts).toHaveLength(0);
  fireEvent.change(edit.getByLabelText(t.internalTasks.timeZone), {
    target: { value: "Asia/Kolkata" },
  });
  fireEvent.change(edit.getByLabelText(t.actionTitle), {
    target: { value: "Unsaved task preparation" },
  });
  await service.change(principal, {
    ...scope,
    taskId: task.id,
    version: task.version,
    command: "save",
    title: "Agent reviewed task",
  });
  await userEvent.setup().click(edit.getByRole("button", { name: t.save }));
  expect(await edit.findByRole("alert")).toHaveProperty(
    "textContent",
    t.errors.CONFLICT,
  );
  expect(edit.getByLabelText(t.actionTitle)).toHaveProperty(
    "value",
    "Unsaved task preparation",
  );
  const [stored] = await harness.local.db
    .select()
    .from(s.internalTasks)
    .where(eq(s.internalTasks.id, task.id));
  expect(stored.title).toBe("Agent reviewed task");
  expect(stored.dueAt.toISOString()).toBe("2030-03-04T04:30:18.125Z");
});
