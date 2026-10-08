// @vitest-environment jsdom
import { act, fireEvent, screen } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import * as s from "../packages/database/schema";
import { demoId, demoUser } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { installCrmHarness, mountCrm } from "./support/crm-harness";
import { chooseSelect } from "./support/select-control";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (original) => ({
  ...(await original<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
const harness = installCrmHarness();

test("rapid minimum and maximum edits combine without losing the other field or view parameters", async () => {
  await harness.local.db
    .update(s.opportunities)
    .set({ amountMinor: 300000, probability: 40 })
    .where(eq(s.opportunities.id, demoId(1101)));
  await mountCrm(harness, "/opportunities?layout=list&sort=name_desc");
  const minimum = screen.getByLabelText(t.minimumDealSize);
  const maximum = screen.getByLabelText(t.maximumDealSize);
  act(() => {
    fireEvent.change(minimum, { target: { value: "2500" } });
    fireEvent.change(maximum, { target: { value: "3500" } });
  });
  const query = new URLSearchParams(window.location.search);
  expect(Object.fromEntries(query)).toEqual({
    layout: "list",
    sort: "name_desc",
    minimum: "2500",
    maximum: "3500",
  });
  expect(minimum).toHaveProperty("value", "2500");
  expect(maximum).toHaveProperty("value", "3500");
  expect(
    screen.getByRole("button", { name: "Northstar evaluation project" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Cedar workflow pilot" }),
  ).toBeNull();
});

test("action toolbar changes preserve record filters, sorting, and the saved waiting scope", async () => {
  const recordFilters = {
    tag: "enterprise",
    qualification: "qualified",
    status: "open",
    currency: "USD",
    minimum: "1000",
    maximum: "9000",
    sort: "name_desc",
  };
  await mountCrm(
    harness,
    `/actions?${new URLSearchParams({ ...recordFilters, waiting: "1" })}`,
  );
  await chooseSelect(
    screen.getByRole("combobox", { name: t.actionType }),
    t.commitment,
  );
  await chooseSelect(screen.getByRole("combobox", { name: t.owner }), t.mine);
  expect(
    Object.fromEntries(new URLSearchParams(window.location.search)),
  ).toEqual({
    ...recordFilters,
    waiting: "1",
    kind: "commitment",
    owner: demoUser,
  });
  fireEvent.click(
    screen.getByRole("button", { name: `${t.waiting}: ${t.clearFilters}` }),
  );
  expect(
    Object.fromEntries(new URLSearchParams(window.location.search)),
  ).toEqual({
    ...recordFilters,
    kind: "commitment",
    owner: demoUser,
  });
});

test("an active owner stays editable when a board search has no matches", async () => {
  await mountCrm(harness, `/opportunities?owner=${demoUser}`);
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "No matching fictional deal" },
  });
  const owner = screen.getByRole("combobox", { name: t.owner });
  expect(owner.textContent).toContain("Alex Morgan");
  await chooseSelect(owner, t.everyone);
  expect(new URLSearchParams(window.location.search).has("owner")).toBe(false);
});

test("a layout click immediately after an amount edit retains the amount filter", async () => {
  await mountCrm(harness, "/opportunities");
  act(() => {
    fireEvent.change(screen.getByLabelText(t.minimumDealSize), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByRole("button", { name: t.inlineEditing.list }));
  });
  expect(
    Object.fromEntries(new URLSearchParams(window.location.search)),
  ).toEqual({
    minimum: "1000",
    layout: "list",
  });
});
