// @vitest-environment jsdom
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { eq } from "drizzle-orm";
import { describe, expect, test, vi } from "vitest";
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
const inspector = () =>
  within(screen.getByRole("complementary", { name: t.recordDetails }));

describe("browsing records", () => {
  test.each(["/companies", "/materials", `/people/${demoId(200)}`])(
    "sidebar products open the overview from %s and clear the old record",
    async (path) => {
      await mountCrm(harness, path);
      const sidebar = document.getElementById("navigation-panel");
      const product = sidebar?.querySelector<HTMLElement>(
        `[data-nav-item="product-${demoId(10)}"]`,
      );
      if (!product) throw new Error("missing product navigation");
      fireEvent.click(product);
      expect(window.location.pathname).toBe("/overview");
      expect(screen.getByRole("combobox", { name: t.product })).toHaveProperty(
        "value",
        demoId(10),
      );
      expect(document.querySelector(".record-page")).toBeNull();
      expect(
        screen.queryByRole("complementary", { name: t.recordDetails }),
      ).toBeNull();
      const all = sidebar?.querySelector<HTMLElement>(
        '[data-nav-item="all-products"]',
      );
      if (!all) throw new Error("missing all-products navigation");
      fireEvent.click(all);
      expect(window.location.pathname).toBe("/overview");
      expect(screen.getByRole("combobox", { name: t.product })).toHaveProperty(
        "value",
        "",
      );
    },
  );
  test("the toolbar product picker filters companies without navigating", async () => {
    await mountCrm(harness, "/companies");
    fireEvent.change(screen.getByRole("combobox", { name: t.product }), {
      target: { value: demoId(10) },
    });
    expect(window.location.pathname).toBe("/companies");
    expect(screen.getByRole("table")).toBeTruthy();
  });
  test("long person notes stay out of contact details and remain readable in the main panel", async () => {
    const summary = "A fictional imported review. ".repeat(40);
    await harness.local.db
      .update(s.people)
      .set({ summary })
      .where(eq(s.people.id, demoId(200)));
    await mountCrm(harness, `/people/${demoId(200)}`);
    const notes = await screen.findByRole("region", { name: t.personNotes });
    expect(
      document.querySelector(".record-attributes .record-text"),
    ).toBeNull();
    const details = notes.querySelector("details");
    expect(details?.open).toBe(false);
    expect(details?.querySelector("p")?.textContent).toBe(summary);
    expect(
      notes.querySelector(".record-text-preview")?.textContent?.length,
    ).toBeLessThan(330);
    const timeline = document.querySelector(".record-timeline");
    expect(timeline?.firstElementChild?.className).toBe("tabs");
  });
  test("calendar descriptions are bounded while full details and editing preserve the original", async () => {
    const summary =
      "Fictional invitation and meeting link https://example.test/meeting ".repeat(
        30,
      );
    const [meeting] = await harness.local.db.select().from(s.meetings).limit(1);
    if (!meeting) throw new Error("missing meeting fixture");
    await harness.local.db
      .update(s.meetings)
      .set({ summary })
      .where(eq(s.meetings.id, meeting.id));
    await mountCrm(harness, "/meetings");
    const article = document.querySelector(`[data-record-id="${meeting.id}"]`);
    expect(
      article?.querySelector(".record-text-preview")?.textContent?.length,
    ).toBeLessThan(250);
    const details = article?.querySelector("details");
    expect(details?.open).toBe(false);
    expect(details?.querySelector("p")?.textContent).toBe(summary);
    if (!article) throw new Error("missing meeting row");
    fireEvent.click(
      within(article as HTMLElement).getByRole("button", {
        name: `${t.editMeeting}: ${meeting.title}`,
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: t.editMeeting });
    expect(within(dialog).getByLabelText(t.summary)).toHaveProperty(
      "value",
      summary,
    );
  });
  test("URL filters reset the current list page", async () => {
    const [existing] = await harness.local.db.select().from(s.actions).limit(1);
    if (!existing) throw new Error("missing action fixture");
    await harness.local.db.insert(s.actions).values(
      Array.from({ length: 105 }, (_, index) => ({
        ...existing,
        id: demoId(5000 + index),
        ownerId: demoUser,
        title: `Fictional action ${index}`,
        status: "open" as const,
      })),
    );
    await mountCrm(harness, "/actions");
    const list = within(screen.getByRole("region", { name: t.actions }));
    fireEvent.click(list.getByRole("button", { name: t.nextPage }));
    expect(list.getByText("Page 2 of 3")).toBeTruthy();
    act(() => visit(`/actions?owner=${demoUser}`));
    expect(list.getByText("Page 1 of 3")).toBeTruthy();
  });
  test("archiving from an action inspector retains the actions list", async () => {
    await mountCrm(harness, "/actions", { compact: true });
    const action = document.querySelector<HTMLElement>(
      "button[data-nav-record]",
    );
    if (!action) throw new Error("missing action fixture");
    fireEvent.click(action);
    fireEvent.click(
      await inspector().findByRole("button", { name: t.archive }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: t.recordDetails }),
      ).toBeNull(),
    );
    expect(window.location.pathname).toBe("/actions");
    expect(
      harness.posts.some((post) => post.operation === "person-archive"),
    ).toBe(true);
  });
  test.each(["person", "company"] as const)(
    "an open %s editor retains its initial revision after a live refresh",
    async (entity) => {
      await mountCrm(harness, entity === "person" ? "/people" : "/companies", {
        compact: true,
      });
      const id = entity === "person" ? demoId(201) : demoId(100);
      const name = entity === "person" ? "Jonah Reed" : "Northstar Labs";
      fireEvent.click(screen.getByRole("link", { name }));
      fireEvent.click(await inspector().findByRole("button", { name: t.edit }));
      const title = entity === "person" ? t.editPerson : t.editCompany;
      const dialog = await screen.findByRole("dialog", { name: title });
      await waitFor(() =>
        expect(within(dialog).getByLabelText(t.name)).toHaveProperty(
          "value",
          name,
        ),
      );
      fireEvent.change(within(dialog).getByLabelText(t.name), {
        target: { value: "Local edit" },
      });
      const table = entity === "person" ? s.people : s.companies;
      await harness.local.db
        .update(table)
        .set({ name: "External edit", version: 2 })
        .where(eq(table.id, id));
      fireEvent.focus(window);
      await inspector().findByRole(
        "heading",
        { name: "External edit" },
        { timeout: 5000 },
      );
      fireEvent.click(within(dialog).getByRole("button", { name: t.save }));
      expect(
        (await within(dialog).findAllByText(t.errors.CONFLICT)).length,
      ).toBeGreaterThan(0);
      const [stored] = await harness.local.db
        .select()
        .from(table)
        .where(eq(table.id, id));
      expect(stored).toMatchObject({ name: "External edit", version: 2 });
    },
  );
  test("an open metadata form rejects a concurrent record revision", async () => {
    await mountCrm(harness, "/people");
    fireEvent.click(screen.getByRole("link", { name: "Jonah Reed" }));
    await inspector().findByRole("heading", { name: "Jonah Reed" });
    const estimate = inspector()
      .getByText(t.personDealSizeAndTags)
      .closest("summary");
    if (!estimate) throw new Error("missing estimate disclosure");
    fireEvent.click(estimate);
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
    await mountCrm(harness, "/people", { compact: true });
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
    expect(inspector().queryByRole("link", { name: t.openRecord })).toBeNull();
    fireEvent.click(
      inspector().getByRole("button", { name: t.expandInspector }),
    );
    expect(document.querySelector(".inspector-expanded")).toBeTruthy();
    expect(window.location.pathname).toBe("/companies");
  });
  test("inspector edits persist tags and deal size, and filters use them", async () => {
    await mountCrm(harness, "/people");
    fireEvent.click(screen.getByRole("link", { name: "Jonah Reed" }));
    await inspector().findByRole("heading", { name: "Jonah Reed" });
    const estimate = inspector()
      .getByText(t.personDealSizeAndTags)
      .closest("summary");
    if (!estimate) throw new Error("missing estimate disclosure");
    fireEvent.click(estimate);
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
    expect(table.getByText("$25,000.00")).toBeTruthy();
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
