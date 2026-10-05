// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { eq } from "drizzle-orm";
import { describe, expect, test, vi } from "vitest";
import * as s from "../packages/database/schema";
import { demoId } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { outreachTabs } from "../src/components/routes";
import { installCrmHarness, mountCrm } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));

const harness = installCrmHarness();
const pathname = () => window.location.pathname;
const tabs = () =>
  screen.getByRole("navigation", { name: t.outreachTabsLabel });
const tabLink = (name: string | RegExp) =>
  within(tabs()).getByRole("link", { name });
const groups = () =>
  screen
    .getAllByRole("group")
    .map((group) => group.getAttribute("aria-label") ?? "");

describe("outreach routes and tabs", () => {
  test("each tab renders from its own deep link with the tab marked current", async () => {
    for (const tab of outreachTabs) {
      await mountCrm(harness, `/outreach/${tab}`);
      const name = t.outreachTabs[tab];
      await waitFor(() =>
        expect(
          within(tabs())
            .getByRole("link", { name: new RegExp(`^${name}`) })
            .getAttribute("aria-current"),
        ).toBe("page"),
      );
      expect(
        await screen.findByRole("region", { name: `${t.outreach}: ${name}` }),
      ).toBeTruthy();
      cleanup();
    }
  });

  test("the tabs are links, so Back returns to the previous tab and /outreach lands on Today", async () => {
    await mountCrm(harness, "/outreach");
    await waitFor(() => expect(pathname()).toBe("/outreach/today"));
    fireEvent.click(tabLink(new RegExp(`^${t.outreachTabs.drafts}`)));
    await waitFor(() => expect(pathname()).toBe("/outreach/drafts"));
    fireEvent.click(tabLink(new RegExp(`^${t.outreachTabs.sent}`)));
    await waitFor(() => expect(pathname()).toBe("/outreach/sent"));
    await act(async () => window.history.back());
    await waitFor(() => expect(pathname()).toBe("/outreach/drafts"));
    expect(
      tabLink(new RegExp(`^${t.outreachTabs.drafts}`)).getAttribute(
        "aria-current",
      ),
    ).toBe("page");
    expect(
      await screen.findByRole("region", {
        name: `${t.outreach}: ${t.outreachTabs.drafts}`,
      }),
    ).toBeTruthy();
  });

  test("Today groups due touches by follow-up with counts and puts overdue ones first", async () => {
    await harness.local.db
      .update(s.enrollments)
      .set({ status: "running", pauseReason: null })
      .where(eq(s.enrollments.id, demoId(500)));
    await mountCrm(harness, "/outreach/today");
    await waitFor(() =>
      expect(groups()).toEqual([
        `${t.followUpGroups[0]}: 1`,
        `${t.followUpGroups[1]}: 1`,
        `${t.followUpGroups[2]}: 2`,
      ]),
    );
    const followUp2 = screen.getByRole("group", {
      name: `${t.followUpGroups[2]}: 2`,
    });
    const rows = within(followUp2).getAllByRole("button", {
      name: new RegExp(t.followUpGroups[2]),
    });
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      `Mira Chen, ${t.followUpGroups[2]}, ${t.overdue}`,
      `Noor Haddad, ${t.followUpGroups[2]}`,
    ]);
    expect(within(followUp2).getByText(t.overdue)).toBeTruthy();
  });
});
