// @vitest-environment jsdom
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test, vi } from "vitest";
import * as s from "../packages/database/schema";
import { demoId, demoUser } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { installCrmHarness, mountCrm } from "./support/crm-harness";
import { visit } from "./support/memory-router";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (original) => ({
  ...(await original<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
const harness = installCrmHarness();

test("recording a declared source preserves unknown creator and owner, and filters independently of ownership", async () => {
  await mountCrm(harness, `/people/${demoId(200)}`);
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
  const dialog = await screen.findByRole("dialog", {
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
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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
  const source = await screen.findByRole("combobox", {
    name: t.attribution.sourceMember,
  });
  fireEvent.change(source, { target: { value: "demo-teammate" } });
  await waitFor(() =>
    expect(screen.getByRole("table").querySelectorAll("tbody tr")).toHaveLength(
      1,
    ),
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: t.attribution.submittedBy }),
    { target: { value: "demo-teammate" } },
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
  const changed = await screen.findByRole("region", {
    name: t.attribution.title,
  });
  await within(changed).findByText("other-product-row");
  expect(changed.querySelectorAll(".attribution-event")).toHaveLength(1);
  expect(changed.textContent).not.toContain("fixture-row-");
});
