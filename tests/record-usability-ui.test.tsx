// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { describe, expect, test, vi } from "vitest";
import * as s from "../packages/database/schema";
import { demoId, demoUser } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { installCrmHarness, mountCrm } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (original) => ({
  ...(await original<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
const harness = installCrmHarness();
const inspector = () =>
  within(screen.getByRole("complementary", { name: t.recordDetails }));

describe("browsing records", () => {
  test("an open metadata form rejects a concurrent record revision", async () => {
    await mountCrm(harness, "/people");
    fireEvent.click(screen.getByRole("link", { name: "Jonah Reed" }));
    await inspector().findByRole("heading", { name: "Jonah Reed" });
    fireEvent.click(
      inspector().getAllByRole("button", {
        name: t.editDealSizeAndTags,
      })[0] as HTMLElement,
    );
    const dialog = screen.getByRole("dialog", { name: t.editDealSizeAndTags });
    fireEvent.change(within(dialog).getByLabelText(t.tags), {
      target: { value: "Local" },
    });
    await harness.local.db
      .update(s.people)
      .set({ tags: ["External"], version: 2 })
      .where(eq(s.people.id, demoId(201)));
    fireEvent.focus(window);
    await inspector().findByText("External", {}, { timeout: 5000 });
    fireEvent.click(within(dialog).getByRole("button", { name: t.save }));
    expect(
      (await within(dialog).findAllByText(t.errors.CONFLICT)).length,
    ).toBeGreaterThan(0);
    const [person] = await harness.local.db
      .select()
      .from(s.people)
      .where(eq(s.people.id, demoId(201)));
    expect(person.tags).toEqual(["External"]);
    expect(person.version).toBe(2);
  });
  test("editing from a compact list preserves the complete summary", async () => {
    await mountCrm(harness, "/people", true);
    fireEvent.click(screen.getByRole("link", { name: "Jonah Reed" }));
    await inspector().findByRole("heading", { name: "Jonah Reed" });
    fireEvent.click(inspector().getByRole("button", { name: t.edit }));
    const dialog = await screen.findByRole("dialog", { name: t.editPerson });
    await waitFor(() =>
      expect(within(dialog).getByLabelText(t.summary)).toHaveProperty(
        "value",
        "Requested API documentation; no purchase decision confirmed.",
      ),
    );
    fireEvent.change(within(dialog).getByLabelText(t.roleTitle), {
      target: { value: "Founder and CEO" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t.save }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: t.editPerson })).toBeNull(),
    );
    const [person] = await harness.local.db
      .select()
      .from(s.people)
      .where(eq(s.people.id, demoId(201)));
    expect(person.summary).toBe(
      "Requested API documentation; no purchase decision confirmed.",
    );
  });
  test("person links and company row cells open the inspector and preserve the list", async () => {
    await mountCrm(harness, "/people");
    const person = screen.getByRole("link", { name: "Jonah Reed" });
    fireEvent.click(person);
    expect(window.location.pathname).toBe("/people");
    expect(
      await inspector().findByRole("heading", { name: "Jonah Reed" }),
    ).toBeTruthy();
    fireEvent.click(
      inspector().getByRole("button", { name: t.closeInspector }),
    );
    expect(
      screen.queryByRole("complementary", { name: t.recordDetails }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: t.companies }));
    const company = screen.getByRole("link", { name: "Northstar Labs" });
    const cell = company.closest("tr")?.querySelectorAll("td")[4];
    if (!cell) throw new Error("missing company cell");
    fireEvent.click(cell);
    expect(window.location.pathname).toBe("/companies");
    expect(
      await inspector().findByRole("heading", { name: "Northstar Labs" }),
    ).toBeTruthy();
    expect(
      inspector()
        .getByRole("link", { name: t.openRecord })
        .getAttribute("href"),
    ).toBe(`/companies/${demoId(100)}`);
  });
  test("inspector edits persist tags and deal size, and filters use them", async () => {
    await mountCrm(harness, "/people");
    fireEvent.click(screen.getByRole("link", { name: "Jonah Reed" }));
    await inspector().findByRole("heading", { name: "Jonah Reed" });
    fireEvent.click(
      inspector().getAllByRole("button", {
        name: t.editDealSizeAndTags,
      })[0] as HTMLElement,
    );
    const dialog = screen.getByRole("dialog", { name: t.editDealSizeAndTags });
    fireEvent.change(within(dialog).getByLabelText(t.tags), {
      target: { value: "Enterprise, Priority" },
    });
    fireEvent.change(within(dialog).getByLabelText(t.dealSize), {
      target: { value: "25000" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t.save }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: t.editDealSizeAndTags }),
      ).toBeNull(),
    );
    const [stored] = await harness.local.db
      .select()
      .from(s.people)
      .where(eq(s.people.id, demoId(201)));
    expect(stored).toMatchObject({
      tags: ["Enterprise", "Priority"],
      amountMinor: 2500000,
      currency: "USD",
      version: 2,
    });
    fireEvent.click(
      inspector().getByRole("button", { name: t.closeInspector }),
    );
    fireEvent.click(screen.getByText(t.filters));
    fireEvent.change(screen.getByLabelText(t.tags), {
      target: { value: "enterprise" },
    });
    fireEvent.change(screen.getByLabelText(t.minimumDealSize), {
      target: { value: "20000" },
    });
    const table = within(screen.getByRole("table"));
    expect(table.getAllByRole("row")).toHaveLength(2);
    expect(table.getByRole("link", { name: "Jonah Reed" })).toBeTruthy();
    expect(table.getByText("$25,000")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(t.currency), {
      target: { value: "USD" },
    });
    fireEvent.change(screen.getByLabelText(t.maximumDealSize), {
      target: { value: "100" },
    });
    expect(screen.getByText(t.invalidDealRange).textContent).toBe(
      t.invalidDealRange,
    );
    fireEvent.click(screen.getByRole("button", { name: t.clearFilters }));
    expect(table.getAllByRole("row").length).toBeGreaterThan(2);
  });
  test("pages bound the DOM, reset on search, and retain page on inspector close", async () => {
    const people = Array.from({ length: 105 }, (_, index) => ({
      id: demoId(2000 + index),
      organizationId: demoId(1),
      name: `Fictional Contact ${String(index).padStart(3, "0")}`,
    }));
    await harness.local.db.insert(s.people).values(people);
    await harness.local.db.insert(s.relationships).values(
      people.map((person, index) => ({
        id: demoId(3000 + index),
        organizationId: demoId(1),
        productId: demoId(10),
        personId: person.id,
        ownerId: demoUser,
        purpose: "buyer",
      })),
    );
    await mountCrm(harness, "/people");
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
      51,
    );
    fireEvent.click(screen.getByRole("button", { name: t.nextPage }));
    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
    const first = within(screen.getByRole("table")).getAllByRole("link")[0];
    if (!first) throw new Error("missing person");
    fireEvent.click(first);
    await inspector().findByRole("button", { name: t.closeInspector });
    fireEvent.click(
      inspector().getByRole("button", { name: t.closeInspector }),
    );
    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: t.search }), {
      target: { value: "Fictional Contact 104" },
    });
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
      2,
    );
    expect(screen.getByText("Page 1 of 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: t.nextPage })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
