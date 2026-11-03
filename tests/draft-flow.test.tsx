// @vitest-environment jsdom
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { eq } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import { NativeIngestionService } from "../packages/core/native-ingestion";
import * as s from "../packages/database/schema";
import { demoId } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { dateLabel, requestJson } from "../src/components/client-api";
import { installCrmHarness, mountCrm, principal } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));

const harness = installCrmHarness();

test.each(["success", "failure"])(
  "leaving native draft review ignores its late %s response",
  async (outcome) => {
    await new NativeIngestionService(harness.local.db).draft(principal, {
      organizationId: demoId(1),
      productId: demoId(10),
      relationshipId: demoId(300),
      channel: "linkedin",
      sourceId: "fictional-late-review",
      title: "Fictional late review",
      reason: "",
      body: "A fictional draft with a delayed review response.",
    });
    await mountCrm(
      harness,
      `/people/${demoId(200)}?relationship=${demoId(300)}`,
    );
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = vi.mocked(requestJson).getMockImplementation();
    if (!original) throw new Error("Missing CRM harness");
    let preparation: Promise<unknown> | undefined;
    vi.mocked(requestJson).mockImplementation((url, init) => {
      if (
        init?.method === "POST" &&
        JSON.parse(String(init.body)).operation === "schedule-native-draft"
      ) {
        preparation = (async () => {
          await pending;
          if (outcome === "failure") throw new Error("NETWORK_ERROR");
          return original(url, init);
        })();
        return preparation;
      }
      return original(url, init);
    });
    const library = await screen.findByRole("region", {
      name: t.nativeIngestion.title,
    });
    fireEvent.click(
      await within(library).findByRole("button", { name: t.draftFlow.send }),
    );
    fireEvent.click(
      screen.getByRole("tab", { name: t.contactWorkspace.context }),
    );
    expect(
      screen.queryByRole("region", { name: t.nativeIngestion.title }),
    ).toBeNull();
    const snapshotCalls = () =>
      vi
        .mocked(requestJson)
        .mock.calls.filter(([url]) =>
          String(url).startsWith(
            `/api/crm?organizationId=${demoId(1)}&compact=true`,
          ),
        ).length;
    const priorSnapshots = snapshotCalls();
    await act(async () => {
      release();
      await preparation?.catch(() => undefined);
    });
    expect(snapshotCalls()).toBe(priorSnapshots);
    expect(
      screen
        .getByRole("tab", { name: t.contactWorkspace.context })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(window.location.search).not.toContain("action=");
    expect(screen.queryByText(t.errors.NETWORK_ERROR)).toBeNull();
    expect(harness.posts.map((post) => post.operation)).toEqual(
      outcome === "success" ? ["schedule-native-draft"] : [],
    );
  },
);

test("an open action scheduler keeps its original version after a live reschedule", async () => {
  await mountCrm(
    harness,
    `/people/${demoId(202)}?relationship=${demoId(302)}&action=${demoId(602)}`,
  );
  fireEvent.click(await screen.findByRole("tab", { name: t.draft }));
  fireEvent.click(screen.getByRole("button", { name: t.draftFlow.schedule }));
  const scheduler = await screen.findByRole("dialog", {
    name: t.draftFlow.scheduleTitle,
  });
  const dateInput = within(scheduler).getByLabelText(t.nativeIngestion.dueAt);
  fireEvent.change(dateInput, { target: { value: "2026-11-02T10:30" } });
  const [before] = await harness.local.db
    .select()
    .from(s.actions)
    .where(eq(s.actions.id, demoId(602)));
  const externalDueAt = "2026-11-03T11:45:00.000Z";
  await harness.service.planActions(principal, {
    organizationId: demoId(1),
    items: [
      { actionId: before.id, version: before.version, dueAt: externalDueAt },
    ],
  });
  fireEvent.focus(window);
  await screen.findByText(
    t.draftFlow.scheduledFor.replace("{date}", dateLabel(externalDueAt, "UTC")),
  );
  expect(dateInput).toHaveProperty("value", "2026-11-02T10:30");
  fireEvent.click(
    within(scheduler).getByRole("button", { name: t.draftFlow.schedule }),
  );
  await waitFor(() => expect(harness.posts).toHaveLength(1));
  expect(harness.posts).toMatchObject([
    {
      operation: "plan",
      items: [{ actionId: before.id, version: before.version }],
    },
  ]);
  expect(await within(scheduler).findByText(t.errors.CONFLICT)).toBeTruthy();
  const [stored] = await harness.local.db
    .select()
    .from(s.actions)
    .where(eq(s.actions.id, before.id));
  expect(stored.dueAt.toISOString()).toBe(externalDueAt);
  expect(stored.version).toBe(before.version + 1);
});

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
