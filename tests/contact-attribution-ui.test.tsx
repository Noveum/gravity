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
import { personSchema } from "../packages/core/crm";
import * as s from "../packages/database/schema";
import { demoId, demoUser } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { requestJson } from "../src/components/client-api";
import { contactTab } from "./support/contact-workspace";
import { installCrmHarness, mountCrm, principal } from "./support/crm-harness";
import { visit } from "./support/memory-router";
import { chooseSelect } from "./support/select-control";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (original) => ({
  ...(await original<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
const harness = installCrmHarness();

test("recording a declared source preserves unknown creator and owner, and filters independently of ownership", async () => {
  await mountCrm(harness, `/people/${demoId(200)}`);
  await contactTab(t.contactWorkspace.details);
  const section = await screen.findByRole("region", {
    name: t.attribution.title,
  });
  fireEvent.click(within(section).getByText(t.attribution.title));
  await waitFor(() =>
    expect(
      within(section).getAllByText(t.attribution.unknown).length,
    ).toBeGreaterThan(0),
  );
  fireEvent.click(
    within(section).getByRole("button", { name: t.attribution.recordSource }),
  );
  const dialog = await screen.findByRole("region", {
    name: t.attribution.recordSource,
  });
  fireEvent.change(within(dialog).getByLabelText(t.attribution.batchLabel), {
    target: { value: "Reviewed fictional list" },
  });
  fireEvent.change(within(dialog).getByLabelText(t.attribution.sourceMember), {
    target: { value: "demo-teammate" },
  });
  fireEvent.change(
    within(dialog).getByLabelText(t.attribution.sourceRecordId),
    { target: { value: "row-7" } },
  );
  fireEvent.click(within(dialog).getByRole("button", { name: t.save }));
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: t.attribution.recordSource }),
    ).toBeNull(),
  );
  await screen.findByText("Reviewed fictional list");
  const [event] = await harness.local.db.select().from(s.contactContributions);
  expect(event).toMatchObject({
    actorId: demoUser,
    sourceMemberId: "demo-teammate",
    kind: "submitted",
    transport: "demo",
  });
  const attribution = within(
    screen.getByRole("region", { name: t.attribution.title }),
  );
  expect(attribution.getByText("Alex Morgan")).toBeTruthy();
  expect(attribution.getByText("Sam Rivera")).toBeTruthy();
  expect(
    attribution.getAllByText(t.attribution.unknown).length,
  ).toBeGreaterThan(0);
  act(() => visit("/people"));
  fireEvent.click(
    await screen.findByRole("button", { name: t.uiRefresh.attributionFilters }),
  );
  const source = await screen.findByRole("combobox", {
    name: t.attribution.sourceMember,
  });
  await chooseSelect(source, "Sam Rivera");
  await waitFor(() =>
    expect(screen.getByRole("table").querySelectorAll("tbody tr")).toHaveLength(
      1,
    ),
  );
  await chooseSelect(
    screen.getByRole("combobox", { name: t.attribution.submittedBy }),
    "Sam Rivera",
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("table")?.querySelectorAll("tbody tr").length ?? 0,
    ).toBe(0),
  );
});

test("paginated history appends once and switching product discards the old page", async () => {
  await harness.local.db.insert(s.contactContributions).values([
    ...Array.from({ length: 31 }, (_, index) => ({
      organizationId: demoId(1),
      productId: demoId(10),
      personId: demoId(200),
      actorId: demoUser,
      transport: "demo" as const,
      kind: "submitted" as const,
      sourceRecordId: `fixture-row-${index}`,
      createdAt: new Date(1700000000000 + index * 1000),
    })),
    {
      organizationId: demoId(1),
      productId: demoId(11),
      personId: demoId(200),
      actorId: "demo-teammate",
      transport: "demo",
      kind: "submitted",
      sourceRecordId: "other-product-row",
    },
  ]);
  await mountCrm(harness, `/people/${demoId(200)}`);
  await contactTab(t.contactWorkspace.details);
  const section = await screen.findByRole("region", {
    name: t.attribution.title,
  });
  fireEvent.click(within(section).getByText(t.attribution.title));
  const more = await within(section).findByRole("button", {
    name: t.attribution.more,
  });
  expect(section.querySelectorAll(".attribution-event")).toHaveLength(30);
  fireEvent.click(more);
  await waitFor(() =>
    expect(section.querySelectorAll(".attribution-event")).toHaveLength(31),
  );
  expect(
    within(section).queryByRole("button", { name: t.attribution.more }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "API Marketplace · Buyer" }),
  );
  await contactTab(t.contactWorkspace.details);
  const changed = await screen.findByRole("region", {
    name: t.attribution.title,
  });
  await within(changed).findByText("other-product-row");
  expect(changed.querySelectorAll(".attribution-event")).toHaveLength(1);
  expect(changed.textContent).not.toContain("fixture-row-");
});

test("partial failures keep exact retry keys but allow corrected batch details", async () => {
  await mountCrm(harness, `/people/${demoId(200)}`);
  await contactTab(t.contactWorkspace.details);
  const section = await screen.findByRole("region", {
    name: t.attribution.title,
  });
  fireEvent.click(within(section).getByText(t.attribution.title));
  fireEvent.click(
    within(section).getByRole("button", { name: t.attribution.recordSource }),
  );
  const dialog = await screen.findByRole("region", {
    name: t.attribution.recordSource,
  });
  const ui = within(dialog);
  fireEvent.change(ui.getByLabelText(t.attribution.batchLabel), {
    target: { value: "Original fictional list" },
  });
  fireEvent.change(ui.getByLabelText(t.attribution.sourceRecordId), {
    target: { value: "row-9" },
  });
  const request = vi.mocked(requestJson);
  const regular = request.getMockImplementation();
  if (!regular) throw new Error("Missing request mock");
  const keys: string[] = [];
  let failedRow = false;
  request.mockImplementation(async (url, init) => {
    const body = init?.method === "POST" ? JSON.parse(String(init.body)) : null;
    if (body?.operation === "import-batch") {
      keys.push(body.submissionKey);
      const result = await regular(url, init);
      // The first response is lost after the batch has committed.
      if (keys.length === 1) throw new Error("NETWORK_ERROR");
      return result;
    }
    if (body?.operation === "contact-import" && !failedRow) {
      failedRow = true;
      throw new Error("NETWORK_ERROR");
    }
    return regular(url, init);
  });
  fireEvent.click(ui.getByRole("button", { name: t.save }));
  await waitFor(() =>
    expect(dialog.querySelector("form > p[role=alert]")?.textContent).toBe(
      t.errors.NETWORK_ERROR,
    ),
  );
  await waitFor(() =>
    expect(
      ui.getByRole("button", { name: t.save }).hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(ui.getByRole("button", { name: t.save }));
  await waitFor(() => expect(failedRow).toBe(true));
  await waitFor(() =>
    expect(dialog.querySelector("form > p[role=alert]")?.textContent).toBe(
      t.errors.NETWORK_ERROR,
    ),
  );
  await waitFor(() =>
    expect(
      ui.getByRole("button", { name: t.save }).hasAttribute("disabled"),
    ).toBe(false),
  );
  expect(keys[1]).toBe(keys[0]);
  fireEvent.change(ui.getByLabelText(t.attribution.batchLabel), {
    target: { value: "Corrected fictional list" },
  });
  fireEvent.click(ui.getByRole("button", { name: t.save }));
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: t.attribution.recordSource }),
    ).toBeNull(),
  );
  expect(keys[2]).not.toBe(keys[0]);
  expect(await screen.findByText("Corrected fictional list")).toBeTruthy();
  const events = await harness.local.db.select().from(s.contactContributions);
  expect(events).toHaveLength(1);
});

test("archived contact records retain readable provenance without an import editor", async () => {
  const contact = await harness.service.createPerson(
    principal,
    personSchema.parse({
      organizationId: demoId(1),
      productId: demoId(10),
      name: "Archived fictional import",
      review: false,
    }),
  );
  await harness.local.db
    .update(s.people)
    .set({ archivedAt: new Date() })
    .where(eq(s.people.id, contact.personId));
  await mountCrm(harness, `/people/${contact.personId}`);
  const section = await screen.findByRole("region", {
    name: t.attribution.title,
  });
  fireEvent.click(within(section).getByText(t.attribution.title));
  await within(section).findByText(t.attribution.created);
  expect(within(section).getAllByText("Alex Morgan").length).toBeGreaterThan(0);
  expect(
    within(section).queryByRole("button", { name: t.attribution.recordSource }),
  ).toBeNull();
});
