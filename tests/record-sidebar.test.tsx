// @vitest-environment jsdom
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { demoId } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { personPath } from "../src/components/routes";
import { installCrmHarness, mountCrm } from "./support/crm-harness";
import { navigations } from "./support/memory-router";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (original) => ({
  ...(await original<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
const harness = installCrmHarness();
const panel = () =>
  within(screen.getByRole("complementary", { name: t.recordDetails }));

describe("records stay in the inspector", () => {
  test("outreach Enter opens the person while Space opens the inline touch editor", async () => {
    await mountCrm(harness, "/outreach/today");
    const row = await screen.findByRole("button", { name: /^Noor Haddad,/ });
    fireEvent.keyDown(row, { key: "Enter" });
    await panel().findByRole("heading", { name: "Noor Haddad" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.location.pathname).toBe("/outreach/today");
    fireEvent.keyDown(row, { key: " " });
    await screen.findByRole("region", {
      name: t.draftEditorTitle.replace("{name}", "Noor Haddad"),
    });
    expect(window.location.pathname).toBe("/outreach/today");
  });
  test("company activity includes completed work and opens its person in place", async () => {
    await mountCrm(harness, "/companies");
    fireEvent.click(screen.getByRole("link", { name: "Northstar Labs" }));
    const completed = await panel().findByRole("button", {
      name: "Coordinate across products",
    });
    fireEvent.click(completed);
    await panel().findByRole("heading", { name: "Mira Chen" });
    expect(window.location.pathname).toBe("/companies");
  });
  test("a person link ignores an action belonging to another relationship", async () => {
    await mountCrm(harness, "/people");
    const link = screen.getByRole("link", { name: "Mira Chen" });
    link.setAttribute(
      "href",
      personPath(demoId(200), {
        relationshipId: demoId(300),
        actionId: demoId(601),
      }),
    );
    fireEvent.click(link);
    await panel().findByRole("heading", { name: "Mira Chen" });
    expect(panel().queryByText("Answer the API format question")).toBeNull();
    expect(
      panel().queryByRole("button", { name: new RegExp(`^${t.draft}`) }),
    ).toBeNull();
  });
  test("Enter and repeated person selections preserve the same list and URL", async () => {
    await mountCrm(harness, "/people");
    const list = screen.getByRole("table");
    const before = navigations.length;
    fireEvent.keyDown(screen.getByRole("link", { name: "Mira Chen" }), {
      key: "Enter",
    });
    expect(window.location.pathname).toBe("/people");
    await panel().findByRole("heading", { name: "Mira Chen" });
    fireEvent.click(screen.getByRole("link", { name: "Jonah Reed" }));
    await panel().findByRole("heading", { name: "Jonah Reed" });
    expect(screen.getByRole("table")).toBe(list);
    expect(navigations.length).toBe(before);
    expect(
      panel().getByRole("link", { name: t.inlineEditing.openFullPage }),
    ).toBeTruthy();
    expect(window.location.pathname).toBe("/people");
    expect(navigations.length).toBe(before);
    expect(
      screen.getByRole("separator", { name: t.resizeInspector }),
    ).toBeTruthy();
  });
  test("company Enter and linked contacts replace inspector content without leaving companies", async () => {
    await mountCrm(harness, "/companies");
    const list = screen.getByRole("table");
    fireEvent.keyDown(screen.getByRole("link", { name: "Northstar Labs" }), {
      key: "Enter",
    });
    expect(window.location.pathname).toBe("/companies");
    await panel().findByRole("heading", { name: "Northstar Labs" });
    fireEvent.click(panel().getByRole("button", { name: /Mira Chen/ }));
    await panel().findByRole("heading", { name: "Mira Chen" });
    expect(screen.getByRole("table")).toBe(list);
    expect(window.location.pathname).toBe("/companies");
    fireEvent.click(panel().getByRole("button", { name: t.backToRecord }));
    await panel().findByRole("heading", { name: "Northstar Labs" });
  });
});
