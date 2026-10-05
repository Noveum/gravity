// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { eq } from "drizzle-orm";
import { describe, expect, test, vi } from "vitest";
import * as s from "../packages/database/schema";
import { demoId } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { dateLabel } from "../src/components/client-api";
import { outreachTabs } from "../src/components/routes";
import {
  installCrmHarness,
  mountCrm,
  organizations,
} from "./support/crm-harness";

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

describe("touch rows, the draft drawer and paused work", () => {
  const touch = async (id: number) => {
    const [found] = await harness.local.db
      .select()
      .from(s.touches)
      .where(eq(s.touches.id, demoId(id)));
    if (!found) throw new Error("missing touch");
    return found;
  };
  const verb = (name: keyof typeof t.touchVerbs, person: string) =>
    screen.findByRole("button", { name: `${t.touchVerbs[name]}: ${person}` });

  test("the row buttons approve and snooze with undo, and the drawer shows the person's context beside the draft", async () => {
    await mountCrm(harness, "/outreach/drafts");
    fireEvent.click(await verb("approve", "Noor Haddad"));
    await screen.findByText(t.touchApproved.replace("{name}", "Noor Haddad"));
    expect((await touch(1307)).status).toBe("approved");
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: t.outreachTabsLabel }),
      ).getByRole("link", { name: new RegExp(`^${t.outreachTabs.today}`) }),
    );
    const before = await touch(1310);
    fireEvent.click(await verb("snooze", "Ellis Park"));
    const toast = await screen.findByText(/^Snoozed the message to Ellis Park/);
    expect((await touch(1310)).dueAt.getTime()).toBeGreaterThan(
      before.dueAt.getTime(),
    );
    fireEvent.click(
      within(toast.parentElement as HTMLElement).getByRole("button", {
        name: t.undo,
      }),
    );
    await screen.findByText(t.verbUndone);
    expect((await touch(1310)).dueAt.toISOString()).toBe(
      before.dueAt.toISOString(),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /^Noor Haddad, / }),
    );
    const drawer = await screen.findByRole("dialog", {
      name: t.draftEditorTitle.replace("{name}", "Noor Haddad"),
    });
    expect(
      await within(drawer).findByText("Send follow-up 2 with the case study"),
    ).toBeTruthy();
    expect(within(drawer).getByText(t.outreachStages.followUp)).toBeTruthy();
    expect(
      await within(drawer).findByText(
        "Hi Noor, good to meet you at the meetup. Here is the two-page summary.",
      ),
    ).toBeTruthy();
    fireEvent.click(
      within(drawer).getByRole("button", { name: t.touchVerbs.skip }),
    );
    const skip = await screen.findByRole("dialog", { name: t.skipTitle });
    fireEvent.change(within(skip).getByLabelText(t.skipReason), {
      target: { value: "Not relevant now" },
    });
    fireEvent.click(within(skip).getByRole("button", { name: t.skipSubmit }));
    await screen.findByText(t.touchSkipped.replace("{name}", "Noor Haddad"));
    expect((await touch(1307)).status).toBe("skipped");
  });

  test("Approved shows each send-after time in the workspace zone, never as raw ISO", async () => {
    const zone = organizations[0]?.timezone ?? "UTC";
    if (organizations[0]) organizations[0].timezone = "Asia/Tokyo";
    try {
      await harness.local.db.insert(s.contactRules).values({
        organizationId: demoId(1),
        cooldownDays: 10,
        dailyCapPerSender: 40,
        quietHoursStart: 0,
        quietHoursEnd: 0,
      });
      const [amara] = await harness.local.db
        .select()
        .from(s.relationships)
        .where(eq(s.relationships.id, demoId(304)));
      const until = new Date(
        (amara?.lastOutboundAt?.getTime() ?? 0) + 10 * 86400000,
      ).toISOString();
      await mountCrm(harness, "/outreach/approved");
      const badge = await screen.findByText(
        t.sendAfter.replace("{time}", dateLabel(until, "Asia/Tokyo")),
      );
      expect(badge.getAttribute("title")).toBe(
        t.gateReasons.CONTACT_COOLDOWN.replace(
          "{until}",
          dateLabel(until, "Asia/Tokyo"),
        ),
      );
      expect(
        screen.getByRole("region", {
          name: `${t.outreach}: ${t.outreachTabs.approved}`,
        }).textContent,
      ).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    } finally {
      if (organizations[0]) organizations[0].timezone = zone;
    }
  });

  test("Resume restarts paused work and is refused with the translated reason for do not contact and archived people, who carry an Archived flag", async () => {
    const mira = demoId(200);
    await harness.local.db
      .update(s.people)
      .set({ doNotContact: true })
      .where(eq(s.people.id, mira));
    await mountCrm(harness, "/outreach/paused");
    const resume = await screen.findByRole("button", {
      name: `${t.resume}: Mira Chen`,
    });
    fireEvent.click(resume);
    await screen.findByText(t.errors.DO_NOT_CONTACT);
    await harness.local.db
      .update(s.people)
      .set({ doNotContact: false, archivedAt: new Date() })
      .where(eq(s.people.id, mira));
    cleanup();
    await mountCrm(harness, "/outreach/paused");
    expect(
      await screen.findByRole("button", {
        name: `Mira Chen, ${t.paused_reply}, ${t.archivedFlag}`,
      }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: `${t.resume}: Mira Chen` }),
    );
    await screen.findByText(t.errors.RECORD_ARCHIVED);
    await harness.local.db
      .update(s.people)
      .set({ archivedAt: null })
      .where(eq(s.people.id, mira));
    fireEvent.click(
      screen.getByRole("button", { name: `${t.resume}: Mira Chen` }),
    );
    await screen.findByText(t.resumed.replace("{name}", "Mira Chen"));
    const [enrollment] = await harness.local.db
      .select()
      .from(s.enrollments)
      .where(eq(s.enrollments.id, demoId(500)));
    expect(enrollment).toMatchObject({ status: "running", pauseReason: null });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: `${t.resume}: Mira Chen` }),
      ).toBeNull(),
    );
  });
});

describe("enrolling from People", () => {
  const person = (name: string) =>
    screen.getByRole("link", { name: new RegExp(`^${name}`) });
  const press = (keys: string) => userEvent.setup().keyboard(keys);

  test("X selects people, Enroll on the chip picks a sequence, the dry run lists who is skipped and why, and confirm enrolls", async () => {
    await harness.local.db
      .update(s.people)
      .set({ doNotContact: true })
      .where(eq(s.people.id, demoId(203)));
    await mountCrm(harness, "/people");
    for (const name of ["Leena Rao", "Theo Grant", "Jonah Reed"]) {
      person(name).focus();
      await press("x");
    }
    fireEvent.click(screen.getByRole("button", { name: t.enrollSelected }));
    const dialog = await screen.findByRole("dialog", { name: t.enrollTitle });
    fireEvent.change(within(dialog).getByLabelText(t.sequenceLabel), {
      target: { value: demoId(402) },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: t.enrollReview }),
    );
    const will = await within(dialog).findByRole("region", {
      name: t.enrollWill.replace("{count}", "1"),
    });
    expect(within(will).getByText("Leena Rao")).toBeTruthy();
    const skipped = within(dialog).getByRole("region", {
      name: t.enrollSkipped.replace("{count}", "2"),
    });
    expect(
      within(skipped)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      `Theo Grant: ${t.outreachCopy.skipReasons.do_not_contact}`,
      `Jonah Reed: ${t.outreachCopy.skipReasons.other_brand}`,
    ]);
    expect(
      harness.posts.filter((post) => post.operation === "enroll"),
    ).toMatchObject([{ dryRun: true, sequenceId: demoId(402) }]);
    expect(
      await harness.local.db
        .select()
        .from(s.enrollments)
        .where(eq(s.enrollments.relationshipId, demoId(302))),
    ).toHaveLength(0);
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: t.enrollConfirm.replace("{people}", t.personCountOne),
      }),
    );
    await screen.findByText(
      t.enrollDone
        .replace("{people}", t.personCountOne)
        .replace("{sequence}", "Pilot conversation"),
    );
    expect(
      await harness.local.db
        .select()
        .from(s.enrollments)
        .where(eq(s.enrollments.relationshipId, demoId(302))),
    ).toMatchObject([{ status: "running", sequenceId: demoId(402) }]);
    expect(screen.queryByRole("button", { name: t.enrollSelected })).toBeNull();
  });

  test("the palette enrolls the focused person and the dry run says they are already in the sequence", async () => {
    await mountCrm(harness, "/people");
    person("Amara Stone").focus();
    await press("{Meta>}k{/Meta}");
    await userEvent
      .setup()
      .type(screen.getByRole("combobox", { name: t.commandSearch }), "Enroll");
    await press("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: t.enrollTitle });
    expect(
      within(dialog).getByText(
        t.enrollChosen.replace("{people}", "Amara Stone"),
      ),
    ).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(t.sequenceLabel), {
      target: { value: demoId(400) },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: t.enrollReview }),
    );
    const skipped = await within(dialog).findByRole("region", {
      name: t.enrollSkipped.replace("{count}", "1"),
    });
    expect(within(skipped).getByRole("listitem").textContent).toBe(
      `Amara Stone: ${t.outreachCopy.skipReasons.already_enrolled}`,
    );
    expect(within(dialog).getByText(t.enrollNobody)).toBeTruthy();
    expect(
      (
        within(dialog).getByRole("button", {
          name: t.enrollConfirm.replace(
            "{people}",
            t.personCount.replace("{count}", "0"),
          ),
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
