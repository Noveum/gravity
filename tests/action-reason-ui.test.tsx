// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import { CrmService } from "../packages/core/crm";
import * as s from "../packages/database/schema";
import { demoId } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { contactTab } from "./support/contact-workspace";
import { installCrmHarness, mountCrm } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
const harness = installCrmHarness();

test("editing an action reason preserves an unsaved draft and its usable version", async () => {
  await harness.local.db
    .update(s.actions)
    .set({ status: "open", draft: "Fictional saved draft." })
    .where(eq(s.actions.id, demoId(600)));
  await mountCrm(harness, `/people/${demoId(200)}?action=${demoId(600)}`);
  await contactTab(t.draft);
  fireEvent.change(await screen.findByLabelText(t.draftLabel), {
    target: { value: "Fictional unsaved draft to retain." },
  });
  await contactTab(t.contactWorkspace.overview);
  fireEvent.click(
    await screen.findByRole("button", { name: t.actionReasons.edit }),
  );
  fireEvent.change(screen.getByLabelText(t.reason), {
    target: { value: "Fictional revised action reason." },
  });
  fireEvent.click(screen.getByRole("button", { name: t.save }));
  await waitFor(() => expect(screen.queryByLabelText(t.reason)).toBeNull());
  await contactTab(t.draft);
  expect(
    ((await screen.findByLabelText(t.draftLabel)) as HTMLTextAreaElement).value,
  ).toBe("Fictional unsaved draft to retain.");
  fireEvent.click(screen.getByRole("button", { name: t.saveDraft }));
  await waitFor(async () => {
    const [action] = await harness.local.db
      .select()
      .from(s.actions)
      .where(eq(s.actions.id, demoId(600)));
    expect(action).toMatchObject({
      draft: "Fictional unsaved draft to retain.",
      reason: "Fictional revised action reason.",
      version: 3,
    });
  });
});

test("older private native messages can be loaded through the UI after the initial history page", async () => {
  const [conversation] = await harness.local.db
    .insert(s.conversations)
    .values({
      organizationId: demoId(1),
      productId: demoId(10),
      relationshipId: demoId(300),
      provenance: "native",
      ownerId: "demo-you",
      channel: "gmail",
      externalThreadId: "fictional-older-history",
    })
    .returning();
  await harness.local.db.insert(s.messages).values(
    Array.from({ length: 35 }, (_, index) => ({
      organizationId: demoId(1),
      productId: demoId(10),
      conversationId: conversation.id,
      providerMessageId: `fictional-older-${index}`,
      direction: "outbound" as const,
      body: `Older fictional message ${index}`,
      occurredAt: new Date("2020-01-01T01:02:03.123Z"),
    })),
  );
  const context = await new CrmService(harness.local.db).context(
    { userId: "demo-you", source: "session" },
    demoId(1),
    demoId(300),
  );
  const older = (await harness.local.db.select().from(s.messages)).find(
    (message) =>
      message.body.startsWith("Older fictional") &&
      !context.messages.some((visible) => visible.id === message.id),
  );
  if (!older) throw new Error("Missing older fixture");
  await mountCrm(harness, `/people/${demoId(200)}`);
  await contactTab(t.contactWorkspace.overview);
  expect(screen.queryByText(older.body)).toBeNull();
  fireEvent.click(
    await screen.findByRole("button", { name: t.nativeIngestion.loadEarlier }),
  );
  expect(await screen.findByText(older.body)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: t.nativeIngestion.loadEarlier }),
  ).toBeNull();
  expect(screen.getAllByText(t.nativeIngestion.historySource)).toHaveLength(35);
});

test("a full action loaded from compact mode can replace legacy JSON and retain its original source", async () => {
  const original = JSON.stringify({
    context: "Fictional original",
    send_permission: false,
  });
  await harness.local.db
    .update(s.actions)
    .set({ reason: original })
    .where(eq(s.actions.id, demoId(600)));
  await mountCrm(harness, `/people/${demoId(200)}?action=${demoId(600)}`, {
    compact: true,
  });
  await contactTab(t.contactWorkspace.overview);
  fireEvent.click(
    await screen.findByRole("button", { name: t.actionReasons.edit }),
  );
  expect((screen.getByLabelText(t.reason) as HTMLTextAreaElement).value).toBe(
    original,
  );
  fireEvent.change(screen.getByLabelText(t.reason), {
    target: { value: "Answer the fictional shortlist request." },
  });
  fireEvent.click(screen.getByRole("button", { name: t.save }));
  await waitFor(() => expect(screen.queryByLabelText(t.reason)).toBeNull());
  expect(
    await screen.findByText("Answer the fictional shortlist request."),
  ).toBeTruthy();
  expect(screen.getByText(t.actionReasons.original)).toBeTruthy();
  const [action] = await harness.local.db
    .select()
    .from(s.actions)
    .where(eq(s.actions.id, demoId(600)));
  expect(action).toMatchObject({
    reasonSource: original,
    reason: "Answer the fictional shortlist request.",
    status: "blocked",
    version: 2,
  });
});
