// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import * as s from "../packages/database/schema";
import { demoId } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { contactTab } from "./support/contact-workspace";
import { installCrmHarness, mountCrm } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (original) => ({
  ...(await original<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
const harness = installCrmHarness();

test("notes and imported conversations are separate, editable notes preserve the exact transcript, and dirty tabs stay put", async () => {
  const source =
    "SENT by Alex · 2026-09-28T16:47:41.437Z · fictional-source\nHello Jonah,\n\nPrepare the evaluation together.\n\nRECEIVED by Jonah · 2026-09-29T08:30:00Z · fictional-reply\nTuesday works. <script>fictional</script>";
  await harness.local.db
    .update(s.people)
    .set({ summary: `Prepare an agenda.\n\n${source}` })
    .where(eq(s.people.id, demoId(201)));
  await mountCrm(harness, "/people");
  fireEvent.click(screen.getByRole("link", { name: "Jonah Reed" }));
  const inspector = within(
    screen.getByRole("complementary", { name: t.recordDetails }),
  );
  const notes = await inspector.findByRole("textbox", { name: t.personNotes });
  expect(notes).toHaveProperty("value", "Prepare an agenda.");
  expect(inspector.queryByRole("button", { name: t.archive })).toBeNull();
  expect(inspector.queryByRole("button", { name: t.edit })).toBeNull();
  expect(inspector.queryByLabelText(t.email)).toBeNull();
  expect(inspector.queryByText(t.personDealSizeAndTags)).toBeNull();
  const history = inspector.getByRole("region", {
    name: t.contactWorkspace.history,
  });
  expect(
    within(history).getByText("Tuesday works. <script>fictional</script>"),
  ).toBeTruthy();
  expect(history.querySelector("script")).toBeNull();
  expect(history.querySelectorAll("article")).toHaveLength(2);
  fireEvent.change(notes, { target: { value: "Updated agenda." } });
  await contactTab(t.contactWorkspace.context);
  expect(
    inspector
      .getByRole("tab", { name: t.contactWorkspace.overview })
      .getAttribute("aria-selected"),
  ).toBe("true");
  const form = notes.closest("form");
  if (!form) throw new Error("Missing notes editor");
  fireEvent.submit(form);
  await waitFor(() => expect(form.querySelector("[role=status]")).toBeTruthy());
  const [stored] = await harness.local.db
    .select()
    .from(s.people)
    .where(eq(s.people.id, demoId(201)));
  expect(stored.summary).toBe(`Updated agenda.\n\n${source}`);
  await contactTab(t.contactWorkspace.context);
  expect(
    inspector.getByRole("region", { name: t.contextFields.heading }),
  ).toBeTruthy();
  await contactTab(t.contactWorkspace.details);
  expect(inspector.getByLabelText(t.email)).toBeTruthy();
  expect(inspector.getByText(t.personDealSizeAndTags)).toBeTruthy();
});

test("the selected next action appears once and opportunity amount saves without opening another editor", async () => {
  const [deal] = await harness.local.db.select().from(s.opportunities).limit(1);
  const [relationship] = await harness.local.db
    .select()
    .from(s.relationships)
    .where(eq(s.relationships.id, deal.relationshipId));
  const [person] = await harness.local.db
    .select()
    .from(s.people)
    .where(eq(s.people.id, relationship.personId));
  const [action] = await harness.local.db
    .select()
    .from(s.actions)
    .where(eq(s.actions.relationshipId, relationship.id))
    .limit(1);
  await mountCrm(
    harness,
    `/people/${person.id}?relationship=${relationship.id}&action=${action.id}`,
  );
  const panel = await screen.findByRole("tabpanel");
  expect(within(panel).getAllByText(action.title)).toHaveLength(1);
  const card = within(panel).getByText(deal.name).closest("article");
  if (!card) throw new Error("Missing opportunity card");
  const amount = within(card).getByLabelText(t.dealSize);
  fireEvent.change(amount, { target: { value: "1234.56" } });
  const form = amount.closest("form");
  if (!form) throw new Error("Missing inline estimate");
  fireEvent.submit(form);
  await waitFor(() => expect(form.querySelector("[role=status]")).toBeTruthy());
  const [stored] = await harness.local.db
    .select()
    .from(s.opportunities)
    .where(eq(s.opportunities.id, deal.id));
  expect(stored.amountMinor).toBe(123456);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("region", { name: t.editOpportunity })).toBeNull();
  expect(window.location.pathname).toBe(`/people/${person.id}`);
});

test("upcoming meetings stay in the short preparation list when a contact has many past meetings", async () => {
  const [meeting] = await harness.local.db.select().from(s.meetings).limit(1);
  const [relationship] = await harness.local.db
    .select()
    .from(s.relationships)
    .where(eq(s.relationships.id, meeting.relationshipId));
  const now = Date.now();
  await harness.local.db.insert(s.meetings).values([
    ...Array.from({ length: 5 }, (_, index) => ({
      ...meeting,
      id: crypto.randomUUID(),
      title: `Fictional past meeting ${index}`,
      status: "held" as const,
      startsAt: new Date(now - (index + 1) * 86400000),
    })),
    {
      ...meeting,
      id: crypto.randomUUID(),
      title: "Fictional upcoming preparation",
      status: "scheduled" as const,
      startsAt: new Date(now + 300000),
    },
  ]);
  await mountCrm(
    harness,
    `/people/${relationship.personId}?relationship=${relationship.id}`,
  );
  const upcoming = await screen.findByRole(
    "button",
    {
      name: /Fictional upcoming preparation/,
    },
    { timeout: 5000 },
  );
  expect(upcoming).toBeTruthy();
  expect(
    screen.queryAllByRole("button", { name: /Fictional past meeting/ }).length,
  ).toBeLessThanOrEqual(2);
  const section = upcoming.closest("section");
  if (!section) throw new Error("Missing meetings section");
  fireEvent.click(within(section).getByRole("button", { name: /Show all/ }));
  expect(
    screen.getAllByRole("button", { name: /Fictional past meeting/ }),
  ).toHaveLength(5);
});
