// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { eq, sql } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import { NativeIngestionService } from "../packages/core/native-ingestion";
import * as s from "../packages/database/schema";
import { demoId } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { installCrmHarness, mountCrm, principal } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
const harness = installCrmHarness();
async function panel() {
  await mountCrm(harness, `/people/${demoId(200)}?relationship=${demoId(300)}`);
  return screen.findByRole("region", { name: t.nativeIngestion.title });
}
const enter = (container: HTMLElement, name: string, value: string) =>
  fireEvent.change(within(container).getByLabelText(name), {
    target: { value },
  });

test("the person UI imports native history with an exact instant and private source", async () => {
  const section = await panel();
  fireEvent.click(
    within(section).getByRole("button", { name: t.nativeIngestion.addHistory }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: t.nativeIngestion.addHistory,
  });
  enter(dialog, t.nativeIngestion.sourceThread, "fictional-ui-history");
  enter(dialog, t.nativeIngestion.sourceMessage, "fictional-ui-message");
  enter(dialog, t.nativeIngestion.occurredAt, "2025-01-01T12:34:56.789");
  enter(dialog, t.nativeIngestion.body, "A fictional imported history body.");
  fireEvent.click(
    within(dialog).getByRole("button", { name: t.nativeIngestion.record }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(
    harness.posts.find((item) => item.operation === "ingest-history"),
  ).toMatchObject({
    relationshipId: demoId(300),
    messages: [
      { direction: "inbound", occurredAt: "2025-01-01T12:34:56.789Z" },
    ],
  });
  const [conversation] = await harness.local.db
    .select()
    .from(s.conversations)
    .where(
      eq(s.conversations.externalThreadId, "history:fictional-ui-history"),
    );
  expect(conversation).toMatchObject({
    provenance: "native",
    connectionId: null,
    visibility: "private",
  });
  const [message] = await harness.local.db
    .select()
    .from(s.messages)
    .where(eq(s.messages.conversationId, conversation.id));
  expect(message.occurredAt.toISOString()).toBe("2025-01-01T12:34:56.789Z");
  await waitFor(() =>
    expect(
      document.querySelector('time[datetime="2025-01-01T12:34:56.789Z"]')
        ?.textContent,
    ).toContain("56.789"),
  );
});

test("native history can record the second repeated workspace hour using UTC without losing entered content", async () => {
  await harness.local.db
    .update(s.organizations)
    .set({ timezone: "America/New_York" })
    .where(eq(s.organizations.id, demoId(1)));
  const section = await panel();
  fireEvent.click(
    within(section).getByRole("button", { name: t.nativeIngestion.addHistory }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: t.nativeIngestion.addHistory,
  });
  enter(dialog, t.nativeIngestion.sourceThread, "fictional-repeated-hour");
  enter(dialog, t.nativeIngestion.sourceMessage, "fictional-second-hour");
  enter(dialog, t.nativeIngestion.body, "Fictional repeated-hour history.");
  enter(dialog, t.nativeIngestion.occurredAt, "2025-11-02T06:30:18.125");
  expect(within(dialog).getByLabelText(t.timezone)).toHaveProperty(
    "value",
    "America/New_York",
  );
  enter(dialog, t.timezone, "UTC");
  expect(
    within(dialog).getByLabelText(t.nativeIngestion.occurredAt),
  ).toHaveProperty("value", "2025-11-02T06:30:18.125");
  expect(within(dialog).getByLabelText(t.nativeIngestion.body)).toHaveProperty(
    "value",
    "Fictional repeated-hour history.",
  );
  expect(
    within(dialog).getByText(t.nativeIngestion.zone.replace("{zone}", "UTC")),
  ).toBeTruthy();
  fireEvent.click(
    within(dialog).getByRole("button", { name: t.nativeIngestion.record }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(
    harness.posts.find((post) => post.operation === "ingest-history"),
  ).toMatchObject({
    messages: [{ occurredAt: "2025-11-02T06:30:18.125Z" }],
  });
  const [message] = await harness.local.db
    .select()
    .from(s.messages)
    .where(eq(s.messages.providerMessageId, "fictional-second-hour"));
  expect(message.occurredAt.toISOString()).toBe("2025-11-02T06:30:18.125Z");
});

test("an undated draft can schedule the second repeated workspace hour in UTC without approval or sending", async () => {
  await harness.local.db
    .update(s.organizations)
    .set({ timezone: "America/New_York" })
    .where(eq(s.organizations.id, demoId(1)));
  const draft = await new NativeIngestionService(harness.local.db).draft(
    principal,
    {
      organizationId: demoId(1),
      productId: demoId(10),
      relationshipId: demoId(300),
      channel: "gmail",
      sourceId: "fictional-repeated-hour-draft",
      title: "Fictional repeated-hour follow-up",
      reason: "",
      body: "Subject: Fictional\n\nFictional repeated-hour follow-up.",
    },
  );
  const section = await panel();
  fireEvent.click(
    await within(section).findByRole("button", {
      name: t.nativeIngestion.schedule,
    }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: t.nativeIngestion.schedule,
  });
  enter(dialog, t.nativeIngestion.dueAt, "2026-11-01T06:30:18.125");
  enter(dialog, t.timezone, "UTC");
  expect(within(dialog).getByLabelText(t.nativeIngestion.dueAt)).toHaveProperty(
    "value",
    "2026-11-01T06:30:18.125",
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: t.nativeIngestion.schedule }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(
    harness.posts.find((post) => post.operation === "schedule-native-draft"),
  ).toMatchObject({
    draftId: draft.id,
    dueAt: "2026-11-01T06:30:18.125Z",
  });
  const [scheduled] = await harness.local.db
    .select()
    .from(s.nativeDrafts)
    .where(eq(s.nativeDrafts.id, draft.id));
  const [action] = await harness.local.db
    .select()
    .from(s.actions)
    .where(eq(s.actions.id, scheduled.scheduledActionId ?? ""));
  expect(action.dueAt.toISOString()).toBe("2026-11-01T06:30:18.125Z");
  expect(action.approvedHash).toBeNull();
  expect(action.approvedBy).toBeNull();
  expect(
    harness.posts.some((post) =>
      ["send-action", "send-touch"].includes(String(post.operation)),
    ),
  ).toBe(false);
});

test("the UI can load, edit and schedule an imported draft beyond its first 100 rows", async () => {
  const service = new NativeIngestionService(harness.local.db);
  let finalDraft: Awaited<ReturnType<typeof service.draft>> | undefined;
  for (let index = 0; index < 101; index++)
    finalDraft = await service.draft(principal, {
      organizationId: demoId(1),
      productId: demoId(10),
      relationshipId: demoId(300),
      channel: "gmail",
      sourceId: `fictional-ui-page-${index}`,
      title: `Fictional paginated draft ${index}`,
      reason: "Fictional pagination notes",
      body: "Subject: Fictional\n\nA fictional page draft.",
    });
  if (!finalDraft) throw new Error("last native draft fixture");
  await harness.local.db
    .update(s.nativeDrafts)
    .set({ createdAt: sql`timestamptz '2026-10-01T00:00:00.123456Z'` })
    .where(eq(s.nativeDrafts.relationshipId, demoId(300)));
  await harness.local.db
    .update(s.nativeDrafts)
    .set({ createdAt: sql`timestamptz '2026-10-01T00:00:00.123789Z'` })
    .where(eq(s.nativeDrafts.id, finalDraft.id));
  const section = await panel();
  await within(section).findByText("Fictional paginated draft 0");
  expect(
    within(section).queryByText("Fictional paginated draft 100"),
  ).toBeNull();
  fireEvent.click(
    await within(section).findByRole("button", {
      name: t.nativeIngestion.loadMoreDrafts,
    }),
  );
  const lastTitle = await within(section).findByText(
    "Fictional paginated draft 100",
  );
  const lastCard = lastTitle.closest("article");
  if (!lastCard) throw new Error("last native draft card");
  fireEvent.click(
    within(lastCard).getByRole("button", { name: t.nativeIngestion.edit }),
  );
  const editor = await screen.findByRole("dialog", {
    name: t.nativeIngestion.edit,
  });
  enter(editor, t.actionTitle, "Edited final fictional draft");
  enter(
    editor,
    t.nativeIngestion.draftBody,
    "Subject: Fictional edited\n\nEdited final page body.",
  );
  fireEvent.click(
    within(editor).getByRole("button", { name: t.nativeIngestion.saveDraft }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(
    await within(section).findByRole("button", {
      name: t.nativeIngestion.loadMoreDrafts,
    }),
  );
  const editedTitle = await within(section).findByText(
    "Edited final fictional draft",
  );
  const editedCard = editedTitle.closest("article");
  if (!editedCard) throw new Error("edited native draft card");
  fireEvent.click(
    within(editedCard).getByRole("button", {
      name: t.nativeIngestion.schedule,
    }),
  );
  const scheduler = await screen.findByRole("dialog", {
    name: t.nativeIngestion.schedule,
  });
  enter(scheduler, t.nativeIngestion.dueAt, "2026-10-08T09:10:11.123");
  fireEvent.click(
    within(scheduler).getByRole("button", { name: t.nativeIngestion.schedule }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const [scheduled] = await harness.local.db
    .select()
    .from(s.nativeDrafts)
    .where(eq(s.nativeDrafts.id, finalDraft.id));
  const [action] = await harness.local.db
    .select()
    .from(s.actions)
    .where(eq(s.actions.id, scheduled.scheduledActionId ?? ""));
  expect(action).toMatchObject({
    title: "Edited final fictional draft",
    draft: "Subject: Fictional edited\n\nEdited final page body.",
    approvedHash: null,
  });
});

test("the UI keeps a draft undated until an explicit schedule and never grants approval", async () => {
  const section = await panel();
  const before = await harness.local.db
    .select()
    .from(s.actions)
    .where(eq(s.actions.relationshipId, demoId(300)));
  fireEvent.click(
    within(section).getByRole("button", { name: t.nativeIngestion.addDraft }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: t.nativeIngestion.addDraft,
  });
  enter(dialog, t.nativeIngestion.sourceDraft, "fictional-ui-draft");
  enter(dialog, t.actionTitle, "Fictional imported undated draft");
  enter(
    dialog,
    t.nativeIngestion.draftBody,
    "Subject: Fictional\n\nFictional UI draft body.",
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: t.nativeIngestion.saveDraft }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await within(section).findByText("Fictional imported undated draft");
  expect(
    await harness.local.db
      .select()
      .from(s.actions)
      .where(eq(s.actions.relationshipId, demoId(300))),
  ).toEqual(before);
  fireEvent.click(
    within(section).getByRole("button", { name: t.nativeIngestion.schedule }),
  );
  const scheduler = await screen.findByRole("dialog", {
    name: t.nativeIngestion.schedule,
  });
  enter(scheduler, t.nativeIngestion.dueAt, "2026-10-08T09:10:11.123");
  fireEvent.click(
    within(scheduler).getByRole("button", { name: t.nativeIngestion.schedule }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await within(section).findByText(t.nativeIngestion.scheduled);
  const [draft] = await harness.local.db
    .select()
    .from(s.nativeDrafts)
    .where(eq(s.nativeDrafts.sourceId, "fictional-ui-draft"));
  const [action] = await harness.local.db
    .select()
    .from(s.actions)
    .where(eq(s.actions.id, draft.scheduledActionId ?? ""));
  expect(action).toMatchObject({
    approvedHash: null,
    approvedBy: null,
    sourceConversationId: draft.sourceConversationId,
  });
  expect(action.dueAt.toISOString()).toBe("2026-10-08T09:10:11.123Z");
  expect(
    harness.posts.some(
      (item) =>
        item.operation === "send-action" || item.operation === "send-touch",
    ),
  ).toBe(false);
});
