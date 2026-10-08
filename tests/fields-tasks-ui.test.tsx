// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { eq } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import {
  createInternalTaskSchema,
  InternalTaskService,
} from "../packages/core/internal-tasks";
import { emptyRelationshipDetails } from "../packages/core/relationship-context";
import * as s from "../packages/database/schema";
import { demoId, demoUser } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { installCrmHarness, mountCrm } from "./support/crm-harness";

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
  fireEvent.click(screen.getByText(t.filters));
  const addFilter = (position: number, key: string) => {
    fireEvent.click(
      screen.getByRole("button", { name: t.contextFields.addField }),
    );
    const group = within(
      screen.getByRole("group", {
        name: `${t.fieldFilters.field} ${position}`,
      }),
    );
    fireEvent.change(group.getByLabelText(t.fieldFilters.field), {
      target: { value: key },
    });
    return group;
  };
  const number = addFilter(1, "number:seats");
  fireEvent.change(number.getByLabelText(t.fieldFilters.value), {
    target: { value: "0" },
  });
  expect(screen.getByRole("link", { name: "Mira Chen" })).toBeTruthy();
  const boolean = addFilter(2, "boolean:verified");
  expect(boolean.getByLabelText(t.fieldFilters.value)).toHaveProperty(
    "value",
    "false",
  );
  expect(screen.getByRole("link", { name: "Mira Chen" })).toBeTruthy();
  fireEvent.change(boolean.getByLabelText(t.fieldFilters.value), {
    target: { value: "true" },
  });
  expect(screen.queryByRole("link", { name: "Mira Chen" })).toBeNull();
  fireEvent.change(boolean.getByLabelText(t.fieldFilters.value), {
    target: { value: "false" },
  });
  const datetime = addFilter(3, "datetime:review time");
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
  fireEvent.change(datetime.getByLabelText(t.fieldFilters.operator), {
    target: { value: "gt" },
  });
  expect(screen.getByRole("link", { name: "Mira Chen" })).toBeTruthy();
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
