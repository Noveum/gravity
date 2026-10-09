// @vitest-environment jsdom
import { act, fireEvent, screen, within } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import { emptyRelationshipDetails } from "../packages/core/relationship-context";
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
  fireEvent.click(screen.getByRole("button", { name: t.uiRefresh.dealValue }));
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
  fireEvent.click(screen.getByRole("button", { name: t.uiRefresh.dealValue }));
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

test("slider updates preserve scope and sorting, and its full range restores unpriced deals", async () => {
  await mountCrm(
    harness,
    `/opportunities?owner=${demoUser}&sort=name_desc&layout=board`,
  );
  fireEvent.click(screen.getByRole("button", { name: t.uiRefresh.dealValue }));
  const minimum = screen.getByRole("slider", {
    name: t.uiRefresh.minimumSlider,
  });
  fireEvent.keyDown(minimum, { key: "ArrowRight" });
  expect(
    Object.fromEntries(new URLSearchParams(window.location.search)),
  ).toEqual({
    owner: demoUser,
    sort: "name_desc",
    layout: "board",
    minimum: "50.00",
  });
  expect(
    screen.getByRole("button", { name: "Cedar workflow pilot" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Northstar evaluation project" }),
  ).toBeNull();
  fireEvent.keyDown(minimum, { key: "Home" });
  expect(
    Object.fromEntries(new URLSearchParams(window.location.search)),
  ).toEqual({
    owner: demoUser,
    sort: "name_desc",
    layout: "board",
  });
  expect(
    screen.getByRole("button", { name: "Northstar evaluation project" }),
  ).toBeTruthy();
});

test("hiding the bar preserves active filters and clear remains available", async () => {
  await mountCrm(harness, "/opportunities?minimum=1000");
  fireEvent.click(
    screen.getByRole("button", { name: t.uiRefresh.hideFilters }),
  );
  expect(
    screen.queryByRole("button", { name: t.uiRefresh.dealValue }),
  ).toBeNull();
  expect(new URLSearchParams(window.location.search).get("minimum")).toBe(
    "1000",
  );
  expect(
    screen.queryByRole("button", { name: "Northstar evaluation project" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: t.clearFilters }));
  expect(window.location.search).toBe("");
  expect(
    screen.getByRole("button", { name: "Northstar evaluation project" }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: t.uiRefresh.showFilters }),
  );
  expect(
    screen.getByRole("button", { name: t.uiRefresh.dealValue }),
  ).toBeTruthy();
});

test.each([
  { draft: "unselected", layout: "list", nextLayout: "board" },
  { draft: "invalid", layout: "board", nextLayout: "list" },
])(
  "the opportunities empty-state reset clears an $draft custom field draft and preserves a pending $nextLayout layout",
  async ({ draft, layout, nextLayout }) => {
    await harness.local.db
      .update(s.relationships)
      .set({
        contextDetails: {
          ...emptyRelationshipDetails(),
          fields: [
            { id: demoId(8960), label: "Seats", type: "number", value: 0 },
          ],
        },
      })
      .where(eq(s.relationships.id, demoId(300)));
    await mountCrm(
      harness,
      `/opportunities?${new URLSearchParams({ layout, sort: "name_desc", pipeline: demoId(1210), stage: demoId(801), owner: demoUser })}`,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "No fictional matching deal" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: t.uiRefresh.customFields }),
    );
    const popup = within(
      screen.getByRole("dialog", { name: t.uiRefresh.customFields }),
    );
    fireEvent.click(
      popup.getByRole("button", { name: t.contextFields.addField }),
    );
    if (draft === "invalid") {
      await chooseSelect(
        popup.getByRole("combobox", { name: t.fieldFilters.field }),
        `Seats · ${t.contextFields.fieldTypes.number}`,
      );
      expect(screen.getByText(t.fieldFilters.invalid)).toBeTruthy();
    } else {
      expect(
        new URLSearchParams(window.location.search).has("fieldFilters"),
      ).toBe(false);
    }
    fireEvent.click(popup.getByRole("button", { name: t.close }));
    const empty = screen
      .getByText(t.uiRefresh.noMatchingDeals)
      .closest<HTMLElement>(".empty-state");
    if (!empty) throw new Error("Missing opportunities empty-state recovery");
    const clear = within(empty).getByRole("button", { name: t.clearFilters });
    act(() => {
      fireEvent.click(
        screen.getByRole("button", {
          name:
            nextLayout === "list"
              ? t.inlineEditing.list
              : t.inlineEditing.board,
        }),
      );
      fireEvent.click(clear);
    });
    expect(
      Object.fromEntries(new URLSearchParams(window.location.search)),
    ).toEqual(nextLayout === "list" ? { layout: "list" } : {});
    expect(screen.getByRole("searchbox")).toHaveProperty("value", "");
    expect(
      screen.getByRole("combobox", { name: t.sortBy }).textContent,
    ).toContain(t.defaultOrder);
    expect(
      screen
        .getByRole("button", {
          name:
            nextLayout === "list"
              ? t.inlineEditing.list
              : t.inlineEditing.board,
        })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Northstar evaluation project" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Cedar workflow pilot" }),
    ).toBeTruthy();
    expect(screen.queryByText(t.fieldFilters.invalid)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: t.uiRefresh.customFields }),
    );
    const reset = within(
      screen.getByRole("dialog", { name: t.uiRefresh.customFields }),
    );
    expect(reset.queryAllByRole("group")).toHaveLength(0);
    fireEvent.click(
      reset.getByRole("button", { name: t.contextFields.addField }),
    );
    expect(
      reset.getByRole("group", { name: `${t.fieldFilters.field} 1` }),
    ).toBeTruthy();
    expect(
      reset.queryByRole("group", { name: `${t.fieldFilters.field} 2` }),
    ).toBeNull();
    expect(screen.queryByText(t.fieldFilters.invalid)).toBeNull();
  },
);

test("malformed custom-field rules alone expose the opportunities empty-state reset and recover the list", async () => {
  await mountCrm(harness, "/opportunities?layout=list&fieldFilters=invalid");
  expect(screen.getByText(t.fieldFilters.invalid)).toBeTruthy();
  const empty = screen
    .getByText(t.uiRefresh.noMatchingDeals)
    .closest<HTMLElement>(".empty-state");
  if (!empty)
    throw new Error("Missing invalid custom-field empty-state recovery");
  fireEvent.click(within(empty).getByRole("button", { name: t.clearFilters }));
  expect(
    Object.fromEntries(new URLSearchParams(window.location.search)),
  ).toEqual({ layout: "list" });
  expect(screen.queryByText(t.fieldFilters.invalid)).toBeNull();
  expect(
    screen.getByRole("button", { name: "Northstar evaluation project" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Cedar workflow pilot" }),
  ).toBeTruthy();
});
