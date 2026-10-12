// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { eq } from "drizzle-orm";
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

test("scheduling a saved action keeps its draft and removes approval without dispatch", async () => {
  await harness.local.db
    .update(s.actions)
    .set({
      draft: "Subject: Fictional proposal\n\nA fictional saved proposal.",
      draftHash: "fictional-approved-hash",
      approvedHash: "fictional-approved-hash",
      approvedBy: principal.userId,
    })
    .where(eq(s.actions.id, demoId(602)));
  await mountCrm(
    harness,
    `/people/${demoId(202)}?relationship=${demoId(302)}&action=${demoId(602)}`,
  );
  fireEvent.click(await screen.findByRole("tab", { name: t.draft }));
  expect(
    screen.getByRole("button", { name: t.touchVerbs.send }),
  ).toHaveProperty("disabled", false);
  fireEvent.click(screen.getByRole("button", { name: t.draftFlow.schedule }));
  const scheduler = await screen.findByRole("dialog", {
    name: t.draftFlow.scheduleTitle,
  });
  fireEvent.change(within(scheduler).getByLabelText(t.nativeIngestion.dueAt), {
    target: { value: "2026-11-02T10:30:15.125" },
  });
  fireEvent.click(
    within(scheduler).getByRole("button", { name: t.draftFlow.schedule }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const [action] = await harness.local.db
    .select()
    .from(s.actions)
    .where(eq(s.actions.id, demoId(602)));
  expect(action).toMatchObject({
    draft: "Subject: Fictional proposal\n\nA fictional saved proposal.",
    approvedHash: null,
    approvedBy: null,
  });
  expect(action.dueAt.toISOString()).toBe("2026-11-02T10:30:15.125Z");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: t.touchVerbs.send }),
    ).toHaveProperty("disabled", true),
  );
  expect(screen.getByText(t.draftFlow.saved)).toBeTruthy();
  expect(harness.posts.map((post) => post.operation)).toEqual(["plan"]);
});

test("an undated draft Send opens fresh review once and never approves or dispatches", async () => {
  const draft = await new NativeIngestionService(harness.local.db).draft(
    principal,
    {
      organizationId: demoId(1),
      productId: demoId(10),
      relationshipId: demoId(300),
      channel: "linkedin",
      sourceId: "fictional-send-review",
      title: "Fictional send review",
      reason: "Fictional notes kept outside the message.",
      body: "A fictional private draft for review.",
    },
  );
  await mountCrm(harness, `/people/${demoId(200)}?relationship=${demoId(300)}`);
  const library = await screen.findByRole("region", {
    name: t.nativeIngestion.title,
  });
  const send = await within(library).findByRole("button", {
    name: t.draftFlow.send,
  });
  expect(within(library).getByText(t.draftFlow.sendHint)).toBeTruthy();
  const notes = screen.getByRole("textbox", {
    name: t.personNotes,
  }) as HTMLTextAreaElement;
  const savedNotes = notes.value;
  fireEvent.change(notes, {
    target: { value: "Fictional unsaved person notes to retain." },
  });
  fireEvent.click(send);
  expect(harness.posts).toHaveLength(0);
  expect(notes.value).toBe("Fictional unsaved person notes to retain.");
  const notesForm = notes.closest("form");
  if (!notesForm) throw new Error("Missing fictional notes editor");
  fireEvent.click(within(notesForm).getByRole("button", { name: t.cancel }));
  expect(notes.value).toBe(savedNotes);
  fireEvent.click(send);
  fireEvent.click(send);
  await screen.findByRole("textbox", { name: t.draftLabel });
  const [saved] = await harness.local.db
    .select()
    .from(s.nativeDrafts)
    .where(eq(s.nativeDrafts.id, draft.id));
  const [action] = await harness.local.db
    .select()
    .from(s.actions)
    .where(eq(s.actions.id, saved.scheduledActionId ?? ""));
  expect(action).toMatchObject({
    draft: draft.body,
    sourceConversationId: draft.sourceConversationId,
    approvedHash: null,
    approvedBy: null,
  });
  expect(harness.posts.map((post) => post.operation)).toEqual([
    "schedule-native-draft",
  ]);
  expect(
    screen.getByRole("button", { name: t.touchVerbs.send }),
  ).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: t.approveDraft })).toHaveProperty(
    "disabled",
    false,
  );
});
