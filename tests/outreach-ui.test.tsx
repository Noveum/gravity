// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
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
import {
  dateLabel,
  RequestError,
  requestJson,
} from "../src/components/client-api";
import { outreachTabs } from "../src/components/routes";
import { Shortcuts } from "../src/components/shortcuts";
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
    .getAllByRole("group", { name: /touch:|Follow-up/ })
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

  test("the outreach view advances enrollments with a POST before it reads the due list", async () => {
    await mountCrm(harness, "/outreach/today");
    await screen.findByRole("region", {
      name: `${t.outreach}: ${t.outreachTabs.today}`,
    });
    const calls = vi.mocked(requestJson).mock.calls;
    const advance = calls.findIndex(
      ([url, init]) =>
        url === "/api/outreach" &&
        init?.method === "POST" &&
        JSON.parse(String(init.body)).operation === "advance",
    );
    const due = calls.findIndex(([url]) =>
      String(url).startsWith("/api/outreach?operation=due"),
    );
    expect(advance).toBeGreaterThanOrEqual(0);
    expect(due).toBeGreaterThan(advance);
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

  test("a touch delivered twice by a reload renders once in its list", async () => {
    await harness.local.db
      .update(s.enrollments)
      .set({ status: "running", pauseReason: null })
      .where(eq(s.enrollments.id, demoId(500)));
    const respond = vi.mocked(requestJson).getMockImplementation();
    if (!respond) throw new Error("missing harness responder");
    vi.mocked(requestJson).mockImplementation(async (url, init) => {
      const value = await respond(url, init);
      if (!String(url).startsWith("/api/outreach?operation=due")) return value;
      const due = value as {
        groups: { followUp: number; touches: unknown[] }[];
      };
      return {
        ...due,
        groups: due.groups.map((group) => ({
          ...group,
          touches: [...group.touches, ...group.touches],
        })),
      };
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
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
      expect(
        within(followUp2).getAllByRole("button", {
          name: new RegExp(t.followUpGroups[2]),
        }),
      ).toHaveLength(2);
      expect(
        errors.mock.calls.some((call) => String(call[0]).includes("same key")),
      ).toBe(false);
    } finally {
      errors.mockRestore();
    }
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
    const drawer = await screen.findByRole("region", {
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
    const skip = await screen.findByRole("region", { name: t.skipTitle });
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
      await harness.local.db
        .update(s.organizations)
        .set({ timezone: "Asia/Tokyo" })
        .where(eq(s.organizations.id, demoId(1)));
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

describe("the sequences tab", () => {
  test("creates a product sequence from the all-products view without enrolling or sending", async () => {
    await mountCrm(harness, "/outreach/sequences");
    const beforeTouches = await harness.local.db.select().from(s.touches);
    const beforeEnrollments = await harness.local.db
      .select()
      .from(s.enrollments);
    fireEvent.click(await screen.findByRole("button", { name: t.newSequence }));
    const dialog = await screen.findByRole("region", { name: t.newSequence });
    const save = within(dialog).getByRole("button", {
      name: t.createSequence,
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(t.product), {
      target: { value: demoId(12) },
    });
    fireEvent.change(within(dialog).getByLabelText(t.sequenceName), {
      target: { value: "Services pilot follow-up" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t.addStep }));
    const second = within(dialog).getByRole("group", {
      name: t.stepLabel.replace("{number}", "2"),
    });
    fireEvent.change(within(second).getByLabelText(t.channel), {
      target: { value: "linkedin" },
    });
    fireEvent.change(within(second).getByLabelText(t.stepDelay), {
      target: { value: "5" },
    });
    fireEvent.change(within(second).getByLabelText(t.stepTemplate), {
      target: { value: "Following up on our pilot scope." },
    });
    fireEvent.click(save);
    await screen.findByText(
      t.sequenceCreated.replace("{name}", "Services pilot follow-up"),
    );
    expect(screen.queryByRole("region", { name: t.newSequence })).toBeNull();
    const [created] = await harness.local.db
      .select()
      .from(s.sequences)
      .where(eq(s.sequences.name, "Services pilot follow-up"));
    expect(created?.productId).toBe(demoId(12));
    expect(
      created?.steps.map((step) => [step.number, step.channel, step.delayDays]),
    ).toEqual([
      [1, "gmail", 0],
      [2, "linkedin", 5],
    ]);
    expect(await harness.local.db.select().from(s.touches)).toEqual(
      beforeTouches,
    );
    expect(await harness.local.db.select().from(s.enrollments)).toEqual(
      beforeEnrollments,
    );
    expect(
      harness.posts.filter((post) => post.operation === "create-sequence"),
    ).toHaveLength(1);
  });

  test("C opens inline sequence creation and Cancel discards it without a mutation", async () => {
    await mountCrm(harness, "/outreach/sequences");
    await screen.findByRole("button", { name: t.newSequence });
    fireEvent.keyDown(document.body, { key: "c" });
    const dialog = await screen.findByRole("region", { name: t.newSequence });
    fireEvent.change(within(dialog).getByLabelText(t.sequenceName), {
      target: { value: "Unsaved sequence" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t.cancel }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: t.newSequence })).toBeNull(),
    );
    expect(
      harness.posts.some((post) => post.operation === "create-sequence"),
    ).toBe(false);
  });

  test("pending creation blocks duplicate submissions and closing, and a failure preserves the draft", async () => {
    await mountCrm(harness, "/outreach/sequences");
    fireEvent.click(await screen.findByRole("button", { name: t.newSequence }));
    const dialog = await screen.findByRole("region", { name: t.newSequence });
    fireEvent.change(within(dialog).getByLabelText(t.sequenceName), {
      target: { value: "Keep this draft" },
    });
    const original = vi.mocked(requestJson).getMockImplementation();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let attempts = 0;
    vi.mocked(requestJson).mockImplementation(async (url, init) => {
      if (
        init?.method === "POST" &&
        JSON.parse(String(init.body)).operation === "create-sequence"
      ) {
        attempts += 1;
        await gate;
        throw new RequestError("INTERNAL_ERROR");
      }
      return original?.(url, init);
    });
    const form = within(dialog).getByRole("form", { name: t.newSequence });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(attempts).toBe(1);
    expect(
      (
        within(dialog).getByRole("button", {
          name: t.cancel,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: t.cancel }));
    expect(screen.getByRole("region", { name: t.newSequence })).toBe(dialog);
    await act(async () => release());
    await within(form).findByRole("alert");
    expect(
      (within(dialog).getByLabelText(t.sequenceName) as HTMLInputElement).value,
    ).toBe("Keep this draft");
    expect(
      (
        within(dialog).getByRole("button", {
          name: t.createSequence,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  test("the editor adds, reorders and removes steps, saves them and says how many planned touches changed", async () => {
    await mountCrm(harness, "/outreach/sequences");
    fireEvent.click(
      await screen.findByRole("button", {
        name: `${t.editSteps}: Thoughtful introduction · AI Platform`,
      }),
    );
    const editor = await screen.findByRole("form", {
      name: `${t.editSteps}: Thoughtful introduction · AI Platform`,
    });
    const step = (number: number) =>
      within(editor).getByRole("group", {
        name: t.stepLabel.replace("{number}", String(number)),
      });
    fireEvent.change(within(step(3)).getByLabelText(t.stepTemplate), {
      target: { value: "Rewritten follow-up" },
    });
    fireEvent.click(within(editor).getByRole("button", { name: t.addStep }));
    fireEvent.change(within(step(5)).getByLabelText(t.stepName), {
      target: { value: "Case study" },
    });
    fireEvent.change(within(step(5)).getByLabelText(t.stepDelay), {
      target: { value: "4" },
    });
    fireEvent.click(
      within(step(5)).getByRole("button", {
        name: t.moveStepUp.replace("{number}", "5"),
      }),
    );
    expect(
      (within(step(4)).getByLabelText(t.stepName) as HTMLInputElement).value,
    ).toBe("Case study");
    fireEvent.click(
      within(step(5)).getByRole("button", {
        name: t.removeStep.replace("{number}", "5"),
      }),
    );
    fireEvent.click(
      within(editor).getByRole("button", { name: t.saveSequence }),
    );
    await screen.findByText(
      t.sequenceSaved
        .replace("{name}", "Thoughtful introduction")
        .replace("{changes}", t.plannedChangedOne),
    );
    const saved = harness.posts.find((post) => post.operation === "sequence");
    expect(
      ((saved?.steps ?? []) as { number: number; name: string }[]).map(
        (item) => [item.number, item.name],
      ),
    ).toEqual([
      [1, "Initial message"],
      [2, "Follow-up 1"],
      [3, "Follow-up 2"],
      [4, "Case study"],
    ]);
    const [touch] = await harness.local.db
      .select()
      .from(s.touches)
      .where(eq(s.touches.id, demoId(1307)));
    expect(touch?.draft).toBe("Rewritten follow-up");
  });

  test("each sequence lists its enrollments with status and step, and pause and resume work from there", async () => {
    await mountCrm(harness, "/outreach/sequences");
    const list = await screen.findByRole("table", {
      name: `${t.enrollments}: Thoughtful introduction · AI Platform`,
    });
    const amara = within(list).getByRole("row", { name: /Amara Stone/ });
    expect(amara.textContent).toContain(t.enrollmentStatus.running);
    expect(amara.textContent).toContain(
      t.currentStep.replace("{step}", "2").replace("{total}", "4"),
    );
    expect(
      within(list).getByRole("row", { name: /Mira Chen/ }).textContent,
    ).toContain(t.paused_reply);
    fireEvent.click(
      within(amara).getByRole("button", { name: `${t.pause}: Amara Stone` }),
    );
    await screen.findByText(t.pausedSequence.replace("{name}", "Amara Stone"));
    await waitFor(() =>
      expect(
        within(
          screen.getByRole("table", {
            name: `${t.enrollments}: Thoughtful introduction · AI Platform`,
          }),
        ).getByRole("button", { name: `${t.resume}: Amara Stone` }),
      ).toBeTruthy(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: `${t.resume}: Amara Stone` }),
    );
    await screen.findByText(t.resumed.replace("{name}", "Amara Stone"));
    const [enrollment] = await harness.local.db
      .select()
      .from(s.enrollments)
      .where(eq(s.enrollments.id, demoId(501)));
    expect(enrollment?.status).toBe("running");
  });
});

describe("the guide", () => {
  test("lists the outreach verbs in their own section and the pipeline keys with the lists", () => {
    render(<Shortcuts onClose={() => {}} />);
    const section = screen.getByRole("region", {
      name: t.shortcutSections.outreach,
    });
    expect(
      [...section.querySelectorAll("[data-shortcut]")].map((row) =>
        row.getAttribute("data-shortcut"),
      ),
    ).toEqual([
      "touch-sent",
      "touch-snooze",
      "touch-skip",
      "touch-edit",
      "touch-undo",
    ]);
    expect(within(section).getByText(t.shortcutLabels.touchSkip)).toBeTruthy();
    const lists = screen.getByRole("region", {
      name: t.shortcutSections.lists,
    });
    expect(
      lists.querySelector('[data-shortcut="move-to"]')?.textContent,
    ).toContain(t.shortcutLabels.moveTo);
  });
});

describe("fix round 1", () => {
  const press = (keys: string) => userEvent.setup().keyboard(keys);
  const verbButton = (name: keyof typeof t.touchVerbs, person: string) =>
    screen.findByRole("button", { name: `${t.touchVerbs[name]}: ${person}` });

  test("the Edit draft, Mark sent and Skip row buttons open inline editors", async () => {
    await mountCrm(harness, "/outreach/today");
    fireEvent.click(await verbButton("edit", "Noor Haddad"));
    const drawer = await screen.findByRole("region", {
      name: t.draftEditorTitle.replace("{name}", "Noor Haddad"),
    });
    expect(document.activeElement).toBe(
      within(drawer).getByLabelText(t.draftLabel),
    );
    fireEvent.click(within(drawer).getByRole("button", { name: t.close }));
    await waitFor(() =>
      expect(
        screen.queryByRole("region", {
          name: t.draftEditorTitle.replace("{name}", "Noor Haddad"),
        }),
      ).toBeNull(),
    );
    fireEvent.click(await verbButton("sent", "Noor Haddad"));
    const sent = await screen.findByRole("region", { name: t.markSentTitle });
    fireEvent.click(within(sent).getByRole("button", { name: t.cancel }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(await verbButton("skip", "Noor Haddad"));
    expect(
      await screen.findByRole("region", { name: t.skipTitle }),
    ).toBeTruthy();
    expect(harness.posts).toEqual([]);
  });

  test("Sent rows flag archived people and peek on Space like paused rows", async () => {
    await harness.local.db
      .update(s.people)
      .set({ archivedAt: new Date() })
      .where(eq(s.people.id, demoId(200)));
    await mountCrm(harness, "/outreach/sent");
    expect(
      await screen.findByRole("button", {
        name: `Mira Chen, ${t.followUpGroups[1]}, ${t.archivedFlag}`,
      }),
    ).toBeTruthy();
    const amara = screen.getByRole("button", {
      name: `Amara Stone, ${t.followUpGroups[0]}`,
    });
    expect(amara.getAttribute("aria-keyshortcuts")).toBe("Space Enter");
    amara.focus();
    await press(" ");
    expect(
      await screen.findByRole("complementary", { name: t.recordDetails }),
    ).toBeTruthy();
    expect(window.location.pathname).toBe("/outreach/sent");
  });

  test("planned touches preview their template with merge fields filled, and the stored draft stays raw", async () => {
    await mountCrm(harness, "/outreach/drafts");
    const row = await screen.findByRole("button", { name: /^Noor Haddad, / });
    expect(row.textContent).toContain(
      "Hi Noor, one more idea: a fictional case study from a similar team.",
    );
    expect(row.textContent).not.toContain("{first name}");
    fireEvent.click(row);
    const drawer = await screen.findByRole("region", {
      name: t.draftEditorTitle.replace("{name}", "Noor Haddad"),
    });
    expect(
      (within(drawer).getByLabelText(t.draftLabel) as HTMLTextAreaElement)
        .value,
    ).toMatch(/^Hi \{first name\}, one more idea/);
    const preview = within(drawer).getByRole("region", {
      name: t.mergePreview,
    });
    expect(preview.querySelector("p")?.textContent).toMatch(
      /^Hi Noor, one more idea/,
    );
  });

  test("/sequences moves to the Sequences tab and the sidebar Sequences item points and lights there", async () => {
    const { default: Page } = await import("../src/app/(crm)/sequences/page");
    expect(() => Page()).toThrow("NEXT_REDIRECT");
    await mountCrm(harness, "/outreach/sequences");
    const current = document.querySelectorAll<HTMLElement>(
      '.sidebar [aria-current="page"]',
    );
    expect([...current].map((link) => link.dataset.navItem)).toEqual([
      "sequences",
    ]);
    expect(current[0]?.getAttribute("href")).toBe("/outreach/sequences");
  });
});

test("unsaved outreach text survives row changes, status actions and Close until Cancel is explicit", async () => {
  await mountCrm(harness, "/outreach/today");
  fireEvent.click(
    await screen.findByRole("button", {
      name: `${t.touchVerbs.edit}: Noor Haddad`,
    }),
  );
  const drawer = await screen.findByRole("region", {
    name: t.draftEditorTitle.replace("{name}", "Noor Haddad"),
  });
  const field = within(drawer).getByLabelText(t.draftLabel);
  fireEvent.change(field, { target: { value: "Fictional unsaved outreach" } });
  fireEvent.click(
    await screen.findByRole("button", {
      name: `${t.touchVerbs.edit}: Ellis Park`,
    }),
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: `${t.touchVerbs.sent}: Noor Haddad`,
    }),
  );
  fireEvent.click(within(drawer).getByRole("button", { name: t.close }));
  expect(field).toHaveProperty("value", "Fictional unsaved outreach");
  expect(screen.queryByRole("region", { name: t.markSentTitle })).toBeNull();
  expect(harness.posts).toEqual([]);
  fireEvent.click(within(drawer).getByRole("button", { name: t.cancel }));
  fireEvent.click(within(drawer).getByRole("button", { name: t.close }));
  await waitFor(() =>
    expect(
      screen.queryByRole("region", {
        name: t.draftEditorTitle.replace("{name}", "Noor Haddad"),
      }),
    ).toBeNull(),
  );
});

test("live outreach refreshes preserve the draft's original version and expose a conflict instead of overwriting remote text", async () => {
  await mountCrm(harness, "/outreach/today");
  fireEvent.click(
    await screen.findByRole("button", {
      name: `${t.touchVerbs.edit}: Noor Haddad`,
    }),
  );
  const drawer = await screen.findByRole("region", {
    name: t.draftEditorTitle.replace("{name}", "Noor Haddad"),
  });
  const field = within(drawer).getByLabelText(t.draftLabel);
  const [original] = await harness.local.db
    .select()
    .from(s.touches)
    .where(eq(s.touches.id, demoId(1307)));
  if (!original) throw new Error("Missing touch fixture");
  fireEvent.change(field, { target: { value: "Local unsaved draft" } });
  await harness.local.db
    .update(s.touches)
    .set({
      draft: "Remote saved draft",
      version: original.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(s.touches.id, original.id));
  fireEvent.focus(window);
  await waitFor(
    () =>
      expect(
        vi
          .mocked(requestJson)
          .mock.calls.some(([url]) =>
            String(url).includes(
              `touchId=${original.id}&version=${original.version + 1}`,
            ),
          ),
      ).toBe(true),
    { timeout: 5000 },
  );
  expect(field).toHaveProperty("value", "Local unsaved draft");
  fireEvent.click(within(drawer).getByRole("button", { name: t.saveDraft }));
  expect(await within(drawer).findByRole("alert")).toHaveProperty(
    "textContent",
    t.errors.CONFLICT,
  );
  expect(field).toHaveProperty("value", "Local unsaved draft");
  const [stored] = await harness.local.db
    .select()
    .from(s.touches)
    .where(eq(s.touches.id, original.id));
  expect(stored?.draft).toBe("Remote saved draft");
});

test("sequence step buttons protect edits even before a text field changes", async () => {
  await mountCrm(harness, "/outreach/sequences");
  fireEvent.click(
    await screen.findByRole("button", {
      name: `${t.editSteps}: Thoughtful introduction · AI Platform`,
    }),
  );
  const editor = screen.getByRole("form", {
    name: `${t.editSteps}: Thoughtful introduction · AI Platform`,
  });
  fireEvent.click(
    within(editor).getByRole("button", {
      name: t.moveStepDown.replace("{number}", "1"),
    }),
  );
  fireEvent.click(screen.getByRole("link", { name: t.companies }));
  expect(pathname()).toBe("/outreach/sequences");
  expect(editor.getAttribute("data-dirty")).toBe("true");
  fireEvent.click(within(editor).getByRole("button", { name: t.cancel }));
  fireEvent.click(screen.getByRole("link", { name: t.companies }));
  await waitFor(() => expect(pathname()).toBe("/companies"));
});
